const fs = require("fs");
const path = require("path");
const { nowIso, toBoolean, httpError } = require("./http-utils");

const repairFieldMap = {
  buildings: ["building_name", "campus_zone", "notes"],
  floor_segments: ["notes"],
  spaces: ["network_segment", "notes"],
  labs: ["lab_name", "college", "major", "lab_type", "director", "notes"],
  plans: ["plan_name", "description"],
  plan_assignments: ["move_note"],
};

function createDatasetService(db, config, audit) {
  function getActiveDataset() {
    const row = db.prepare("SELECT revision, dataset_json, updated_by, updated_at FROM active_dataset WHERE id = 1").get();
    return {
      revision: row.revision,
      dataset: JSON.parse(row.dataset_json),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }

  function saveActiveDataset(dataset, actor, options = {}) {
    const active = getActiveDataset();
    if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== active.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前数据已被其他人更新，请刷新后重试"), {
        payload: { revision: active.revision, dataset: active.dataset },
      });
    }
    const revision = active.revision + 1;
    const updatedAt = nowIso();
    db.prepare("UPDATE active_dataset SET revision = ?, dataset_json = ?, updated_by = ?, updated_at = ? WHERE id = 1")
      .run(revision, JSON.stringify(dataset), actor, updatedAt);
    return { revision, updatedAt, dataset, maintenance: buildMaintenance(dataset) };
  }

  function seedDataset(snapshotService) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM active_dataset").get();
    if (row.count > 0) return;
    const seed = normalizeIncomingDataset(loadSeedDataset());
    const validation = validateDataset(seed);
    if (!validation.ok) {
      throw new Error(`Seed dataset invalid: ${validation.errors.join("; ")}`);
    }
    db.prepare("INSERT INTO active_dataset (id, revision, dataset_json, updated_by, updated_at) VALUES (1, 1, ?, 'system', ?)")
      .run(JSON.stringify(seed), nowIso());
    snapshotService.createSnapshot("baseline", "初始基线快照", seed, 1, "system", 1);
    audit.writeAudit("dataset_seeded", "system", "127.0.0.1", { summary: summarizeDataset(seed) });
  }

  function loadSeedDataset() {
    const candidates = [
      path.join(config.root, "floor-room-baseline-upload-package.json"),
      path.join(config.root, "baseline-upload-package.json"),
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
    for (const key of config.datasetKeys) {
      data[key] = Array.isArray(raw?.[key]) ? JSON.parse(JSON.stringify(raw[key])) : [];
    }
    return data;
  }

  function firstText(row, fields) {
    for (const field of fields) {
      const value = row?.[field];
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  }

  function normalizeAssignmentStatus(value, hasSpace = false) {
    const raw = String(value || "").trim().toLowerCase();
    if (["assigned", "pending_move", "已分配", "已落位", "待搬迁"].includes(raw)) return "assigned";
    if (["invalid", "unplaced", "无效", "未落位", "未分配"].includes(raw)) return "Invalid";
    return hasSpace ? "assigned" : "Invalid";
  }

  function normalizeSpaceStatus(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["unavailable", "不可用", "disabled", "inactive"].includes(raw)) return "unavailable";
    return "active";
  }

  /**
   * 服务端会再次规范化前端传入的数据，保证导入、编辑和恢复快照都落到同一套 id/引用规则。
   */
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
      const spaceCode = firstText(row, ["space_code", "space_id", "id"]);
      return {
        ...row,
        id: row.id || `${row.building_code}__${row.floor_code}__${spaceCode}`,
        building_code: String(row.building_code || "").trim(),
        floor_code: String(row.floor_code || "").trim(),
        segment_code: String(row.segment_code || "").trim(),
        space_code: spaceCode,
        front_door: String(row.front_door || spaceCode || "").trim(),
        rear_door: String(row.rear_door || "").trim(),
        length_m: Number.isFinite(length) ? length : 0,
        width_m: Number.isFinite(width) ? width : 0,
        area_m2: Number(row.area_m2 || length * width || 0),
        current_status: normalizeSpaceStatus(row.current_status),
      };
    }));
    const labs = dedupeById(data.labs.map((row) => ({
      ...row,
      id: row.id || row.lab_code || row.lab_id,
      lab_code: firstText(row, ["lab_code", "lab_id", "id"]),
      lab_name: String(row.lab_name || row.lab_code || row.lab_id || row.id || "").trim(),
    })));
    const plans = dedupeById(data.plans.map((row) => ({
      ...row,
      id: row.id || row.plan_code || row.plan_id,
      plan_code: firstText(row, ["plan_code", "plan_id", "id"]),
      plan_name: String(row.plan_name || row.plan_code || row.plan_id || row.id || "").trim(),
      is_locked: toBoolean(row.is_locked),
      is_default_compare_before: toBoolean(row.is_default_compare_before),
      is_default_compare_after: toBoolean(row.is_default_compare_after),
    })));
    const plansByCode = new Map(plans.map((row) => [row.plan_code, row]));
    const labsByCode = new Map(labs.map((row) => [row.lab_code, row]));
    const spacesByCode = new Map(spaces.map((row) => [row.space_code, row]));
    const assignments = dedupeById(data.plan_assignments.map((row) => {
      const planCode = firstText(row, ["plan_code", "plan_id"]);
      const labCode = firstText(row, ["lab_code", "lab_id"]);
      const spaceCode = firstText(row, ["space_code", "space_id"]);
      const previousSpaceCode = firstText(row, ["previous_space_code", "previous_space_id"]);
      const plan = plansByCode.get(planCode);
      const lab = labsByCode.get(labCode);
      const space = spacesByCode.get(spaceCode);
      const previousSpace = spacesByCode.get(previousSpaceCode);
      return {
        ...row,
        id: row.id || `${planCode}__${labCode}`,
        plan_code: planCode,
        lab_code: labCode,
        space_code: spaceCode,
        previous_space_code: previousSpaceCode,
        plan_id: row.plan_id || plan?.id || "",
        lab_id: row.lab_id || lab?.id || "",
        space_id: row.space_id || space?.id || "",
        previous_space_id: row.previous_space_id || previousSpace?.id || "",
        assignment_status: normalizeAssignmentStatus(row.assignment_status, Boolean(space)),
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
    // 启发式防护：只有异常字段足够多且比例足够高时才判定为编码损坏。
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
    for (const key of config.datasetKeys.slice(0, 6)) {
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

  function buildMaintenance(dataset) {
    const corruption = detectTextCorruption(dataset);
    const source = corruption.detected ? findTextRepairSource(dataset) : null;
    return {
      textCorruptionDetected: corruption.detected,
      textRepairAvailable: Boolean(source),
      textRepairSourceLabel: source?.label || "",
    };
  }

  return {
    getActiveDataset,
    saveActiveDataset,
    seedDataset,
    normalizeIncomingDataset,
    validateDataset,
    detectTextCorruption,
    findTextRepairSource,
    repairDatasetText,
    summarizeDataset,
    buildImportSummary,
    buildMaintenance,
  };
}

module.exports = { createDatasetService };
