const { readJsonBody, sendJson } = require("./http-utils");

function createRouteApi(services) {
  const { auth, dataset, imports, snapshots, audit, planCopies } = services;

  return async function routeApi(req, res, _url, pathname, context) {
    if (req.method === "GET" && pathname === "/api/bootstrap") {
      const active = planCopies.buildVisibleDataset(context.user);
      return sendJson(res, 200, {
        user: auth.publicUser(context.user),
        permissions: auth.permissionsFor(context.user),
        dataset: active.dataset,
        revision: active.revision,
        planCopies: active.copies,
        maintenance: dataset.buildMaintenance(active.dataset),
      });
    }

    if (req.method === "GET" && pathname === "/api/me") {
      return sendJson(res, 200, { user: auth.publicUser(context.user), permissions: auth.permissionsFor(context.user) });
    }

    if (req.method === "GET" && pathname === "/api/users") {
      auth.requireRole(context.user, ["admin"]);
      return sendJson(res, 200, { users: auth.listUsers() });
    }

    if (req.method === "POST" && pathname === "/api/users") {
      auth.requireRole(context.user, ["admin"]);
      const body = await readJsonBody(req);
      const user = auth.createManagedUser(body);
      audit.writeAudit("user_created", context.user.username, context.ip, {
        userId: user.id,
        username: user.username,
        role: user.role,
      });
      return sendJson(res, 200, { ok: true, user });
    }

    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (req.method === "DELETE" && userMatch) {
      auth.requireRole(context.user, ["admin"]);
      const user = auth.disableUser(Number(userMatch[1]), context.user);
      audit.writeAudit("user_disabled", context.user.username, context.ip, {
        userId: user.id,
        username: user.username,
      });
      return sendJson(res, 200, { ok: true });
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
      const active = planCopies.buildVisibleDataset(context.user);
      return sendJson(res, 200, {
        dataset: active.dataset,
        revision: active.revision,
        planCopies: active.copies,
        maintenance: dataset.buildMaintenance(active.dataset),
      });
    }

    if (req.method === "POST" && pathname === "/api/plan-copies") {
      auth.requireRole(context.user, ["editor", "admin"]);
      const body = await readJsonBody(req);
      const result = planCopies.createCopy(body, context.user);
      audit.writeAudit("plan_copy_created", context.user.username, context.ip, result);
      return sendVisibleDataset(res, context, services, 200, { ok: true, ...result });
    }

    if (req.method === "GET" && pathname === "/api/manage/plans") {
      auth.requireRole(context.user, ["admin"]);
      return sendJson(res, 200, { plans: planCopies.listManageablePlans(context.user) });
    }

    const managedPlanMatch = pathname.match(/^\/api\/manage\/plans\/(\d+)$/);
    if (req.method === "GET" && managedPlanMatch) {
      auth.requireRole(context.user, ["admin"]);
      return sendJson(res, 200, planCopies.getManagedPlan(Number(managedPlanMatch[1]), context.user));
    }

    if (req.method === "PATCH" && managedPlanMatch) {
      auth.requireRole(context.user, ["admin"]);
      const body = await readJsonBody(req);
      planCopies.updateManagedPlan(Number(managedPlanMatch[1]), body, context.user);
      audit.writeAudit("managed_plan_updated", context.user.username, context.ip, { copyId: Number(managedPlanMatch[1]) });
      return sendVisibleDataset(res, context, services);
    }

    if (req.method === "DELETE" && managedPlanMatch) {
      auth.requireRole(context.user, ["admin"]);
      planCopies.deleteManagedPlan(Number(managedPlanMatch[1]), context.user);
      audit.writeAudit("managed_plan_deleted", context.user.username, context.ip, { copyId: Number(managedPlanMatch[1]) });
      return sendVisibleDataset(res, context, services);
    }

    const baselineMatch = pathname.match(/^\/api\/manage\/plans\/(\d+)\/baseline$/);
    if (req.method === "POST" && baselineMatch) {
      auth.requireRole(context.user, ["admin"]);
      planCopies.setManagedPlanBaseline(Number(baselineMatch[1]), context.user);
      audit.writeAudit("managed_plan_baselined", context.user.username, context.ip, { copyId: Number(baselineMatch[1]) });
      return sendVisibleDataset(res, context, services);
    }

    const copyMatch = pathname.match(/^\/api\/plan-copies\/(\d+)$/);
    if (req.method === "PATCH" && copyMatch) {
      auth.requireRole(context.user, ["editor", "admin"]);
      const body = await readJsonBody(req);
      planCopies.updateCopy(Number(copyMatch[1]), body, context.user);
      audit.writeAudit("plan_copy_updated", context.user.username, context.ip, { copyId: Number(copyMatch[1]) });
      return sendVisibleDataset(res, context, services);
    }

    if (req.method === "DELETE" && copyMatch) {
      auth.requireRole(context.user, ["editor", "admin"]);
      planCopies.deleteCopy(Number(copyMatch[1]), context.user);
      audit.writeAudit("plan_copy_deleted", context.user.username, context.ip, { copyId: Number(copyMatch[1]) });
      return sendVisibleDataset(res, context, services);
    }

    const assignmentMatch = pathname.match(/^\/api\/plan-copies\/(\d+)\/assignments$/);
    if (req.method === "PUT" && assignmentMatch) {
      auth.requireRole(context.user, ["editor", "admin"]);
      const body = await readJsonBody(req);
      const result = planCopies.saveAssignments(Number(assignmentMatch[1]), body, context.user);
      audit.writeAudit("plan_copy_assignments_saved", context.user.username, context.ip, {
        copyId: Number(assignmentMatch[1]),
        revision: result.revision,
      });
      return sendVisibleDataset(res, context, services, 200, { ok: true, copyRevision: result.revision });
    }

    const copyDatasetMatch = pathname.match(/^\/api\/plan-copies\/(\d+)\/dataset$/);
    if (req.method === "PUT" && copyDatasetMatch) {
      auth.requireRole(context.user, ["editor", "admin"]);
      const body = await readJsonBody(req);
      const result = planCopies.saveCopyDataset(Number(copyDatasetMatch[1]), body, context.user);
      audit.writeAudit("plan_copy_dataset_saved", context.user.username, context.ip, {
        copyId: Number(copyDatasetMatch[1]),
        revision: result.revision,
      });
      return sendVisibleDataset(res, context, services, 200, { ok: true, copyRevision: result.revision });
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

    const importDraftMatch = pathname.match(/^\/api\/imports\/(\d+)$/);
    if (req.method === "GET" && importDraftMatch) {
      auth.requireRole(context.user, ["admin"]);
      return sendJson(res, 200, { draft: imports.getImportDraft(Number(importDraftMatch[1])) });
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

function sendVisibleDataset(res, context, services, statusCode = 200, extra = {}) {
  const active = services.planCopies.buildVisibleDataset(context.user);
  return sendJson(res, statusCode, {
    ...extra,
    dataset: active.dataset,
    revision: active.revision,
    planCopies: active.copies,
    maintenance: services.dataset.buildMaintenance(active.dataset),
  });
}

async function handleSaveDataset(req, res, context, services) {
  const body = await readJsonBody(req);
  const normalized = services.dataset.normalizeIncomingDataset(stripPlanCopies(body.dataset));
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
    return sendVisibleDataset(res, context, services, 200, { ok: true, revision: result.revision });
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

function stripPlanCopies(rawDataset) {
  const dataset = { ...(rawDataset || {}) };
  const copyCodes = new Set((dataset.plans || [])
    .map((plan) => String(plan.plan_code || ""))
    .filter((code) => code.startsWith("copy-")));
  dataset.plans = (dataset.plans || []).filter((plan) => !copyCodes.has(String(plan.plan_code || "")));
  dataset.plan_assignments = (dataset.plan_assignments || []).filter((assignment) => !copyCodes.has(String(assignment.plan_code || "")));
  return dataset;
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
