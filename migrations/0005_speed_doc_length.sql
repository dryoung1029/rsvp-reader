-- Speed achievements only count sittings in documents long enough to be real
-- reading (see SPEED_MIN_DOC_WORDS in shared/achievements.js).
ALTER TABLE reading_sessions ADD COLUMN doc_words INTEGER;
UPDATE reading_sessions SET doc_words = (SELECT word_count FROM documents d WHERE d.id = reading_sessions.doc_id)
  WHERE doc_id IS NOT NULL;
