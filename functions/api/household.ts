interface Env {
  DB: D1Database;
}

function generateId(): string {
  return crypto.randomUUID();
}

function generateShareCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) {
    code += chars[arr[i] % chars.length];
  }
  return code;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as {
    action: string;
    code?: string;
    name?: string;
    members?: string[];
  };

  if (body.action === "create") {
    const id = generateId();
    const shareCode = generateShareCode();
    const name = body.name || "Unser Haushalt";

    await context.env.DB.prepare(
      "INSERT INTO households (id, share_code, name) VALUES (?, ?, ?)"
    )
      .bind(id, shareCode, name)
      .run();

    // Create default lists
    const defaults = [
      { name: "Lebensmittel und Co", emoji: "\u{1F6D2}", category: "Einkauf", sort: 0 },
      { name: "Kosmetik", emoji: "\u{1F484}", category: "Einkauf", sort: 1 },
      { name: "Reinigungsmittel", emoji: "\u{1F9F9}", category: "Einkauf", sort: 2 },
    ];

    const stmt = context.env.DB.prepare(
      "INSERT INTO lists (id, household_id, name, emoji, category, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
    await context.env.DB.batch(
      defaults.map((d) =>
        stmt.bind(generateId(), id, d.name, d.emoji, d.category, d.sort)
      )
    );

    // Create initial members if provided
    if (body.members && body.members.length > 0) {
      const memberColors = ["#4a90d9", "#d94a8c", "#9b59b6", "#e67e22", "#27ae60"];
      const memberStmt = context.env.DB.prepare(
        "INSERT INTO members (id, household_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)"
      );
      await context.env.DB.batch(
        body.members.filter(m => m.trim()).map((m, i) =>
          memberStmt.bind(generateId(), id, m.trim(), memberColors[i % memberColors.length], i)
        )
      );
    }

    return Response.json({ id, shareCode, name });
  }

  if (body.action === "join") {
    const code = (body.code || "").toUpperCase().trim();
    if (!code) {
      return Response.json({ error: "Code fehlt" }, { status: 400 });
    }

    const result = await context.env.DB.prepare(
      "SELECT id, share_code, name FROM households WHERE share_code = ?"
    )
      .bind(code)
      .first();

    if (!result) {
      return Response.json(
        { error: "Code nicht gefunden" },
        { status: 404 }
      );
    }

    return Response.json({
      id: result.id,
      shareCode: result.share_code,
      name: result.name,
    });
  }

  return Response.json({ error: "Ungueltige Aktion" }, { status: 400 });
};
