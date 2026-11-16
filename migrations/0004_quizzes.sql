-- Comprehension quizzes: reading only counts toward achievements, competitions
-- and leaderboards once a 3-question quiz on it has been passed.

ALTER TABLE reading_days ADD COLUMN verified_words INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reading_days ADD COLUMN verified_ms INTEGER NOT NULL DEFAULT 0;
-- Reading done before quizzes existed keeps counting.
UPDATE reading_days SET verified_words = words, verified_ms = ms;

ALTER TABLE reading_sessions ADD COLUMN doc_id TEXT;
ALTER TABLE reading_sessions ADD COLUMN start_word INTEGER;
ALTER TABLE reading_sessions ADD COLUMN end_word INTEGER;
-- 1 = passed a quiz (or predates quizzes), 0 = waiting, -1 = quiz attempts used up
ALTER TABLE reading_sessions ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
UPDATE reading_sessions SET verified = 1;
CREATE INDEX reading_sessions_pending ON reading_sessions(user_id, doc_id, verified);

CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  session_ids TEXT NOT NULL,
  words INTEGER NOT NULL,
  questions TEXT NOT NULL,
  source TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX quizzes_user ON quizzes(user_id, doc_id, status);

ALTER TABLE documents ADD COLUMN finish_counted INTEGER NOT NULL DEFAULT 0;
