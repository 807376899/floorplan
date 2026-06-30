const fs = require("fs");
const path = require("path");
const { nowIso, toBoolean, httpError } = require("./http-utils");
const RelationalStore = require("./relational-store");

const COLLEGE_COLORS = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f",
  "#b45309", "#0f766e", "#4338ca", "#c026d3", "#16a34a", "#ea580c", "#0284c7", "#e11d48",
  "#65a30d", "#9333ea", "#ca8a04", "#0d9488", "#1d4ed8", "#be185d", "#15803d", "#7c2d12",
];

const repairFieldMap = {
  buildings: ["building_name", "campus_zone", "notes"],
  floor_segments: ["notes"],
  spaces: ["network_segment", "notes"],
  labs: ["lab_name", "college", "major", "lab_type", "director", "notes"],
  colleges: ["college_name", "color", "notes"],
  majors: ["major_name", "notes"],
  lab_types: ["type_name", "notes"],
  plans: ["plan_name", "description"],
  plan_assignments: ["move_note"],
};

function compare(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), "zh-CN", { numeric: true });
}

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
    RelationalStore.syncFromVisibleDataset(db, normalizeIncomingDataset(dataset), []);
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
    RelationalStore.syncFromVisibleDataset(db, seed, []);
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

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function padNumber(value, width) {
    return String(Math.max(0, Math.trunc(numberValue(value, 0)))).padStart(width, "0").slice(-width);
  }

  function isAsciiCode(value) {
    return /^[A-Z][A-Z0-9_-]*$/i.test(String(value || "").trim()) && !containsCjk(value);
  }

  function campusCodeFromName(campusName) {
    const raw = String(campusName || "").trim();
    if (raw.includes("下沙")) return "01";
    if (raw.includes("绍兴")) return "02";
    return "00";
  }

  function campusCodeForBuilding(building) {
    const mapped = campusCodeFromName(building?.campus_zone);
    if (mapped !== "00") return mapped;
    const match = String(building?.building_code || "").trim().match(/^B(\d{2})\d{2}$/i);
    return match?.[1] || mapped;
  }

  function buildingNumberCode(building) {
    if (Number(building?.building_number) > 0) return padNumber(building.building_number, 2);
    const match = String(building?.building_code || "").trim().match(/^B(?:\d{2})?(\d{2})$/i);
    return match?.[1] || "00";
  }

  function generateBuildingCode(building) {
    return `B${campusCodeForBuilding(building)}${buildingNumberCode(building)}`;
  }

  function generateSequentialCode(rows, field, prefix, width) {
    const max = (rows || []).reduce((highest, row) => {
      const match = String(row?.[field] || "").trim().match(new RegExp(`^${prefix}(\\d+)$`, "i"));
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return `${prefix}${String(max + 1).padStart(width, "0")}`;
  }

  function normalizeElementType(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["stairs", "stair", "楼梯"].includes(raw)) return "stairs";
    if (["elevator", "lift", "ev", "电梯"].includes(raw)) return "elevator";
    if (["other", "ot", "其他"].includes(raw)) return "other";
    return "corridor";
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function activeStatus(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["inactive", "disabled", "停用", "禁用", "0", "false"].includes(raw)) return "inactive";
    return "active";
  }

  function normalizeDictionaryCode(value, fallbackPrefix) {
    const raw = String(value || "").trim();
    return raw || `${fallbackPrefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  function normalizeColor(value) {
    const raw = String(value || "").trim();
    const short = raw.match(/^#?([0-9a-f]{3})$/i);
    if (short) return `#${short[1].split("").map((char) => char + char).join("").toLowerCase()}`;
    const full = raw.match(/^#?([0-9a-f]{6})$/i);
    return full ? `#${full[1].toLowerCase()}` : "";
  }

  function stableColorIndex(seed, offset = 0) {
    const text = String(seed || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return (hash + offset) % COLLEGE_COLORS.length;
  }

  function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = l - c / 2;
    const [r, g, b] = hue < 60 ? [c, x, 0]
      : hue < 120 ? [x, c, 0]
        : hue < 180 ? [0, c, x]
          : hue < 240 ? [0, x, c]
            : hue < 300 ? [x, 0, c]
              : [c, 0, x];
    const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function nextCollegeColor(index = 0, seed = "", usedColors = new Set()) {
    const used = new Set([...usedColors].map(normalizeColor).filter(Boolean));
    for (let offset = 0; offset < COLLEGE_COLORS.length; offset += 1) {
      const color = COLLEGE_COLORS[(index + stableColorIndex(seed, offset)) % COLLEGE_COLORS.length];
      if (!used.has(color)) return color;
    }
    const hue = (stableColorIndex(seed, index) * 47 + index * 29) % 360;
    for (let offset = 0; offset < 360; offset += 23) {
      const color = hslToHex((hue + offset) % 360, 58, 42);
      if (!used.has(color)) return color;
    }
    return COLLEGE_COLORS[index % COLLEGE_COLORS.length];
  }

  function assignCollegeColors(colleges) {
    const groups = new Map();
    colleges.forEach((college) => {
      const key = collegeSemanticKey(college);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(college);
    });
    const used = new Set();
    const canonical = new Map();
    [...groups.keys()].sort(compare).forEach((key, index) => {
      const preferred = preferredCollegeColor(groups.get(key));
      const color = preferred && !used.has(preferred)
        ? preferred
        : nextCollegeColor(index, key, used);
      used.add(color);
      canonical.set(key, color);
    });
    return colleges.map((college) => ({
      ...college,
      color: canonical.get(collegeSemanticKey(college)) || nextCollegeColor(0, college.college_name || college.college_code, used),
    }));
  }

  function collegeSemanticKey(college) {
    return String(college?.college_code || college?.college_name || college?.id || "").trim();
  }

  function preferredCollegeColor(rows = []) {
    return rows
      .slice()
      .sort((a, b) => {
        const aScoped = a.copy_id || a.copyId ? 1 : 0;
        const bScoped = b.copy_id || b.copyId ? 1 : 0;
        return aScoped - bScoped ||
          Number(a.copy_id || a.copyId || 0) - Number(b.copy_id || b.copyId || 0) ||
          Number(a.sort_order || 0) - Number(b.sort_order || 0) ||
          compare(a.college_name || a.college_code || "", b.college_name || b.college_code || "") ||
          compare(a.color || a.color_hex || "", b.color || b.color_hex || "");
      })
      .map((row) => normalizeColor(row.color || row.color_hex))
      .find(Boolean) || "";
  }

  function normalizeCollegeRow(row) {
    const name = String(row.college_name || row.college || row.college_code || "").trim();
    const code = normalizeDictionaryCode(row.college_code || name, "COLLEGE");
    return {
      ...row,
      id: row.id || code,
      college_code: code,
      college_name: name || code,
      color: normalizeColor(row.color || row.color_hex),
      sort_order: Number(row.sort_order || 0),
      status: activeStatus(row.status),
      notes: String(row.notes || ""),
    };
  }

  function normalizeMajorRow(row) {
    const name = String(row.major_name || row.major || row.major_code || "").trim();
    const collegeCode = String(row.college_code || "").trim();
    const code = normalizeDictionaryCode(row.major_code || (collegeCode && name ? `${collegeCode}-${name}` : name), "MAJOR");
    return {
      ...row,
      id: row.id || code,
      major_code: code,
      major_name: name || code,
      college_code: collegeCode,
      sort_order: Number(row.sort_order || 0),
      status: activeStatus(row.status),
      notes: String(row.notes || ""),
    };
  }

  function normalizeLabTypeRow(row) {
    const name = String(row.type_name || row.lab_type || row.type_code || "").trim();
    const rawCode = String(row.type_code || "").trim();
    const code = isAsciiCode(rawCode) ? rawCode.toUpperCase() : "";
    return {
      ...row,
      id: row.id || code || normalizeDictionaryCode(name, "TYPE"),
      type_code: code,
      type_name: name || code,
      sort_order: Number(row.sort_order || 0),
      status: activeStatus(row.status),
      notes: String(row.notes || ""),
    };
  }

  function canonicalUseTypeSeed(name) {
    const trimmed = String(name || "").trim();
    if (trimmed === "实验室") return { type_code: "USE0001", sort_order: 1 };
    if (trimmed === "教室") return { type_code: "USE0002", sort_order: 2 };
    return null;
  }

  function canonicalizeLabTypes(rows, labs = []) {
    const normalized = (rows || []).map(normalizeLabTypeRow).filter((row) => row.type_name);
    for (const name of unique((labs || []).map((row) => String(row.lab_type || "").trim())).filter(Boolean)) {
      if (!normalized.some((row) => row.type_name === name)) {
        normalized.push(normalizeLabTypeRow({ type_name: name, sort_order: normalized.length + 1, status: "active" }));
      }
    }
    for (const name of ["实验室", "教室"]) {
      if (!normalized.some((row) => row.type_name === name)) {
        normalized.push(normalizeLabTypeRow({ type_name: name, sort_order: normalized.length + 1, status: "active" }));
      }
    }

    const byName = new Map();
    for (const row of normalized) {
      const seed = canonicalUseTypeSeed(row.type_name);
      const existing = byName.get(row.type_name);
      if (!existing) {
        byName.set(row.type_name, {
          ...row,
          id: row.id || row.type_code || normalizeDictionaryCode(row.type_name, "TYPE"),
          type_code: seed?.type_code || row.type_code,
          sort_order: seed?.sort_order || row.sort_order || 0,
          status: seed ? "active" : row.status,
        });
        continue;
      }
      const nextSeed = seed || canonicalUseTypeSeed(existing.type_name);
      byName.set(row.type_name, {
        ...existing,
        id: existing.id || row.id,
        type_code: nextSeed?.type_code || existing.type_code || row.type_code,
        sort_order: nextSeed?.sort_order || Math.min(existing.sort_order || row.sort_order || 0, row.sort_order || existing.sort_order || 0),
        status: existing.status === "active" || row.status === "active" ? "active" : existing.status,
        notes: existing.notes || row.notes || "",
      });
    }

    const reserved = new Set(["USE0001", "USE0002"]);
    const used = new Set();
    let nextIndex = 3;
    const sorted = [...byName.values()].sort((a, b) => {
      const seedA = canonicalUseTypeSeed(a.type_name);
      const seedB = canonicalUseTypeSeed(b.type_name);
      return (seedA?.sort_order || a.sort_order || 999) - (seedB?.sort_order || b.sort_order || 999)
        || String(a.type_name).localeCompare(String(b.type_name), "zh-Hans-CN");
    });
    return sorted.map((row) => {
      const seed = canonicalUseTypeSeed(row.type_name);
      let code = seed?.type_code || (isAsciiCode(row.type_code) && !reserved.has(row.type_code) ? row.type_code : "");
      if (!code || used.has(code)) {
        do {
          code = `USE${String(nextIndex).padStart(4, "0")}`;
          nextIndex += 1;
        } while (used.has(code) || reserved.has(code));
      }
      used.add(code);
      return {
        ...row,
        id: seed?.type_code || row.id || code,
        type_code: code,
        sort_order: seed?.sort_order || row.sort_order || used.size,
        status: row.status || "active",
      };
    });
  }

  function deriveDictionaries(labs, data) {
    const colleges = data.colleges.length ? data.colleges.map(normalizeCollegeRow) : unique(labs.map((row) => row.college))
      .map((name, index) => normalizeCollegeRow({ college_code: name, college_name: name, sort_order: index + 1 }));
    const collegeByName = new Map(colleges.map((row) => [row.college_name, row]));
    const majors = data.majors.length ? data.majors.map(normalizeMajorRow) : unique(labs.map((row) => `${row.college || ""}:::${row.major || ""}`))
      .map((key, index) => {
        const [collegeName, majorName] = key.split(":::");
        if (!majorName) return null;
        const college = collegeByName.get(collegeName);
        return normalizeMajorRow({
          major_code: `${college?.college_code || collegeName}-${majorName}`,
          major_name: majorName,
          college_code: college?.college_code || collegeName,
          sort_order: index + 1,
        });
      })
      .filter(Boolean);
    const labTypesRaw = data.lab_types.length ? data.lab_types.map(normalizeLabTypeRow) : unique(labs.map((row) => row.lab_type))
      .map((name, index) => normalizeLabTypeRow({ type_code: name, type_name: name, sort_order: index + 1 }));
    return {
      colleges: assignCollegeColors(dedupeById(colleges)),
      majors: dedupeById(majors),
      lab_types: canonicalizeLabTypes(labTypesRaw, labs),
    };
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
      sort_order: Number(row.sort_order || 0),
    })));
    const floorSegments = dedupeById(data.floor_segments.map((row) => ({
      ...row,
      id: row.id || `${row.building_code}__${row.floor_code}__${row.segment_code}`,
      building_code: String(row.building_code || "").trim(),
      floor_code: String(row.floor_code || "").trim(),
      segment_code: String(row.segment_code || "").trim(),
      element_type: normalizeElementType(row.element_type),
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
    const dictionary = deriveDictionaries(labs, data);
    const plansRaw = dedupeById(data.plans.map((row) => ({
      ...row,
      id: row.id || row.plan_code || row.plan_id,
      plan_code: firstText(row, ["plan_code", "plan_id", "id"]),
      plan_name: String(row.plan_name || row.plan_code || row.plan_id || row.id || "").trim(),
      is_locked: toBoolean(row.is_locked),
      is_default_compare_before: toBoolean(row.is_default_compare_before),
      is_default_compare_after: toBoolean(row.is_default_compare_after),
    })));
    const plans = fillSequentialCodes(plansRaw, "plan_code", "PLAN", 6);
    const planAlias = new Map(plansRaw.map((plan, index) => [plan.plan_code, plans[index]?.plan_code || plan.plan_code]));
    const plansWithSources = plans.map((plan) => ({ ...plan, source_plan_code: planAlias.get(plan.source_plan_code) || plan.source_plan_code || "" }));
    const plansByCode = new Map(plansWithSources.map((row) => [row.plan_code, row]));
    const labsByCode = new Map(labs.map((row) => [row.lab_code, row]));
    const spacesByCode = new Map(spaces.map((row) => [row.space_code, row]));
    const assignments = dedupeById(data.plan_assignments.map((row) => {
      const rawPlanCode = firstText(row, ["plan_code", "plan_id"]);
      const planCode = planAlias.get(rawPlanCode) || rawPlanCode;
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
      colleges: dictionary.colleges,
      majors: dictionary.majors,
      lab_types: dictionary.lab_types,
      plans: plansWithSources,
      plan_assignments: assignments,
      deleted_space_ids: data.deleted_space_ids || [],
    };
  }

  function dedupeById(rows) {
    return [...new Map(rows.filter((row) => row.id).map((row) => {
      const copyId = String(row.copy_id || row.copyId || "").trim();
      return [`${copyId}::${row.id}`, row];
    })).values()];
  }

  function fillSequentialCodes(rows, field, prefix, width, options = {}) {
    const used = new Set();
    return (rows || []).map((row) => {
      let code = String(row[field] || "").trim();
      if (!isAsciiCode(code) || (options.forcePrefix && !code.toUpperCase().startsWith(prefix)) || containsCjk(code) || used.has(code)) {
        code = generateSequentialCode([...rows.filter((item) => used.has(String(item[field] || "").trim())), ...[...used].map((value) => ({ [field]: value }))], field, prefix, width);
        while (used.has(code)) code = generateSequentialCode([...used].map((value) => ({ [field]: value })), field, prefix, width);
      }
      used.add(code);
      return { ...row, [field]: code, id: row.id || code };
    });
  }

  function normalizeNumberingDataset(raw) {
    const data = normalizeIncomingDataset(raw);
    const buildingAlias = new Map();
    const buildingsByCode = new Map();
    const buildings = [];
    for (const building of data.buildings || []) {
      const oldCode = String(building.building_code || "").trim();
      const nextCode = generateBuildingCode(building);
      buildingAlias.set(oldCode, nextCode);
      const next = { ...building, id: building.id || oldCode || nextCode, building_code: nextCode };
      const existing = buildingsByCode.get(nextCode);
      if (existing) {
        Object.assign(existing, {
          building_name: existing.building_name || next.building_name,
          campus_zone: existing.campus_zone === "未分区" ? next.campus_zone : existing.campus_zone,
          building_number: existing.building_number || next.building_number,
          notes: existing.notes || next.notes,
        });
      } else {
        buildingsByCode.set(nextCode, next);
        buildings.push(next);
      }
    }
    const translateBuildingCode = (code) => buildingAlias.get(String(code || "").trim()) || String(code || "").trim();
    const spacesById = new Map();
    const spaces = (data.spaces || []).map((space) => {
      const next = { ...space, building_code: translateBuildingCode(space.building_code) };
      spacesById.set(next.id, next);
      return next;
    });
    const floorSegments = (data.floor_segments || []).map((segment) => ({ ...segment, building_code: translateBuildingCode(segment.building_code) }));
    const planCompaction = compactPlansForNumbering(data.plans || []);
    const plans = fillSequentialCodes(planCompaction.plans, "plan_code", "PLAN", 6, { forcePrefix: true });
    const planAlias = new Map(planCompaction.alias);
    planCompaction.plans.forEach((plan, index) => {
      const nextCode = plans[index]?.plan_code || plan.plan_code;
      for (const key of [plan.plan_code, plan.plan_id, plan.id]) {
        if (key) planAlias.set(String(key).trim(), nextCode);
      }
    });
    for (const [oldCode, canonicalCode] of [...planAlias.entries()]) {
      const finalCode = planAlias.get(canonicalCode);
      if (finalCode) planAlias.set(oldCode, finalCode);
    }
    const labTypes = canonicalizeLabTypes(data.lab_types || [], data.labs || []);
    const translated = {
      ...data,
      buildings,
      floor_segments: floorSegments,
      spaces,
      lab_types: labTypes,
      plans: plans.map((plan) => ({ ...plan, source_plan_code: planAlias.get(plan.source_plan_code) || plan.source_plan_code || "" })),
    };
    const relation = {
      plansByCode: new Map(translated.plans.map((plan) => [plan.plan_code, plan])),
      labsByCode: new Map((translated.labs || []).map((lab) => [lab.lab_code, lab])),
      spacesByCode: new Map(translated.spaces.map((space) => [space.space_code, space])),
    };
    translated.plan_assignments = (data.plan_assignments || []).map((assignment) => normalizeAssignmentLike({
      ...assignment,
      plan_code: planAlias.get(assignment.plan_code) || assignment.plan_code,
    }, relation));
    return normalizeIncomingDataset(translated);
  }

  function compactPlansForNumbering(plans) {
    const kept = [];
    const bySemantic = new Map();
    const alias = new Map();
    for (const plan of plans || []) {
      const semantic = [
        String(plan.source_plan_code || "").trim(),
        String(plan.plan_type || "").trim(),
        String(plan.plan_name || "").trim(),
      ].join("__");
      const existing = bySemantic.get(semantic);
      if (semantic.replace(/_/g, "") && existing) {
        for (const key of [plan.plan_code, plan.plan_id, plan.id]) {
          if (key) alias.set(String(key).trim(), existing.plan_code);
        }
        continue;
      }
      bySemantic.set(semantic, plan);
      kept.push(plan);
    }
    return { plans: kept, alias };
  }

  function writeRepairBackup(label, payload) {
    fs.mkdirSync(config.backupsDir, { recursive: true });
    const safeLabel = String(label || "repair").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "repair";
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeLabel}.json`;
    const filePath = path.join(config.backupsDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
  }

  function normalizeAssignmentLike(row, relation) {
    const plan = relation.plansByCode.get(row.plan_code);
    const lab = relation.labsByCode.get(row.lab_code);
    const space = relation.spacesByCode.get(row.space_code);
    const previousSpace = relation.spacesByCode.get(row.previous_space_code);
    return {
      ...row,
      id: `${row.plan_code}__${row.lab_code}`,
      plan_id: plan?.id || row.plan_id || "",
      lab_id: lab?.id || row.lab_id || "",
      space_id: space?.id || "",
      previous_space_id: previousSpace?.id || "",
      assignment_status: normalizeAssignmentStatus(row.assignment_status, Boolean(space)),
    };
  }

  function emptyDataset() {
    return {
      buildings: [],
      floor_segments: [],
      spaces: [],
      labs: [],
      colleges: [],
      majors: [],
      lab_types: [],
      plans: [],
      plan_assignments: [],
      file_assets: [],
      imports: [],
      deleted_space_ids: [],
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

  function mergeTextSafeDataset(baseDataset, incomingDataset) {
    const merged = JSON.parse(JSON.stringify(incomingDataset));
    for (const [key, fields] of Object.entries(repairFieldMap)) {
      const baseById = new Map((baseDataset[key] || []).map((row) => [row.id, row]));
      merged[key] = (merged[key] || []).map((row) => {
        const base = baseById.get(row.id);
        if (!base) return row;
        const next = { ...row };
        for (const field of fields) {
          if (isQuestionCorrupted(next[field]) && !isQuestionCorrupted(base[field])) {
            next[field] = base[field];
          }
        }
        return next;
      });
    }
    return merged;
  }

  function validateDataset(dataset) {
    const errors = [];
    for (const key of ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments"]) {
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
    normalizeNumberingDataset,
    writeRepairBackup,
    validateDataset,
    detectTextCorruption,
    findTextRepairSource,
    repairDatasetText,
    mergeTextSafeDataset,
    summarizeDataset,
    buildImportSummary,
    buildMaintenance,
  };
}

module.exports = { createDatasetService };
