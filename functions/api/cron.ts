import webpush from "web-push";

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  CRON_SECRET?: string;
}

// POST: Trigger daily summary + reminder push notifications
// Call daily at 18:00 via external cron (e.g. cron-job.org)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  // Protect with secret
  const secret = context.request.headers.get("X-Cron-Secret");
  if (context.env.CRON_SECRET && secret !== context.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  webpush.setVapidDetails(
    context.env.VAPID_SUBJECT,
    context.env.VAPID_PUBLIC_KEY,
    context.env.VAPID_PRIVATE_KEY
  );

  const results: string[] = [];

  // Get all households
  const households = await context.env.DB.prepare(
    "SELECT id, name FROM households"
  ).all();

  for (const household of households.results) {
    const householdId = household.id as string;

    // 1. Today's changes
    const today = new Date().toISOString().split("T")[0];
    const changedItems = await context.env.DB.prepare(
      `SELECT i.name, i.checked, l.name as list_name
       FROM items i JOIN lists l ON l.id = i.list_id
       WHERE l.household_id = ? AND date(i.updated_at) = ?`
    )
      .bind(householdId, today)
      .all();

    // 2. Tomorrow's Termine
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const upcomingTermine = await context.env.DB.prepare(
      `SELECT i.name, i.due_time, i.recurrence
       FROM items i JOIN lists l ON l.id = i.list_id
       WHERE l.household_id = ? AND l.category = 'Termine'
       AND i.due_date = ? AND i.checked = 0`
    )
      .bind(householdId, tomorrowStr)
      .all();

    // 3. Open tasks (Aufgaben) due today or overdue
    const openTasks = await context.env.DB.prepare(
      `SELECT i.name, i.assigned_to, i.due_date
       FROM items i JOIN lists l ON l.id = i.list_id
       WHERE l.household_id = ? AND l.category = 'Aufgaben'
       AND i.checked = 0 AND i.due_date IS NOT NULL AND i.due_date <= ?`
    )
      .bind(householdId, today)
      .all();

    // Build notification
    const parts: string[] = [];

    if (changedItems.results.length > 0) {
      const checked = changedItems.results.filter((i) => i.checked).length;
      const open = changedItems.results.filter((i) => !i.checked).length;
      if (checked > 0) parts.push(`${checked} erledigt`);
      if (open > 0) parts.push(`${open} neu/offen`);
    }

    if (upcomingTermine.results.length > 0) {
      const names = upcomingTermine.results
        .map((t) => {
          let s = t.name as string;
          if (t.due_time) s += ` (${t.due_time})`;
          return s;
        })
        .join(", ");
      parts.push(`Morgen: ${names}`);
    }

    if (openTasks.results.length > 0) {
      const taskNames = openTasks.results
        .map((t) => {
          let s = t.name as string;
          if (t.assigned_to) s += ` (${t.assigned_to})`;
          return s;
        })
        .slice(0, 3)
        .join(", ");
      const extra = openTasks.results.length > 3 ? ` +${openTasks.results.length - 3}` : "";
      parts.push(`Aufgaben: ${taskNames}${extra}`);
    }

    if (parts.length === 0) continue;

    const body = parts.join(" | ");
    const payload = JSON.stringify({
      title: "Tages-Update",
      body,
      tag: "daily-summary",
      url: "/",
    });

    // Get push subscriptions
    const subs = await context.env.DB.prepare(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE household_id = ?"
    )
      .bind(householdId)
      .all();

    for (const sub of subs.results) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: {
              p256dh: sub.p256dh as string,
              auth: sub.auth as string,
            },
          },
          payload
        );
        results.push(`OK: ${householdId.slice(0, 8)}`);
      } catch (err: any) {
        results.push(`FAIL: ${err.statusCode || err.message}`);
        // Remove expired subscriptions
        if (err.statusCode === 410 || err.statusCode === 404) {
          await context.env.DB.prepare(
            "DELETE FROM push_subscriptions WHERE id = ?"
          )
            .bind(sub.id)
            .run();
        }
      }
    }
  }

  return Response.json({ ok: true, sent: results.length, details: results });
};
