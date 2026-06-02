const crypto = require("crypto");
const { httpError, nowIso, parseCookies, serializeCookie } = require("./http-utils");

const VALID_ROLES = new Set(["admin", "editor"]);

function createAuthService(db, config, audit) {
  function seedUsers() {
    const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    if (count > 0) return;
    createUser(process.env.FLOORPLAN_ADMIN_USER || "admin", process.env.FLOORPLAN_ADMIN_PASSWORD || "admin123456", "admin");
    createUser(process.env.FLOORPLAN_EDITOR_USER || "editor", process.env.FLOORPLAN_EDITOR_PASSWORD || "editor123456", "editor");
  }

  function createUser(username, password, role) {
    if (!VALID_ROLES.has(role)) throw httpError(400, "invalid_role", "Role must be admin or editor");
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    db.prepare("INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(username, passwordHash, salt, role, nowIso());
  }

  function listUsers() {
    return db.prepare(`
      SELECT id, username, role, is_active, created_at
      FROM users
      ORDER BY id ASC
    `).all().map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
    }));
  }

  function createManagedUser(body) {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const role = String(body.role || "").trim();
    if (!username) throw httpError(400, "invalid_username", "请输入账号");
    if (!password) throw httpError(400, "invalid_password", "请输入密码");
    if (!VALID_ROLES.has(role)) throw httpError(400, "invalid_role", "Role must be admin or editor");
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) throw httpError(409, "username_exists", "账号已存在");
    createUser(username, password, role);
    const row = db.prepare("SELECT id, username, role, is_active, created_at FROM users WHERE username = ?").get(username);
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
    };
  }

  function disableUser(userId, actorUser) {
    const id = Number(userId);
    if (!id) throw httpError(400, "invalid_user_id", "用户 ID 无效");
    if (actorUser?.id === id) throw httpError(400, "cannot_disable_self", "不能禁用当前登录账号");
    const target = db.prepare("SELECT id, username FROM users WHERE id = ? AND is_active = 1").get(id);
    if (!target) throw httpError(404, "user_not_found", "未找到可禁用的用户");
    const now = nowIso();
    db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(id);
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, id);
    return target;
  }

  function buildRequestContext(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    const sessionId = cookies[config.sessionCookieName] || "";
    let user = null;
    if (sessionId) {
      user = db.prepare(`
        SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.id = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ? AND users.is_active = 1
      `).get(sessionId, nowIso()) || null;
    }
    return {
      ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "",
      sessionId,
      user,
    };
  }

  function permissionsFor(user) {
    const role = user?.role || "viewer";
    return {
      role,
      canEdit: role === "editor" || role === "admin",
      canAdmin: role === "admin",
    };
  }

  function publicUser(user) {
    if (!user) return null;
    return { id: user.id, username: user.username, role: user.role };
  }

  function requireRole(user, roles) {
    if (!user) throw httpError(401, "login_required", "请先登录");
    if (!roles.includes(user.role)) throw httpError(403, "forbidden", "当前账号没有对应权限");
  }

  function createSession(userId, remember) {
    const id = crypto.randomUUID();
    const ttlMs = remember ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(id, userId, expiresAt, nowIso());
    return { id, expiresAt };
  }

  function login(username, password, remember, context) {
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND is_active = 1").get(username);
    if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
      audit.writeAudit("login_failed", username || "anonymous", context.ip, {});
      throw httpError(401, "invalid_credentials", "用户名或密码错误");
    }

    const session = createSession(user.id, remember);
    audit.writeAudit("login_success", user.username, context.ip, { role: user.role, remember });
    return {
      cookie: serializeCookie(config.sessionCookieName, session.id, remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
      user: publicUser(user),
      permissions: permissionsFor(user),
    };
  }

  function logout(context) {
    if (context.sessionId) {
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(nowIso(), context.sessionId);
    }
    if (context.user) audit.writeAudit("logout", context.user.username, context.ip, {});
    return serializeCookie(config.sessionCookieName, "", { maxAge: 0 });
  }

  function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString("hex");
  }

  function verifyPassword(password, salt, expected) {
    const candidate = hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
  }

  return {
    seedUsers,
    buildRequestContext,
    permissionsFor,
    publicUser,
    requireRole,
    listUsers,
    createManagedUser,
    disableUser,
    login,
    logout,
  };
}

module.exports = { createAuthService };
