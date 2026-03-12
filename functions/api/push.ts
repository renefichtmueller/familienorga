interface Env {
  DB: D1Database;
}

// POST: Subscribe to push notifications
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return Response.json({ error: "Ungueltige Subscription" }, { status: 400 });
  }

  // Check if this endpoint already exists
  const existing = await context.env.DB.prepare(
    "SELECT id FROM push_subscriptions WHERE endpoint = ?"
  )
    .bind(body.endpoint)
    .first();

  if (existing) {
    // Update existing
    await context.env.DB.prepare(
      "UPDATE push_subscriptions SET household_id = ?, p256dh = ?, auth = ? WHERE id = ?"
    )
      .bind(householdId, body.keys.p256dh, body.keys.auth, existing.id)
      .run();
    return Response.json({ ok: true, updated: true });
  }

  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT INTO push_subscriptions (id, household_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, householdId, body.endpoint, body.keys.p256dh, body.keys.auth)
    .run();

  return Response.json({ ok: true });
};

// DELETE: Unsubscribe
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as { endpoint: string };

  await context.env.DB.prepare(
    "DELETE FROM push_subscriptions WHERE endpoint = ? AND household_id = ?"
  )
    .bind(body.endpoint, householdId)
    .run();

  return Response.json({ ok: true });
};
