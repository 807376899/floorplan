const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { ensureRelationalSchema, pruneRedundantPlanOverrides } = require("./relational-store");

function openDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.mkdirSync(config.backupsDir, { recursive: true });

  const db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS active_dataset (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      dataset_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_copies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL,
      plan_code TEXT NOT NULL UNIQUE,
      plan_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private',
      revision INTEGER NOT NULL DEFAULT 1,
      plan_json TEXT NOT NULL,
      assignments_json TEXT NOT NULL,
      source_plan_code TEXT NOT NULL DEFAULT '',
      source_copy_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY(owner_user_id) REFERENCES users(id),
      FOREIGN KEY(source_copy_id) REFERENCES plan_copies(id)
    );
    CREATE TABLE IF NOT EXISTS import_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      dataset_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      status TEXT NOT NULL,
      published_at TEXT,
      discarded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      dataset_json TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_protected INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      ip TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  migratePlanCopies(db);
  ensureRelationalSchema(db);
  compactRelationalOverrides(db, config);
  return db;
}

function compactRelationalOverrides(db, config) {
  const pending = pruneRedundantPlanOverrides(db, { dryRun: true });
  if (!pending.removedSpaces && !pending.removedLabs) return;
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const backupPath = path.join(config.backupsDir, `pre-override-prune-${Date.now()}.sqlite`);
  const safeTarget = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${safeTarget}'`);
  const result = pruneRedundantPlanOverrides(db);
  console.log(`pruned redundant plan overrides: spaces=${result.removedSpaces}, labs=${result.removedLabs}, backup=${backupPath}`);
}

function migratePlanCopies(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(plan_copies)").all().map((row) => row.name));
  const migrations = [
    ["source_type", "ALTER TABLE plan_copies ADD COLUMN source_type TEXT NOT NULL DEFAULT 'copy'"],
    ["dataset_json", "ALTER TABLE plan_copies ADD COLUMN dataset_json TEXT"],
    ["import_draft_id", "ALTER TABLE plan_copies ADD COLUMN import_draft_id INTEGER"],
    ["is_baseline", "ALTER TABLE plan_copies ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0"],
    ["baselined_at", "ALTER TABLE plan_copies ADD COLUMN baselined_at TEXT"],
    ["baselined_by", "ALTER TABLE plan_copies ADD COLUMN baselined_by TEXT"],
  ];
  for (const [name, sql] of migrations) {
    if (!columns.has(name)) db.exec(sql);
  }
}

module.exports = { openDatabase };
