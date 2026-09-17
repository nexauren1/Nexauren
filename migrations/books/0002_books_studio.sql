PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  bible_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS book_series (
  book_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, series_id),
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_series_series
  ON book_series(series_id, position);

CREATE TABLE IF NOT EXISTS story_states (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_state_book
  ON story_states(book_id);

CREATE TABLE IF NOT EXISTS canon_changes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canon_changes_book
  ON canon_changes(book_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  book_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  model TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  created_by TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_book
  ON ai_jobs(book_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  book_id TEXT,
  action TEXT NOT NULL,
  model TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (job_id) REFERENCES ai_jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_generations_book
  ON ai_generations(book_id, created_at DESC);

CREATE TABLE IF NOT EXISTS originality_checks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_originality_book
  ON originality_checks(book_id, created_at DESC);

CREATE TABLE IF NOT EXISTS covers (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  data_uri TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  selected INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_covers_book
  ON covers(book_id, selected, created_at DESC);

CREATE TABLE IF NOT EXISTS book_metadata (
  book_id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seo_metadata (
  book_id TEXT PRIMARY KEY,
  slug TEXT,
  meta_title TEXT,
  meta_description TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  og_title TEXT,
  og_description TEXT,
  social_text TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publications_book
  ON publications(book_id, version DESC);

CREATE TABLE IF NOT EXISTS download_logs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  user_id TEXT,
  format TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_download_logs_book
  ON download_logs(book_id, created_at DESC);
