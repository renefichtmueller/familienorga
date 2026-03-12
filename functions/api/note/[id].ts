interface Env {
  DB: D1Database;
}

// PATCH: Update a note
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const noteId = context.params.id as string;

  const note = await context.env.DB.prepare(
    "SELECT id FROM notes WHERE id = ? AND household_id = ?"
  )
    .bind(noteId, householdId)
    .first();

  if (!note) {
    return Response.json({ error: "Notiz nicht gefunden" }, { status: 404 });
  }

  const body = (await context.request.json()) as {
    title?: string;
    content?: string;
    category?: string;
    pinned?: number;
  };

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.title !== undefined) {
    updates.push("title = ?");
    values.push(body.title.trim());
  }
  if (body.content !== undefined) {
    updates.push("content = ?");
    values.push(body.content);
  }
  if (body.category !== undefined) {
    updates.push("category = ?");
    values.push(body.category);
  }
  if (body.pinned !== undefined) {
    updates.push("pinned = ?");
    values.push(body.pinned ? 1 : 0);
  }

  if (updates.length === 0) {
    return Response.json({ error: "Nichts zu aendern" }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  values.push(noteId);

  await context.env.DB.prepare(
    `UPDATE notes SET ${updates.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  return Response.json({ ok: true });
};

// DELETE: Remove a note
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const noteId = context.params.id as string;

  await context.env.DB.prepare(
    "DELETE FROM notes WHERE id = ? AND household_id = ?"
  )
    .bind(noteId, householdId)
    .run();

  return Response.json({ ok: true });
};
