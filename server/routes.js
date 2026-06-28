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

    const activeManagedPlanMatch = pathname.match(/^\/api\/manage\/active-plans\/([^/]+)$/);
    if (req.method === "GET" && activeManagedPlanMatch) {
      auth.requireRole(context.user, ["admin"]);
      return sendJson(res, 200, planCopies.getActiveManagedPlan(decodeURIComponent(activeManagedPlanMatch[1]), context.user));
    }

    if (req.method === "PATCH" && activeManagedPlanMatch) {
      auth.requireRole(context.user, ["admin"]);
      const body = await readJsonBody(req);
      planCopies.updateActiveManagedPlan(decodeURIComponent(activeManagedPlanMatch[1]), body, context.user);
      audit.writeAudit("active_plan_updated", context.user.username, context.ip, { planCode: decodeURIComponent(activeManagedPlanMatch[1]) });
      return sendVisibleDataset(res, context, services);
    }

    if (req.method === "DELETE" && activeManagedPlanMatch) {
      auth.requireRole(context.user, ["admin"]);
      planCopies.deleteActiveManagedPlan(decodeURIComponent(activeManagedPlanMatch[1]), context.user);
      audit.writeAudit("active_plan_deleted", context.user.username, context.ip, { planCode: decodeURIComponent(activeManagedPlanMatch[1]) });
      return sendVisibleDataset(res, context, services);
    }

    const activeBaselineMatch = pathname.match(/^\/api\/manage\/active-plans\/([^/]+)\/baseline$/);
    if (req.method === "POST" && activeBaselineMatch) {
      auth.requireRole(context.user, ["admin"]);
      const body = await readJsonBody(req);
      const isBaseline = body.isBaseline !== false;
      planCopies.setActiveManagedPlanBaseline(decodeURIComponent(activeBaselineMatch[1]), context.user, isBaseline);
      audit.writeAudit(isBaseline ? "active_plan_baselined" : "active_plan_unbaselined", context.user.username, context.ip, { planCode: decodeURIComponent(activeBaselineMatch[1]) });
      return sendVisibleDataset(res, context, services);
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
      const body = await readJsonBody(req);
      const isBaseline = body.isBaseline !== false;
      planCopies.setManagedPlanBaseline(Number(baselineMatch[1]), context.user, isBaseline);
      audit.writeAudit(isBaseline ? "managed_plan_baselined" : "managed_plan_unbaselined", context.user.username, context.ip, { copyId: Number(baselineMatch[1]) });
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

    if (req.method === "POST" && pathname === "/api/dataset/normalize-numbering") {
      auth.requireRole(context.user, ["admin"]);
      return handleNormalizeNumbering(res, context, services);
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

function handleNormalizeNumbering(res, context, services) {
  const active = services.dataset.getActiveDataset();
  services.dataset.writeRepairBackup("numbering-repair", {
    createdAt: new Date().toISOString(),
    active,
    planCopies: services.planCopies.listBackupRows(),
  });
  services.snapshots.createSnapshot("pre_numbering_normalize", `编号规范化前快照 #${active.revision}`, active.dataset, active.revision, context.user.username, 0);
  const result = services.planCopies.normalizeAllNumbering(context.user);
  services.audit.writeAudit("dataset_numbering_normalized", context.user.username, context.ip, {
    revision: result.revision,
  });
  return sendVisibleDataset(res, context, services, 200, { ok: true, revision: result.revision });
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
  const active = services.dataset.getActiveDataset();
  const copyIndex = services.planCopies.copyPayloadIndex();
  const activeNormalized = services.dataset.normalizeIncomingDataset(stripPlanCopies(active.dataset, active.dataset, copyIndex));
  const incomingNormalized = services.dataset.normalizeIncomingDataset(stripPlanCopies(body.dataset, active.dataset, copyIndex));
  const normalized = services.dataset.mergeTextSafeDataset(activeNormalized, incomingNormalized);
  const validation = services.dataset.validateDataset(normalized);
  if (!validation.ok) {
    return sendJson(res, 400, { error: "invalid_dataset", message: validation.errors.join("；"), errors: validation.errors });
  }
  const corruption = services.dataset.detectTextCorruption(normalized);
  if (corruption.detected) {
    const activeCorruption = services.dataset.detectTextCorruption(activeNormalized);
    const makesCorruptionWorse = !activeCorruption.detected || corruption.suspiciousFields > activeCorruption.suspiciousFields;
    if (makesCorruptionWorse) {
      services.audit.writeAudit("suspected_text_corruption_rejected", context.user.username, context.ip, {
        source: "save_dataset",
        summary: corruption,
        activeSummary: activeCorruption,
      });
      return sendJson(res, 422, {
        error: "suspected_text_corruption",
        message: "检测到本次保存新增或加重了异常的问号化文本，已阻止覆盖正式数据，请先修复编码后再保存。",
        details: corruption,
      });
    }
    services.audit.writeAudit("suspected_text_corruption_allowed", context.user.username, context.ip, {
      source: "save_dataset",
      summary: corruption,
      activeSummary: activeCorruption,
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

function stripPlanCopies(rawDataset, activeDataset = {}, copyIndex = null) {
  const dataset = { ...(rawDataset || {}) };
  const activeIds = {
    buildings: new Set((activeDataset.buildings || []).map((row) => String(row.id || ""))),
    floor_segments: new Set((activeDataset.floor_segments || []).map((row) => String(row.id || ""))),
    spaces: new Set((activeDataset.spaces || []).map((row) => String(row.id || ""))),
    labs: new Set((activeDataset.labs || []).map((row) => String(row.id || ""))),
    lab_types: new Set((activeDataset.lab_types || []).map((row) => String(row.id || ""))),
    colleges: new Set((activeDataset.colleges || []).map((row) => String(row.id || ""))),
    majors: new Set((activeDataset.majors || []).map((row) => String(row.id || ""))),
    file_assets: new Set((activeDataset.file_assets || []).map((row) => String(row.id || ""))),
  };
  const copyCodes = new Set((dataset.plans || [])
    .map((plan) => String(plan.plan_code || ""))
    .filter((code) => code.startsWith("copy-")));
  for (const code of copyIndex?.planCodes || []) copyCodes.add(String(code));
  const copyPlanIds = new Set([...(copyIndex?.planIds || [])].map(String));
  dataset.plans = (dataset.plans || []).filter((plan) => {
    const copyId = String(plan.copy_id || plan.copyId || "").trim();
    const code = String(plan.plan_code || "").trim();
    const id = String(plan.id || "").trim();
    return !copyId && !copyCodes.has(code) && !copyPlanIds.has(id);
  });
  dataset.plan_assignments = (dataset.plan_assignments || []).filter((assignment) => !copyCodes.has(String(assignment.plan_code || "")));
  const filterCopyRows = (key, ids) => {
    const copyIds = new Set([...(ids || [])].map(String));
    dataset[key] = (dataset[key] || []).filter((row) => {
      const id = String(row.id || "").trim();
      const rowCopyId = String(row.copy_id || row.copyId || "").trim();
      if (rowCopyId) return false;
      return !id || !copyIds.has(id) || activeIds[key]?.has(id);
    });
  };
  filterCopyRows("buildings", copyIndex?.buildingIds);
  filterCopyRows("floor_segments", copyIndex?.floorSegmentIds);
  filterCopyRows("spaces", copyIndex?.spaceIds);
  filterCopyRows("labs", copyIndex?.labIds);
  filterCopyRows("lab_types", copyIndex?.labTypeIds);
  filterCopyRows("colleges", copyIndex?.collegeIds);
  filterCopyRows("majors", copyIndex?.majorIds);
  filterCopyRows("file_assets", copyIndex?.fileAssetIds);
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
