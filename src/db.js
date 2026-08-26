const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'practice.db'));
db.pragma('journal_mode = WAL');
// SQLite ignores "ON DELETE CASCADE" in the schema below unless foreign key
// enforcement is turned on per-connection — without this, deleting a user
// silently leaves orphaned rows in credentials/password_history instead of
// cascading.
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  webauthn_user_id TEXT NOT NULL,
  google_sub TEXT,
  google_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  nickname TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Lightweight migration: CREATE TABLE IF NOT EXISTS doesn't add new columns
// to a users table that already existed before google_sub/google_email were
// introduced, so add them by hand if a pre-existing database is missing them.
const existingColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!existingColumns.includes('google_sub')) {
  db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
}
if (!existingColumns.includes('google_email')) {
  db.exec('ALTER TABLE users ADD COLUMN google_email TEXT');
}

module.exports = db;
