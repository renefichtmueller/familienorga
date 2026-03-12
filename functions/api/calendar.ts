interface Env {
  DB: D1Database;
}

interface ItemRow {
  id: string;
  name: string;
  due_date: string;
  due_time: string | null;
  recurrence: string | null;
  assigned_to: string | null;
  checked: number;
  list_name: string;
  list_emoji: string;
}

function expandRecurrence(item: ItemRow, year: number, month: number): ItemRow[] {
  const results: ItemRow[] = [];
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // last day of month

  if (!item.recurrence || !item.due_date) {
    // Non-recurring: just check if it falls in this month
    const d = new Date(item.due_date + "T00:00:00");
    if (d >= monthStart && d <= monthEnd) {
      results.push(item);
    }
    return results;
  }

  const baseDate = new Date(item.due_date + "T00:00:00");

  if (item.recurrence === "weekly") {
    // Find all occurrences of this weekday in the month
    const dayOfWeek = baseDate.getDay();
    const d = new Date(monthStart);
    // Find first occurrence of this day of week
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
    while (d <= monthEnd) {
      if (d >= baseDate) {
        results.push({
          ...item,
          due_date: d.toISOString().split("T")[0],
        });
      }
      d.setDate(d.getDate() + 7);
    }
  } else if (item.recurrence === "monthly") {
    const dayOfMonth = baseDate.getDate();
    const maxDay = monthEnd.getDate();
    const effectiveDay = Math.min(dayOfMonth, maxDay);
    const candidate = new Date(year, month - 1, effectiveDay);
    if (candidate >= baseDate) {
      results.push({
        ...item,
        due_date: candidate.toISOString().split("T")[0],
      });
    }
  } else if (item.recurrence === "yearly") {
    if (baseDate.getMonth() === month - 1) {
      const dayOfMonth = baseDate.getDate();
      const maxDay = monthEnd.getDate();
      const effectiveDay = Math.min(dayOfMonth, maxDay);
      const candidate = new Date(year, month - 1, effectiveDay);
      if (candidate >= baseDate || candidate.getFullYear() > baseDate.getFullYear()) {
        results.push({
          ...item,
          due_date: candidate.toISOString().split("T")[0],
        });
      }
    }
  }

  return results;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const url = new URL(context.request.url);
  const year = parseInt(url.searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(url.searchParams.get("month") || (new Date().getMonth() + 1).toString());

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return Response.json({ error: "Ungueltige Parameter" }, { status: 400 });
  }

  // Get all items with due_date from all lists in this household
  // Include items from previous months that have recurrence (they might repeat into this month)
  const items = await context.env.DB.prepare(
    `SELECT i.id, i.name, i.due_date, i.due_time, i.recurrence, i.assigned_to, i.checked,
            l.name as list_name, l.emoji as list_emoji
     FROM items i
     JOIN lists l ON i.list_id = l.id
     WHERE l.household_id = ?
       AND i.due_date IS NOT NULL
       AND (
         -- Items in this month
         (i.due_date >= ? AND i.due_date <= ?)
         -- Or recurring items from before that repeat into this month
         OR (i.recurrence IS NOT NULL AND i.due_date <= ?)
       )
     ORDER BY i.due_date ASC, i.due_time ASC NULLS LAST`
  )
    .bind(
      householdId,
      `${year}-${String(month).padStart(2, "0")}-01`,
      `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`,
      `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`
    )
    .all();

  // Expand recurring items for this month
  const expanded: ItemRow[] = [];
  for (const row of items.results as unknown as ItemRow[]) {
    if (row.recurrence) {
      expanded.push(...expandRecurrence(row, year, month));
    } else {
      expanded.push(row);
    }
  }

  // Sort by date, then time
  expanded.sort((a, b) => {
    if (a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
    if (!a.due_time) return 1;
    if (!b.due_time) return -1;
    return a.due_time.localeCompare(b.due_time);
  });

  // ── Travel events from cache ──
  const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;

  const travelRows = await context.env.DB
    .prepare(
      `SELECT member_name, summary, location, start_date, end_date
       FROM travel_events_cache
       WHERE household_id = ?
         AND start_date <= ? AND end_date >= ?
       ORDER BY start_date ASC`
    )
    .bind(householdId, monthEndStr, monthStartStr)
    .all();

  // Expand multi-day travel events into per-day entries for the calendar
  const travelEvents: Array<{
    type: string;
    member_name: string;
    summary: string;
    location: string | null;
    start_date: string;
    end_date: string;
    due_date: string;
  }> = [];

  for (const row of (travelRows.results || []) as any[]) {
    const start = new Date(Math.max(
      new Date(row.start_date + "T00:00:00").getTime(),
      new Date(monthStartStr + "T00:00:00").getTime()
    ));
    const end = new Date(Math.min(
      new Date(row.end_date + "T00:00:00").getTime(),
      new Date(monthEndStr + "T00:00:00").getTime()
    ));

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      travelEvents.push({
        type: "travel",
        member_name: row.member_name,
        summary: row.summary,
        location: row.location,
        start_date: row.start_date,
        end_date: row.end_date,
        due_date: d.toISOString().split("T")[0],
      });
    }
  }

  return Response.json({ items: expanded, travel: travelEvents, year, month });
};
