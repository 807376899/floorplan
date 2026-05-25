const crypto = require("crypto");
const config = require("../server/config");
const { openDatabase } = require("../server/db");

const VALID_ROLES = new Set(["admin", "editor"]);

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`Usage:
  node scripts/manage-user.js <username> <password> <admin|editor>
  npm run user -- <username> <password> <admin|editor>

Examples:
  node scripts/manage-user.js admin "new-password" admin
  node scripts/manage-user.js zhangsan "editor-password" editor

This creates the user if missing, or updates password, role, and active state if it already exists.
`);
  process.exit(exitCode);
}

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function main() {
  const [username, password, role] = process.argv.slice(2);
  if (process.argv.includes("--help") || process.argv.includes("-h")) usage(0);
  if (!username || !password || !role) usage(1);
  if (!VALID_ROLES.has(role)) {
    process.stderr.write("Role must be admin or editor.\n");
    usage(1);
  }

  const db = openDatabase(config);
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, salt = ?, role = ?, is_active = 1
      WHERE username = ?
    `).run(passwordHash, salt, role, username);
    process.stdout.write(`Updated ${username} (${role}).\n`);
    return;
  }

  db.prepare(`
    INSERT INTO users (username, password_hash, salt, role, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(username, passwordHash, salt, role, nowIso());
  process.stdout.write(`Created ${username} (${role}).\n`);
}

main();
