-- Gamification: reading sessions, events, achievements, daily goals.

-- One row per continuous stretch of reading (Play until Pause).
CREATE TABLE reading_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL DEFAULT 12,
  words INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  wpm INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX reading_sessions_user ON reading_sessions(user_id, day);

-- Things that count toward achievements and survive deleting the document:
-- kind = 'finished' (value = word count, meta = source), 'sent', 'received', 'import' (meta = source).
CREATE TABLE user_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX user_events_user ON user_events(user_id, kind);

CREATE TABLE achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX achievements_recent ON achievements(unlocked_at);

ALTER TABLE documents ADD COLUMN finished_at INTEGER;
ALTER TABLE users ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 0;
