PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT NOT NULL DEFAULT 'Nexauren',
  description TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  genre TEXT,
  subgenre TEXT,
  audience TEXT,
  age_rating TEXT,
  style TEXT,
  desired_size TEXT,
  approx_chapter_count INTEGER NOT NULL DEFAULT 0,
  premise TEXT,
  price_usd TEXT NOT NULL DEFAULT '0.00',
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'research', 'planning', 'writing', 'review', 'published', 'archived')),
  cover_url TEXT,
  preview_url TEXT,
  pdf_available INTEGER NOT NULL DEFAULT 0,
  epub_available INTEGER NOT NULL DEFAULT 0,
  pdf_key TEXT,
  epub_key TEXT,
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre);
CREATE INDEX IF NOT EXISTS idx_books_published ON books(published_at DESC);

CREATE TABLE IF NOT EXISTS story_bibles (
  book_id TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL DEFAULT '{}',
  world_json TEXT NOT NULL DEFAULT '{}',
  characters_json TEXT NOT NULL DEFAULT '[]',
  relations_json TEXT NOT NULL DEFAULT '{}',
  story_json TEXT NOT NULL DEFAULT '{}',
  timeline_json TEXT NOT NULL DEFAULT '[]',
  chapters_json TEXT NOT NULL DEFAULT '[]',
  style_json TEXT NOT NULL DEFAULT '{}',
  continuity_json TEXT NOT NULL DEFAULT '{}',
  continuation_json TEXT NOT NULL DEFAULT '{}',
  canon_locked INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_notes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL,
  source TEXT,
  where_used TEXT,
  provenance_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_book ON research_notes(book_id);

CREATE TABLE IF NOT EXISTS canonical_facts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  immutable INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canon_book_key
  ON canonical_facts(book_id, fact_key);

CREATE TABLE IF NOT EXISTS chapter_versions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  outline_json TEXT,
  story_state_json TEXT,
  continuity_report_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chapters_book_number
  ON chapter_versions(book_id, chapter_number, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_chapters_current
  ON chapter_versions(book_id, chapter_number, is_current);

CREATE TABLE IF NOT EXISTS book_files (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('cover', 'pdf', 'epub', 'preview', 'other')),
  storage_key TEXT,
  file_url TEXT,
  sha256 TEXT,
  size_bytes INTEGER,
  mime_type TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_files_book_kind
  ON book_files(book_id, kind);

CREATE TABLE IF NOT EXISTS entity_registry (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_name
  ON entity_registry(entity_type, canonical_name);

CREATE TABLE IF NOT EXISTS continuity_checks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER,
  report_json TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_continuity_book_chapter
  ON continuity_checks(book_id, chapter_number, created_at DESC);

CREATE TABLE IF NOT EXISTS qa_runs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publication_versions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  pdf_file_id TEXT,
  epub_file_id TEXT,
  cover_file_id TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
