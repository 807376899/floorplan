(function attachFloorplanDomain(global) {
  // 领域模块只处理数据结构、规范化、模板和示例数据，不直接读写 DOM 或请求服务端。
  const STORAGE_KEY = "floorplan-migration-dataset-v2";
  const ALL_COLLEGES = "全部学院";
  const ROOM_GAP_M = 0.7;
  const DETAIL_SCALE = 28;
  const THUMB_SCALE = 6;
  const COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f"];

  const DATASETS = [
    {
      key: "buildings",
      label: "教学楼",
      sheet: "buildings",
      columns: [
        ["building_code", "教学楼编码"],
        ["building_name", "教学楼名称"],
        ["campus_zone", "所属校区"],
        ["building_number", "楼号"],
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
      label: "实验室",
      sheet: "labs",
      columns: [
        ["lab_code", "实验室编码"],
        ["lab_name", "实验室名称"],
        ["college", "所属学院"],
        ["major", "所属专业"],
        ["lab_type", "实验室类型"],
        ["director", "负责人"],
        ["seat_count", "座位数"],
        ["computer_count", "电脑数"],
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

  const KEY_ALIASES = {
    buildings: {
      building_code: ["building_code", "教学楼编码"],
      building_name: ["building_name", "教学楼名称"],
      campus_zone: ["campus_zone", "所属校区"],
      building_number: ["building_number", "教学楼编号", "楼号"],
      notes: ["notes", "备注"],
    },
    floor_segments: {
      building_code: ["building_code", "教学楼编码"],
      floor_code: ["floor_code", "楼层编码"],
      segment_code: ["segment_code", "走廊段编码"],
      start_x_m: ["start_x_m", "起点X"],
      start_y_m: ["start_y_m", "起点Y"],
      end_x_m: ["end_x_m", "终点X"],
      end_y_m: ["end_y_m", "终点Y"],
      width_m: ["width_m", "宽度", "走廊宽度"],
      element_type: ["element_type", "元素类型"],
      notes: ["notes", "备注"],
    },
    spaces: {
      space_code: ["space_code", "空间编码", "房间编码"],
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
      lab_code: ["lab_code", "实验室编码"],
      lab_name: ["lab_name", "实验室名称"],
      college: ["college", "所属学院"],
      major: ["major", "所属专业"],
      lab_type: ["lab_type", "实验室类型"],
      director: ["director", "负责人", "实验室负责人"],
      seat_count: ["seat_count", "座位数"],
      computer_count: ["computer_count", "电脑数", "电脑数量"],
      status: ["status", "状态", "实验室状态"],
      notes: ["notes", "备注"],
    },
    plans: {
      plan_code: ["plan_code", "方案编码"],
      plan_name: ["plan_name", "方案名称"],
      plan_type: ["plan_type", "方案类型"],
      source_plan_code: ["source_plan_code", "来源方案"],
      description: ["description", "方案描述"],
      is_locked: ["is_locked", "是否锁定"],
      is_default_compare_before: ["is_default_compare_before", "默认搬迁前", "是否默认搬迁前"],
      is_default_compare_after: ["is_default_compare_after", "默认搬迁后", "是否默认搬迁后"],
    },
    plan_assignments: {
      plan_code: ["plan_code", "方案编码"],
      lab_code: ["lab_code", "实验室编码"],
      space_code: ["space_code", "当前空间编码"],
      previous_space_code: ["previous_space_code", "搬迁前空间编码"],
      assignment_status: ["assignment_status", "分配状态"],
      move_note: ["move_note", "搬迁说明"],
      effective_from: ["effective_from", "生效时间"],
    },
  };

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
    return ["stairs", "楼梯"].includes(raw) ? "stairs" : "corridor";
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

  function compareBuildings(a, b) {
    return numberValue(a.building_number, 0) - numberValue(b.building_number, 0) || compare(a.building_name, b.building_name);
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
    return {
      id: row.building_code || `building-${Date.now()}`,
      building_code: row.building_code,
      building_name: row.building_name || row.building_code,
      campus_zone: row.campus_zone || "未分区",
      building_number: numberValue(row.building_number, 0),
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeSegment(row) {
    const now = isoNow();
    return {
      id: `${row.building_code}__${row.floor_code}__${row.segment_code}`,
      building_code: row.building_code,
      floor_code: row.floor_code,
      segment_code: row.segment_code,
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
    return {
      id: `${row.building_code}__${row.floor_code}__${row.space_code}`,
      space_code: row.space_code,
      building_code: row.building_code,
      floor_code: row.floor_code,
      segment_code: row.segment_code,
      offset_m: numberValue(row.offset_m, 0),
      side: normalizeSide(row.side),
      front_door: row.front_door || row.space_code,
      rear_door: row.rear_door || "",
      length_m: length,
      width_m: width,
      area_m2: numberValue(row.area_m2, length * width),
      network_segment: row.network_segment || "",
      current_status: row.current_status || "active",
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizeLab(row) {
    const now = isoNow();
    return {
      id: row.lab_code || `lab-${Date.now()}`,
      lab_code: row.lab_code,
      lab_name: row.lab_name || row.lab_code,
      college: row.college || "未设置学院",
      major: row.major || "",
      lab_type: row.lab_type || "教学实验室",
      director: row.director || "",
      seat_count: numberValue(row.seat_count, 0),
      computer_count: numberValue(row.computer_count, 0),
      status: row.status || "active",
      notes: row.notes || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function normalizePlan(row) {
    const now = isoNow();
    return {
      id: row.plan_code || `plan-${Date.now()}`,
      plan_code: row.plan_code,
      plan_name: row.plan_name || row.plan_code,
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
      assignment_status: row.assignment_status || (space ? "assigned" : "unplaced"),
      move_note: row.move_note || "",
      effective_from: row.effective_from || "",
      created_at: row.created_at || now,
      updated_at: now,
    };
  }

  function deriveBuildings(buildings, spaces, floorSegments) {
    const byCode = new Map(buildings.map((row) => [row.building_code, row]));
    for (const code of unique([...spaces.map((row) => row.building_code), ...floorSegments.map((row) => row.building_code)])) {
      if (!byCode.has(code)) byCode.set(code, normalizeBuilding({ building_code: code, building_name: code, campus_zone: "未分区", building_number: 0, notes: "" }));
    }
    return [...byCode.values()].sort(compareBuildings);
  }

  function projectRow(key, row) {
    const aliases = KEY_ALIASES[key];
    return Object.fromEntries(Object.keys(aliases).map((field) => [field, read(row, aliases[field])]));
  }

  function normalizeDataset(raw) {
    const buildings = (raw.buildings || []).map((row) => normalizeBuilding(projectRow("buildings", row)));
    const floorSegments = (raw.floor_segments || []).map((row) => normalizeSegment(projectRow("floor_segments", row)));
    const spaces = (raw.spaces || []).map((row) => normalizeSpace(projectRow("spaces", row)));
    const labs = (raw.labs || []).map((row) => normalizeLab(projectRow("labs", row)));
    const plansRaw = (raw.plans || []).map((row) => normalizePlan(projectRow("plans", row)));
    const plans = plansRaw.length ? plansRaw : defaultPlans().map(normalizePlan);
    const relation = relationMaps({ spaces, labs, plans });
    const planAssignments = (raw.plan_assignments || []).map((row) => normalizeAssignment(projectRow("plan_assignments", row), relation));
    return {
      buildings: deriveBuildings(buildings, spaces, floorSegments),
      floor_segments: dedupeBy(floorSegments, "id"),
      spaces: dedupeBy(spaces, "id"),
      labs: dedupeBy(labs, "id"),
      plans: dedupeBy(plans, "id"),
      plan_assignments: dedupeBy(planAssignments, "id"),
      file_assets: Array.isArray(raw.file_assets) ? raw.file_assets : [],
      imports: Array.isArray(raw.imports) ? raw.imports : [],
    };
  }

  function defaultComparePlans(plans) {
    const before = plans.find((row) => row.is_default_compare_before) || plans.find((row) => row.plan_type === "baseline") || plans[0] || null;
    const after = plans.find((row) => row.is_default_compare_after) || plans.find((row) => row.plan_type === "draft") || plans[1] || before || null;
    return { before, after };
  }

  function sampleDataset() {
    return {
      buildings: [
        { building_code: "B01", building_name: "明理楼", campus_zone: "本部", building_number: 1, notes: "" },
        { building_code: "B02", building_name: "博学楼", campus_zone: "西校区", building_number: 2, notes: "" },
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
        { space_code: "202", building_code: "B01", floor_code: "2", segment_code: "loop-east", offset_m: 7, side: "east", front_door: "202", rear_door: "204", length_m: 12, width_m: 7, network_segment: "192.168.4.0/24", current_status: "reserved" },
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
      plans: defaultPlans(),
      plan_assignments: [
        { plan_code: "baseline", lab_code: "LAB001", space_code: "101", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB002", space_code: "102", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB003", space_code: "108", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB004", space_code: "201", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB005", space_code: "202", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB006", space_code: "A-101", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "baseline", lab_code: "LAB007", space_code: "A-104", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB001", space_code: "201", previous_space_code: "101", assignment_status: "pending_move", move_note: "搬迁至二层共享区域", effective_from: "2026-09-01" },
        { plan_code: "draft-2026", lab_code: "LAB002", space_code: "102", previous_space_code: "102", assignment_status: "assigned", move_note: "原位保留", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB003", space_code: "108", previous_space_code: "108", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB004", space_code: "101", previous_space_code: "201", assignment_status: "pending_move", move_note: "迁入一层", effective_from: "2026-09-01" },
        { plan_code: "draft-2026", lab_code: "LAB005", space_code: "", previous_space_code: "202", assignment_status: "unplaced", move_note: "待扩建后落位", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB006", space_code: "A-101", previous_space_code: "A-101", assignment_status: "assigned", move_note: "", effective_from: "" },
        { plan_code: "draft-2026", lab_code: "LAB007", space_code: "A-104", previous_space_code: "A-104", assignment_status: "assigned", move_note: "", effective_from: "" },
      ],
    };
  }

  function templateInstructions() {
    return [
      ["使用说明", "整套数据只需维护这一个 Excel 文件。"],
      ["导入方式", "上传本工作簿即可，系统会自动读取各工作表。"],
      ["工作表", "buildings, floor_segments, spaces, labs, plans, plan_assignments"],
      ["字段约定", "编码字段保持唯一；side 使用 north/south/east/west；element_type 使用 corridor/stairs。"],
      ["方案分配", "plan_assignments 用 plan_code + lab_code 表示一条实验室落位关系。"],
    ];
  }

  function templateRows(key) {
    return {
      buildings: [{ building_code: "B01", building_name: "第一教学楼", campus_zone: "本部", building_number: 1, notes: "示例楼" }],
      floor_segments: [
        { building_code: "B01", floor_code: "1", segment_code: "main", start_x_m: 0, start_y_m: 0, end_x_m: 28, end_y_m: 0, width_m: 2.4, element_type: "corridor", notes: "主走廊" },
        { building_code: "B01", floor_code: "1", segment_code: "stairs-east", start_x_m: 28, start_y_m: 4, end_x_m: 28, end_y_m: 10, width_m: 4, element_type: "stairs", notes: "东侧楼梯" },
      ],
      spaces: [{ space_code: "101", building_code: "B01", floor_code: "1", segment_code: "main", offset_m: 0, side: "north", front_door: "101", rear_door: "", length_m: 9.6, width_m: 7.2, network_segment: "192.168.1.0/24", current_status: "active" }],
      labs: [{ lab_code: "LAB001", lab_name: "计算机组成原理实验室", college: "计算机学院", major: "计算机科学", lab_type: "教学实验室", director: "李老师", seat_count: 48, computer_count: 48, status: "active", notes: "" }],
      plans: defaultPlans(),
      plan_assignments: [{ plan_code: "baseline", lab_code: "LAB001", space_code: "101", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "" }],
    }[key] || [];
  }

  global.FloorplanDomain = {
    STORAGE_KEY,
    ALL_COLLEGES,
    ROOM_GAP_M,
    DETAIL_SCALE,
    THUMB_SCALE,
    COLORS,
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
    normalizeBuilding,
    normalizeSegment,
    normalizeSpace,
    normalizeLab,
    normalizePlan,
    normalizeAssignment,
    normalizeSide,
    normalizeElementType,
    relationMaps,
    templateInstructions,
    templateRows,
    sampleDataset,
    isoNow,
  };
})(window);
