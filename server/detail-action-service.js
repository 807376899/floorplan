"use strict";

const { httpError, nowIso, toBoolean } = require("./http-utils");
const DatasetProjection = require("./dataset-projection-service");
const DetailActions = require("../js/app/detail-actions");

function text(value) {
  return String(value ?? "").trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function generateSpaceCode(space, building) {
  const campus = text(building?.campus_zone).includes("绍兴") ? "02" : "01";
  const buildingNumber = String(numberValue(building?.building_number, Number(text(building?.building_code).match(/\d{2}(\d{2})$/)?.[1] || 0))).padStart(2, "0").slice(-2);
  const floorRaw = text(space?.floor_code).toUpperCase();
  const floorNumber = /^B\d$/.test(floorRaw) ? floorRaw : String(numberValue(floorRaw, 0)).padStart(2, "0").slice(-2);
  const front = text(space?.front_door).replace(/\D/g, "").slice(-2).padStart(2, "0");
  if (!front || front === "00") return "";
  const rearDigits = text(space?.rear_door).replace(/\D/g, "").slice(-2).padStart(2, "0");
  const rear = rearDigits && rearDigits !== "00" ? rearDigits : front;
  return `0${campus}${buildingNumber}${floorNumber}${front}${rear}`;
}

function generateUnitCode(labs = []) {
  const max = (labs || []).reduce((value, lab) => {
    const match = text(lab.lab_code).match(/^UNIT(\d+)$/i);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `UNIT${String(max + 1).padStart(6, "0")}`;
}

function isAssignableSegment(segment) {
  return text(segment?.element_type || "corridor").toLowerCase() === "corridor";
}

function rowCopyId(row) {
  return Number(row?.copy_id || row?.copyId || 0);
}

function planMatches(row, planCode) {
  return text(row.plan_id) === planCode || text(row.plan_code) === planCode;
}

function makePublicCopy(row) {
  const isBaseline = toBoolean(row.is_baseline);
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    planCode: row.plan_code,
    planName: row.plan_name,
    description: row.description || "",
    visibility: row.visibility,
    isBaseline,
    sourceType: row.source_type || "copy",
    revision: row.revision,
    sourcePlanCode: row.source_plan_code || "",
    sourceCopyId: row.source_copy_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plan: {
      id: row.plan_code,
      copy_id: row.id,
      plan_code: row.plan_code,
      plan_name: row.plan_name,
      description: row.description || "",
      plan_type: isBaseline ? "baseline" : "copy",
      is_locked: isBaseline,
    },
  };
}

function selectedSpaceFrom(dataset, plan, selectedSpace) {
  const wantedId = text(selectedSpace?.id);
  const wantedCode = text(selectedSpace?.space_code);
  const copyId = Number(plan?.copy_id || 0);
  const candidates = (dataset.spaces || []).filter((space) => {
    if (copyId && rowCopyId(space) && rowCopyId(space) !== copyId) return false;
    return (wantedId && text(space.id) === wantedId) || (wantedCode && text(space.space_code) === wantedCode);
  });
  return candidates.find((space) => copyId && rowCopyId(space) === copyId) || candidates[0] || null;
}

function findAssignment(dataset, plan, space) {
  if (!plan || !space) return null;
  const refs = new Set([text(space.id), text(space.space_code)].filter(Boolean));
  return (dataset.plan_assignments || []).find((assignment) =>
    planMatches(assignment, plan.id || plan.plan_code) &&
    assignment.assignment_status === "assigned" &&
    (refs.has(text(assignment.space_id)) || refs.has(text(assignment.space_code)))
  ) || null;
}

function findLab(dataset, plan, assignment) {
  if (!assignment) return null;
  const copyId = Number(plan?.copy_id || 0);
  const candidates = (dataset.labs || []).filter((lab) =>
    text(lab.lab_code) === text(assignment.lab_code) || text(lab.id) === text(assignment.lab_id)
  );
  return candidates.find((lab) => copyId && rowCopyId(lab) === copyId) || candidates[0] || null;
}

function ensureScopedRow(dataset, key, row, copyId) {
  if (!copyId || !row || rowCopyId(row) === copyId) return row;
  const codeKey = key === "labs" ? "lab_code" : "space_code";
  const clone = {
    ...row,
    id: `copy:${copyId}::${text(row.id || row[codeKey])}`,
    copy_id: copyId,
  };
  dataset[key] = [...(dataset[key] || []), clone];
  return clone;
}

function buildContext(dataset, body, copyId = 0) {
  const planCode = text(body.planCode);
  const activePlan = (dataset.plans || []).find((plan) => text(plan.plan_code || plan.id) === planCode) || null;
  if (!activePlan) throw httpError(400, "plan_not_found", "未找到当前方案");
  if (body.action === "createSpace") {
    const buildingCode = text(body.buildingCode);
    const building = (dataset.buildings || []).find((row) => text(row.building_code) === buildingCode) || null;
    return {
      activePlan,
      building,
      buildingCode,
      floorCode: text(body.floorCode),
      space: null,
      assignment: null,
      lab: null,
    };
  }
  const space = selectedSpaceFrom(dataset, activePlan, body.selectedSpace || {});
  if (body.action !== "createSpace" && !space) throw httpError(400, "space_not_found", "未找到当前房间");
  if (copyId && ["editSpace"].includes(body.action)) {
    const scoped = ensureScopedRow(dataset, "spaces", space, copyId);
    return buildContextWithSpace(dataset, activePlan, scoped);
  }
  const context = buildContextWithSpace(dataset, activePlan, space);
  if (copyId && body.action === "editLab") {
    context.lab = ensureScopedRow(dataset, "labs", context.lab, copyId);
  }
  return context;
}

function buildContextWithSpace(dataset, activePlan, space) {
  const building = (dataset.buildings || []).find((row) => text(row.building_code) === text(space?.building_code)) || null;
  const assignment = findAssignment(dataset, activePlan, space);
  const lab = findLab(dataset, activePlan, assignment);
  return {
    activePlan,
    building,
    buildingCode: space?.building_code || "",
    floorCode: space?.floor_code || "",
    space,
    assignment,
    lab,
  };
}

function applyAction(dataset, context, body, copyId = 0) {
  const deps = {
    copyScope: copyId ? { copy_id: copyId } : {},
    normalizeLab: (row) => row,
    normalizeSpace: (row) => row,
    normalizeAssignment: (row) => row,
    generateSpaceCode,
    generateUnitCode,
    isAssignableSegment,
    isoNow: nowIso,
    clearDeletedSpaceRefs: DetailActions.clearDeletedSpaceRefs,
  };
  if (body.action === "editLab") return DetailActions.applyDetailLabEdit(dataset, context, body.form || {}, deps);
  if (body.action === "renovateRoom") return DetailActions.applyDetailRenovation(dataset, context, body.form || {}, deps);
  if (body.action === "createSpace") return DetailActions.applyDetailCreateSpace(dataset, context, body.form || {}, deps);
  if (body.action === "editSpace") return DetailActions.applyDetailSpaceEdit(dataset, context, body.form || {}, deps);
  if (body.action === "deleteSpace") return DetailActions.applyDetailDeleteSpace(dataset, context, deps);
  return { ok: false, message: "未知详情操作。" };
}

function upsertSpaceOverride(db, planCode, space, now) {
  const code = text(space.space_code || space.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO plan_space_overrides (id, plan_id, base_space_id, space_code, operation, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'upsert', ?, ?, ?)
    ON CONFLICT(plan_id, space_code) DO UPDATE SET
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(`${planCode}__${code}`, planCode, text(space.id), code, JSON.stringify(space), now, now);
}

function upsertLabOverride(db, planCode, lab, now) {
  const code = text(lab.lab_code || lab.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO plan_lab_overrides (id, plan_id, base_lab_id, lab_code, operation, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'upsert', ?, ?, ?)
    ON CONFLICT(plan_id, lab_code) DO UPDATE SET
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(`${planCode}__${code}`, planCode, text(lab.id), code, JSON.stringify(lab), now, now);
}

function replaceAssignments(db, planCode, assignments, now) {
  db.prepare("DELETE FROM plan_assignments WHERE plan_id = ?").run(planCode);
  const stmt = db.prepare(`
    INSERT INTO plan_assignments (
      id, plan_id, plan_code, lab_code, space_code, previous_space_code, assignment_status,
      effective_from, move_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of assignments) {
    const labCode = text(row.lab_code || row.lab_id);
    if (!labCode) continue;
    stmt.run(
      text(row.id) || `${planCode}__${labCode}`,
      planCode,
      text(row.plan_code) || planCode,
      labCode,
      text(row.space_code),
      text(row.previous_space_code),
      text(row.assignment_status) || "assigned",
      text(row.effective_from),
      text(row.move_note),
      text(row.created_at) || now,
      now
    );
  }
}

function replaceDeletedSpaces(db, planCode, deletedRefs, copyId, now) {
  db.prepare("DELETE FROM plan_deleted_spaces WHERE plan_id = ?").run(planCode);
  const stmt = db.prepare(`
    INSERT INTO plan_deleted_spaces (id, plan_id, base_space_id, space_code, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, space_code) DO NOTHING
  `);
  for (const ref of deletedRefs || []) {
    const raw = text(ref);
    const prefix = `copy:${copyId}::`;
    if (!raw.startsWith(prefix)) continue;
    const code = raw.slice(prefix.length);
    if (!code) continue;
    stmt.run(`${planCode}__${code}`, planCode, code, code, now);
  }
}

function copySnapshot(dataset, planCode, copyId) {
  return {
    buildings: [],
    floor_segments: [],
    spaces: (dataset.spaces || []).filter((row) => rowCopyId(row) === copyId),
    labs: (dataset.labs || []).filter((row) => rowCopyId(row) === copyId),
    colleges: [],
    majors: [],
    lab_types: [],
    plans: (dataset.plans || []).filter((row) => text(row.plan_code || row.id) === planCode),
    plan_assignments: (dataset.plan_assignments || []).filter((row) => planMatches(row, planCode)),
    file_assets: [],
    imports: [],
    deleted_space_ids: (dataset.deleted_space_ids || []).filter((ref) => text(ref).startsWith(`copy:${copyId}::`)),
  };
}

function createDetailActionService(db, datasetService) {
  function ownedCopy(copyId, user) {
    const row = db.prepare("SELECT * FROM plan_copies WHERE id = ? AND deleted_at IS NULL").get(copyId);
    if (!row) throw httpError(404, "copy_not_found", "未找到方案");
    if (!user || (row.owner_user_id !== user.id && user.role !== "admin")) {
      throw httpError(403, "forbidden", "只能管理自己创建的方案");
    }
    if (toBoolean(row.is_baseline) && user.role !== "admin") {
      throw httpError(403, "baseline_locked", "基线方案只能由管理员管理");
    }
    return row;
  }

  function submitCopyDetailAction(copyId, body, user) {
    const row = ownedCopy(copyId, user);
    if (Number(body.expectedRevision) !== row.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前方案已被更新，请刷新后重试"), {
        payload: { copy: makePublicCopy(row) },
      });
    }
    const now = nowIso();
    const nextRevision = row.revision + 1;
    const dataset = datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user));
    const context = buildContext(dataset, { ...body, planCode: row.plan_code }, copyId);
    const actionResult = applyAction(dataset, context, body, copyId);
    if (!actionResult.ok) throw httpError(400, "invalid_detail_action", actionResult.message || "详情保存失败");
    const normalized = datasetService.normalizeIncomingDataset(dataset);
    const assignments = (normalized.plan_assignments || []).filter((assignment) => planMatches(assignment, row.plan_code));
    const snapshot = datasetService.normalizeIncomingDataset(copySnapshot(normalized, row.plan_code, copyId));
    db.exec("BEGIN");
    try {
      for (const space of snapshot.spaces) upsertSpaceOverride(db, row.plan_code, space, now);
      for (const lab of snapshot.labs) upsertLabOverride(db, row.plan_code, lab, now);
      replaceAssignments(db, row.plan_code, assignments, now);
      replaceDeletedSpaces(db, row.plan_code, snapshot.deleted_space_ids, copyId, now);
      db.prepare(`
        UPDATE plan_copies
        SET assignments_json = ?, dataset_json = ?, revision = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(assignments), JSON.stringify(snapshot), nextRevision, now, copyId);
      db.prepare("UPDATE plans SET revision = ?, updated_at = ? WHERE plan_code = ?").run(nextRevision, now, row.plan_code);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const active = datasetService.getActiveDataset();
    return {
      ok: true,
      copyRevision: nextRevision,
      revision: active.revision,
      dataset: datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user, { fallbackDataset: snapshot })),
    };
  }

  function submitActiveDetailAction(body, user) {
    if (!user || user.role !== "admin") throw httpError(403, "forbidden", "只有管理员可以修改共享基线数据");
    const active = datasetService.getActiveDataset();
    if (Number(body.expectedRevision) !== active.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前数据已被其他人更新，请刷新后重试"), {
        payload: { revision: active.revision, dataset: active.dataset },
      });
    }
    const dataset = datasetService.normalizeIncomingDataset(active.dataset);
    const context = buildContext(dataset, body, 0);
    const actionResult = applyAction(dataset, context, body, 0);
    if (!actionResult.ok) throw httpError(400, "invalid_detail_action", actionResult.message || "详情保存失败");
    const normalized = datasetService.normalizeIncomingDataset(dataset);
    const result = datasetService.saveActiveDataset(normalized, user.username, { expectedRevision: body.expectedRevision });
    return {
      ok: true,
      revision: result.revision,
      dataset: datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user, { fallbackDataset: result.dataset })),
    };
  }

  return {
    submitCopyDetailAction,
    submitActiveDetailAction,
  };
}

module.exports = {
  createDetailActionService,
};
