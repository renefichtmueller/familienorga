interface Env {
  DB: D1Database;
}

// POST: Add new item to list (id = list_id)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const listId = context.params.id as string;

  // Verify list belongs to household
  const list = await context.env.DB.prepare(
    "SELECT id FROM lists WHERE id = ? AND household_id = ?"
  )
    .bind(listId, householdId)
    .first();

  if (!list) {
    return Response.json({ error: "Liste nicht gefunden" }, { status: 404 });
  }

  const body = (await context.request.json()) as {
    name: string;
    quantity?: string;
    due_date?: string;
    due_time?: string;
    recurrence?: string;
    assigned_to?: string;
  };

  if (!body.name?.trim()) {
    return Response.json({ error: "Name fehlt" }, { status: 400 });
  }

  const id = crypto.randomUUID();

  await context.env.DB.prepare(
    "INSERT INTO items (id, list_id, name, quantity, due_date, due_time, recurrence, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, listId, body.name.trim(), body.quantity || null, body.due_date || null, body.due_time || null, body.recurrence || null, body.assigned_to || null)
    .run();

  // Update list timestamp
  await context.env.DB.prepare(
    "UPDATE lists SET updated_at = datetime('now') WHERE id = ?"
  )
    .bind(listId)
    .run();

  return Response.json({
    id,
    name: body.name.trim(),
    quantity: body.quantity || null,
    due_date: body.due_date || null,
    due_time: body.due_time || null,
    recurrence: body.recurrence || null,
    assigned_to: body.assigned_to || null,
    checked: 0,
  });
};

// PATCH: Update item (id = item_id)
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const itemId = context.params.id as string;

  // Verify item belongs to household
  const item = await context.env.DB.prepare(
    `SELECT i.id, i.list_id FROM items i
     JOIN lists l ON l.id = i.list_id
     WHERE i.id = ? AND l.household_id = ?`
  )
    .bind(itemId, householdId)
    .first();

  if (!item) {
    return Response.json({ error: "Item nicht gefunden" }, { status: 404 });
  }

  const body = (await context.request.json()) as {
    checked?: number;
    name?: string;
    quantity?: string;
    due_date?: string | null;
    due_time?: string | null;
    recurrence?: string | null;
    assigned_to?: string | null;
  };

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.checked !== undefined) {
    updates.push("checked = ?");
    values.push(body.checked ? 1 : 0);
  }
  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.due_date !== undefined) {
    updates.push("due_date = ?");
    values.push(body.due_date);
  }
  if (body.due_time !== undefined) {
    updates.push("due_time = ?");
    values.push(body.due_time);
  }
  if (body.quantity !== undefined) {
    updates.push("quantity = ?");
    values.push(body.quantity || null);
  }
  if (body.recurrence !== undefined) {
    updates.push("recurrence = ?");
    values.push(body.recurrence || null);
  }
  if (body.assigned_to !== undefined) {
    updates.push("assigned_to = ?");
    values.push(body.assigned_to || null);
  }

  if (updates.length === 0) {
    return Response.json({ error: "Nichts zu aendern" }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  values.push(itemId);

  await context.env.DB.prepare(
    `UPDATE items SET ${updates.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  // Update list timestamp
  await context.env.DB.prepare(
    "UPDATE lists SET updated_at = datetime('now') WHERE id = ?"
  )
    .bind(item.list_id as string)
    .run();

  return Response.json({ ok: true });
};

// DELETE: Remove item (id = item_id)
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const itemId = context.params.id as string;

  // Verify item belongs to household
  const item = await context.env.DB.prepare(
    `SELECT i.id, i.list_id FROM items i
     JOIN lists l ON l.id = i.list_id
     WHERE i.id = ? AND l.household_id = ?`
  )
    .bind(itemId, householdId)
    .first();

  if (!item) {
    return Response.json({ error: "Item nicht gefunden" }, { status: 404 });
  }

  await context.env.DB.prepare("DELETE FROM items WHERE id = ?")
    .bind(itemId)
    .run();

  return Response.json({ ok: true });
};
