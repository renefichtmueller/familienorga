CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  share_code TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT 'Unser Haushalt',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '🛒',
  category TEXT DEFAULT 'Einkauf',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  checked INTEGER DEFAULT 0,
  quantity TEXT,
  due_date TEXT,
  due_time TEXT,
  recurrence TEXT DEFAULT NULL,
  assigned_to TEXT DEFAULT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  category TEXT DEFAULT 'Allgemein',
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#888888',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lists_household ON lists(household_id);
CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id);
CREATE INDEX IF NOT EXISTS idx_households_code ON households(share_code);
CREATE INDEX IF NOT EXISTS idx_push_household ON push_subscriptions(household_id);
CREATE INDEX IF NOT EXISTS idx_items_due ON items(due_date);
CREATE INDEX IF NOT EXISTS idx_notes_household ON notes(household_id);
CREATE INDEX IF NOT EXISTS idx_items_assigned ON items(assigned_to);
CREATE INDEX IF NOT EXISTS idx_members_household ON members(household_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_household ON chat_messages(household_id);

CREATE TABLE IF NOT EXISTS travel_feeds (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  label TEXT DEFAULT 'TripIt',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS travel_events_cache (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  uid TEXT NOT NULL,
  summary TEXT NOT NULL,
  location TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  description TEXT,
  cached_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_travel_feeds_household ON travel_feeds(household_id);
CREATE INDEX IF NOT EXISTS idx_travel_cache_household ON travel_events_cache(household_id);
CREATE INDEX IF NOT EXISTS idx_travel_cache_dates ON travel_events_cache(start_date, end_date);
