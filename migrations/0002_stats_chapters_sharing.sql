-- Reading stats, chapter markers, and sending documents to other members.

ALTER TABLE users ADD COLUMN share_stats INTEGER NOT NULL DEFAULT 0;

ALTER TABLE documents ADD COLUMN chapters TEXT NOT NULL DEFAULT '[]';
ALTER TABLE documents ADD COLUMN shared_by TEXT NOT NULL DEFAULT '';

-- One row per person per local calendar day.
CREATE TABLE reading_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  words INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
