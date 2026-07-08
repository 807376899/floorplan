(function attachFloorplanDomain(global) {
  // 领域模块只处理数据结构、规范化、模板和示例数据，不直接读写 DOM 或请求服务端。
  const STORAGE_KEY = "floorplan-migration-dataset-v2";
  const ALL_COLLEGES = "全部学院";
  const ROOM_GAP_M = 0.7;
  const DETAIL_SCALE = 28;
  const THUMB_SCALE = 6;
  const COLORS = [
    "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f",
    "#b45309", "#0f766e", "#4338ca", "#c026d3", "#16a34a", "#ea580c", "#0284c7", "#e11d48",
    "#65a30d", "#9333ea", "#ca8a04", "#0d9488", "#1d4ed8", "#be185d", "#15803d", "#7c2d12",
  ];
  const NUMBERING_RULES = {
    fallbackCampusCode: "00",
    buildingPrefix: "B",
    spacePrefix: "0",
    unitPrefix: "UNIT",
    planPrefix: "PLAN",
    useTypePrefix: "USE",
    segmentPrefixes: {
      eastWest: "EW",
      northSouth: "NS",
      stairs: "ST",
      elevator: "EV",
      other: "OT",
    },
  };

  const DATASETS = [
    {
      key: "campuses",
      label: "校区",
      sheet: "campuses",
      columns: [
        ["campus_code", "校区编码"],
        ["campus_name", "校区名称"],
        ["sort_order", "排序"],
        ["status", "状态"],
        ["notes", "备注"],
      ],
    },
    {
      key: "buildings",
      label: "教学楼",
      sheet: "buildings",
      columns: [
        ["building_code", "教学楼编码"],
        ["building_name", "教学楼名称"],
        ["campus_code", "所属校区"],
        ["building_number", "楼号"],
        ["sort_order", "排列顺序"],
        ["notes", "备注"],
      ],
    },
    {
      key: "floor_segments",
      label: "楼层骨架",
      sheet: "floor_segments",
      columns: [
        ["building_code", "教学楼编码"],
        ["floor_code", "楼层编码"],
        ["segment_code", "走廊段编码"],
        ["segment_name", "名称"],
        ["start_x_m", "起点X"],
        ["start_y_m", "起点Y"],
        ["end_x_m", "终点X"],
        ["end_y_m", "终点Y"],
        ["width_m", "宽度"],
        ["element_type", "元素类型"],
        ["notes", "备注"],
      ],
    },
    {
      key: "spaces",
      label: "物理空间",
      sheet: "spaces",
      columns: [
        ["space_code", "空间编码"],
        ["building_code", "教学楼编码"],
        ["floor_code", "楼层编码"],
        ["segment_code", "走廊段编码"],
        ["offset_m", "沿段偏移"],
        ["side", "所在侧"],
        ["front_door", "前门牌"],
        ["rear_door", "后门牌"],
        ["length_m", "长度"],
        ["width_m", "宽度"],
        ["network_segment", "网段信息"],
        ["current_status", "空间状态"],
      ],
    },
    {
      key: "labs",
      label: "用途单元",
      sheet: "labs",
      columns: [
        ["lab_code", "用途编码"],
        ["lab_name", "用途名称"],
        ["college", "所属学院"],
        ["major", "所属专业"],
        ["lab_type", "用途类型"],
        ["director", "负责人"],
        ["seat_count", "座位数"],
        ["computer_count", "电脑数"],
        ["status", "状态"],
        ["notes", "备注"],
      ],
    },
    {
      key: "colleges",
      label: "学院",
      sheet: "colleges",
      columns: [
        ["college_code", "学院编码"],
        ["college_name", "学院名称"],
        ["sort_order", "排序"],
        ["status", "状态"],
        ["notes", "备注"],
      ],
    },
    {
      key: "majors",
      label: "专业",
      sheet: "majors",
      columns: [
        ["major_code", "专业编码"],
        ["major_name", "专业名称"],
        ["college_code", "所属学院编码"],
        ["sort_order", "排序"],
        ["status", "状态"],
        ["notes", "备注"],
      ],
    },
    {
      key: "lab_types",
      label: "用途类型",
      sheet: "lab_types",
      columns: [
        ["type_code", "类型编码"],
        ["type_name", "类型名称"],
        ["sort_order", "排序"],
        ["status", "状态"],
        ["notes", "备注"],
      ],
    },
    {
      key: "plans",
      label: "方案",
      sheet: "plans",
      columns: [
        ["plan_code", "方案编码"],
        ["plan_name", "方案名称"],
        ["plan_type", "方案类型"],
        ["source_plan_code", "来源方案"],
        ["description", "方案描述"],
        ["is_locked", "是否锁定"],
        ["is_default_compare_before", "默认搬迁前"],
        ["is_default_compare_after", "默认搬迁后"],
      ],
    },
    {
      key: "plan_assignments",
      label: "方案分配",
      sheet: "plan_assignments",
      columns: [
        ["plan_code", "方案编码"],
        ["lab_code", "实验室编码"],
        ["space_code", "当前空间编码"],
        ["previous_space_code", "搬迁前空间编码"],
        ["assignment_status", "分配状态"],
        ["move_note", "搬迁说明"],
        ["effective_from", "生效时间"],
      ],
    },
  ];

  const collegeDataset = DATASETS.find((item) => item.key === "colleges");
  if (collegeDataset && !collegeDataset.columns.some(([key]) => key === "color")) {
    collegeDataset.columns.splice(2, 0, ["color", "颜色"]);
  }

  const KEY_ALIASES = {
    buildings: {
      building_code: ["building_code", "教学楼编码"],
      building_name: ["building_name", "教学楼名称"],
      campus_code: ["campus_code", "校区编码", "所属校区编码"],
      campus_zone: ["campus_zone", "所属校区"],
      building_number: ["building_number", "教学楼编号", "楼号"],
      sort_order: ["sort_order", "排列顺序", "排序"],
      notes: ["notes", "备注"],
    },
    campuses: {
      campus_code: ["campus_code", "校区编码"],
      campus_name: ["campus_name", "校区名称", "所属校区"],
      sort_order: ["sort_order", "排序", "排列顺序"],
      status: ["status", "状态"],
      notes: ["notes", "备注"],
    },
    floor_segments: {
      building_code: ["building_code", "教学楼编码"],
      floor_code: ["floor_code", "楼层编码"],
      segment_code: ["segment_code", "走廊段编码"],
      segment_name: ["segment_name", "名称", "走廊名称", "骨架名称"],
      start_x_m: ["start_x_m", "起点X"],
      start_y_m: ["start_y_m", "起点Y"],
      end_x_m: ["end_x_m", "终点X"],
      end_y_m: ["end_y_m", "终点Y"],
      width_m: ["width_m", "宽度", "走廊宽度"],
      element_type: ["element_type", "元素类型"],
      notes: ["notes", "备注"],
    },
    spaces: {
      space_code: ["space_code", "space_id", "id", "空间编码", "房间编码"],
      building_code: ["building_code", "教学楼编码"],
      floor_code: ["floor_code", "楼层编码"],
      segment_code: ["segment_code", "走廊段编码"],
      offset_m: ["offset_m", "沿段偏移", "沿走廊段偏移"],
      side: ["side", "所在侧", "段侧"],
      front_door: ["front_door", "前门牌", "前门门牌号"],
      rear_door: ["rear_door", "后门牌", "后门门牌号"],
      space_name: ["space_name", "空间名称"],
      length_m: ["length_m", "长度", "房间长度"],
      width_m: ["width_m", "宽度", "房间宽度"],
      area_m2: ["area_m2", "面积"],
      network_segment: ["network_segment", "网段信息"],
      current_status: ["current_status", "空间状态"],
      notes: ["notes", "备注"],
    },
    labs: {
      lab_code: ["lab_code", "lab_id", "id", "用途编码", "实验室编码"],
      lab_name: ["lab_name", "用途名称", "实验室名称"],
      college: ["college", "所属学院"],
      major: ["major", "所属专业"],
      lab_type: ["lab_type", "用途类型", "实验室类型"],
      director: ["director", "负责人", "实验室负责人"],
      seat_count: ["seat_count", "座位数"],
      computer_count: ["computer_count", "电脑数", "电脑数量"],
      status: ["status", "状态", "用途状态", "实验室状态"],
      notes: ["notes", "备注"],
    },
    colleges: {
      college_code: ["college_code", "学院编码"],
      college_name: ["college_name", "所属学院", "学院名称", "college"],
      sort_order: ["sort_order", "排序"],
      status: ["status", "状态"],
      notes: ["notes", "备注"],
    },
    majors: {
      major_code: ["major_code", "专业编码"],
      major_name: ["major_name", "所属专业", "专业名称", "major"],
      college_code: ["college_code", "所属学院编码"],
      sort_order: ["sort_order", "排序"],
      status: ["status", "状态"],
      notes: ["notes", "备注"],
    },
    lab_types: {
      type_code: ["type_code", "类型编码"],
      type_name: ["type_name", "用途类型", "实验室类型", "类型名称", "lab_type"],
      sort_order: ["sort_order", "排序"],
      status: ["status", "状态"],
      notes: ["notes", "备注"],
    },
    plans: {
      plan_code: ["plan_code", "plan_id", "id", "方案编码"],
      plan_name: ["plan_name", "方案名称"],
      plan_type: ["plan_type", "方案类型"],
      source_plan_code: ["source_plan_code", "来源方案"],
      description: ["description", "方案描述"],
      is_locked: ["is_locked", "是否锁定"],
      is_default_compare_before: ["is_default_compare_before", "默认搬迁前", "是否默认搬迁前"],
      is_default_compare_after: ["is_default_compare_after", "默认搬迁后", "是否默认搬迁后"],
    },
    plan_assignments: {
      plan_code: ["plan_code", "plan_id", "方案编码"],
      lab_code: ["lab_code", "lab_id", "用途编码", "实验室编码"],
      space_code: ["space_code", "space_id", "当前空间编码"],
      previous_space_code: ["previous_space_code", "搬迁前空间编码"],
      assignment_status: ["assignment_status", "分配状态"],
      move_note: ["move_note", "搬迁说明"],
      effective_from: ["effective_from", "生效时间"],
    },
  };

  function emptyDataset() {
    return {
      buildings: [],
      campuses: [],
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

  function isoNow() {
    return new Date().toISOString();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function compare(a, b) {
    return String(a).localeCompare(String(b), "zh-CN", { numeric: true });
  }

  function numberValue(value, fallback) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function booleanValue(value) {
    return ["true", "1", "yes", "是", "y"].includes(String(value ?? "").trim().toLowerCase());
  }

  function read(row, keys) {
    const key = keys.find((name) => row[name] !== undefined);
    return key ? String(row[key]).trim() : "";
  }

  function normalizeSide(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (["north", "北", "n"].includes(raw)) return "north";
    if (["south", "南", "s"].includes(raw)) return "south";
    if (["east", "东", "e", "右"].includes(raw)) return "east";
    if (["west", "西", "w", "左"].includes(raw)) return "west";
    return "south";
  }

  function normalizeElementType(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (["stairs", "stair", "楼梯"].includes(raw)) return "stairs";
    if (["elevator", "lift", "ev", "电梯"].includes(raw)) return "elevator";
    if (["other", "ot", "其他"].includes(raw)) return "other";
    return "corridor";
  }

  function normalizeAssignmentStatus(value, hasSpace = false) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (["assigned", "pending_move", "已分配", "已落位", "待搬迁"].includes(raw)) return "assigned";
    if (["invalid", "unplaced", "无效", "未落位", "未分配"].includes(raw)) return "Invalid";
    return hasSpace ? "assigned" : "Invalid";
  }

  function normalizeSpaceStatus(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (["unavailable", "不可用", "disabled", "inactive"].includes(raw)) return "unavailable";
    return "active";
  }

  function pad2(value) {
    return String(Math.max(0, Math.trunc(numberValue(value, 0)))).padStart(2, "0").slice(-2);
  }

  function campusCodeForBuilding(building) {
    const configured = String(building?.campus_code || building?.campusCode || "").trim();
    if (configured) return configured.padStart(2, "0").slice(-2);
    const codeMatch = String(building?.building_code || "").trim().match(/^B(\d{2})\d{2}$/i);
    return codeMatch?.[1] || NUMBERING_RULES.fallbackCampusCode;
  }

  function buildingNumberCode(building) {
    if (building && Number(building.building_number) > 0) return pad2(building.building_number);
    const codeMatch = String(building?.building_code || "").trim().match(/^B(?:\d{2})?(\d{2})$/i);
    return codeMatch?.[1] || pad2(0);
  }

  function floorCodeForNumbering(floorCode) {
    const raw = String(floorCode ?? "").trim().toUpperCase();
    if (/^B\d$/.test(raw)) return raw;
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed < 0) return `B${Math.min(9, Math.abs(parsed))}`;
    if (Number.isFinite(parsed)) return pad2(parsed);
    const digitMatch = raw.match(/\d+/);
    return digitMatch ? pad2(digitMatch[0]) : "00";
  }

  function doorCode(doorText) {
    const digits = String(doorText ?? "").replace(/\D/g, "");
    if (!digits) return "";
    return digits.slice(-2).padStart(2, "0");
  }

  function generateBuildingCode(building) {
    return `${NUMBERING_RULES.buildingPrefix}${campusCodeForBuilding(building)}${buildingNumberCode(building)}`;
  }

  function generateSpaceCode(space, building) {
    const frontDoor = doorCode(space?.front_door);
    if (!frontDoor) return "";
    const rearDoor = doorCode(space?.rear_door) || frontDoor;
    return `${NUMBERING_RULES.spacePrefix}${campusCodeForBuilding(building)}${buildingNumberCode(building)}${floorCodeForNumbering(space?.floor_code)}${frontDoor}${rearDoor}`;
  }

  function segmentElementPrefix(segment) {
    const type = normalizeElementType(segment?.element_type);
    if (type === "stairs") return NUMBERING_RULES.segmentPrefixes.stairs;
    if (type === "elevator") return NUMBERING_RULES.segmentPrefixes.elevator;
    if (type === "other") return NUMBERING_RULES.segmentPrefixes.other;
    const dx = Math.abs(numberValue(segment?.end_x_m, 0) - numberValue(segment?.start_x_m, 0));
    const dy = Math.abs(numberValue(segment?.end_y_m, 0) - numberValue(segment?.start_y_m, 0));
    return dx >= dy ? NUMBERING_RULES.segmentPrefixes.eastWest : NUMBERING_RULES.segmentPrefixes.northSouth;
  }

  function generateSegmentCode(segment, building, existingSegments = []) {
    const prefix = `${segmentElementPrefix(segment)}${campusCodeForBuilding(building)}${buildingNumberCode(building)}${floorCodeForNumbering(segment?.floor_code)}`;
    const maxSequence = existingSegments.reduce((max, item) => {
      const code = String(item.segment_code || "");
      if (!code.startsWith(prefix)) return max;
      const sequence = parseInt(code.slice(prefix.length), 10);
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 0);
    const nextSequence = maxSequence + 1;
    return nextSequence > 99 ? "" : `${prefix}${String(nextSequence).padStart(2, "0")}`;
  }

  function generateUnitCode(labs = []) {
    const prefix = NUMBERING_RULES.unitPrefix;
    const maxSequence = labs.reduce((max, lab) => {
      const match = String(lab.lab_code || "").match(new RegExp(`^${prefix}(\\d+)$`));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const nextSequence = maxSequence + 1;
    return `${prefix}${String(nextSequence).padStart(6, "0")}`;
  }

  function generateSequentialCode(rows = [], field, prefix, width = 6) {
    const maxSequence = rows.reduce((max, row) => {
      const match = String(row?.[field] || "").match(new RegExp(`^${prefix}(\\d+)$`, "i"));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}${String(maxSequence + 1).padStart(width, "0")}`;
  }

  function generatePlanCode(plans = []) {
    return generateSequentialCode(plans, "plan_code", NUMBERING_RULES.planPrefix, 6);
  }

  function generateUseTypeCode(types = []) {
    return generateSequentialCode(types, "type_code", NUMBERING_RULES.useTypePrefix, 4);
  }

  function isAssignableSegment(segment) {
    return normalizeElementType(segment?.element_type) === "corridor";
  }

  function csv(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function pick(row, fields) {
    return Object.fromEntries(fields.map((field) => [field, row[field] ?? ""]));
  }

  function dedupeBy(rows, key) {
    return [...new Map(rows.filter((row) => row[key]).map((row) => [row[key], row])).values()];
  }

  function copyScopedDedupeBy(rows, key) {
    return [...new Map(rows.filter((row) => row[key]).map((row) => {
      const copyId = String(row.copy_id || row.copyId || "").trim();
      return [`${copyId}::${row[key]}`, row];
    })).values()];
  }

  function compareBuildings(a, b) {
    return numberValue(a.campus_sort_order, 9999) - numberValue(b.campus_sort_order, 9999)
      || compare(a.campus_code, b.campus_code)
      || numberValue(a.sort_order, 0) - numberValue(b.sort_order, 0)
      || numberValue(a.building_number, 0) - numberValue(b.building_number, 0)
      || compare(a.building_name, b.building_name);
  }

  function defaultPlans() {
    return [
      {
        plan_code: "baseline",
        plan_name: "搬迁前基线",
        plan_type: "baseline",
        source_plan_code: "",
        description: "现状数据",
        is_locked: true,
        is_default_compare_before: true,
        is_default_compare_after: false,
      },
      {
        plan_code: "draft-2026",
        plan_name: "扩建后方案",
        plan_type: "draft",
        source_plan_code: "baseline",
        description: "搬迁规划草案",
        is_locked: false,
        is_default_compare_before: false,
        is_default_compare_after: true,
      },
    ];
  }

  function normalizeBuilding(row) {
    const now = isoNow();
    const code = String(row.building_code || "").trim();
    return {
      id: row.id || code || `building-${Date.now()}`,
      copy_id: row.copy_id || row.copyId || "",
      building_code: code,
      building_name: row.building_name || code,
      _legacy_campus_zone: row._legacy_campus_zone || row.campus_zone || "",
      campus_code: row.campus_code || row.campusCode || "",
      campus_sort_order: numberValue(row.campus_sort_order ?? row.campusSortOrder, 9999),
      building_number: numberValue(row.building_number, 0),
      sort_order: numberValue(row.sort_order, 0),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeCampus(row) {
    const now = isoNow();
    const code = String(row.campus_code || row.id || "").trim();
    const name = String(row.campus_name || row.campus_zone || code || "").trim();
    return {
      id: row.id || code || name,
      campus_code: code,
      campus_name: name,
      sort_order: numberValue(row.sort_order, 0),
      status: String(row.status || "active").trim(),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeSegment(row) {
    const now = isoNow();
    const buildingCode = String(row.building_code || "").trim();
    const floorCode = String(row.floor_code || "").trim();
    const segmentCode = String(row.segment_code || "").trim();
    return {
      id: row.id || `${buildingCode}__${floorCode}__${segmentCode}`,
      copy_id: row.copy_id || row.copyId || "",
      building_code: buildingCode,
      floor_code: floorCode,
      segment_code: segmentCode,
      segment_name: row.segment_name || row.segmentName || "",
      start_x_m: numberValue(row.start_x_m, 0),
      start_y_m: numberValue(row.start_y_m, 0),
      end_x_m: numberValue(row.end_x_m, 0),
      end_y_m: numberValue(row.end_y_m, 0),
      width_m: numberValue(row.width_m, 2.4),
      element_type: normalizeElementType(row.element_type),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeSpace(row) {
    const now = isoNow();
    const length = numberValue(row.length_m, 8);
    const width = numberValue(row.width_m, 6);
    const buildingCode = String(row.building_code || "").trim();
    const floorCode = String(row.floor_code || "").trim();
    const spaceCode = String(row.space_code || "").trim();
    return {
      id: row.id || `${buildingCode}__${floorCode}__${spaceCode}`,
      copy_id: row.copy_id || row.copyId || "",
      space_code: spaceCode,
      building_code: buildingCode,
      floor_code: floorCode,
      segment_code: String(row.segment_code || "").trim(),
      offset_m: numberValue(row.offset_m, 0),
      side: normalizeSide(row.side),
      front_door: row.front_door || row.space_code,
      rear_door: row.rear_door || "",
      length_m: length,
      width_m: width,
      area_m2: numberValue(row.area_m2, length * width),
      network_segment: row.network_segment || "",
      current_status: normalizeSpaceStatus(row.current_status),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeLab(row) {
    const now = isoNow();
    const code = String(row.lab_code || "").trim();
    return {
      id: row.id || code || `lab-${Date.now()}`,
      copy_id: row.copy_id || row.copyId || "",
      lab_code: code,
      lab_name: row.lab_name || code,
      college: row.college || "未设置学院",
      major: row.major || "",
      lab_type: row.lab_type === undefined ? "教学实验室" : row.lab_type,
      director: row.director || "",
      seat_count: row.seat_count === "" ? "" : numberValue(row.seat_count, 0),
      computer_count: row.computer_count === "" ? "" : numberValue(row.computer_count, 0),
      status: row.status || "active",
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function activeStatus(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (["inactive", "disabled", "停用", "禁用", "0", "false"].includes(raw)) return "inactive";
    return "active";
  }

  function normalizeDictionaryCode(value, fallbackPrefix) {
    const raw = String(value ?? "").trim();
    return raw || `${fallbackPrefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  KEY_ALIASES.colleges.color = ["color", "color_hex", "颜色", "学院颜色", "颜色值"];

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
    return (hash + offset) % COLORS.length;
  }

  function nextCollegeColor(index = 0, seed = "", usedColors = new Set()) {
    const used = new Set([...usedColors].map(normalizeColor).filter(Boolean));
    for (let offset = 0; offset < COLORS.length; offset += 1) {
      const color = COLORS[(index + stableColorIndex(seed, offset)) % COLORS.length];
      if (!used.has(color)) return color;
    }
    const hue = (stableColorIndex(seed, index) * 47 + index * 29) % 360;
    for (let offset = 0; offset < 360; offset += 23) {
      const color = hslToHex((hue + offset) % 360, 58, 42);
      if (!used.has(color)) return color;
    }
    return COLORS[index % COLORS.length];
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

  function normalizeCollege(row) {
    const now = isoNow();
    const name = String(row.college_name || row.college || row.college_code || "").trim();
    const code = normalizeDictionaryCode(row.college_code || name, "COLLEGE");
    return {
      id: code,
      copy_id: row.copy_id || row.copyId || "",
      college_code: code,
      college_name: name || code,
      color: normalizeColor(row.color || row.color_hex),
      sort_order: numberValue(row.sort_order, 0),
      status: activeStatus(row.status),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeMajor(row) {
    const now = isoNow();
    const name = String(row.major_name || row.major || row.major_code || "").trim();
    const collegeCode = String(row.college_code || "").trim();
    const code = normalizeDictionaryCode(row.major_code || (collegeCode && name ? `${collegeCode}-${name}` : name), "MAJOR");
    return {
      id: code,
      copy_id: row.copy_id || row.copyId || "",
      major_code: code,
      major_name: name || code,
      college_code: collegeCode,
      sort_order: numberValue(row.sort_order, 0),
      status: activeStatus(row.status),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeLabType(row) {
    const now = isoNow();
    const name = String(row.type_name || row.lab_type || row.type_code || "").trim();
    const rawCode = String(row.type_code || "").trim();
    const code = /^[A-Z][A-Z0-9_-]*$/i.test(rawCode) && !/[\u3400-\u9fff]/.test(rawCode) ? rawCode.toUpperCase() : "";
    return {
      id: row.id || code || normalizeDictionaryCode(name, "TYPE"),
      copy_id: row.copy_id || row.copyId || "",
      type_code: code,
      type_name: name || code,
      sort_order: numberValue(row.sort_order, 0),
      status: activeStatus(row.status),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function canonicalUseTypeSeed(name) {
    const trimmed = String(name || "").trim();
    if (trimmed === "实验室") return { type_code: "USE0001", sort_order: 1 };
    if (trimmed === "教室") return { type_code: "USE0002", sort_order: 2 };
    return null;
  }

  function canonicalizeLabTypes(rows, labs = []) {
    const normalized = (rows || []).map(normalizeLabType).filter((row) => row.type_name);
    for (const name of unique((labs || []).map((row) => String(row.lab_type || "").trim())).filter(Boolean)) {
      if (!normalized.some((row) => row.type_name === name)) {
        normalized.push(normalizeLabType({ type_name: name, sort_order: normalized.length + 1, status: "active" }));
      }
    }
    for (const name of ["实验室", "教室"]) {
      if (!normalized.some((row) => row.type_name === name)) {
        normalized.push(normalizeLabType({ type_name: name, sort_order: normalized.length + 1, status: "active" }));
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
    return [...byName.values()].sort((a, b) => {
      const seedA = canonicalUseTypeSeed(a.type_name);
      const seedB = canonicalUseTypeSeed(b.type_name);
      return (seedA?.sort_order || a.sort_order || 999) - (seedB?.sort_order || b.sort_order || 999)
        || compare(a.type_name, b.type_name);
    }).map((row) => {
      const seed = canonicalUseTypeSeed(row.type_name);
      let code = seed?.type_code || (/^USE\d{4}$/i.test(row.type_code) && !reserved.has(row.type_code) ? row.type_code.toUpperCase() : "");
      if (!code || used.has(code)) {
        do {
          code = `USE${String(nextIndex).padStart(4, "0")}`;
          nextIndex += 1;
        } while (used.has(code) || reserved.has(code));
      }
      used.add(code);
      return normalizeLabType({
        ...row,
        id: seed?.type_code || row.id || code,
        type_code: code,
        sort_order: seed?.sort_order || row.sort_order || used.size,
        status: row.status || "active",
      });
    });
  }

  function deriveDictionaries(labs, colleges, majors, labTypes) {
    const collegeRows = colleges.length ? colleges : unique(labs.map((row) => row.college))
      .map((name, index) => normalizeCollege({ college_code: name, college_name: name, sort_order: index + 1 }));
    const collegeByName = new Map(collegeRows.map((row) => [row.college_name, row]));
    const majorRows = majors.length ? majors : unique(labs.map((row) => `${row.college || ""}:::${row.major || ""}`))
      .map((key, index) => {
        const [collegeName, majorName] = key.split(":::");
        if (!majorName) return null;
        const college = collegeByName.get(collegeName);
        return normalizeMajor({
          major_code: `${college?.college_code || collegeName}-${majorName}`,
          major_name: majorName,
          college_code: college?.college_code || collegeName,
          sort_order: index + 1,
        });
      })
      .filter(Boolean);
    const typeRows = labTypes.length ? labTypes : unique(labs.map((row) => row.lab_type))
      .map((name, index) => normalizeLabType({ type_code: name, type_name: name, sort_order: index + 1 }));
    const byOrderThenName = (nameKey) => (a, b) => numberValue(a.sort_order, 0) - numberValue(b.sort_order, 0) || compare(a[nameKey], b[nameKey]);
    return {
      colleges: assignCollegeColors(dedupeBy(collegeRows, "id").sort(byOrderThenName("college_name"))),
      majors: dedupeBy(majorRows, "id").sort(byOrderThenName("major_name")),
      lab_types: canonicalizeLabTypes(typeRows, labs).sort(byOrderThenName("type_name")),
    };
  }

  function normalizePlan(row) {
    const now = isoNow();
    const code = String(row.plan_code || "").trim();
    return {
      id: row.id || code || `plan-${Date.now()}`,
      copy_id: row.copy_id || row.copyId || "",
      plan_code: code,
      plan_name: row.plan_name || code,
      plan_type: row.plan_type || "draft",
      source_plan_code: row.source_plan_code || "",
      source_plan_id: row.source_plan_id || "",
      description: row.description || "",
      is_locked: booleanValue(row.is_locked),
      is_default_compare_before: booleanValue(row.is_default_compare_before),
      is_default_compare_after: booleanValue(row.is_default_compare_after),
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function relationMaps(base) {
    return {
      spacesByCode: new Map((base.spaces || []).map((row) => [row.space_code, row])),
      labsByCode: new Map((base.labs || []).map((row) => [row.lab_code, row])),
      plansByCode: new Map((base.plans || []).map((row) => [row.plan_code, row])),
    };
  }

  function normalizeAssignment(row, relation) {
    const now = isoNow();
    const plan = relation.plansByCode.get(row.plan_code);
    const lab = relation.labsByCode.get(row.lab_code);
    const space = relation.spacesByCode.get(row.space_code);
    const previousSpace = relation.spacesByCode.get(row.previous_space_code);
    return {
      id: `${row.plan_code}__${row.lab_code}`,
      plan_code: row.plan_code,
      lab_code: row.lab_code,
      space_code: row.space_code || "",
      previous_space_code: row.previous_space_code || "",
      plan_id: plan?.id || "",
      lab_id: lab?.id || "",
      space_id: space?.id || "",
      previous_space_id: previousSpace?.id || "",
      assignment_status: normalizeAssignmentStatus(row.assignment_status, Boolean(space)),
      move_note: row.move_note || "",
      effective_from: row.effective_from || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function deriveBuildings(buildings, spaces, floorSegments) {
    const scopedBuildingKey = (row) => `${String(row.copy_id || row.copyId || "").trim()}::${row.building_code}`;
    const byCode = new Map(buildings.map((row) => [scopedBuildingKey(row), row]));
    for (const row of [...spaces, ...floorSegments]) {
      const code = row.building_code;
      const key = scopedBuildingKey(row);
      if (code && !byCode.has(key)) {
        byCode.set(key, normalizeBuilding({ copy_id: row.copy_id || row.copyId || "", building_code: code, building_name: code, building_number: 0, notes: "" }));
      }
    }
    return [...byCode.values()].sort(compareBuildings);
  }

  function applyCampusConfig(buildings, campuses) {
    const activeCampuses = (campuses || []).filter((campus) => String(campus.status || "active") === "active");
    const byCode = new Map(activeCampuses.map((campus) => [String(campus.campus_code || "").trim(), campus]));
    const byName = new Map(activeCampuses.map((campus) => [String(campus.campus_name || "").trim(), campus]));
    return (buildings || []).map((building) => {
      const configured = byCode.get(String(building.campus_code || "").trim()) ||
        byName.get(String(building._legacy_campus_zone || building.campus_zone || "").trim());
      if (!configured) {
        const { campus_zone: _legacyCampusZone, _legacy_campus_zone: _legacyCampusName, ...rest } = building;
        return {
          ...rest,
          campus_code: "",
          campus_sort_order: 9999,
        };
      }
      const { campus_zone: _legacyCampusZone, _legacy_campus_zone: _legacyCampusName, ...rest } = building;
      return {
        ...rest,
        campus_code: configured.campus_code,
        campus_sort_order: numberValue(configured.sort_order, 9999),
      };
    }).sort(compareBuildings);
  }

  function projectRow(key, row) {
    const aliases = KEY_ALIASES[key];
    return {
      ...Object.fromEntries(Object.keys(aliases).map((field) => [field, read(row, aliases[field])])),
      id: row?.id || "",
      copy_id: row?.copy_id || row?.copyId || "",
    };
  }

  function normalizeDataset(raw) {
    const campuses = (raw.campuses || []).map((row) => normalizeCampus(projectRow("campuses", row)));
    const buildings = (raw.buildings || []).map((row) => normalizeBuilding(projectRow("buildings", row)));
    const floorSegments = (raw.floor_segments || []).map((row) => normalizeSegment(projectRow("floor_segments", row)));
    const spaces = (raw.spaces || []).map((row) => normalizeSpace(projectRow("spaces", row)));
    const labs = (raw.labs || []).map((row) => normalizeLab(projectRow("labs", row)));
    const dictionary = deriveDictionaries(
      labs,
      (raw.colleges || []).map((row) => normalizeCollege(projectRow("colleges", row))),
      (raw.majors || []).map((row) => normalizeMajor(projectRow("majors", row))),
      (raw.lab_types || []).map((row) => normalizeLabType(projectRow("lab_types", row)))
    );
    const plansRaw = (raw.plans || []).map((row) => normalizePlan(projectRow("plans", row)));
    const plans = plansRaw.length ? plansRaw : defaultPlans().map(normalizePlan);
    const relation = relationMaps({ spaces, labs, plans });
    const planAssignments = (raw.plan_assignments || []).map((row) => normalizeAssignment(projectRow("plan_assignments", row), relation));
    return {
      campuses: dedupeBy(campuses, "id"),
      buildings: applyCampusConfig(deriveBuildings(buildings, spaces, floorSegments), campuses),
      floor_segments: copyScopedDedupeBy(floorSegments, "id"),
      spaces: copyScopedDedupeBy(spaces, "id"),
      labs: copyScopedDedupeBy(labs, "id"),
      colleges: copyScopedDedupeBy(dictionary.colleges, "id"),
      majors: copyScopedDedupeBy(dictionary.majors, "id"),
      lab_types: copyScopedDedupeBy(dictionary.lab_types, "id"),
      plans: dedupeBy(plans, "id"),
      plan_assignments: dedupeBy(planAssignments, "id"),
      file_assets: Array.isArray(raw.file_assets) ? raw.file_assets : [],
      imports: Array.isArray(raw.imports) ? raw.imports : [],
      deleted_space_ids: Array.isArray(raw.deleted_space_ids) ? [...new Set(raw.deleted_space_ids.filter(Boolean))] : [],
    };
  }

  function defaultComparePlans(plans) {
    const before = plans.find((row) => row.is_default_compare_before) || plans.find((row) => row.plan_type === "baseline") || plans[0] || null;
    const after = plans.find((row) => row.is_default_compare_after) || plans.find((row) => row.plan_type === "draft") || plans[1] || before || null;
    return { before, after };
  }

  function sampleDataset() {
    return {
      campuses: [
        { campus_code: "01", campus_name: "本部", sort_order: 1, status: "active", notes: "" },
        { campus_code: "02", campus_name: "西校区", sort_order: 2, status: "active", notes: "" },
      ],
      buildings: [
        { building_code: "B01", building_name: "明理楼", campus_code: "01", building_number: 1, notes: "" },
        { building_code: "B02", building_name: "博学楼", campus_code: "02", building_number: 2, notes: "" },
      ],
      floor_segments: [
        { building_code: "B01", floor_code: "1", segment_code: "main", start_x_m: 0, start_y_m: 0, end_x_m: 28, end_y_m: 0, width_m: 2.4, element_type: "corridor", notes: "主走廊" },
        { building_code: "B01", floor_code: "1", segment_code: "branch", start_x_m: 14, start_y_m: 0, end_x_m: 14, end_y_m: 18, width_m: 2.4, element_type: "corridor", notes: "支走廊" },
        { building_code: "B01", floor_code: "1", segment_code: "stairs-east", start_x_m: 28, start_y_m: 4, end_x_m: 28, end_y_m: 10, width_m: 4, element_type: "stairs", notes: "东侧楼梯" },
        { building_code: "B01", floor_code: "2", segment_code: "loop-north", start_x_m: 0, start_y_m: 0, end_x_m: 24, end_y_m: 0, width_m: 2.4, element_type: "corridor", notes: "北走廊" },
        { building_code: "B01", floor_code: "2", segment_code: "loop-east", start_x_m: 24, start_y_m: 0, end_x_m: 24, end_y_m: 16, width_m: 2.4, element_type: "corridor", notes: "东走廊" },
        { building_code: "B02", floor_code: "1", segment_code: "zig-1", start_x_m: 0, start_y_m: 0, end_x_m: 14, end_y_m: 0, width_m: 2.4, element_type: "corridor", notes: "折线一" },
        { building_code: "B02", floor_code: "1", segment_code: "zig-2", start_x_m: 14, start_y_m: 0, end_x_m: 20, end_y_m: 9, width_m: 2.4, element_type: "corridor", notes: "折线二" },
        { building_code: "B02", floor_code: "1", segment_code: "zig-3", start_x_m: 20, start_y_m: 9, end_x_m: 8, end_y_m: 9, width_m: 2.4, element_type: "corridor", notes: "折线三" },
      ],
      spaces: [
        { space_code: "101", building_code: "B01", floor_code: "1", segment_code: "main", offset_m: 0, side: "north", front_door: "101", rear_door: "", length_m: 9.6, width_m: 7.2, network_segment: "192.168.1.0/24", current_status: "active" },
        { space_code: "102", building_code: "B01", floor_code: "1", segment_code: "main", offset_m: 15, side: "south", front_door: "102", rear_door: "104", length_m: 11.2, width_m: 7, network_segment: "192.168.2.0/24", current_status: "active" },
        { space_code: "108", building_code: "B01", floor_code: "1", segment_code: "branch", offset_m: 6, side: "east", front_door: "108", rear_door: "110", length_m: 10, width_m: 6, network_segment: "VLAN-118", current_status: "active" },
        { space_code: "201", building_code: "B01", floor_code: "2", segment_code: "loop-north", offset_m: 8, side: "north", front_door: "201", rear_door: "", length_m: 9, width_m: 6.8, network_segment: "192.168.3.0/24", current_status: "active" },
        { space_code: "202", building_code: "B01", floor_code: "2", segment_code: "loop-east", offset_m: 7, side: "east", front_door: "202", rear_door: "204", length_m: 12, width_m: 7, network_segment: "192.168.4.0/24", current_status: "active" },
        { space_code: "A-101", building_code: "B02", floor_code: "1", segment_code: "zig-1", offset_m: 6, side: "north", front_door: "A101", rear_door: "A103", length_m: 12, width_m: 7.8, network_segment: "10.10.10.0/24", current_status: "active" },
        { space_code: "A-104", building_code: "B02", floor_code: "1", segment_code: "zig-3", offset_m: 5, side: "south", front_door: "A104", rear_door: "A106", length_m: 11, width_m: 7, network_segment: "10.10.20.0/24", current_status: "active" },
      ],
      labs: [
        { lab_code: "LAB001", lab_name: "计算机组成原理实验室", college: "计算机学院", major: "计算机科学", lab_type: "教学实验室", director: "李老师", seat_count: 48, computer_count: 48, status: "active", notes: "" },
        { lab_code: "LAB002", lab_name: "电子技术实验室", college: "电子信息学院", major: "电子工程", lab_type: "专业实验室", director: "周老师", seat_count: 52, computer_count: 30, status: "active", notes: "" },
        { lab_code: "LAB003", lab_name: "机器视觉实验室", college: "人工智能学院", major: "人工智能", lab_type: "科研实验室", director: "王老师", seat_count: 30, computer_count: 24, status: "active", notes: "" },
        { lab_code: "LAB004", lab_name: "数据结构实验室", college: "计算机学院", major: "软件工程", lab_type: "教学实验室", director: "陈老师", seat_count: 50, computer_count: 50, status: "active", notes: "" },
        { lab_code: "LAB005", lab_name: "智能机器人实验室", college: "人工智能学院", major: "机器人工程", lab_type: "科研实验室", director: "赵老师", seat_count: 28, computer_count: 18, status: "planning", notes: "待迁移" },
        { lab_code: "LAB006", lab_name: "有机化学实验室", college: "化学学院", major: "应用化学", lab_type: "教学实验室", director: "孙老师", seat_count: 36, computer_count: 0, status: "active", notes: "" },
        { lab_code: "LAB007", lab_name: "细胞培养实验室", college: "生命科学学院", major: "生物技术", lab_type: "科研实验室", director: "吴老师", seat_count: 24, computer_count: 6, status: "active", notes: "" },
      ],
      colleges: [
        { college_code: "计算机学院", college_name: "计算机学院", sort_order: 1, status: "active", notes: "" },
        { college_code: "电子信息学院", college_name: "电子信息学院", sort_order: 2, status: "active", notes: "" },
        { college_code: "人工智能学院", college_name: "人工智能学院", sort_order: 3, status: "active", notes: "" },
        { college_code: "化学学院", college_name: "化学学院", sort_order: 4, status: "active", notes: "" },
        { college_code: "生命科学学院", college_name: "生命科学学院", sort_order: 5, status: "active", notes: "" },
      ],
      majors: [
        { major_code: "计算机学院-计算机科学", major_name: "计算机科学", college_code: "计算机学院", sort_order: 1, status: "active", notes: "" },
        { major_code: "计算机学院-软件工程", major_name: "软件工程", college_code: "计算机学院", sort_order: 2, status: "active", notes: "" },
        { major_code: "电子信息学院-电子工程", major_name: "电子工程", college_code: "电子信息学院", sort_order: 1, status: "active", notes: "" },
        { major_code: "人工智能学院-人工智能", major_name: "人工智能", college_code: "人工智能学院", sort_order: 1, status: "active", notes: "" },
        { major_code: "人工智能学院-机器人工程", major_name: "机器人工程", college_code: "人工智能学院", sort_order: 2, status: "active", notes: "" },
        { major_code: "化学学院-应用化学", major_name: "应用化学", college_code: "化学学院", sort_order: 1, status: "active", notes: "" },
        { major_code: "生命科学学院-生物技术", major_name: "生物技术", college_code: "生命科学学院", sort_order: 1, status: "active", notes: "" },
      ],
      lab_types: [
        { type_code: "教学实验室", type_name: "教学实验室", sort_order: 1, status: "active", notes: "" },
        { type_code: "专业实验室", type_name: "专业实验室", sort_order: 2, status: "active", notes: "" },
        { type_code: "科研实验室", type_name: "科研实验室", sort_order: 3, status: "active", notes: "" },
      ],
      plans: defaultPlans(),
      plan_assignments: [
        { plan_code: "baseline", lab_code: "LAB001", space_code: "101", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB002", space_code: "102", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB003", space_code: "108", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB004", space_code: "201", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB005", space_code: "202", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB006", space_code: "A-101", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB007", space_code: "A-104", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB001", space_code: "201", previous_space_code: "101", assignment_status: "assigned", move_note: "搬迁至二层共享区域", effective_from: "2026-09-01" },
        { plan_code: "draft-2026", lab_code: "LAB002", space_code: "102", previous_space_code: "102", assignment_status: "assigned", move_note: "原位保留", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB003", space_code: "108", previous_space_code: "108", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB004", space_code: "101", previous_space_code: "201", assignment_status: "assigned", move_note: "迁入一层", effective_from: "2026-09-01" },
        { plan_code: "draft-2026", lab_code: "LAB005", space_code: "", previous_space_code: "202", assignment_status: "Invalid", move_note: "待扩建后落位", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB006", space_code: "A-101", previous_space_code: "A-101", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB007", space_code: "A-104", previous_space_code: "A-104", assignment_status: "assigned", move_note: "", effective_from: "" },
      ],
    };
  }

  function templateInstructions() {
    return [
      ["使用说明", "整套数据只需维护这一个 Excel 文件。"],
      ["导入方式", "上传本工作簿即可，系统会自动读取各工作表。"],
      ["工作表", "campuses, buildings, floor_segments, spaces, labs, colleges, majors, lab_types, plans, plan_assignments"],
      ["字段约定", "编码字段保持唯一；side 使用 north/south/east/west；element_type 使用 corridor/stairs/elevator/other。"],
      ["方案分配", "plan_assignments 用 plan_code + lab_code 表示一条用途单元落位关系。"],
    ];
  }

  function templateRows(key) {
    return {
      campuses: [{ campus_code: "01", campus_name: "示例校区", sort_order: 1, status: "active", notes: "示例校区，可按学校实际情况维护" }],
      buildings: [{ building_code: "B01", building_name: "第一教学楼", campus_code: "01", building_number: 1, notes: "示例楼" }],
      floor_segments: [
        { building_code: "B01", floor_code: "1", segment_code: "main", segment_name: "主走廊", start_x_m: 0, start_y_m: 0, end_x_m: 28, end_y_m: 0, width_m: 2.4, element_type: "corridor", notes: "" },
        { building_code: "B01", floor_code: "1", segment_code: "stairs-east", segment_name: "东侧楼梯", start_x_m: 28, start_y_m: 4, end_x_m: 28, end_y_m: 10, width_m: 4, element_type: "stairs", notes: "" },
        { building_code: "B01", floor_code: "1", segment_code: "elevator-west", segment_name: "西侧电梯", start_x_m: 2, start_y_m: 4, end_x_m: 2, end_y_m: 8, width_m: 4, element_type: "elevator", notes: "" },
      ],
      spaces: [{ space_code: "101", building_code: "B01", floor_code: "1", segment_code: "main", offset_m: 0, side: "north", front_door: "101", rear_door: "", length_m: 9.6, width_m: 7.2, network_segment: "192.168.1.0/24", current_status: "active" }],
      labs: [{ lab_code: "UNIT000001", lab_name: "计算机组成原理实验室", college: "计算机学院", major: "计算机科学", lab_type: "教学实验室", director: "李老师", seat_count: 48, computer_count: 48, status: "active", notes: "" }],
      colleges: [{ college_code: "计算机学院", college_name: "计算机学院", sort_order: 1, status: "active", notes: "" }],
      majors: [{ major_code: "计算机学院-计算机科学", major_name: "计算机科学", college_code: "计算机学院", sort_order: 1, status: "active", notes: "" }],
      lab_types: [{ type_code: "教学实验室", type_name: "教学实验室", sort_order: 1, status: "active", notes: "" }],
      plans: defaultPlans(),
      plan_assignments: [{ plan_code: "baseline", lab_code: "UNIT000001", space_code: "101", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" }],
    }[key] || [];
  }

  global.FloorplanDomain = {
    STORAGE_KEY,
    ALL_COLLEGES,
    ROOM_GAP_M,
    DETAIL_SCALE,
    THUMB_SCALE,
    COLORS,
    NUMBERING_RULES,
    DATASETS,
    emptyDataset,
    unique,
    compare,
    compareBuildings,
    numberValue,
    booleanValue,
    read,
    csv,
    escapeHtml,
    pick,
    defaultPlans,
    defaultComparePlans,
    normalizeDataset,
    normalizeColor,
    nextCollegeColor,
    assignCollegeColors,
    normalizeBuilding,
    normalizeSegment,
    normalizeSpace,
    normalizeLab,
    normalizeCampus,
    normalizeCollege,
    normalizeMajor,
    normalizeLabType,
    canonicalizeLabTypes,
    normalizePlan,
    normalizeAssignment,
    normalizeSide,
    normalizeElementType,
    generateBuildingCode,
    generateSpaceCode,
    generateSegmentCode,
    generateUnitCode,
    generatePlanCode,
    generateUseTypeCode,
    segmentElementPrefix,
    isAssignableSegment,
    relationMaps,
    templateInstructions,
    templateRows,
    sampleDataset,
    isoNow,
  };
})(window);
