interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const lists = await context.env.DB.prepare(
    `SELECT l.id, l.name, l.emoji, l.category, l.sort_order, l.created_at, l.updated_at,
            (SELECT COUNT(*) FROM items WHERE list_id = l.id) as total_items,
            (SELECT COUNT(*) FROM items WHERE list_id = l.id AND checked = 0) as open_items
     FROM lists l
     WHERE l.household_id = ?
     ORDER BY l.category, l.sort_order, l.created_at`
  )
    .bind(householdId)
    .all();

  // Collect unique categories for the frontend
  const categories = [...new Set((lists.results as any[]).map((l) => l.category || "Einkauf"))];

  return Response.json({ lists: lists.results, categories });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as {
    name: string;
    emoji?: string;
    category?: string;
  };

  if (!body.name?.trim()) {
    return Response.json({ error: "Name fehlt" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const emoji = body.emoji || "\u{1F6D2}";
  const category = body.category?.trim() || "Einkauf";

  await context.env.DB.prepare(
    "INSERT INTO lists (id, household_id, name, emoji, category) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, householdId, body.name.trim(), emoji, category)
    .run();

  return Response.json({ id, name: body.name.trim(), emoji, category });
};
