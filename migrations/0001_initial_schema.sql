-- ══════════════════════════════════════════════════════
--  FamilyTree Cloudflare D1 Database Initial Schema
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT,
  data TEXT, -- Full JSON dump for offline/instant sync fallback
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL,
  name TEXT NOT NULL,
  gender TEXT,
  parent_ids TEXT,
  spouse_ids TEXT,
  child_ids TEXT,
  data TEXT, -- Extended properties (birth, photo, tags, notes)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tree_id) REFERENCES trees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'viewer', -- 'viewer' | 'editor'
  created_by TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tree_id) REFERENCES trees(id) ON DELETE CASCADE
);
