-- Fair play: reading counts once, on one device at a time, on the day it
-- happened; finishing means reading most of it; flags for the admin to review.

-- Times are on the server's clock, derived from the device's report.
ALTER TABLE reading_sessions ADD COLUMN started_at INTEGER;
ALTER TABLE reading_sessions ADD COLUMN ended_at INTEGER;
-- Words from this sitting that were new to the reader (rereading counts once).
ALTER TABLE reading_sessions ADD COLUMN counted_words INTEGER;
UPDATE reading_sessions SET counted_words = words WHERE verified = 1;
CREATE INDEX reading_sessions_time ON reading_sessions(user_id, started_at);

-- Which parts of a document have counted: merged [start, end] word ranges.
CREATE TABLE doc_coverage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_key TEXT NOT NULL,
  ranges TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, cover_key)
);

ALTER TABLE documents ADD COLUMN edited_at INTEGER;
ALTER TABLE documents ADD COLUMN fingerprints TEXT;
ALTER TABLE documents ADD COLUMN quality REAL;

-- A send counts once the recipient has actually read some of it.
CREATE TABLE sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_doc_id TEXT NOT NULL,
  recipient_doc_id TEXT NOT NULL,
  counted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX sends_recipient_doc ON sends(recipient_doc_id);

-- Notes for the admin's Fair play view. Nothing here changes anyone's score.
CREATE TABLE fair_play_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX fair_play_flags_recent ON fair_play_flags(created_at);

ALTER TABLE quizzes ADD COLUMN expires_at INTEGER;
