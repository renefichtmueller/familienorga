interface Env {
  DB: D1Database;
}

interface TravelFeed {
  id: string;
  household_id: string;
  member_name: string;
  feed_url: string;
  label: string;
}

interface TravelEvent {
  id: string;
  member_name: string;
  uid: string;
  summary: string;
  location: string | null;
  start_date: string;
  end_date: string;
  description: string | null;
  type: "travel";
}

// ── Minimal iCal Parser ──

function parseIcalDate(value: string): string {
  // Handles YYYYMMDD and YYYYMMDDTHHmmssZ formats
  const cleaned = value.replace(/[^0-9T]/g, "").split("T")[0];
  if (cleaned.length >= 8) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  return value;
}

function parseIcalEvents(icalText: string): Array<{
  uid: string;
  summary: string;
  location: string | null;
  start_date: string;
  end_date: string;
  description: string | null;
}> {
  const events: Array<{
    uid: string;
    summary: string;
    location: string | null;
    start_date: string;
    end_date: string;
    description: string | null;
  }> = [];

  // Unfold long lines (RFC 5545: lines starting with space/tab are continuations)
  const unfolded = icalText.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  let uid = "";
  let summary = "";
  let location: string | null = null;
  let dtstart = "";
  let dtend = "";
  let description: string | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      uid = "";
      summary = "";
      location = null;
      dtstart = "";
      dtend = "";
      description = null;
      continue;
    }

    if (line === "END:VEVENT") {
      if (inEvent && summary && dtstart) {
        events.push({
          uid: uid || crypto.randomUUID(),
          summary,
          location,
          start_date: parseIcalDate(dtstart),
          end_date: dtend ? parseIcalDate(dtend) : parseIcalDate(dtstart),
          description,
        });
      }
      inEvent = false;
      continue;
    }

    if (!inEvent) continue;

    // Handle properties (may have params like DTSTART;VALUE=DATE:20260315)
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const propPart = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1).trim();
    const propName = propPart.split(";")[0].toUpperCase();

    switch (propName) {
      case "UID":
        uid = value;
        break;
      case "SUMMARY":
        summary = value.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\\\/g, "\\");
        break;
      case "LOCATION":
        location = value.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\\\/g, "\\") || null;
        break;
      case "DTSTART":
        dtstart = value;
        break;
      case "DTEND":
        dtend = value;
        break;
      case "DESCRIPTION":
        description = value.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\") || null;
        break;
    }
  }

  return events;
}

// ── Cache logic ──

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function isCacheFresh(db: D1Database, householdId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT cached_at FROM travel_events_cache WHERE household_id = ? ORDER BY cached_at DESC LIMIT 1")
    .bind(householdId)
    .first<{ cached_at: string }>();

  if (!row) return false;

  const cachedAt = new Date(row.cached_at + "Z").getTime();
  return Date.now() - cachedAt < CACHE_TTL_MS;
}

async function refreshCache(db: D1Database, householdId: string): Promise<void> {
  // Get all feeds for this household
  const feeds = await db
    .prepare("SELECT * FROM travel_feeds WHERE household_id = ?")
    .bind(householdId)
    .all<TravelFeed>();

  if (!feeds.results || feeds.results.length === 0) {
    // No feeds — clear cache
    await db.prepare("DELETE FROM travel_events_cache WHERE household_id = ?").bind(householdId).run();
    return;
  }

  // Cutoff: only keep events from 30 days ago onwards
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const allEvents: Array<{
    household_id: string;
    member_name: string;
    uid: string;
    summary: string;
    location: string | null;
    start_date: string;
    end_date: string;
    description: string | null;
  }> = [];

  for (const feed of feeds.results) {
    try {
      const resp = await fetch(feed.feed_url, {
        headers: { "User-Agent": "Familienorga/1.0" },
        cf: { cacheTtl: 300 }, // CF edge cache 5 min
      });

      if (!resp.ok) continue;

      const icalText = await resp.text();
      const events = parseIcalEvents(icalText);

      for (const ev of events) {
        // Filter: only future-ish events
        if (ev.end_date >= cutoffStr) {
          allEvents.push({
            household_id: householdId,
            member_name: feed.member_name,
            ...ev,
          });
        }
      }
    } catch {
      // Feed fetch failed — skip silently
      continue;
    }
  }

  // Replace cache: delete old, insert new
  await db.prepare("DELETE FROM travel_events_cache WHERE household_id = ?").bind(householdId).run();

  const now = new Date().toISOString().replace("T", " ").split(".")[0];

  for (const ev of allEvents) {
    await db
      .prepare(
        `INSERT INTO travel_events_cache (id, household_id, member_name, uid, summary, location, start_date, end_date, description, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        ev.household_id,
        ev.member_name,
        ev.uid,
        ev.summary,
        ev.location,
        ev.start_date,
        ev.end_date,
        ev.description,
        now
      )
      .run();
  }
}

// ── GET: return travel events ──
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const url = new URL(context.request.url);
  const yearParam = url.searchParams.get("year");
  const monthParam = url.searchParams.get("month");

  // Refresh cache if stale
  const fresh = await isCacheFresh(context.env.DB, householdId);
  if (!fresh) {
    await refreshCache(context.env.DB, householdId);
  }

  let events;

  if (yearParam && monthParam) {
    // Calendar mode: events that overlap with this month
    const year = parseInt(yearParam);
    const month = parseInt(monthParam);
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

    events = await context.env.DB
      .prepare(
        `SELECT id, member_name, uid, summary, location, start_date, end_date, description
         FROM travel_events_cache
         WHERE household_id = ?
           AND start_date <= ? AND end_date >= ?
         ORDER BY start_date ASC`
      )
      .bind(householdId, monthEnd, monthStart)
      .all();
  } else {
    // Travel tab mode: all upcoming events
    const today = new Date().toISOString().split("T")[0];
    events = await context.env.DB
      .prepare(
        `SELECT id, member_name, uid, summary, location, start_date, end_date, description
         FROM travel_events_cache
         WHERE household_id = ? AND end_date >= ?
         ORDER BY start_date ASC`
      )
      .bind(householdId, today)
      .all();
  }

  // Also return feeds so the UI knows which feeds are configured
  const feeds = await context.env.DB
    .prepare("SELECT id, member_name, label, feed_url FROM travel_feeds WHERE household_id = ?")
    .bind(householdId)
    .all();

  const travelEvents = (events.results || []).map((e: any) => ({
    ...e,
    type: "travel",
  }));

  return Response.json({
    events: travelEvents,
    feeds: feeds.results || [],
  });
};

// ── POST: add a travel feed ──
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as {
    member_name: string;
    feed_url: string;
    label?: string;
  };

  if (!body.member_name || !body.feed_url) {
    return Response.json({ error: "member_name und feed_url sind Pflicht" }, { status: 400 });
  }

  // Validate URL format
  try {
    new URL(body.feed_url);
  } catch {
    return Response.json({ error: "Ungueltige URL" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await context.env.DB
    .prepare(
      "INSERT INTO travel_feeds (id, household_id, member_name, feed_url, label) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, householdId, body.member_name, body.feed_url, body.label || "TripIt")
    .run();

  // Force cache refresh
  await refreshCache(context.env.DB, householdId);

  return Response.json({ id, success: true });
};

// ── PATCH: update a travel feed ──
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const body = (await context.request.json()) as {
    id: string;
    feed_url?: string;
    member_name?: string;
    label?: string;
  };

  if (!body.id) {
    return Response.json({ error: "Feed ID fehlt" }, { status: 400 });
  }

  if (body.feed_url) {
    try { new URL(body.feed_url); } catch {
      return Response.json({ error: "Ungueltige URL" }, { status: 400 });
    }
  }

  // Build dynamic UPDATE
  const sets: string[] = [];
  const vals: string[] = [];
  if (body.feed_url) { sets.push("feed_url = ?"); vals.push(body.feed_url); }
  if (body.member_name) { sets.push("member_name = ?"); vals.push(body.member_name); }
  if (body.label) { sets.push("label = ?"); vals.push(body.label); }

  if (sets.length === 0) {
    return Response.json({ error: "Nichts zu aendern" }, { status: 400 });
  }

  await context.env.DB
    .prepare(`UPDATE travel_feeds SET ${sets.join(", ")} WHERE id = ? AND household_id = ?`)
    .bind(...vals, body.id, householdId)
    .run();

  // Force cache refresh with new URL
  await refreshCache(context.env.DB, householdId);

  return Response.json({ success: true });
};

// ── DELETE: remove a travel feed ──
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const householdId = context.request.headers.get("X-Household-Id");
  if (!householdId) {
    return Response.json({ error: "Household-ID fehlt" }, { status: 401 });
  }

  const url = new URL(context.request.url);
  const feedId = url.searchParams.get("id");

  if (!feedId) {
    return Response.json({ error: "Feed ID fehlt" }, { status: 400 });
  }

  await context.env.DB
    .prepare("DELETE FROM travel_feeds WHERE id = ? AND household_id = ?")
    .bind(feedId, householdId)
    .run();

  // Refresh cache (will remove events from deleted feed)
  await refreshCache(context.env.DB, householdId);

  return Response.json({ success: true });
};
