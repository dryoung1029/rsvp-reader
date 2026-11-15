-- Accounts, invites, sign-in codes, sessions and per-user document libraries.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  inbox_token_hash TEXT,
  invite_code TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE UNIQUE INDEX users_inbox_token ON users(inbox_token_hash);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  link_hash TEXT NOT NULL UNIQUE,
  invite_code TEXT,
  name TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_codes_email ON login_codes(email, created_at);
CREATE INDEX login_codes_ip ON login_codes(ip, created_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  word_index INTEGER NOT NULL DEFAULT 0,
  read_words INTEGER NOT NULL DEFAULT 0,
  position_at INTEGER NOT NULL DEFAULT 0,
  text_version INTEGER NOT NULL DEFAULT 1,
  text_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX documents_user ON documents(user_id, last_opened_at);

-- Document text, gzip-compressed by the browser, split into chunks that fit D1's row limit.
CREATE TABLE document_text (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (doc_id, seq)
);
