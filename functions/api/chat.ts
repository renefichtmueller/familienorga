interface Env {
  DB: D1Database;
  OLLAMA_URL: string;
  OLLAMA_API_KEY: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

async function buildSystemPrompt(db: D1Database, householdId: string): Promise<string> {
  // Get household info
  const household = await db
    .prepare("SELECT name FROM households WHERE id = ?")
    .bind(householdId)
    .first();

  // Get members
  const members = await db
    .prepare("SELECT name, color FROM members WHERE household_id = ? ORDER BY sort_order")
    .bind(householdId)
    .all();

  // Get open items from all lists (max 30)
  const openItems = await db
    .prepare(
      `SELECT i.name, i.due_date, i.due_time, i.assigned_to, i.quantity,
              l.name as list_name, l.category, l.emoji
       FROM items i
       JOIN lists l ON i.list_id = l.id
       WHERE l.household_id = ? AND i.checked = 0
       ORDER BY i.due_date ASC NULLS LAST, i.created_at DESC
       LIMIT 30`
    )
    .bind(householdId)
    .all();

  // Get recent notes titles
  const notes = await db
    .prepare(
      `SELECT title FROM notes WHERE household_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 10`
    )
    .bind(householdId)
    .all();

  const familyName = (household?.name as string) || "Familie";
  const memberList = (members.results || [])
    .map((m: any) => m.name)
    .join(", ");

  // Group items by category
  const byCategory: Record<string, string[]> = {};
  for (const item of (openItems.results || []) as any[]) {
    const cat = `${item.emoji} ${item.list_name}`;
    if (!byCategory[cat]) byCategory[cat] = [];
    let desc = item.name;
    if (item.quantity) desc += ` (${item.quantity})`;
    if (item.due_date) {
      const d = new Date(item.due_date + "T00:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
      if (diff === 0) desc += " [HEUTE]";
      else if (diff === 1) desc += " [morgen]";
      else if (diff < 0) desc += ` [${Math.abs(diff)} Tage ueberfaellig!]`;
      else desc += ` [${item.due_date}]`;
      if (item.due_time) desc += ` ${item.due_time}`;
    }
    if (item.assigned_to) desc += ` → ${item.assigned_to}`;
    byCategory[cat].push(desc);
  }

  let itemsText = "";
  for (const [cat, items] of Object.entries(byCategory)) {
    itemsText += `\n${cat}:\n`;
    items.forEach((i) => (itemsText += `  - ${i}\n`));
  }

  const notesText = (notes.results || [])
    .map((n: any) => n.title)
    .join(", ");

  return `Du bist der freundliche Familien-Assistent fuer ${familyName}.
Mitglieder: ${memberList || "noch keine eingetragen"}.
Antworte immer auf Deutsch, kurz und hilfreich. Nutze Emojis sparsam.
Heute ist ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.

Aktuelle offene Eintraege:${itemsText || "\n  Keine offenen Eintraege."}
${notesText ? `\nNotizen: ${notesText}` : ""}

Du kannst bei Fragen zum Familienalltag helfen, Rezepte vorschlagen, an Termine erinnern, beim Planen helfen oder einfach nett plaudern.`;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as {
    message: string;
    history?: ChatMessage[];
  };

  if (!body.message?.trim()) {
    return Response.json({ error: "Nachricht fehlt" }, { status: 400 });
  }

  // Build system prompt with family context
  const systemPrompt = await buildSystemPrompt(context.env.DB, householdId);

  // Build message history
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...(body.history || []).slice(-10), // Last 10 messages for context
    { role: "user", content: body.message.trim() },
  ];

  // Call Ollama via tunnel
  const ollamaUrl = context.env.OLLAMA_URL || "https://ollama.fichtmueller.org";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add Ollama API key
  if (context.env.OLLAMA_API_KEY) {
    headers["x-ollama-key"] = context.env.OLLAMA_API_KEY;
  }

  // Add Cloudflare Access service token if configured
  if (context.env.CF_ACCESS_CLIENT_ID && context.env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = context.env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = context.env.CF_ACCESS_CLIENT_SECRET;
  }

  try {
    const ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "qwen2.5:7b",
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 512,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      const errText = await ollamaResponse.text();
      console.error("Ollama error:", ollamaResponse.status, errText);
      return Response.json(
        { error: "AI nicht erreichbar", detail: ollamaResponse.status },
        { status: 502 }
      );
    }

    const result = (await ollamaResponse.json()) as {
      message?: { content: string };
    };
    const reply = result.message?.content || "Keine Antwort erhalten.";

    // Save to chat history
    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO chat_messages (id, household_id, role, content) VALUES (?, ?, 'user', ?)"
      ).bind(userMsgId, householdId, body.message.trim()),
      context.env.DB.prepare(
        "INSERT INTO chat_messages (id, household_id, role, content) VALUES (?, ?, 'assistant', ?)"
      ).bind(assistantMsgId, householdId, reply),
    ]);

    return Response.json({ reply });
  } catch (err: any) {
    console.error("Chat error:", err);
    return Response.json(
      { error: "Verbindungsfehler zum AI-Server", detail: err.message },
      { status: 502 }
    );
  }
};

// GET: Load chat history
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const messages = await context.env.DB.prepare(
    `SELECT role, content, created_at FROM chat_messages
     WHERE household_id = ?
     ORDER BY created_at DESC
     LIMIT 50`
  )
    .bind(householdId)
    .all();

  // Return in chronological order
  return Response.json({
    messages: (messages.results || []).reverse(),
  });
};
