const { readJsonBody, sendJson } = require("./http-utils");

function createRouteApi(services) {
  const { auth, dataset, imports, snapshots, audit } = services;

  return async function routeApi(req, res, _url, pathname, context) {
    if (req.method === "GET" && pathname === "/api/bootstrap") {
      const active = dataset.getActiveDataset();
      return sendJson(res, 200, {
        user: auth.publicUser(context.user),
        permissions: auth.permissionsFor(context.user),
        dataset: active.dataset,
        revision: active.revision,
        maintenance: dataset.buildMaintenance(active.dataset),
      });
    }

    if (req.method === "GET" && pathname === "/api/me") {
      return sendJson(res, 200, { user: auth.publicUser(context.user), permissions: auth.permissionsFor(context.user) });
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const login = auth.login(String(body.username || "").trim(), String(body.password || ""), Boolean(body.remember), context);
      res.setHeader("Set-Cookie", login.cookie);
      return sendJson(res, 200, { user: login.user, permissions: login.permissions });
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      res.setHeader("Set-Cookie", auth.logout(context));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/dataset/active") {
      const active = dataset.getActiveDataset();
      return sendJson(res, 200, { dataset: active.dataset, revision: active.revision, maintenance: dataset.buildMaintenance(active.dataset) });
    }

    if (req.method === "PUT" && pathname === "/api/dataset/active") {
      auth.requireRole(context.user, ["editor", "admin"]);
      return handleSaveDataset(req, res, context, services);
    }

    if (req.method === "POST" && pathname === "/api/dataset/repair-text") {
      auth.requireRole(context.user, ["admin"]);
      return handleRepairDatasetText(res, context, services);
    }

    if (req.method === "POST" && pathname === "/api/imports") {
      auth.requireRole(context.user, ["admin"]);
      const body = await readJsonBody(req);
      const result = imports.createImportDraft(body, context);
      return sendJson(res, result.statusCode, result.payload);
    }

    if (req.method === "GET" && pathname === "/api/imports") {
      auth.requireRole(context.user, ["admin"]);
      return sendJson(res, 200, { drafts: imports.listImportDrafts() });
    }

    const publishMatch = pathname.match(/^\/api\/imports\/(\d+)\/publish$/);
    if (req.method === "POST" && publishMatch) {
      auth.requireRole(context.user, ["admin"]);
      const result = imports.publishImportDraft(Number(publishMatch[1]), context.user.username, context.ip);
      return sendJson(res, 200, result);
    }

    const discardMatch = pathname.match(/^\/api\/imports\/(\d+)$/);
    if (req.method === "DELETE" && discardMatch) {
      auth.requireRole(context.user, ["admin"]);
      imports.discardImportDraft(Number(discardMatch[1]), context.user.username, context.ip);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/snapshots") {
      auth.requireRole(context.user, ["admin"]);
      return sendJson(res, 200, { snapshots: snapshots.listSnapshots() });
    }

    const restoreMatch = pathname.match(/^\/api\/snapshots\/(\d+)\/restore$/);
    if (req.method === "POST" && restoreMatch) {
      auth.requireRole(context.user, ["admin"]);
      const result = snapshots.restoreSnapshot(Number(restoreMatch[1]), context.user.username, context.ip);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: "not_found", message: "Not found" });
  };
}

async function handleSaveDataset(req, res, context, services) {
  const body = await readJsonBody(req);
  const normalized = services.dataset.normalizeIncomingDataset(body.dataset);
  const validation = services.dataset.validateDataset(normalized);
  if (!validation.ok) {
    return sendJson(res, 400, { error: "invalid_dataset", message: validation.errors.join("；"), errors: validation.errors });
  }
  const corruption = services.dataset.detectTextCorruption(normalized);
  if (corruption.detected) {
    services.audit.writeAudit("suspected_text_corruption_rejected", context.user.username, context.ip, {
      source: "save_dataset",
      summary: corruption,
    });
    return sendJson(res, 422, {
      error: "suspected_text_corruption",
      message: "检测到本次保存包含异常的问号化文本，已阻止覆盖正式数据，请先修复编码后再保存。",
      details: corruption,
    });
  }

  try {
    const result = services.dataset.saveActiveDataset(normalized, context.user.username, { expectedRevision: body.expectedRevision });
    services.audit.writeAudit("dataset_saved", context.user.username, context.ip, {
      revision: result.revision,
      changeNote: String(body.changeNote || "").trim(),
      summary: services.dataset.summarizeDataset(normalized),
    });
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    if (error.code === "revision_conflict") {
      return sendJson(res, 409, {
        error: error.code,
        message: error.message,
        ...error.payload,
      });
    }
    throw error;
  }
}

function handleRepairDatasetText(res, context, services) {
  const active = services.dataset.getActiveDataset();
  const source = services.dataset.findTextRepairSource(active.dataset);
  if (!source) {
    return sendJson(res, 404, {
      error: "repair_source_not_found",
      message: "未找到可用于修复中文文本的可信数据源。",
    });
  }

  const repaired = services.dataset.repairDatasetText(active.dataset, source.dataset);
  services.snapshots.createSnapshot("pre_text_repair", `中文修复前快照 #${active.revision}`, active.dataset, active.revision, context.user.username, 0);
  const result = services.dataset.saveActiveDataset(repaired, context.user.username);
  services.audit.writeAudit("dataset_text_repaired", context.user.username, context.ip, {
    revision: result.revision,
    source: source.label,
  });
  return sendJson(res, 200, { ok: true, ...result });
}

module.exports = { createRouteApi };
