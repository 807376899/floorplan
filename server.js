const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const dataDir = path.join(root, "data");
const uploadsDir = path.join(dataDir, "uploads");
const backupsDir = path.join(dataDir, "backups");
const dbPath = path.join(dataDir, "app.db");
const sessionCookieName = "floorplan_session";
const datasetKeys = ["buildings", "floor_segments", "spaces", "labs", "plans", "plan_assignments", "file_assets", "imports"];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });

const db = new DatabaseSync(dbPath);
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

seedUsers();
seedDataset();
ensureScheduledBackup();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = decodeURIComponent(url.pathname);
    const requestContext = buildRequestContext(req);

    if (pathname.startsWith("/api/")) {
      await routeApi(req, res, url, pathname, requestContext);
      return;
    }

    serveStatic(res, pathname);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error);
    sendJson(res, statusCode, {
      error: error.code || "server_error",
      message: error.message || "Server error",
    });
  }
}).listen(port, () => {
  console.log(`floorplan server running at http://127.0.0.1:${port}`);
});

function routeApi(req, res, url, pathname, context) {
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    const active = getActiveDataset();
    return sendJson(res, 200, {
      user: publicUser(context.user),
      permissions: permissionsFor(context.user),
      dataset: active.dataset,
      revision: active.revision,
      maintenance: buildMaintenance(active.dataset),
    });
  }

  if (req.method === "GET" && pathname === "/api/me") {
    return sendJson(res, 200, { user: publicUser(context.user), permissions: permissionsFor(context.user) });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    return handleLogin(req, res, context);
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    return handleLogout(req, res, context);
  }

  if (req.method === "GET" && pathname === "/api/dataset/active") {
    const active = getActiveDataset();
    return sendJson(res, 200, { dataset: active.dataset, revision: active.revision, maintenance: buildMaintenance(active.dataset) });
  }

  if (req.method === "PUT" && pathname === "/api/dataset/active") {
    requireRole(context.user, ["editor", "admin"]);
    return handleSaveDataset(req, res, context);
  }

  if (req.method === "POST" && pathname === "/api/dataset/repair-text") {
    requireRole(context.user, ["admin"]);
    return handleRepairDatasetText(res, context);
  }

  if (req.method === "POST" && pathname === "/api/imports") {
    requireRole(context.user, ["admin"]);
    return handleCreateImportDraft(req, res, context);
  }

  if (req.method === "GET" && pathname === "/api/imports") {
    requireRole(context.user, ["admin"]);
    return sendJson(res, 200, { drafts: listImportDrafts() });
  }

  const publishMatch = pathname.match(/^\/api\/imports\/(\d+)\/publish$/);
  if (req.method === "POST" && publishMatch) {
    requireRole(context.user, ["admin"]);
    const draftId = Number(publishMatch[1]);
    const result = publishImportDraft(draftId, context.user.username, context.ip);
    return sendJson(res, 200, result);
  }

  const discardMatch = pathname.match(/^\/api\/imports\/(\d+)$/);
  if (req.method === "DELETE" && discardMatch) {
    requireRole(context.user, ["admin"]);
    const draftId = Number(discardMatch[1]);
    discardImportDraft(draftId, context.user.username, context.ip);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/snapshots") {
    requireRole(context.user, ["admin"]);
    return sendJson(res, 200, { snapshots: listSnapshots() });
  }

  const restoreMatch = pathname.match(/^\/api\/snapshots\/(\d+)\/restore$/);
  if (req.method === "POST" && restoreMatch) {
    requireRole(context.user, ["admin"]);
    const snapshotId = Number(restoreMatch[1]);
    const result = restoreSnapshot(snapshotId, context.user.username, context.ip);
    return sendJson(res, 200, result);
  }

  sendJson(res, 404, { error: "not_found", message: "Not found" });
}

async function handleLogin(req, res, context) {
  const body = await readJsonBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const remember = Boolean(body.remember);
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND is_active = 1").get(username);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    writeAudit("login_failed", username || "anonymous", context.ip, {});
    return sendJson(res, 401, { error: "invalid_credentials", message: "用户名或密码错误" });
  }

  const session = createSession(user.id, remember);
  res.setHeader("Set-Cookie", serializeCookie(sessionCookieName, session.id, remember ? { maxAge: 60 * 60 * 24 * 30 } : {}));
  writeAudit("login_success", user.username, context.ip, { role: user.role, remember });
  sendJson(res, 200, { user: publicUser(user), permissions: permissionsFor(user) });
}

function handleLogout(_req, res, context) {
  if (context.sessionId) {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(nowIso(), context.sessionId);
  }
  res.setHeader("Set-Cookie", serializeCookie(sessionCookieName, "", { maxAge: 0 }));
  if (context.user) writeAudit("logout", context.user.username, context.ip, {});
  sendJson(res, 200, { ok: true });
}

async function handleSaveDataset(req, res, context) {
  const body = await readJsonBody(req);
  const dataset = normalizeIncomingDataset(body.dataset);
  const validation = validateDataset(dataset);
  if (!validation.ok) {
    return sendJson(res, 400, { error: "invalid_dataset", message: validation.errors.join("；"), errors: validation.errors });
  }
  const corruption = detectTextCorruption(dataset);
  if (corruption.detected) {
    writeAudit("suspected_text_corruption_rejected", context.user.username, context.ip, {
      source: "save_dataset",
      summary: corruption,
    });
    return sendJson(res, 422, {
      error: "suspected_text_corruption",
      message: "检测到本次保存包含异常的问号化文本，已阻止覆盖正式数据，请先修复编码后再保存。",
      details: corruption,
    });
  }

  const active = getActiveDataset();
  const expectedRevision = Number(body.expectedRevision);
  if (expectedRevision !== active.revision) {
    return sendJson(res, 409, {
      error: "revision_conflict",
      message: "当前数据已被其他人更新，请刷新后重试",
      revision: active.revision,
      dataset: active.dataset,
    });
  }

  const revision = active.revision + 1;
  const updatedAt = nowIso();
  db.prepare("UPDATE active_dataset SET revision = ?, dataset_json = ?, updated_by = ?, updated_at = ? WHERE id = 1")
    .run(revision, JSON.stringify(dataset), context.user.username, updatedAt);
  writeAudit("dataset_saved", context.user.username, context.ip, {
    revision,
    changeNote: String(body.changeNote || "").trim(),
    summary: summarizeDataset(dataset),
  });
  sendJson(res, 200, { ok: true, revision, dataset, updatedAt, maintenance: buildMaintenance(dataset) });
}

async function handleCreateImportDraft(req, res, context) {
  const body = await readJsonBody(req);
  const dataset = normalizeIncomingDataset(body.dataset);
  const validation = validateDataset(dataset);
  if (!validation.ok) {
    return sendJson(res, 400, { error: "invalid_dataset", message: validation.errors.join("；"), errors: validation.errors });
  }
  const corruption = detectTextCorruption(dataset);
  if (corruption.detected) {
    writeAudit("suspected_text_corruption_rejected", context.user.username, context.ip, {
      source: "create_import_draft",
      summary: corruption,
      fileName: String(body.fileName || "").trim(),
    });
    return sendJson(res, 422, {
      error: "suspected_text_corruption",
      message: "检测到导入包内存在异常的问号化文本，已阻止创建草稿，请先修复原始文件编码。",
      details: corruption,
    });
  }

  const fileName = String(body.fileName || "未命名数据包").trim();
  const sourceType = String(body.sourceType || "json").trim();
  const active = getActiveDataset();
  const summary = buildImportSummary(active.dataset, dataset);
  const uploadedAt = nowIso();

  const result = db.prepare(`
    INSERT INTO import_drafts (file_name, source_type, uploaded_by, uploaded_at, dataset_json, summary_json, status)
    VALUES (?, ?, ?, ?, ?, ?, 'draft')
  `).run(fileName, sourceType, context.user.username, uploadedAt, JSON.stringify(dataset), JSON.stringify(summary));

  fs.writeFileSync(path.join(uploadsDir, `draft-${result.lastInsertRowid}.json`), JSON.stringify({
    fileName,
    sourceType,
    uploadedBy: context.user.username,
    uploadedAt,
    dataset,
  }, null, 2));

  writeAudit("import_draft_created", context.user.username, context.ip, {
    draftId: Number(result.lastInsertRowid),
    fileName,
    summary,
  });

  sendJson(res, 200, { ok: true, draftId: Number(result.lastInsertRowid), summary });
}

function publishImportDraft(draftId, actor, ip) {
  const draft = db.prepare("SELECT * FROM import_drafts WHERE id = ?").get(draftId);
  if (!draft || draft.status !== "draft") {
    throw httpError(404, "draft_not_found", "未找到可发布的导入草稿");
  }

  const active = getActiveDataset();
  createSnapshot("pre_import_publish", `导入发布前快照 #${active.revision}`, active.dataset, active.revision, actor, 0);

  const nextDataset = JSON.parse(draft.dataset_json);
  const revision = active.revision + 1;
  const updatedAt = nowIso();
  db.prepare("UPDATE active_dataset SET revision = ?, dataset_json = ?, updated_by = ?, updated_at = ? WHERE id = 1")
    .run(revision, draft.dataset_json, actor, updatedAt);
  db.prepare("UPDATE import_drafts SET status = 'published', published_at = ? WHERE id = ?").run(updatedAt, draftId);
  writeAudit("import_draft_published", actor, ip, {
    draftId,
    revision,
    summary: JSON.parse(draft.summary_json),
  });
  return { ok: true, revision, dataset: nextDataset, maintenance: buildMaintenance(nextDataset) };
}

function discardImportDraft(draftId, actor, ip) {
  const draft = db.prepare("SELECT * FROM import_drafts WHERE id = ?").get(draftId);
  if (!draft || draft.status !== "draft") {
    throw httpError(404, "draft_not_found", "未找到可丢弃的导入草稿");
  }
  db.prepare("UPDATE import_drafts SET status = 'discarded', discarded_at = ? WHERE id = ?").run(nowIso(), draftId);
  writeAudit("import_draft_discarded", actor, ip, { draftId, fileName: draft.file_name });
}

function restoreSnapshot(snapshotId, actor, ip) {
  const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId);
  if (!snapshot) throw httpError(404, "snapshot_not_found", "未找到可恢复的快照");

  const active = getActiveDataset();
  createSnapshot("pre_restore", `恢复前快照 #${active.revision}`, active.dataset, active.revision, actor, 0);
  const revision = active.revision + 1;
  const updatedAt = nowIso();
  db.prepare("UPDATE active_dataset SET revision = ?, dataset_json = ?, updated_by = ?, updated_at = ? WHERE id = 1")
    .run(revision, snapshot.dataset_json, actor, updatedAt);
  writeAudit("snapshot_restored", actor, ip, { snapshotId, revision, label: snapshot.label });
  const dataset = JSON.parse(snapshot.dataset_json);
  return { ok: true, revision, dataset, maintenance: buildMaintenance(dataset) };
}

function handleRepairDatasetText(res, context) {
  const active = getActiveDataset();
  const source = findTextRepairSource(active.dataset);
  if (!source) {
    return sendJson(res, 404, {
      error: "repair_source_not_found",
      message: "未找到可用于修复中文文本的可信数据源。",
    });
  }

  const repaired = repairDatasetText(active.dataset, source.dataset);
  const revision = active.revision + 1;
  const updatedAt = nowIso();
  createSnapshot("pre_text_repair", `中文修复前快照 #${active.revision}`, active.dataset, active.revision, context.user.username, 0);
  db.prepare("UPDATE active_dataset SET revision = ?, dataset_json = ?, updated_by = ?, updated_at = ? WHERE id = 1")
    .run(revision, JSON.stringify(repaired), context.user.username, updatedAt);
  writeAudit("dataset_text_repaired", context.user.username, context.ip, {
    revision,
    source: source.label,
  });
  return sendJson(res, 200, { ok: true, revision, dataset: repaired, updatedAt, maintenance: buildMaintenance(repaired) });
}

function listImportDrafts() {
  return db.prepare("SELECT id, file_name, source_type, uploaded_by, uploaded_at, summary_json, status, published_at, discarded_at FROM import_drafts ORDER BY id DESC")
    .all()
    .map((row) => ({
      ...row,
      summary: JSON.parse(row.summary_json),
    }));
}

function listSnapshots() {
  return db.prepare("SELECT id, kind, label, source_revision, created_by, created_at, is_protected FROM snapshots ORDER BY id DESC LIMIT 50").all();
}

function buildRequestContext(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionId = cookies[sessionCookieName] || "";
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

function buildMaintenance(dataset) {
  const corruption = detectTextCorruption(dataset);
  const source = corruption.detected ? findTextRepairSource(dataset) : null;
  return {
    textCorruptionDetected: corruption.detected,
    textRepairAvailable: Boolean(source),
    textRepairSourceLabel: source?.label || "",
  };
}

function getActiveDataset() {
  const row = db.prepare("SELECT revision, dataset_json, updated_by, updated_at FROM active_dataset WHERE id = 1").get();
  return {
    revision: row.revision,
    dataset: JSON.parse(row.dataset_json),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function createSnapshot(kind, label, dataset, sourceRevision, createdBy, isProtected) {
  db.prepare(`
    INSERT INTO snapshots (kind, label, dataset_json, source_revision, created_by, created_at, is_protected)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(kind, label, JSON.stringify(dataset), sourceRevision, createdBy, nowIso(), isProtected ? 1 : 0);
}

function seedUsers() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count > 0) return;
  createUser(process.env.FLOORPLAN_ADMIN_USER || "admin", process.env.FLOORPLAN_ADMIN_PASSWORD || "admin123456", "admin");
  createUser(process.env.FLOORPLAN_EDITOR_USER || "editor", process.env.FLOORPLAN_EDITOR_PASSWORD || "editor123456", "editor");
}

function createUser(username, password, role) {
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  db.prepare("INSERT INTO users (username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(username, passwordHash, salt, role, nowIso());
}

function seedDataset() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM active_dataset").get();
  if (row.count > 0) return;
  const seed = normalizeIncomingDataset(loadSeedDataset());
  const validation = validateDataset(seed);
  if (!validation.ok) {
    throw new Error(`Seed dataset invalid: ${validation.errors.join("; ")}`);
  }
  db.prepare("INSERT INTO active_dataset (id, revision, dataset_json, updated_by, updated_at) VALUES (1, 1, ?, 'system', ?)")
    .run(JSON.stringify(seed), nowIso());
  createSnapshot("baseline", "初始基线快照", seed, 1, "system", 1);
  writeAudit("dataset_seeded", "system", "127.0.0.1", { summary: summarizeDataset(seed) });
}

function loadSeedDataset() {
  const candidates = [
    path.join(root, "floor-room-baseline-upload-package.json"),
    path.join(root, "baseline-upload-package.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const text = fs.readFileSync(candidate, "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(text);
    }
  }
  return emptyDataset();
}

function sanitizeDataset(raw) {
  const data = emptyDataset();
  for (const key of datasetKeys) {
    data[key] = Array.isArray(raw?.[key]) ? JSON.parse(JSON.stringify(raw[key])) : [];
  }
  return data;
}

function normalizeIncomingDataset(raw) {
  const data = sanitizeDataset(raw);
  const buildings = dedupeById(data.buildings.map((row) => ({
    ...row,
    id: row.id || row.building_code,
    building_code: String(row.building_code || "").trim(),
    building_name: String(row.building_name || row.building_code || "").trim(),
  })));
  const floorSegments = dedupeById(data.floor_segments.map((row) => ({
    ...row,
    id: row.id || `${row.building_code}__${row.floor_code}__${row.segment_code}`,
    building_code: String(row.building_code || "").trim(),
    floor_code: String(row.floor_code || "").trim(),
    segment_code: String(row.segment_code || "").trim(),
  })));
  const spaces = dedupeById(data.spaces.map((row) => {
    const length = Number(row.length_m || 0);
    const width = Number(row.width_m || 0);
    return {
      ...row,
      id: row.id || `${row.building_code}__${row.floor_code}__${row.space_code}`,
      building_code: String(row.building_code || "").trim(),
      floor_code: String(row.floor_code || "").trim(),
      segment_code: String(row.segment_code || "").trim(),
      space_code: String(row.space_code || "").trim(),
      front_door: String(row.front_door || row.space_code || "").trim(),
      rear_door: String(row.rear_door || "").trim(),
      length_m: Number.isFinite(length) ? length : 0,
      width_m: Number.isFinite(width) ? width : 0,
      area_m2: Number(row.area_m2 || length * width || 0),
    };
  }));
  const labs = dedupeById(data.labs.map((row) => ({
    ...row,
    id: row.id || row.lab_code,
    lab_code: String(row.lab_code || "").trim(),
    lab_name: String(row.lab_name || row.lab_code || "").trim(),
  })));
  const plans = dedupeById(data.plans.map((row) => ({
    ...row,
    id: row.id || row.plan_code,
    plan_code: String(row.plan_code || "").trim(),
    plan_name: String(row.plan_name || row.plan_code || "").trim(),
    is_locked: toBoolean(row.is_locked),
    is_default_compare_before: toBoolean(row.is_default_compare_before),
    is_default_compare_after: toBoolean(row.is_default_compare_after),
  })));
  const plansByCode = new Map(plans.map((row) => [row.plan_code, row]));
  const labsByCode = new Map(labs.map((row) => [row.lab_code, row]));
  const spacesByCode = new Map(spaces.map((row) => [row.space_code, row]));
  const assignments = dedupeById(data.plan_assignments.map((row) => {
    const plan = plansByCode.get(String(row.plan_code || "").trim());
    const lab = labsByCode.get(String(row.lab_code || "").trim());
    const space = spacesByCode.get(String(row.space_code || "").trim());
    const previousSpace = spacesByCode.get(String(row.previous_space_code || "").trim());
    return {
      ...row,
      id: row.id || `${row.plan_code}__${row.lab_code}`,
      plan_code: String(row.plan_code || "").trim(),
      lab_code: String(row.lab_code || "").trim(),
      space_code: String(row.space_code || "").trim(),
      previous_space_code: String(row.previous_space_code || "").trim(),
      plan_id: row.plan_id || plan?.id || "",
      lab_id: row.lab_id || lab?.id || "",
      space_id: row.space_id || space?.id || "",
      previous_space_id: row.previous_space_id || previousSpace?.id || "",
      assignment_status: String(row.assignment_status || (space ? "assigned" : "unplaced")).trim(),
    };
  }));
  return {
    ...data,
    buildings,
    floor_segments: floorSegments,
    spaces,
    labs,
    plans,
    plan_assignments: assignments,
  };
}

function dedupeById(rows) {
  return [...new Map(rows.filter((row) => row.id).map((row) => [row.id, row])).values()];
}

function emptyDataset() {
  return {
    buildings: [],
    floor_segments: [],
    spaces: [],
    labs: [],
    plans: [],
    plan_assignments: [],
    file_assets: [],
    imports: [],
  };
}

const repairFieldMap = {
  buildings: ["building_name", "campus_zone", "notes"],
  floor_segments: ["notes"],
  spaces: ["network_segment", "notes"],
  labs: ["lab_name", "college", "major", "lab_type", "director", "notes"],
  plans: ["plan_name", "description"],
  plan_assignments: ["move_note"],
};

function containsCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function isQuestionCorrupted(value) {
  const text = String(value || "").trim();
  return Boolean(text) && /[?？]+/.test(text) && !containsCjk(text);
}

function detectTextCorruption(dataset) {
  let scanned = 0;
  let suspicious = 0;
  for (const [key, fields] of Object.entries(repairFieldMap)) {
    for (const row of dataset[key] || []) {
      for (const field of fields) {
        const value = String(row[field] ?? "").trim();
        if (!value) continue;
        scanned += 1;
        if (isQuestionCorrupted(value)) suspicious += 1;
      }
    }
  }
  return {
    detected: suspicious >= 5 && suspicious / Math.max(scanned, 1) >= 0.08,
    suspiciousFields: suspicious,
    scannedFields: scanned,
  };
}

function hasSufficientRepairCoverage(activeDataset, candidateDataset) {
  const keys = ["buildings", "floor_segments", "spaces", "labs"];
  return keys.every((key) => {
    const activeIds = new Set((activeDataset[key] || []).map((row) => row.id));
    const candidateIds = new Set((candidateDataset[key] || []).map((row) => row.id));
    if (!activeIds.size || !candidateIds.size) return false;
    let matched = 0;
    for (const id of activeIds) if (candidateIds.has(id)) matched += 1;
    return matched / activeIds.size >= 0.8;
  });
}

function findTextRepairSource(activeDataset) {
  const draftRows = db.prepare("SELECT id, file_name, dataset_json FROM import_drafts ORDER BY id DESC").all();
  for (const row of draftRows) {
    const dataset = JSON.parse(row.dataset_json);
    if (!hasSufficientRepairCoverage(activeDataset, dataset) || detectTextCorruption(dataset).detected) continue;
    return { dataset, label: `导入草稿 #${row.id} ${row.file_name}` };
  }

  const snapshotRows = db.prepare("SELECT id, label, dataset_json, is_protected FROM snapshots ORDER BY id DESC").all();
  for (const row of snapshotRows) {
    const dataset = JSON.parse(row.dataset_json);
    if (!hasSufficientRepairCoverage(activeDataset, dataset) || detectTextCorruption(dataset).detected) continue;
    return { dataset, label: row.is_protected ? `受保护快照 #${row.id} ${row.label}` : `快照 #${row.id} ${row.label}` };
  }
  return null;
}

function repairDatasetText(activeDataset, sourceDataset) {
  const repaired = JSON.parse(JSON.stringify(activeDataset));
  for (const [key, fields] of Object.entries(repairFieldMap)) {
    const sourceById = new Map((sourceDataset[key] || []).map((row) => [row.id, row]));
    repaired[key] = (repaired[key] || []).map((row) => {
      const source = sourceById.get(row.id);
      if (!source) return row;
      const next = { ...row };
      for (const field of fields) {
        if (isQuestionCorrupted(row[field]) && String(source[field] ?? "").trim()) {
          next[field] = source[field];
        }
      }
      return next;
    });
  }
  return repaired;
}

function validateDataset(dataset) {
  const errors = [];
  for (const key of datasetKeys.slice(0, 6)) {
    if (!Array.isArray(dataset[key])) errors.push(`${key} 必须是数组`);
  }
  if (errors.length) return { ok: false, errors };

  const planIds = new Set();
  const planCodes = new Set();
  const labIds = new Set();
  const labCodes = new Set();
  const spaceIds = new Set();
  const spaceCodes = new Set();
  const assignmentIds = new Set();

  for (const plan of dataset.plans) {
    if (!plan.id || planIds.has(plan.id)) errors.push(`方案 id 重复或缺失: ${plan.id || "(empty)"}`);
    if (!plan.plan_code || planCodes.has(plan.plan_code)) errors.push(`方案编码重复或缺失: ${plan.plan_code || "(empty)"}`);
    planIds.add(plan.id);
    planCodes.add(plan.plan_code);
  }

  for (const lab of dataset.labs) {
    if (!lab.id || labIds.has(lab.id)) errors.push(`实验室 id 重复或缺失: ${lab.id || "(empty)"}`);
    if (!lab.lab_code || labCodes.has(lab.lab_code)) errors.push(`实验室编码重复或缺失: ${lab.lab_code || "(empty)"}`);
    labIds.add(lab.id);
    labCodes.add(lab.lab_code);
  }

  for (const space of dataset.spaces) {
    const codeKey = `${space.building_code || ""}::${space.floor_code || ""}::${space.space_code || ""}`;
    if (!space.id || spaceIds.has(space.id)) errors.push(`空间 id 重复或缺失: ${space.id || "(empty)"}`);
    if (!space.space_code || spaceCodes.has(codeKey)) errors.push(`空间编码重复或缺失: ${space.space_code || "(empty)"}`);
    spaceIds.add(space.id);
    spaceCodes.add(codeKey);
  }

  for (const assignment of dataset.plan_assignments) {
    if (!assignment.id || assignmentIds.has(assignment.id)) errors.push(`分配 id 重复或缺失: ${assignment.id || "(empty)"}`);
    assignmentIds.add(assignment.id);
    if (assignment.plan_id && !planIds.has(assignment.plan_id)) errors.push(`分配引用了不存在的 plan_id: ${assignment.plan_id}`);
    if (assignment.plan_code && !planCodes.has(assignment.plan_code)) errors.push(`分配引用了不存在的 plan_code: ${assignment.plan_code}`);
    if (assignment.lab_id && !labIds.has(assignment.lab_id)) errors.push(`分配引用了不存在的 lab_id: ${assignment.lab_id}`);
    if (assignment.lab_code && !labCodes.has(assignment.lab_code)) errors.push(`分配引用了不存在的 lab_code: ${assignment.lab_code}`);
    if (assignment.space_id && !spaceIds.has(assignment.space_id)) errors.push(`分配引用了不存在的 space_id: ${assignment.space_id}`);
  }

  return { ok: errors.length === 0, errors };
}

function summarizeDataset(dataset) {
  return {
    buildings: dataset.buildings.length,
    floorSegments: dataset.floor_segments.length,
    spaces: dataset.spaces.length,
    labs: dataset.labs.length,
    plans: dataset.plans.length,
    assignments: dataset.plan_assignments.length,
  };
}

function buildImportSummary(currentDataset, nextDataset) {
  const currentSummary = summarizeDataset(currentDataset);
  const nextSummary = summarizeDataset(nextDataset);
  return {
    current: currentSummary,
    next: nextSummary,
    delta: {
      buildings: nextSummary.buildings - currentSummary.buildings,
      floorSegments: nextSummary.floorSegments - currentSummary.floorSegments,
      spaces: nextSummary.spaces - currentSummary.spaces,
      labs: nextSummary.labs - currentSummary.labs,
      plans: nextSummary.plans - currentSummary.plans,
      assignments: nextSummary.assignments - currentSummary.assignments,
    },
  };
}

function createSession(userId, remember) {
  const id = crypto.randomUUID();
  const ttlMs = remember ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, expiresAt, nowIso());
  return { id, expiresAt };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, expected) {
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
}

function ensureScheduledBackup() {
  setInterval(() => {
    try {
      const active = getActiveDataset();
      createSnapshot("scheduled_backup", `每日备份 #${active.revision}`, active.dataset, active.revision, "system", 0);
      const target = path.join(backupsDir, `app-${Date.now()}.sqlite`);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      const safeTarget = target.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${safeTarget}'`);
    } catch (error) {
      console.error("scheduled backup failed", error);
    }
  }, 24 * 60 * 60 * 1000);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) {
        reject(httpError(413, "payload_too_large", "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(httpError(400, "invalid_json", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader.split(";").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const index = pair.indexOf("=");
    if (index === -1) return [pair, ""];
    return [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
  }));
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function serveStatic(res, pathname) {
  const resolvedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const target = path.normalize(path.join(root, resolvedPath));
  if (!target.startsWith(root) || target.startsWith(dataDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function writeAudit(action, actor, ip, details) {
  db.prepare("INSERT INTO audit_logs (action, actor, ip, details_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(action, actor, ip, JSON.stringify(details || {}), nowIso());
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function toBoolean(value) {
  return ["true", "1", "yes", "y", "是"].includes(String(value ?? "").trim().toLowerCase());
}

process.on("uncaughtException", (error) => {
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  console.error(error);
});
