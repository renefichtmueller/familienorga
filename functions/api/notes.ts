interface Env {
  DB: D1Database;
}

// GET: List all notes for household
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const notes = await context.env.DB.prepare(
    `SELECT id, title, content, category, pinned, created_at, updated_at
     FROM notes WHERE household_id = ?
     ORDER BY pinned DESC, updated_at DESC`
  )
    .bind(householdId)
    .all();

  return Response.json({ notes: notes.results });
};

// POST: Create a new note
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as {
    title: string;
    content?: string;
    category?: string;
  };

  if (!body.title?.trim()) {
    return Response.json({ error: "Titel fehlt" }, { status: 400 });
  }

  const id = crypto.randomUUID();

  await context.env.DB.prepare(
    "INSERT INTO notes (id, household_id, title, content, category) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, householdId, body.title.trim(), body.content || "", body.category || "Allgemein")
    .run();

  return Response.json({ id, title: body.title.trim(), content: body.content || "", category: body.category || "Allgemein", pinned: 0 });
};
