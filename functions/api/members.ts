interface Env {
  DB: D1Database;
}

const MEMBER_COLORS = [
  "#4a90d9", "#d94a8c", "#9b59b6", "#e67e22", "#27ae60",
  "#e74c3c", "#1abc9c", "#f39c12", "#3498db", "#8e44ad",
];

// GET: List members for household
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const members = await context.env.DB.prepare(
    "SELECT id, name, color, sort_order FROM members WHERE household_id = ? ORDER BY sort_order, created_at"
  )
    .bind(householdId)
    .all();

  // Also return household name
  const household = await context.env.DB.prepare(
    "SELECT name FROM households WHERE id = ?"
  )
    .bind(householdId)
    .first();

  return Response.json({
    members: members.results,
    householdName: household?.name || "Unser Haushalt",
  });
};

// POST: Add a member
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as { name: string };

  if (!body.name?.trim()) {
    return Response.json({ error: "Name fehlt" }, { status: 400 });
  }

  // Count existing members for color assignment
  const count = await context.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM members WHERE household_id = ?"
  )
    .bind(householdId)
    .first();

  const colorIdx = ((count?.cnt as number) || 0) % MEMBER_COLORS.length;
  const id = crypto.randomUUID();

  await context.env.DB.prepare(
    "INSERT INTO members (id, household_id, name, color, sort_order) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, householdId, body.name.trim(), MEMBER_COLORS[colorIdx], (count?.cnt as number) || 0)
    .run();

  return Response.json({ id, name: body.name.trim(), color: MEMBER_COLORS[colorIdx] });
};

// DELETE: Remove a member (via query param ?id=xxx)
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const url = new URL(context.request.url);
  const memberId = url.searchParams.get("id");
  if (!memberId) {
    return Response.json({ error: "Member-ID fehlt" }, { status: 400 });
  }

  await context.env.DB.prepare(
    "DELETE FROM members WHERE id = ? AND household_id = ?"
  )
    .bind(memberId, householdId)
    .run();

  return Response.json({ ok: true });
};
