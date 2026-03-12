interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const listId = context.params.id as string;

  const list = await context.env.DB.prepare(
    "SELECT id, name, emoji, category FROM lists WHERE id = ? AND household_id = ?"
  )
    .bind(listId, householdId)
    .first();

  if (!list) {
    return Response.json({ error: "Liste nicht gefunden" }, { status: 404 });
  }

  const isTermine = list.category === "Termine";

  const items = await context.env.DB.prepare(
    isTermine
      ? `SELECT id, name, checked, quantity, due_date, due_time, recurrence, assigned_to, sort_order, created_at, updated_at
         FROM items WHERE list_id = ?
         ORDER BY checked ASC, due_date ASC NULLS LAST, due_time ASC NULLS LAST, created_at DESC`
      : `SELECT id, name, checked, quantity, due_date, due_time, recurrence, assigned_to, sort_order, created_at, updated_at
         FROM items WHERE list_id = ?
         ORDER BY checked ASC, sort_order ASC, created_at DESC`
  )
    .bind(listId)
    .all();

  return Response.json({
    list,
    items: items.results,
    _ts: Date.now(),
  });
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const listId = context.params.id as string;
  const body = (await context.request.json()) as {
    name?: string;
    emoji?: string;
  };

  const updates: string[] = [];
  const values: string[] = [];

  if (body.name?.trim()) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.emoji) {
    updates.push("emoji = ?");
    values.push(body.emoji);
  }

  if (updates.length === 0) {
    return Response.json({ error: "Nichts zu aendern" }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  values.push(listId, householdId);

  await context.env.DB.prepare(
    `UPDATE lists SET ${updates.join(", ")} WHERE id = ? AND household_id = ?`
  )
    .bind(...values)
    .run();

  return Response.json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const listId = context.params.id as string;

  // Delete items first (cascade might not work in D1)
  await context.env.DB.prepare("DELETE FROM items WHERE list_id = ?")
    .bind(listId)
    .run();

  await context.env.DB.prepare(
    "DELETE FROM lists WHERE id = ? AND household_id = ?"
  )
    .bind(listId, householdId)
    .run();

  return Response.json({ ok: true });
};
