"use strict";

const { httpError, nowIso, toBoolean } = require("./http-utils");
const DatasetProjection = require("./dataset-projection-service");

function text(value) {
  return String(value ?? "").trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  };
}

function generateUnitCode(labs = []) {
  const max = (labs || []).reduce((value, lab) => {
    const match = text(lab.lab_code).match(/^UNIT(\d+)$/i);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `UNIT${String(max + 1).padStart(6, "0")}`;
}

function activePlanFrom(dataset, planCode) {
  const code = text(planCode);
  const plan = (dataset.plans || []).find((row) => text(row.plan_code || row.id) === code) || null;
  if (!plan) throw httpError(400, "plan_not_found", "未找到当前方案");
  return plan;
}

function findSpace(dataset, plan, input = {}) {
  const wantedId = text(input.id || input.space_id);
  const wantedCode = text(input.space_code);
  const copyId = rowCopyId(plan);
  const candidates = (dataset.spaces || []).filter((space) => {
    if (copyId && rowCopyId(space) && rowCopyId(space) !== copyId) return false;
    return (wantedId && text(space.id) === wantedId) || (wantedCode && text(space.space_code) === wantedCode);
  });
  return candidates.find((space) => copyId && rowCopyId(space) === copyId) || candidates[0] || null;
}

function findLab(dataset, plan, input = {}) {
  const wantedId = text(input.id || input.lab_id);
  const wantedCode = text(input.lab_code);
  const copyId = rowCopyId(plan);
  const candidates = (dataset.labs || []).filter((lab) =>
    (wantedId && text(lab.id) === wantedId) || (wantedCode && text(lab.lab_code) === wantedCode)
  );
  return candidates.find((lab) => copyId && rowCopyId(lab) === copyId) || candidates[0] || null;
}

function findAssignment(dataset, plan, input = {}) {
  const labRefs = new Set([text(input.lab_id || input.id), text(input.lab_code)].filter(Boolean));
  const spaceRefs = new Set([text(input.space_id), text(input.space_code)].filter(Boolean));
  return (dataset.plan_assignments || []).find((assignment) => {
    if (!planMatches(assignment, text(plan.plan_code || plan.id))) return false;
    const labMatched = !labRefs.size || labRefs.has(text(assignment.lab_id)) || labRefs.has(text(assignment.lab_code));
    const spaceMatched = !spaceRefs.size || spaceRefs.has(text(assignment.space_id)) || spaceRefs.has(text(assignment.space_code));
    return labMatched && spaceMatched;
  }) || null;
}

function targetIsOccupied(dataset, plan, targetSpace, currentAssignment) {
  return (dataset.plan_assignments || []).some((row) =>
    planMatches(row, text(plan.plan_code || plan.id)) &&
    text(row.assignment_status) === "assigned" &&
    text(row.id) !== text(currentAssignment?.id) &&
    (text(row.space_code) === text(targetSpace.space_code) || text(row.space_id) === text(targetSpace.id))
  );
}

function assertTargetAvailable(dataset, plan, targetSpace, currentAssignment) {
  if (!targetSpace) throw httpError(400, "target_space_not_found", "未找到目标空间");
  if (text(targetSpace.current_status) === "unavailable") {
    throw httpError(400, "target_space_unavailable", "不可用空间不能作为安置目标");
  }
  if (targetIsOccupied(dataset, plan, targetSpace, currentAssignment)) {
    throw httpError(400, "target_space_occupied", "目标空间已有 assigned 占用，无法落位");
  }
}

function normalizeAssignmentRows(datasetService, dataset) {
  const normalized = datasetService.normalizeIncomingDataset(dataset);
  dataset.plan_assignments = normalized.plan_assignments;
  dataset.labs = normalized.labs;
  dataset.spaces = normalized.spaces;
  dataset.plans = normalized.plans;
  return normalized;
}

function replaceAssignment(dataset, nextAssignment) {
  let replaced = false;
  dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
    if (text(row.id) !== text(nextAssignment.id)) return row;
    replaced = true;
    return { ...row, ...nextAssignment };
  });
  if (!replaced) dataset.plan_assignments.push(nextAssignment);
}

function applyMoveToBasket(dataset, plan, body) {
  const lab = findLab(dataset, plan, body.lab || {});
  const sourceSpace = findSpace(dataset, plan, body.sourceSpace || {});
  const assignment = findAssignment(dataset, plan, { ...(body.lab || {}), ...(body.sourceSpace || {}) });
  if (!lab || !assignment || !sourceSpace) throw httpError(400, "assignment_not_found", "未找到可加入待安置区的用途单元");
  replaceAssignment(dataset, {
    ...assignment,
    lab_code: assignment.lab_code || lab.lab_code,
    space_code: "",
    space_id: "",
    previous_space_code: assignment.space_code || sourceSpace.space_code || assignment.previous_space_code || "",
    previous_space_id: assignment.space_id || assignment.previous_space_id || "",
    assignment_status: "Invalid",
    updated_at: nowIso(),
  });
}

function applyReturnFromBasket(dataset, plan, body) {
  const lab = findLab(dataset, plan, body.lab || {});
  const assignment = findAssignment(dataset, plan, body.lab || {});
  const targetSpace = findSpace(dataset, plan, body.targetSpace || { space_code: assignment?.previous_space_code });
  if (!lab || !assignment) throw httpError(400, "assignment_not_found", "未找到待归位用途单元");
  assertTargetAvailable(dataset, plan, targetSpace, assignment);
  replaceAssignment(dataset, {
    ...assignment,
    lab_code: assignment.lab_code || lab.lab_code,
    space_code: targetSpace.space_code,
    previous_space_code: assignment.previous_space_code || targetSpace.space_code,
    assignment_status: "assigned",
    updated_at: nowIso(),
  });
}

function applyPlaceBasketItem(dataset, plan, body) {
  const lab = findLab(dataset, plan, body.lab || {});
  const assignment = findAssignment(dataset, plan, body.lab || {});
  const targetSpace = findSpace(dataset, plan, body.targetSpace || {});
  if (!lab || !assignment) throw httpError(400, "assignment_not_found", "未找到待落位用途单元");
  assertTargetAvailable(dataset, plan, targetSpace, assignment);
  replaceAssignment(dataset, {
    ...assignment,
    lab_code: assignment.lab_code || lab.lab_code,
    space_code: targetSpace.space_code,
    previous_space_code: assignment.previous_space_code || text(body.sourceSpace?.space_code),
    assignment_status: "assigned",
    updated_at: nowIso(),
  });
}

function applyDirectMove(dataset, plan, body) {
  const lab = findLab(dataset, plan, body.lab || {});
  const sourceSpace = findSpace(dataset, plan, body.sourceSpace || {});
  const targetSpace = findSpace(dataset, plan, body.targetSpace || {});
  const assignment = findAssignment(dataset, plan, { ...(body.lab || {}), ...(body.sourceSpace || {}) });
  if (!lab || !assignment || !sourceSpace) throw httpError(400, "assignment_not_found", "未找到可搬迁用途单元");
  if (text(sourceSpace.space_code) === text(targetSpace?.space_code)) return;
  assertTargetAvailable(dataset, plan, targetSpace, assignment);
  replaceAssignment(dataset, {
    ...assignment,
    lab_code: assignment.lab_code || lab.lab_code,
    space_code: targetSpace.space_code,
    previous_space_code: assignment.space_code || sourceSpace.space_code || assignment.previous_space_code || "",
    assignment_status: "assigned",
    updated_at: nowIso(),
  });
}

function applyCreateUnplacedUnit(dataset, plan, body, copyId) {
  const form = body.form || {};
  const labName = text(form.labName || form.lab_name);
  if (!labName) throw httpError(400, "lab_name_required", "请输入用途单元名称");
  const labCode = text(form.labCode || form.lab_code) || generateUnitCode(dataset.labs || []);
  const lab = {
    id: copyId ? `copy:${copyId}::${labCode}` : labCode,
    copy_id: copyId || "",
    lab_code: labCode,
    lab_name: labName,
    college: text(form.college || form.college_name),
    major: text(form.major || form.major_name),
    lab_type: text(form.labType || form.lab_type) || "实验室",
    director: text(form.director),
    seat_count: numberValue(form.seatCount ?? form.seat_count, 0),
    computer_count: numberValue(form.computerCount ?? form.computer_count, 0),
    status: "planning",
    notes: "",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  dataset.labs = [...(dataset.labs || []), lab];
  dataset.plan_assignments = [...(dataset.plan_assignments || []), {
    id: `${text(plan.plan_code || plan.id)}__${labCode}`,
    plan_code: text(plan.plan_code || plan.id),
    lab_code: labCode,
    space_code: "",
    previous_space_code: "",
    assignment_status: "Invalid",
    move_note: "",
    effective_from: "",
    created_at: nowIso(),
    updated_at: nowIso(),
  }];
}

function applyPlanSpace(dataset, plan, body, copyId) {
  const targetSpace = findSpace(dataset, plan, body.targetSpace || body.selectedSpace || {});
  const invalid = body.invalidAssignment ? findAssignment(dataset, plan, body.invalidAssignment || {}) : null;
  assertTargetAvailable(dataset, plan, targetSpace, invalid);
  if (body.invalidAssignment) {
    if (invalid) {
      replaceAssignment(dataset, {
        ...invalid,
        space_code: "",
        space_id: "",
        previous_space_code: invalid.space_code || targetSpace.space_code || invalid.previous_space_code || "",
        previous_space_id: invalid.space_id || invalid.previous_space_id || "",
        assignment_status: "Invalid",
        updated_at: nowIso(),
      });
    }
  }
  if (body.lab && (body.lab.lab_code || body.lab.id)) {
    applyPlaceBasketItem(dataset, plan, { ...body, targetSpace });
    return;
  }
  const door = text(targetSpace.front_door || targetSpace.rear_door || targetSpace.space_code);
  applyCreateUnplacedUnit(dataset, plan, {
    form: {
      labName: text(body.form?.labName) || `未规划实验室${door}`,
      college: text(body.form?.college || body.college),
      labType: "实验室",
    },
  }, copyId);
  const labCode = dataset.labs[dataset.labs.length - 1].lab_code;
  applyPlaceBasketItem(dataset, plan, { lab: { lab_code: labCode }, targetSpace });
}

function applyAssignmentAction(dataset, plan, body, copyId) {
  if (body.action === "moveToBasket") applyMoveToBasket(dataset, plan, body);
  else if (body.action === "returnFromBasket") applyReturnFromBasket(dataset, plan, body);
  else if (body.action === "placeBasketItem") applyPlaceBasketItem(dataset, plan, body);
  else if (body.action === "directMove") applyDirectMove(dataset, plan, body);
  else if (body.action === "createUnplacedUnit") applyCreateUnplacedUnit(dataset, plan, body, copyId);
  else if (body.action === "planSpace") applyPlanSpace(dataset, plan, body, copyId);
  else throw httpError(400, "unknown_assignment_action", "未知分配操作");
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

function createAssignmentActionService(db, datasetService) {
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

  function submitCopyAssignmentAction(copyId, body, user) {
    const row = ownedCopy(copyId, user);
    if (Number(body.expectedRevision) !== row.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前方案已被更新，请刷新后重试"), {
        payload: { copy: makePublicCopy(row) },
      });
    }
    const now = nowIso();
    const nextRevision = row.revision + 1;
    const dataset = datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user));
    const plan = activePlanFrom(dataset, row.plan_code);
    applyAssignmentAction(dataset, plan, { ...body, planCode: row.plan_code }, copyId);
    const normalized = normalizeAssignmentRows(datasetService, dataset);
    const assignments = (normalized.plan_assignments || []).filter((assignment) => planMatches(assignment, row.plan_code));
    const snapshot = datasetService.normalizeIncomingDataset(copySnapshot(normalized, row.plan_code, copyId));
    db.exec("BEGIN");
    try {
      for (const lab of snapshot.labs) upsertLabOverride(db, row.plan_code, lab, now);
      replaceAssignments(db, row.plan_code, assignments, now);
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

  function submitActiveAssignmentAction(body, user) {
    if (!user || user.role !== "admin") throw httpError(403, "forbidden", "只有管理员可以修改共享基线数据");
    const active = datasetService.getActiveDataset();
    if (Number(body.expectedRevision) !== active.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前数据已被其他人更新，请刷新后重试"), {
        payload: { revision: active.revision, dataset: active.dataset },
      });
    }
    const dataset = datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user, { activeOnly: true, fallbackDataset: active.dataset }));
    const plan = activePlanFrom(dataset, body.planCode);
    applyAssignmentAction(dataset, plan, body, 0);
    const normalized = datasetService.normalizeIncomingDataset(dataset);
    const result = datasetService.saveActiveDataset(normalized, user.username, { expectedRevision: body.expectedRevision });
    return {
      ok: true,
      revision: result.revision,
      dataset: datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user, { fallbackDataset: result.dataset })),
    };
  }

  return {
    submitCopyAssignmentAction,
    submitActiveAssignmentAction,
  };
}

module.exports = {
  createAssignmentActionService,
};
