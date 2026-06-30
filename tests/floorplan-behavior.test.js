const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const { createDatasetService } = require("../server/dataset-service");
const { compactVisibleDataset, createPlanCopyService } = require("../server/plan-copy-service");
const DatasetProjection = require("../server/dataset-projection-service");
const { createDetailActionService } = require("../server/detail-action-service");
const RelationalStore = require("../server/relational-store");
const { colorMap: buildLegendColorMap, renderLegend: renderLegendOnly } = require("../js/app/legend-colors");
const { createRenderThumbList } = require("../js/app/thumbnails");
const PlanManagement = require("../js/app/plan-management");
const PlanActions = require("../js/app/plan-actions");
const ManagedPlansModal = require("../js/app/managed-plans-modal");
const RawEditor = require("../js/app/raw-editor");
const PlanScope = require("../js/app/plan-scope");
const DetailActions = require("../js/app/detail-actions");
const { buildPlanDiff } = require("../js/app/plan-diff");
const { renderPlanDiffPanel } = require("../js/app/plan-diff-panel");

function loadBrowserModules() {
  const context = {
    window: {},
    console,
  };
  vm.createContext(context);
  for (const file of ["js/domain.js", "js/app/legend-colors.js", "js/app/thumbnails.js", "js/render.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  return context.window;
}

class StubElement {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.dataset = {};
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }
}

class ThumbContainerStub extends StubElement {
  constructor() {
    super();
    this.scrollTop = 0;
    this.scrollHeight = 1200;
    this.clientHeight = 400;
    this.listenerCount = 0;
  }

  querySelectorAll(selector) {
    if (selector !== "button") return [];
    const matches = this.innerHTML.match(/<button /g) || [];
    return matches.map(() => ({
      dataset: { planId: "plan-1", floor: "1" },
      addEventListener: () => {
        this.listenerCount += 1;
      },
    }));
  }
}

function createPlanCopyTestDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      role TEXT
    );
    CREATE TABLE plan_copies (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER,
      plan_code TEXT,
      plan_name TEXT,
      description TEXT,
      visibility TEXT,
      revision INTEGER,
      plan_json TEXT,
      assignments_json TEXT,
      source_plan_code TEXT,
      source_copy_id INTEGER,
      created_at TEXT,
      updated_at TEXT,
      source_type TEXT,
      dataset_json TEXT,
      import_draft_id INTEGER,
      is_baseline INTEGER,
      baselined_at TEXT,
      baselined_by TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare("INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin')").run();
  return db;
}

function createActiveDatasetTestDb(initialDataset) {
  const db = createPlanCopyTestDb();
  db.exec(`
    CREATE TABLE active_dataset (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      dataset_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO active_dataset (id, revision, dataset_json, updated_by, updated_at) VALUES (1, 1, ?, 'system', '2026-06-01T00:00:00Z')")
    .run(JSON.stringify(initialDataset));
  return db;
}

function createDatasetServiceStub() {
  const active = {
    revision: 1,
    dataset: {
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
    },
    updatedBy: "test",
    updatedAt: "2026-06-01T00:00:00Z",
  };
  return {
    getActiveDataset: () => active,
    normalizeIncomingDataset: (dataset) => dataset,
    saveActiveDataset: (dataset) => {
      active.dataset = dataset;
      active.revision += 1;
      return { revision: active.revision, dataset };
    },
  };
}

function createDatasetServiceStubWithNormalizer() {
  const stub = createDatasetServiceStub();
  const normalizer = createDatasetService({}, {
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, {});
  return {
    ...stub,
    normalizeIncomingDataset: normalizer.normalizeIncomingDataset,
  };
}

function insertPlanCopyRow(db, options) {
  const now = "2026-06-01T00:00:00Z";
  const plan = options.plan || {
    id: options.planCode,
    plan_code: options.planCode,
    plan_name: options.planName,
    plan_type: options.isBaseline ? "baseline" : "copy",
    is_locked: Boolean(options.isBaseline),
  };
  db.prepare(`
    INSERT INTO plan_copies (
      id, owner_user_id, plan_code, plan_name, description, visibility, revision,
      plan_json, assignments_json, source_plan_code, source_copy_id, created_at, updated_at,
      source_type, dataset_json, import_draft_id, is_baseline, baselined_at, baselined_by, deleted_at
    ) VALUES (?, ?, ?, ?, '', ?, 1, ?, ?, ?, ?, ?, ?, 'copy', ?, NULL, ?, ?, ?, NULL)
  `).run(
    options.id,
    options.ownerUserId || 1,
    options.planCode,
    options.planName,
    options.visibility || "private",
    JSON.stringify(plan),
    JSON.stringify(options.assignments || []),
    options.sourcePlanCode || "",
    options.sourceCopyId || null,
    now,
    now,
    options.dataset ? JSON.stringify(options.dataset) : null,
    options.isBaseline ? 1 : 0,
    options.isBaseline ? now : null,
    options.isBaseline ? "admin" : null
  );
}

function copiedReferenceDataset(copyId, overrides = {}) {
  const planCode = overrides.planCode || `copy-${copyId}`;
  return {
    buildings: [
      { id: `copy:${copyId}::B0101`, copy_id: copyId, building_code: "B0101", building_name: "明德楼", campus_zone: "下沙校区", building_number: 1, sort_order: 1 },
    ],
    floor_segments: [
      { id: `copy:${copyId}::seg-1`, copy_id: copyId, building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" },
    ],
    spaces: [
      { id: `copy:${copyId}::space-${copyId}`, copy_id: copyId, building_code: "B0101", floor_code: "1", segment_code: "EW01010101", space_code: `00101010${copyId}${copyId}`, front_door: `10${copyId}`, rear_door: "", length_m: 8, width_m: 6, area_m2: 48, network_segment: "", current_status: "active" },
    ],
    labs: [
      { id: `copy:${copyId}::lab-${copyId}`, copy_id: copyId, lab_code: `UNIT00000${copyId}`, lab_name: `用途单元${copyId}`, college: "统一学院", major: "智能建造", lab_type: "实验室", director: "", seat_count: 20, computer_count: 10 },
    ],
    colleges: [
      { id: `copy:${copyId}::COL-A`, copy_id: copyId, college_code: "COL-A", college_name: "统一学院", color: copyId === 1 ? "#2563EB" : "#DC2626", status: "active" },
    ],
    majors: [
      { id: `copy:${copyId}::MAJ-A`, copy_id: copyId, major_code: "MAJ-A", major_name: "智能建造", college_code: "COL-A", status: "active" },
    ],
    lab_types: [
      { id: `copy:${copyId}::USE0001`, copy_id: copyId, type_code: "USE0001", type_name: "实验室", status: "active" },
    ],
    plans: [{ id: planCode, copy_id: copyId, plan_code: planCode, plan_name: `方案${copyId}` }],
    plan_assignments: [
      { id: `${planCode}__UNIT00000${copyId}`, plan_id: planCode, plan_code: planCode, lab_code: `UNIT00000${copyId}`, space_code: `00101010${copyId}${copyId}`, assignment_status: "assigned" },
    ],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
}

function seedRelationalProjectionFixture(db) {
  RelationalStore.ensureRelationalSchema(db);
  db.prepare(`
    INSERT INTO buildings (id, building_code, building_name, campus_zone, building_number, sort_order)
    VALUES ('B0101', 'B0101', '关系楼', '下沙校区', 1, 1)
  `).run();
  db.prepare(`
    INSERT INTO floor_segments (id, building_code, floor_code, segment_code, start_x_m, start_y_m, end_x_m, end_y_m, width_m, element_type)
    VALUES ('B0101__1__EW01010101', 'B0101', '1', 'EW01010101', 0, 0, 20, 0, 2.4, 'corridor')
  `).run();
  db.prepare(`
    INSERT INTO colleges (id, college_code, college_name, color, status)
    VALUES ('COL-A', 'COL-A', '关系学院', '#2563EB', 'active')
  `).run();
  db.prepare(`
    INSERT INTO majors (id, major_code, major_name, college_code, status)
    VALUES ('MAJ-A', 'MAJ-A', '关系专业', 'COL-A', 'active')
  `).run();
  db.prepare(`
    INSERT INTO lab_types (id, type_code, type_name, status)
    VALUES ('USE0001', 'USE0001', '实验室', 'active')
  `).run();
  db.prepare(`
    INSERT INTO spaces (
      id, space_code, building_code, floor_code, segment_code, front_door, rear_door,
      side, offset_m, length_m, width_m, area_m2, network_segment, current_status
    ) VALUES ('SPACE-101', '00101010101', 'B0101', '1', 'EW01010101', '101', '', 'north', 0, 8, 6, 48, '10.0.0.0/24', 'active')
  `).run();
  db.prepare(`
    INSERT INTO spaces (
      id, space_code, building_code, floor_code, segment_code, front_door, rear_door,
      side, offset_m, length_m, width_m, area_m2, network_segment, current_status
    ) VALUES ('SPACE-102', '00101010202', 'B0101', '1', 'EW01010101', '102', '', 'north', 9, 8, 6, 48, '10.0.1.0/24', 'active')
  `).run();
  db.prepare(`
    INSERT INTO labs (
      id, lab_code, lab_name, college_code, college, major_code, major, lab_type_code,
      lab_type, director, seat_count, computer_count, status
    ) VALUES ('UNIT000001', 'UNIT000001', '关系实验室', 'COL-A', '关系学院', 'MAJ-A', '关系专业', 'USE0001', '实验室', '张三', 30, 20, 'active')
  `).run();
  db.prepare(`
    INSERT INTO plans (
      id, copy_id, plan_code, plan_name, owner_user_id, visibility, is_baseline,
      is_locked, revision, plan_type, source_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'copy', '2026-06-01T00:00:00Z', ?)
  `).run("copy-1", 1, "copy-1", "公开基线", 1, "public", 1, 1, "baseline", "2026-06-01T00:00:00Z");
  db.prepare(`
    INSERT INTO plans (
      id, copy_id, plan_code, plan_name, owner_user_id, visibility, is_baseline,
      is_locked, revision, plan_type, source_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, 'copy', 'copy', '2026-06-01T00:00:00Z', ?)
  `).run("copy-2", 2, "copy-2", "公开副本", 3, "public", "2026-06-02T00:00:00Z");
  db.prepare(`
    INSERT INTO plans (
      id, copy_id, plan_code, plan_name, owner_user_id, visibility, is_baseline,
      is_locked, revision, plan_type, source_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, 'copy', 'copy', '2026-06-01T00:00:00Z', ?)
  `).run("copy-8", 8, "copy-8", "编辑私有副本", 2, "private", "2026-06-03T00:00:00Z");
  db.prepare(`
    INSERT INTO plans (
      id, copy_id, plan_code, plan_name, owner_user_id, visibility, is_baseline,
      is_locked, revision, plan_type, source_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, 'copy', 'copy', '2026-06-01T00:00:00Z', ?)
  `).run("copy-9", 9, "copy-9", "他人私有副本", 3, "private", "2026-06-04T00:00:00Z");
  db.prepare(`
    INSERT INTO plan_space_overrides (id, plan_id, base_space_id, space_code, operation, payload_json)
    VALUES (?, ?, ?, ?, 'upsert', ?)
  `).run("copy-8__00101010202", "copy-8", "SPACE-102", "00101010202", JSON.stringify({
    id: "copy:8::SPACE-102",
    copy_id: 8,
    space_code: "00101010202",
    building_code: "B0101",
    floor_code: "1",
    segment_code: "EW01010101",
    front_door: "102",
    rear_door: "",
    network_segment: "10.8.0.0/24",
    current_status: "active",
  }));
  db.prepare(`
    INSERT INTO plan_assignments (id, plan_id, plan_code, lab_code, space_code, assignment_status, effective_from)
    VALUES ('copy-1__UNIT000001', 'copy-1', 'copy-1', 'UNIT000001', '00101010101', 'assigned', '2026-06')
  `).run();
  db.prepare(`
    INSERT INTO plan_assignments (id, plan_id, plan_code, lab_code, space_code, assignment_status)
    VALUES ('copy-8__UNIT000001', 'copy-8', 'copy-8', 'UNIT000001', '00101010202', 'assigned')
  `).run();
  db.prepare(`
    INSERT INTO plan_deleted_spaces (id, plan_id, base_space_id, space_code, created_at)
    VALUES ('copy-8__00101010101', 'copy-8', 'SPACE-101', '00101010101', '2026-06-01T00:00:00Z')
  `).run();
}

test("building sort uses campus groups then editable sort order", () => {
  const { FloorplanDomain } = loadBrowserModules();
  const buildings = [
    FloorplanDomain.normalizeBuilding({ building_code: "B0201", building_name: "绍兴一号楼", campus_zone: "绍兴校区", building_number: 1, sort_order: 1 }),
    FloorplanDomain.normalizeBuilding({ building_code: "B0109", building_name: "光大教学楼", campus_zone: "下沙校区", building_number: 9, sort_order: 20 }),
    FloorplanDomain.normalizeBuilding({ building_code: "B0106", building_name: "信泰教学楼", campus_zone: "下沙校区", building_number: 6, sort_order: 10 }),
  ];

  buildings.sort(FloorplanDomain.compareBuildings);

  assert.deepEqual(buildings.map((row) => row.building_code), ["B0106", "B0109", "B0201"]);
  assert.equal(buildings[0].sort_order, 10);
});

test("classroom spaces render gray even when assigned to a college", () => {
  const { FloorplanRender } = loadBrowserModules();
  const floorplanEl = new StubElement();
  const badgeEl = new StubElement();
  const data = {
    buildings: [],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" }],
    spaces: [{ id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", offset_m: 0, side: "north", space_code: "00101010101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, area_m2: 48, network_segment: "", current_status: "active" }],
    labs: [{ id: "lab-1", lab_code: "UNIT000001", lab_name: "普通教室", college: "金融管理学院", lab_type: "教室" }],
    plan_assignments: [{ id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", assignment_status: "assigned" }],
  };

  FloorplanRender.renderFloorplan({
    floorplanEl,
    activePlanBadgeEl: badgeEl,
    data,
    building: { building_code: "B0101", building_name: "测试楼" },
    floorCode: "1",
    activePlan: { id: "plan-1", plan_name: "基线" },
    colors: { 金融管理学院: "#2563eb" },
    selectedSpaceId: "",
    collegeFilter: "全部学院",
    onSelectSpace() {},
  });

  assert.match(floorplanEl.innerHTML, /fill="#94a3b8"/);
  assert.doesNotMatch(floorplanEl.innerHTML, /fill="#2563eb"/);
});

test("college dictionaries initialize unique editable colors", () => {
  const { FloorplanDomain } = loadBrowserModules();
  const dataset = FloorplanDomain.normalizeDataset({
    buildings: [],
    floor_segments: [],
    spaces: [],
    labs: [
      { lab_code: "LAB001", lab_name: "Lab A", college: "学院A", lab_type: "实验室" },
      { lab_code: "LAB002", lab_name: "Lab B", college: "学院B", lab_type: "实验室" },
      { lab_code: "LAB003", lab_name: "Lab C", college: "学院C", lab_type: "实验室" },
    ],
    plans: [],
    plan_assignments: [],
  });

  const colors = dataset.colleges.map((college) => college.color);

  assert.equal(colors.length, 3);
  assert.equal(new Set(colors).size, colors.length);
  colors.forEach((color) => assert.match(color, /^#[0-9a-f]{6}$/i));
});

test("college colors stay stable for the same college across copy scoped rows", () => {
  const { FloorplanDomain } = loadBrowserModules();
  const dataset = FloorplanDomain.normalizeDataset({
    buildings: [],
    floor_segments: [],
    spaces: [],
    labs: [],
    colleges: [
      { id: "college-a", copy_id: 1, college_code: "COL-A", college_name: "统一学院", color: "#111111" },
      { id: "college-a", copy_id: 2, college_code: "COL-A", college_name: "统一学院", color: "#222222" },
      { id: "college-b", copy_id: 1, college_code: "COL-B", college_name: "另一个学院", color: "#111111" },
    ],
    majors: [],
    lab_types: [],
    plans: [],
    plan_assignments: [],
  });

  const sameCollegeColors = dataset.colleges
    .filter((college) => college.college_name === "统一学院")
    .map((college) => college.color);
  const uniqueByCollege = new Map(dataset.colleges.map((college) => [college.college_name, college.color]));

  assert.equal(new Set(sameCollegeColors).size, 1);
  assert.notEqual(uniqueByCollege.get("统一学院"), uniqueByCollege.get("另一个学院"));
  dataset.colleges.forEach((college) => assert.match(college.color, /^#[0-9a-f]{6}$/i));
});

test("browser dataset normalization preserves copy scoped structural rows", () => {
  const { FloorplanDomain } = loadBrowserModules();
  const dataset = FloorplanDomain.normalizeDataset({
    buildings: [
      { id: "building-1", copy_id: 2, building_code: "B0101", building_name: "副本A楼" },
      { id: "building-1", copy_id: 3, building_code: "B0101", building_name: "副本B楼" },
    ],
    floor_segments: [
      { id: "seg-1", copy_id: 2, building_code: "B0101", floor_code: "1", segment_code: "EW1", element_type: "corridor" },
      { id: "seg-1", copy_id: 3, building_code: "B0101", floor_code: "1", segment_code: "EW1", element_type: "corridor" },
    ],
    spaces: [
      { id: "space-1", copy_id: 2, space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "101", current_status: "active" },
      { id: "space-1", copy_id: 3, space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "101", current_status: "active" },
    ],
    labs: [
      { id: "lab-1", copy_id: 2, lab_code: "UNIT000001", lab_name: "副本A用途", college: "学院A", lab_type: "实验室" },
      { id: "lab-1", copy_id: 3, lab_code: "UNIT000001", lab_name: "副本B用途", college: "学院B", lab_type: "实验室" },
    ],
    plans: [
      { id: "copy-2", copy_id: 2, plan_code: "copy-2", plan_name: "副本A" },
      { id: "copy-3", copy_id: 3, plan_code: "copy-3", plan_name: "副本B" },
    ],
    plan_assignments: [],
  });

  assert.deepEqual(Array.from(dataset.spaces.map((space) => Number(space.copy_id)).sort()), [2, 3]);
  assert.equal(dataset.floor_segments.length, 2);
  assert.equal(dataset.labs.length, 2);
  assert.deepEqual(Array.from(PlanScope.filterRowsForPlan(dataset.spaces, dataset.plans[0]).map((space) => Number(space.copy_id))), [2]);
  assert.deepEqual(Array.from(PlanScope.filterRowsForPlan(dataset.spaces, dataset.plans[1]).map((space) => Number(space.copy_id))), [3]);
});

test("custom college colors drive room fills and legend swatches", () => {
  const { FloorplanRender } = loadBrowserModules();
  const floorplanEl = new StubElement();
  const badgeEl = new StubElement();
  const legendEl = new StubElement();
  const data = {
    buildings: [],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" }],
    spaces: [{ id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", offset_m: 0, side: "north", space_code: "101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, area_m2: 48, network_segment: "", current_status: "active" }],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "Lab A", college: "自定义学院", lab_type: "实验室" }],
    colleges: [{ college_code: "C001", college_name: "自定义学院", color: "#123abc", sort_order: 1 }],
    plan_assignments: [{ id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", assignment_status: "assigned" }],
  };
  const colors = FloorplanRender.colorMap(data);

  FloorplanRender.renderFloorplan({
    floorplanEl,
    activePlanBadgeEl: badgeEl,
    data,
    building: { building_code: "B0101", building_name: "测试楼" },
    floorCode: "1",
    activePlan: { id: "plan-1", plan_name: "基线" },
    colors,
    selectedSpaceId: "",
    collegeFilter: "全部学院",
    onSelectSpace() {},
  });
  FloorplanRender.renderLegend(legendEl, data, colors, "plan-1");

  assert.match(floorplanEl.innerHTML, /fill="#123abc"/);
  assert.match(legendEl.innerHTML, /background:#123abc/);
});

test("legend color module maps dictionary colors and renders muted legend state", () => {
  const legendEl = new StubElement();
  const data = {
    colleges: [{ college_code: "C001", college_name: "自定义学院", color: "#123ABC" }],
    labs: [{ id: "lab-1", lab_code: "LAB001", college: "自定义学院" }],
    plan_assignments: [{ id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", assignment_status: "assigned" }],
  };

  const colors = buildLegendColorMap(data);
  renderLegendOnly(legendEl, data, colors, "plan-1", new Set(["自定义学院"]));

  assert.equal(colors["自定义学院"], "#123abc");
  assert.match(legendEl.innerHTML, /legend-item is-muted/);
  assert.match(legendEl.innerHTML, /title="正常显示"/);
});

test("legend color map is stable for duplicate college dictionaries regardless of order", () => {
  const dataA = {
    colleges: [
      { college_code: "COL-A", college_name: "统一学院", color: "#111111", copy_id: 1 },
      { college_code: "COL-A", college_name: "统一学院", color: "#222222", copy_id: 2 },
      { college_code: "COL-B", college_name: "另一个学院", color: "#111111", copy_id: 1 },
    ],
    labs: [
      { id: "lab-a", lab_code: "LAB-A", college: "统一学院" },
      { id: "lab-b", lab_code: "LAB-B", college: "另一个学院" },
    ],
  };
  const dataB = { ...dataA, colleges: dataA.colleges.slice().reverse() };

  const colorsA = buildLegendColorMap(dataA);
  const colorsB = buildLegendColorMap(dataB);

  assert.equal(colorsA["统一学院"], colorsB["统一学院"]);
  assert.equal(colorsA["另一个学院"], colorsB["另一个学院"]);
  assert.notEqual(colorsA["统一学院"], colorsA["另一个学院"]);
});

test("legend-driven college highlight can mute a selected college", () => {
  const { FloorplanRender } = loadBrowserModules();
  const floorplanEl = new StubElement();
  const badgeEl = new StubElement();
  const legendEl = new StubElement();
  const data = {
    buildings: [],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" }],
    spaces: [{ id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", offset_m: 0, side: "north", space_code: "101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, area_m2: 48, network_segment: "", current_status: "active" }],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "Lab A", college: "自定义学院", lab_type: "实验室" }],
    colleges: [{ college_code: "C001", college_name: "自定义学院", color: "#123abc", sort_order: 1 }],
    plan_assignments: [{ id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", assignment_status: "assigned" }],
  };
  const colors = FloorplanRender.colorMap(data);

  FloorplanRender.renderFloorplan({
    floorplanEl,
    activePlanBadgeEl: badgeEl,
    data,
    building: { building_code: "B0101", building_name: "测试楼" },
    floorCode: "1",
    activePlan: { id: "plan-1", plan_name: "基线" },
    colors,
    selectedSpaceId: "",
    mutedColleges: new Set(["自定义学院"]),
    onSelectSpace() {},
  });
  FloorplanRender.renderLegend(legendEl, data, colors, "plan-1", new Set(["自定义学院"]));

  assert.match(floorplanEl.innerHTML, /is-muted/);
  assert.match(legendEl.innerHTML, /legend-item is-muted/);
  assert.match(legendEl.innerHTML, /data-college="自定义学院"/);
});

test("all-college legend control is a compact stateful color button", () => {
  const { FloorplanRender } = loadBrowserModules();
  const legendEl = new StubElement();
  const data = {
    labs: [
      { id: "lab-1", college: "学院A" },
      { id: "lab-2", college: "学院B" },
    ],
    plan_assignments: [
      { id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", assignment_status: "assigned" },
      { id: "assign-2", plan_id: "plan-1", lab_id: "lab-2", assignment_status: "assigned" },
    ],
  };

  FloorplanRender.renderLegend(legendEl, data, { 学院A: "#ef4444", 学院B: "#2563eb" }, "plan-1");

  assert.match(legendEl.innerHTML, /class="legend-toggle is-soft"/);
  assert.match(legendEl.innerHTML, /title="弱化显示"/);
  assert.match(legendEl.innerHTML, /conic-gradient/);
  assert.doesNotMatch(legendEl.innerHTML, />全部取消</);

  FloorplanRender.renderLegend(legendEl, data, { 学院A: "#ef4444", 学院B: "#2563eb" }, "plan-1", new Set(["学院A"]));

  assert.match(legendEl.innerHTML, /class="legend-toggle is-vivid"/);
  assert.match(legendEl.innerHTML, /title="正常显示"/);
});

test("plan diff summarizes college counts, areas, and moved labs", () => {
  const data = {
    spaces: [
      { id: "space-1", space_code: "S101", front_door: "101", floor_code: "1", area_m2: 40 },
      { id: "space-2", space_code: "S102", front_door: "102", floor_code: "1", area_m2: 60 },
    ],
    labs: [
      { id: "lab-1", lab_code: "LAB001", lab_name: "机器人实验室", college: "信息学院" },
      { id: "lab-2", lab_code: "LAB002", lab_name: "会计实验室", college: "商学院" },
    ],
    plan_assignments: [
      { id: "a1", plan_id: "before", lab_code: "LAB001", space_id: "space-1", assignment_status: "assigned" },
      { id: "a2", plan_id: "after", lab_code: "LAB001", space_id: "space-2", assignment_status: "assigned" },
      { id: "a3", plan_id: "after", lab_code: "LAB002", space_id: "space-1", assignment_status: "assigned" },
    ],
  };

  const diff = buildPlanDiff(data, { id: "before" }, { id: "after" }, {
    compare: (a, b) => String(a).localeCompare(String(b), "zh-CN", { numeric: true }),
    spaceDisplayName: (space) => space.front_door || space.space_code,
  });

  assert.deepEqual(diff.labChanges.map((row) => [row.type, row.labName, row.beforeText, row.afterText, row.areaDelta]), [
    ["空间变更", "机器人实验室", "101 · S101", "102 · S102", 20],
    ["新增落位", "会计实验室", "未落位", "101 · S101", 40],
  ]);
  assert.deepEqual(diff.collegeRows.map((row) => [row.college, row.beforeCount, row.afterCount, row.areaDelta]), [
    ["商学院", 0, 1, 40],
    ["信息学院", 1, 1, 20],
  ]);
  assert.equal(diff.totalAreaDelta, 60);
});

test("plan diff panel renders summary and second-level collapsible sections", () => {
  const panelEl = new StubElement();
  const diff = {
    labChanges: [{ type: "空间变更", labName: "机器人实验室", beforeText: "101 · S101", afterText: "102 · S102", areaDelta: 20 }],
    spaceChanges: [{ type: "新增落位", spaceText: "101 · S101", beforeLab: "未规划", afterLab: "会计实验室", areaDelta: 40 }],
    collegeRows: [{ college: "信息学院", beforeCount: 1, beforeArea: 40, afterCount: 1, afterArea: 60, countDelta: 0, areaDelta: 20 }],
    totalAreaDelta: 60,
  };

  renderPlanDiffPanel({
    panelEl,
    isCompare: true,
    beforePlan: { id: "before", plan_name: "左侧方案" },
    afterPlan: { id: "after", plan_name: "右侧方案" },
    diff,
    collapsed: { summaryCollapsed: false, labCollapsed: false, spaceCollapsed: false },
    onToggle() {},
  });

  assert.equal(panelEl.hidden, false);
  assert.match(panelEl.innerHTML, /方案差异对比/);
  assert.match(panelEl.innerHTML, /左侧方案 → 右侧方案/);
  assert.match(panelEl.innerHTML, /学院汇总/);
  assert.match(panelEl.innerHTML, /机器人实验室/);
  assert.match(panelEl.innerHTML, /会计实验室/);
  assert.match(panelEl.innerHTML, /data-plan-diff-toggle="labs"/);
  assert.match(panelEl.innerHTML, /data-plan-diff-toggle="spaces"/);
});

test("placement panel exposes a concise create action without the old dock copy", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const renderSource = fs.readFileSync(path.join(__dirname, "..", "js", "render.js"), "utf8");

  assert.match(indexSource, /id="newUnplacedLabModal"/);
  assert.match(indexSource, /id="newUnplacedLabNameInput"[\s\S]*required/);
  assert.match(renderSource, /data-action="create-unplaced-lab"/);
  assert.doesNotMatch(renderSource, /拖到未规划空间落位，也可以归位到原空间。/);
  assert.doesNotMatch(renderSource, />加入待安置区</);
});

test("plan option labels use short copy ids and allow duplicate names", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const plan = { id: "copy-3", plan_code: "copy-3", plan_name: "重复名称" };
  const copy = { id: 3, ownerUserId: 10, visibility: "public", isBaseline: false };
  const user = { id: 10, role: "editor" };

  assert.equal(PlanManagement.planOptionLabel(plan, copy, user), "我的 · 重复名称 · 公开3");
  assert.doesNotMatch(appSource, /function uniquePlanName/);
  assert.doesNotMatch(appSource, /公开副本/);
});

test("plan management helpers keep copy labels anonymous and enforce baseline permissions", () => {
  const plan = { id: "copy-7", plan_code: "copy-7", plan_name: "方案A" };
  const ownCopy = { id: 7, ownerUserId: 3, visibility: "public", isBaseline: false };
  const otherCopy = { id: 8, ownerUserId: 4, visibility: "private", isBaseline: false };
  const baselineCopy = { id: 9, ownerUserId: 3, visibility: "public", isBaseline: true };
  const editor = { id: 3, role: "editor" };
  const admin = { id: 1, role: "admin" };

  assert.equal(PlanManagement.copyIdFromPlan(plan), 7);
  assert.equal(PlanManagement.copyMetaForPlan(plan, [ownCopy]), ownCopy);
  assert.equal(PlanManagement.planOptionLabel(plan, ownCopy, editor), "我的 · 方案A · 公开7");
  assert.equal(PlanManagement.planOptionLabel({ ...plan, plan_code: "copy-8" }, otherCopy, editor), "方案A · 8");
  assert.equal(PlanManagement.planOptionLabel({ ...plan, is_locked: true }, baselineCopy, editor), "基线 · 方案A");
  assert.equal(PlanManagement.canManageCopy(ownCopy, editor, { canAdmin: false }), true);
  assert.equal(PlanManagement.canManageCopy(otherCopy, editor, { canAdmin: false }), false);
  assert.equal(PlanManagement.canManageCopy(baselineCopy, editor, { canAdmin: false }), false);
  assert.equal(PlanManagement.canManageCopy(baselineCopy, admin, { canAdmin: true }), true);
});

test("plan actions create, update visibility, and delete copies through stable endpoints", async () => {
  const calls = [];
  const state = { serverRevision: 1, planCopies: [], data: { plans: [] } };
  const normalizeDatasetForTest = (dataset) => ({ ...dataset, normalized: true });
  const fetchJson = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      revision: 2,
      planCopies: [{ id: 11, visibility: "private" }],
      dataset: { plans: [{ id: "copy-11", plan_code: "copy-11" }] },
      copyId: 11,
    };
  };

  const created = await PlanActions.createPlanCopy({
    fetchJson,
    state,
    normalizeDataset: normalizeDatasetForTest,
    sourcePlanCode: "baseline",
    planName: "新方案",
  });
  await PlanActions.updatePlanCopyVisibility({
    fetchJson,
    state,
    normalizeDataset: normalizeDatasetForTest,
    copyId: 11,
    visibility: "public",
  });
  await PlanActions.deletePlanCopy({
    fetchJson,
    state,
    normalizeDataset: normalizeDatasetForTest,
    copyId: 11,
  });

  assert.equal(created.copyId, 11);
  assert.deepEqual(calls.map((call) => [call.url, call.options.method]), [
    ["/api/plan-copies", "POST"],
    ["/api/plan-copies/11", "PATCH"],
    ["/api/plan-copies/11", "DELETE"],
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { sourcePlanCode: "baseline", planName: "新方案" });
  assert.deepEqual(JSON.parse(calls[1].options.body), { visibility: "public" });
  assert.equal(state.serverRevision, 2);
  assert.equal(state.data.normalized, true);
});

test("managed plans modal renders manageable plans and active/copy endpoints", () => {
  const plans = [
    {
      id: "active:PLAN001",
      kind: "active",
      planCode: "PLAN001",
      planName: "正式方案",
      isBaseline: true,
      isMine: true,
      isPublic: true,
      updatedAt: "2026-06-01T00:00:00Z",
    },
    {
      id: 5,
      kind: "copy",
      planName: "副本方案",
      sourceType: "import",
      isBaseline: false,
      isMine: false,
      ownerUsername: "editor1",
      isPublic: false,
      updatedAt: "2026-06-02T00:00:00Z",
    },
  ];
  const detail = {
    ...plans[1],
    revision: 4,
    dataset: {
      buildings: [{}],
      floor_segments: [{}, {}],
      spaces: [{}, {}, {}],
      labs: [{}],
      plan_assignments: [{}, {}],
    },
  };

  assert.equal(ManagedPlansModal.managedPlanSourceLabel(plans[0]), "正式数据方案");
  assert.equal(ManagedPlansModal.managedPlanSourceLabel(plans[1]), "admin 上传数据包");
  assert.equal(ManagedPlansModal.managedPlanEndpoint(plans[0], "/baseline"), "/api/manage/active-plans/PLAN001/baseline");
  assert.equal(ManagedPlansModal.managedPlanEndpoint(plans[1]), "/api/manage/plans/5");
  assert.match(ManagedPlansModal.renderManagedPlanListHtml({ plans, selectedId: 5 }), /data-import-draft-id="5"/);
  assert.match(ManagedPlansModal.renderManagedPlanListHtml({ plans, selectedId: 5 }), /import-draft-item is-active/);
  assert.match(ManagedPlansModal.renderManagedPlanDetailHtml({ detail }), /#5 副本方案/);
  assert.match(ManagedPlansModal.renderManagedPlanDetailHtml({ detail }), /用途单元/);
  assert.match(ManagedPlansModal.renderManagedPlanDetailHtml({ detail }), /id="importPreviewCanvas"/);
});

test("managed plan preview starts from a floor used by the selected plan", () => {
  const dataset = {
    buildings: [
      { building_code: "B0101", building_name: "空楼", sort_order: 1 },
      { building_code: "B0102", building_name: "有落位楼", sort_order: 2 },
    ],
    floor_segments: [
      { building_code: "B0101", floor_code: "1", segment_code: "A" },
      { building_code: "B0102", floor_code: "3", segment_code: "B" },
    ],
    spaces: [{ id: "space-3", space_code: "301", building_code: "B0102", floor_code: "3" }],
    plans: [{ id: "copy-9", plan_code: "copy-9", plan_name: "导入方案" }],
    plan_assignments: [{ plan_id: "legacy-plan-id", plan_code: "copy-9", space_id: "space-3", space_code: "301", assignment_status: "assigned" }],
  };

  assert.deepEqual(ManagedPlansModal.choosePreviewContext(dataset, { buildingCode: "", floorCode: "" }, "copy-9"), {
    buildingCode: "B0102",
    floorCode: "3",
  });
});

test("detail actions allow admin to delete spaces in non-baseline active plans", () => {
  assert.equal(DetailActions.canDeleteSpaceForActivePlan({
    serverMode: true,
    permissions: { canAdmin: true, canEdit: true },
    activePlan: { plan_type: "draft", is_locked: false },
    copy: null,
    canEditCopy: false,
  }), true);
});

test("detail actions allow admin to delete spaces in baseline plans", () => {
  assert.equal(DetailActions.canDeleteSpaceForActivePlan({
    serverMode: true,
    permissions: { canAdmin: true, canEdit: true },
    activePlan: { plan_type: "baseline", is_locked: true },
    copy: null,
    canEditCopy: false,
  }), true);
  assert.equal(DetailActions.canDeleteSpaceForActivePlan({
    serverMode: true,
    permissions: { canAdmin: true, canEdit: true },
    activePlan: { plan_type: "baseline", is_locked: true },
    copy: { id: 1, isBaseline: true },
    canEditCopy: true,
  }), true);
});

test("detail create room clears deleted space tombstones", () => {
  const dataset = {
    deleted_space_ids: ["space-old", "101", "copy:6::space-old", "copy:6::101", "copy:2::101", "space-other"],
  };

  DetailActions.clearDeletedSpaceRefs(dataset, { id: "space-new", space_code: "101" }, ["space-old"], 6);

  assert.deepEqual(dataset.deleted_space_ids, ["copy:2::101", "space-other"]);
});

test("managed plan baseline action can be toggled off by admin", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const routeSource = fs.readFileSync(path.join(__dirname, "..", "server", "routes.js"), "utf8");
  const serviceSource = fs.readFileSync(path.join(__dirname, "..", "server", "plan-copy-service.js"), "utf8");

  assert.match(appSource, /detail\?\.isBaseline \? "取消基线" : "设为基线"/);
  assert.match(appSource, /JSON\.stringify\(\{ isBaseline: nextBaseline \}\)/);
  assert.match(routeSource, /const isBaseline = body\.isBaseline !== false/);
  assert.match(serviceSource, /SET is_baseline = \?/);
  assert.match(serviceSource, /plan_type: baseline \? "baseline" : "copy"/);
  assert.match(serviceSource, /plan_type: baseline \? "baseline" : "draft"/);
});

test("copy-backed managed plan preview falls back to the source copy dataset", () => {
  const db = createPlanCopyTestDb();
  const sourceDataset = {
    buildings: [{ id: "B0101", building_code: "B0101", building_name: "来源楼" }],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW1" }],
    spaces: [{ id: "space-1", space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1" }],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "用途单元" }],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "来源方案", plan_type: "copy" }],
    plan_assignments: [{ id: "copy-1__LAB001", plan_code: "copy-1", plan_id: "copy-1", lab_code: "LAB001", lab_id: "lab-1", space_code: "101", space_id: "space-1", assignment_status: "assigned" }],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "来源方案",
    dataset: sourceDataset,
    assignments: sourceDataset.plan_assignments,
  });
  insertPlanCopyRow(db, {
    id: 3,
    planCode: "copy-3",
    planName: "复制方案",
    sourceCopyId: 1,
    dataset: null,
    plan: { id: "copy-3", plan_code: "copy-3", plan_name: "复制方案", plan_type: "copy", is_locked: false },
    assignments: [{ ...sourceDataset.plan_assignments[0], id: "copy-3__LAB001", plan_code: "copy-3", plan_id: "copy-3" }],
  });
  const service = createPlanCopyService(db, createDatasetServiceStub());

  const result = service.getManagedPlan(3, { id: 1, username: "admin", role: "admin" });

  assert.equal(result.dataset.floor_segments.length, 1);
  assert.equal(result.dataset.buildings.length, 1);
  assert.equal(result.dataset.plans[0].plan_code, "copy-3");
});

test("visible datasets keep college colors stable for visitor editor and admin", () => {
  const db = createPlanCopyTestDb();
  db.prepare("INSERT INTO users (id, username, role) VALUES (2, 'editor', 'editor')").run();
  const datasetService = createDatasetServiceStubWithNormalizer();
  datasetService.getActiveDataset().dataset = {
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
  const copyDataset = (copyId, color) => ({
    ...datasetService.getActiveDataset().dataset,
    colleges: [
      { id: "college-a", copy_id: copyId, college_code: "COL-A", college_name: "统一学院", color },
      { id: "college-b", copy_id: copyId, college_code: "COL-B", college_name: "另一个学院", color: "#111111" },
    ],
    plans: [{ id: `copy-${copyId}`, copy_id: copyId, plan_code: `copy-${copyId}`, plan_name: `副本${copyId}` }],
  });
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "公开基线",
    visibility: "public",
    isBaseline: true,
    dataset: copyDataset(1, "#111111"),
  });
  insertPlanCopyRow(db, {
    id: 2,
    planCode: "copy-2",
    planName: "公开副本",
    visibility: "public",
    dataset: copyDataset(2, "#222222"),
  });
  insertPlanCopyRow(db, {
    id: 8,
    ownerUserId: 2,
    planCode: "copy-8",
    planName: "编辑用户私有副本",
    dataset: copyDataset(8, "#333333"),
  });
  const service = createPlanCopyService(db, datasetService);
  const colorsFor = (user) => buildLegendColorMap(service.buildVisibleDataset(user).dataset);

  const visitorColors = colorsFor(null);
  const editorColors = colorsFor({ id: 2, username: "editor", role: "editor" });
  const adminColors = colorsFor({ id: 1, username: "admin", role: "admin" });

  assert.equal(visitorColors["统一学院"], editorColors["统一学院"]);
  assert.equal(visitorColors["统一学院"], adminColors["统一学院"]);
  assert.notEqual(visitorColors["统一学院"], visitorColors["另一个学院"]);
});

test("relational backfill stores shared reference rows once across plan copies", () => {
  const db = createPlanCopyTestDb();
  RelationalStore.ensureRelationalSchema(db);
  const datasetService = createDatasetServiceStubWithNormalizer();
  const copy1 = copiedReferenceDataset(1, { planCode: "copy-1" });
  const copy2 = copiedReferenceDataset(2, { planCode: "copy-2" });
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "方案1",
    visibility: "public",
    dataset: copy1,
    assignments: copy1.plan_assignments,
  });
  insertPlanCopyRow(db, {
    id: 2,
    planCode: "copy-2",
    planName: "方案2",
    visibility: "public",
    dataset: copy2,
    assignments: copy2.plan_assignments,
  });

  const service = createPlanCopyService(db, datasetService);
  const visible = service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" }).dataset;

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM buildings WHERE building_code = 'B0101'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM floor_segments WHERE building_code = 'B0101' AND floor_code = '1' AND segment_code = 'EW01010101'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM colleges WHERE college_code = 'COL-A'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plans WHERE plan_code IN ('copy-1', 'copy-2')").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plan_assignments").get().count, 2);
  assert.equal(visible.buildings.filter((row) => row.building_code === "B0101").length, 1);
});

test("admin visible dataset projects global buildings once even when copies carry duplicates", () => {
  const db = createPlanCopyTestDb();
  RelationalStore.ensureRelationalSchema(db);
  const datasetService = createDatasetServiceStubWithNormalizer();
  for (const copyId of [1, 2, 3]) {
    const dataset = copiedReferenceDataset(copyId, { planCode: `copy-${copyId}` });
    insertPlanCopyRow(db, {
      id: copyId,
      planCode: `copy-${copyId}`,
      planName: `方案${copyId}`,
      visibility: "public",
      dataset,
      assignments: dataset.plan_assignments,
    });
  }

  const service = createPlanCopyService(db, datasetService);
  const visible = service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" }).dataset;

  assert.deepEqual(visible.buildings.map((row) => row.building_code), ["B0101"]);
  assert.equal(visible.buildings[0].copy_id || "", "");
  assert.equal(visible.floor_segments.filter((row) => row.segment_code === "EW01010101").length, 1);
  assert.equal(visible.colleges.filter((row) => row.college_code === "COL-A").length, 1);
});

test("saving copy datasets synchronizes relational plan tables immediately", () => {
  const db = createPlanCopyTestDb();
  RelationalStore.ensureRelationalSchema(db);
  const datasetService = createDatasetServiceStubWithNormalizer();
  const originalDataset = copiedReferenceDataset(1, { planCode: "copy-1" });
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "方案1",
    visibility: "public",
    dataset: originalDataset,
    assignments: originalDataset.plan_assignments,
  });
  const nextDataset = copiedReferenceDataset(1, { planCode: "copy-1" });
  nextDataset.spaces[0] = { ...nextDataset.spaces[0], network_segment: "10.0.1.0/24" };
  nextDataset.plan_assignments[0] = { ...nextDataset.plan_assignments[0], effective_from: "2026-06" };
  const service = createPlanCopyService(db, datasetService);

  service.saveCopyDataset(1, { expectedRevision: 1, dataset: nextDataset }, { id: 1, username: "admin", role: "admin" });

  assert.equal(db.prepare("SELECT network_segment FROM spaces WHERE space_code = ?").get(nextDataset.spaces[0].space_code).network_segment, "10.0.1.0/24");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plan_space_overrides WHERE plan_id = 'copy-1'").get().count, 1);
  assert.equal(db.prepare("SELECT effective_from FROM plan_assignments WHERE plan_id = 'copy-1' AND lab_code = 'UNIT000001'").get().effective_from, "2026-06");
});

test("saving active datasets synchronizes global relational reference tables immediately", () => {
  const initial = createDatasetServiceStubWithNormalizer().getActiveDataset().dataset;
  const db = createActiveDatasetTestDb(initial);
  RelationalStore.ensureRelationalSchema(db);
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  const nextDataset = datasetService.normalizeIncomingDataset({
    ...initial,
    buildings: [{ id: "B0102", building_code: "B0102", building_name: "关系楼", campus_zone: "下沙校区", building_number: 2, sort_order: 3 }],
    floor_segments: [{ id: "B0102__1__EW01020101", building_code: "B0102", floor_code: "1", segment_code: "EW01020101", element_type: "corridor" }],
    colleges: [{ id: "COL-R", college_code: "COL-R", college_name: "关系学院", color: "#2563EB" }],
    majors: [{ id: "MAJ-R", major_code: "MAJ-R", major_name: "关系专业", college_code: "COL-R" }],
    lab_types: [{ id: "USE-R", type_code: "USE-R", type_name: "关系用途" }],
  });

  datasetService.saveActiveDataset(nextDataset, "admin", { expectedRevision: 1 });

  assert.equal(db.prepare("SELECT building_name FROM buildings WHERE building_code = 'B0102'").get().building_name, "关系楼");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM floor_segments WHERE building_code = 'B0102' AND segment_code = 'EW01020101'").get().count, 1);
  assert.equal(db.prepare("SELECT college_name FROM colleges WHERE college_code = 'COL-R'").get().college_name, "关系学院");
  assert.equal(db.prepare("SELECT major_name FROM majors WHERE major_code = 'MAJ-R'").get().major_name, "关系专业");
  assert.equal(db.prepare("SELECT type_name FROM lab_types WHERE type_code = 'USE-R'").get().type_name, "关系用途");
});

test("saving copy datasets removes stale relational deleted-space tombstones for the copy", () => {
  const db = createPlanCopyTestDb();
  RelationalStore.ensureRelationalSchema(db);
  const datasetService = createDatasetServiceStubWithNormalizer();
  const originalDataset = copiedReferenceDataset(1, { planCode: "copy-1" });
  originalDataset.deleted_space_ids = ["copy:1::00101010101"];
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "方案1",
    visibility: "public",
    dataset: originalDataset,
    assignments: originalDataset.plan_assignments,
  });
  const service = createPlanCopyService(db, datasetService);
  service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plan_deleted_spaces WHERE plan_id = 'copy-1'").get().count, 1);

  const nextDataset = copiedReferenceDataset(1, { planCode: "copy-1" });
  nextDataset.deleted_space_ids = [];
  service.saveCopyDataset(1, { expectedRevision: 1, dataset: nextDataset }, { id: 1, username: "admin", role: "admin" });

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plan_deleted_spaces WHERE plan_id = 'copy-1'").get().count, 0);
});

test("relational projection builds a complete frontend dataset without legacy dataset json", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  seedRelationalProjectionFixture(db);
  const projected = DatasetProjection.projectVisibleDataset(db, { id: 2, username: "editor", role: "editor" });

  assert.deepEqual(projected.buildings.map((row) => row.building_code), ["B0101"]);
  assert.deepEqual(projected.floor_segments.map((row) => row.segment_code), ["EW01010101"]);
  assert.deepEqual(projected.colleges.map((row) => row.college_name), ["关系学院"]);
  assert.deepEqual(projected.majors.map((row) => row.major_name), ["关系专业"]);
  assert.deepEqual(projected.lab_types.map((row) => row.type_name), ["实验室"]);
  assert.ok(projected.spaces.some((row) => row.space_code === "00101010101" && !row.copy_id));
  assert.ok(projected.spaces.some((row) => row.space_code === "00101010202" && Number(row.copy_id) === 8 && row.network_segment === "10.8.0.0/24"));
  assert.ok(projected.labs.some((row) => row.lab_code === "UNIT000001"));
  assert.ok(projected.plan_assignments.some((row) => row.plan_id === "copy-8" && row.space_code === "00101010202"));
  assert.deepEqual(projected.deleted_space_ids, ["copy:8::00101010101"]);
});

test("relational projection preserves visitor editor and admin plan visibility", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  seedRelationalProjectionFixture(db);

  const visitor = DatasetProjection.projectVisibleDataset(db, null);
  const editor = DatasetProjection.projectVisibleDataset(db, { id: 2, username: "editor", role: "editor" });
  const admin = DatasetProjection.projectVisibleDataset(db, { id: 1, username: "admin", role: "admin" });

  assert.deepEqual(visitor.plans.map((row) => row.plan_code).sort(), ["copy-1", "copy-2"]);
  assert.deepEqual(editor.plans.map((row) => row.plan_code).sort(), ["copy-1", "copy-2", "copy-8"]);
  assert.deepEqual(admin.plans.map((row) => row.plan_code).sort(), ["copy-1", "copy-2", "copy-8", "copy-9"]);
  assert.ok(editor.spaces.every((row) => !row.copy_id || [1, 2, 8].includes(Number(row.copy_id))));
  assert.equal(visitor.spaces.some((row) => Number(row.copy_id) === 8), false);
});

test("visible dataset read path uses relational projection when legacy json is empty", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  db.prepare("INSERT INTO users (id, username, role) VALUES (2, 'editor', 'editor')").run();
  seedRelationalProjectionFixture(db);
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  const service = createPlanCopyService(db, datasetService);

  const visible = service.buildVisibleDataset({ id: 2, username: "editor", role: "editor" }).dataset;

  assert.deepEqual(visible.plans.map((row) => row.plan_code).sort(), ["copy-1", "copy-2", "copy-8"]);
  assert.ok(visible.spaces.some((row) => row.space_code === "00101010202" && Number(row.copy_id) === 8));
  assert.ok(visible.plan_assignments.some((row) => row.plan_id === "copy-8" && row.space_code === "00101010202"));
  assert.deepEqual(visible.deleted_space_ids, ["copy:8::00101010101"]);
});

test("copy detail edit lab writes a plan lab override and returns projected data", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  seedRelationalProjectionFixture(db);
  insertPlanCopyRow(db, {
    id: 8,
    ownerUserId: 2,
    planCode: "copy-8",
    planName: "编辑私有副本",
    visibility: "private",
    dataset: null,
    assignments: [],
  });
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  const detailService = createDetailActionService(db, datasetService);

  const result = detailService.submitCopyDetailAction(8, {
    expectedRevision: 1,
    planCode: "copy-8",
    action: "editLab",
    selectedSpace: { space_code: "00101010202" },
    form: {
      labName: "关系实验室-副本编辑",
      college: "关系学院",
      major: "关系专业",
      director: "李四",
      seatCount: "42",
      computerCount: "21",
      renovationMonth: "2026-07",
    },
  }, { id: 2, username: "editor", role: "editor" });

  const override = db.prepare("SELECT payload_json FROM plan_lab_overrides WHERE plan_id = 'copy-8' AND lab_code = 'UNIT000001'").get();
  const payload = JSON.parse(override.payload_json);
  assert.equal(payload.lab_name, "关系实验室-副本编辑");
  assert.equal(Number(payload.copy_id), 8);
  assert.equal(db.prepare("SELECT lab_name FROM labs WHERE lab_code = 'UNIT000001'").get().lab_name, "关系实验室");
  assert.equal(db.prepare("SELECT effective_from FROM plan_assignments WHERE plan_id = 'copy-8' AND lab_code = 'UNIT000001'").get().effective_from, "2026-07-01");
  assert.equal(result.copyRevision, 2);
  assert.ok(result.dataset.labs.some((row) => Number(row.copy_id) === 8 && row.lab_name === "关系实验室-副本编辑"));
});

test("copy detail delete writes tombstones and invalidates only the current plan assignment", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  seedRelationalProjectionFixture(db);
  insertPlanCopyRow(db, {
    id: 8,
    ownerUserId: 2,
    planCode: "copy-8",
    planName: "编辑私有副本",
    visibility: "private",
    dataset: null,
    assignments: [],
  });
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  const detailService = createDetailActionService(db, datasetService);

  const result = detailService.submitCopyDetailAction(8, {
    expectedRevision: 1,
    planCode: "copy-8",
    action: "deleteSpace",
    selectedSpace: { space_code: "00101010202" },
    form: {},
  }, { id: 2, username: "editor", role: "editor" });

  const tombstones = db.prepare("SELECT space_code FROM plan_deleted_spaces WHERE plan_id = 'copy-8' ORDER BY space_code").all().map((row) => row.space_code);
  assert.ok(tombstones.includes("00101010202"));
  const assignment = db.prepare("SELECT assignment_status, space_code, previous_space_code FROM plan_assignments WHERE plan_id = 'copy-8' AND lab_code = 'UNIT000001'").get();
  assert.equal(assignment.assignment_status, "Invalid");
  assert.equal(assignment.space_code, "");
  assert.equal(assignment.previous_space_code, "00101010202");
  assert.equal(db.prepare("SELECT assignment_status FROM plan_assignments WHERE plan_id = 'copy-1' AND lab_code = 'UNIT000001'").get().assignment_status, "assigned");
  assert.ok(result.dataset.deleted_space_ids.includes("copy:8::00101010202"));
});

test("copy detail create room writes only a plan space override", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  seedRelationalProjectionFixture(db);
  insertPlanCopyRow(db, {
    id: 8,
    ownerUserId: 2,
    planCode: "copy-8",
    planName: "编辑私有副本",
    visibility: "private",
    dataset: null,
    assignments: [],
  });
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  const detailService = createDetailActionService(db, datasetService);

  const result = detailService.submitCopyDetailAction(8, {
    expectedRevision: 1,
    planCode: "copy-8",
    action: "createSpace",
    buildingCode: "B0101",
    floorCode: "1",
    selectedSpace: null,
    form: {
      frontDoor: "303",
      rearDoor: "",
      segmentCode: "EW01010101",
      side: "north",
      offsetM: "12",
      lengthM: "7",
      widthM: "5",
      areaM2: "",
      networkSegment: "10.8.3.0/24",
      currentStatus: "active",
    },
  }, { id: 2, username: "editor", role: "editor" });

  const override = db.prepare("SELECT payload_json FROM plan_space_overrides WHERE plan_id = 'copy-8' AND space_code = '00101010303'").get();
  const payload = JSON.parse(override.payload_json);
  assert.equal(Number(payload.copy_id), 8);
  assert.equal(payload.area_m2, 35);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE space_code = '00101010303'").get().count, 0);
  assert.ok(result.dataset.spaces.some((row) => Number(row.copy_id) === 8 && row.space_code === "00101010303"));
});

test("copy detail renovation invalidates the old assignment and binds a new copy-scoped lab", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  seedRelationalProjectionFixture(db);
  insertPlanCopyRow(db, {
    id: 8,
    ownerUserId: 2,
    planCode: "copy-8",
    planName: "编辑私有副本",
    visibility: "private",
    dataset: null,
    assignments: [],
  });
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  const detailService = createDetailActionService(db, datasetService);

  detailService.submitCopyDetailAction(8, {
    expectedRevision: 1,
    planCode: "copy-8",
    action: "renovateRoom",
    selectedSpace: { space_code: "00101010202" },
    form: {
      labName: "待改建房间",
      college: "关系学院",
      major: "关系专业",
      director: "王五",
      seatCount: "12",
      computerCount: "6",
      renovationMonth: "2026-08",
    },
  }, { id: 2, username: "editor", role: "editor" });

  const assignments = db.prepare("SELECT lab_code, space_code, previous_space_code, assignment_status, effective_from FROM plan_assignments WHERE plan_id = 'copy-8' ORDER BY lab_code").all();
  assert.deepEqual(assignments.map((row) => row.assignment_status).sort(), ["Invalid", "assigned"]);
  assert.ok(assignments.some((row) => row.lab_code === "UNIT000001" && row.assignment_status === "Invalid" && row.previous_space_code === "00101010202"));
  assert.ok(assignments.some((row) => row.lab_code === "UNIT000002" && row.assignment_status === "assigned" && row.space_code === "00101010202" && row.effective_from === "2026-08-01"));
  const override = JSON.parse(db.prepare("SELECT payload_json FROM plan_lab_overrides WHERE plan_id = 'copy-8' AND lab_code = 'UNIT000002'").get().payload_json);
  assert.equal(override.lab_name, "待改建房间");
  assert.equal(Number(override.copy_id), 8);
});

test("active detail edit space updates global spaces through the active revision path", () => {
  const initial = createDatasetServiceStubWithNormalizer().getActiveDataset().dataset;
  const activeDataset = {
    ...initial,
    buildings: [{ id: "B0101", building_code: "B0101", building_name: "基线楼", campus_zone: "下沙校区", building_number: 1 }],
    floor_segments: [{ id: "B0101__1__EW01010101", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", element_type: "corridor" }],
    spaces: [{ id: "SPACE-101", space_code: "00101010101", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, area_m2: 48, current_status: "active" }],
    labs: [],
    plans: [{ id: "PLAN001", plan_code: "PLAN001", plan_name: "基线", plan_type: "baseline" }],
    plan_assignments: [],
  };
  const db = createActiveDatasetTestDb(activeDataset);
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  datasetService.saveActiveDataset(datasetService.normalizeIncomingDataset(activeDataset), "system", { expectedRevision: 1 });
  const detailService = createDetailActionService(db, datasetService);

  const result = detailService.submitActiveDetailAction({
    expectedRevision: 2,
    planCode: "PLAN001",
    action: "editSpace",
    selectedSpace: { space_code: "00101010101" },
    form: {
      frontDoor: "104",
      rearDoor: "",
      segmentCode: "EW01010101",
      side: "south",
      offsetM: "2",
      lengthM: "9",
      widthM: "5",
      areaM2: "",
      networkSegment: "10.1.4.0/24",
      currentStatus: "active",
    },
  }, { id: 1, username: "admin", role: "admin" });

  assert.equal(result.revision, 3);
  assert.equal(db.prepare("SELECT network_segment FROM spaces WHERE space_code = '00101010404'").get().network_segment, "10.1.4.0/24");
  assert.ok(result.dataset.spaces.some((row) => row.space_code === "00101010404" && row.area_m2 === 45));
});

test("copy detail action revision conflicts do not write relation rows or legacy snapshots", () => {
  const db = createActiveDatasetTestDb(createDatasetServiceStubWithNormalizer().getActiveDataset().dataset);
  seedRelationalProjectionFixture(db);
  insertPlanCopyRow(db, {
    id: 8,
    ownerUserId: 2,
    planCode: "copy-8",
    planName: "编辑私有副本",
    visibility: "private",
    dataset: null,
    assignments: [],
  });
  const datasetService = createDatasetService(db, {
    root: __dirname,
    datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  }, { writeAudit() {} });
  const detailService = createDetailActionService(db, datasetService);

  assert.throws(() => detailService.submitCopyDetailAction(8, {
    expectedRevision: 0,
    planCode: "copy-8",
    action: "editSpace",
    selectedSpace: { space_code: "00101010202" },
    form: { frontDoor: "203", rearDoor: "", segmentCode: "EW01010101", side: "north", lengthM: "8", widthM: "6" },
  }, { id: 2, username: "editor", role: "editor" }), /当前方案已被更新/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plan_space_overrides WHERE plan_id = 'copy-8' AND space_code = '00101020303'").get().count, 0);
  assert.equal(db.prepare("SELECT dataset_json FROM plan_copies WHERE id = 8").get().dataset_json, null);
});

test("copy datasets do not reintroduce spaces marked deleted", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStub();
  datasetService.getActiveDataset().dataset = {
    buildings: [],
    floor_segments: [],
    spaces: [
      { id: "space-1", space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "101", rear_door: "", current_status: "active" },
      { id: "space-2", space_code: "102", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "102", rear_door: "", current_status: "active" },
    ],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "用途单元" }],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: "baseline", plan_code: "baseline", plan_name: "基线", plan_type: "baseline" }],
    plan_assignments: [],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "删除空间副本",
    assignments: [
      { id: "copy-1__LAB001", plan_code: "copy-1", plan_id: "copy-1", lab_code: "LAB001", lab_id: "lab-1", space_code: "101", space_id: "space-1", assignment_status: "assigned" },
    ],
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      deleted_space_ids: ["space-1", "101"],
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "删除空间副本", plan_type: "copy" }],
      plan_assignments: [
        { id: "copy-1__LAB001", plan_code: "copy-1", plan_id: "copy-1", lab_code: "LAB001", lab_id: "lab-1", space_code: "", space_id: "", previous_space_code: "101", assignment_status: "Invalid" },
      ],
    },
  });
  const service = createPlanCopyService(db, datasetService);

  const visible = service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" }).dataset;
  const copyPlan = visible.plans.find((plan) => plan.id === "copy-1");
  const copyData = PlanScope.datasetForPlan(visible, copyPlan);

  assert.deepEqual(copyData.spaces.map((space) => space.space_code), ["102"]);
  assert.equal(visible.plan_assignments[0].assignment_status, "Invalid");
  assert.equal(visible.plan_assignments[0].space_code, "");
});

test("copy tombstones do not hide another copy's newly added space", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStub();
  datasetService.getActiveDataset().dataset = {
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
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "新增空间副本",
    assignments: [],
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      buildings: [{ id: "b1", copy_id: 1, building_code: "B0109", building_name: "光大教学楼" }],
      floor_segments: [{ id: "seg-1", copy_id: 1, building_code: "B0109", floor_code: "1", segment_code: "EW1", element_type: "corridor" }],
      spaces: [{ id: "space-new", copy_id: 1, space_code: "00109010404", building_code: "B0109", floor_code: "1", segment_code: "EW1", front_door: "0404", rear_door: "0404", current_status: "active" }],
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "新增空间副本", plan_type: "copy" }],
      deleted_space_ids: [],
    },
  });
  insertPlanCopyRow(db, {
    id: 2,
    planCode: "copy-2",
    planName: "历史删除副本",
    assignments: [],
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      plans: [{ id: "copy-2", plan_code: "copy-2", plan_name: "历史删除副本", plan_type: "copy" }],
      deleted_space_ids: ["00109010404"],
    },
  });
  const service = createPlanCopyService(db, datasetService);

  const visible = service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" }).dataset;
  const copy1 = PlanScope.datasetForPlan(visible, visible.plans.find((plan) => plan.id === "copy-1"));
  const copy2 = PlanScope.datasetForPlan(visible, visible.plans.find((plan) => plan.id === "copy-2"));

  assert.ok(copy1.spaces.some((space) => space.id === "space-new" && space.space_code === "00109010404"));
  assert.equal(copy2.spaces.some((space) => space.space_code === "00109010404"), false);
});

test("saving copy datasets keeps only copy-scoped structural rows", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStub();
  datasetService.getActiveDataset().dataset = {
    buildings: [{ id: "B0101", building_code: "B0101", building_name: "基础楼" }],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW1" }],
    spaces: [
      { id: "space-1", space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "101", rear_door: "", current_status: "active" },
    ],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "基础用途单元" }],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: "baseline", plan_code: "baseline", plan_name: "基线", plan_type: "baseline" }],
    plan_assignments: [],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "新增空间副本",
    assignments: [],
    dataset: null,
  });
  const service = createPlanCopyService(db, datasetService);

  service.saveCopyDataset(1, {
    expectedRevision: 1,
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      spaces: [
        ...datasetService.getActiveDataset().dataset.spaces,
        { id: "space-copy", space_code: "103", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "103", rear_door: "", current_status: "active" },
      ],
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "新增空间副本", plan_type: "copy" }],
      plan_assignments: [],
    },
  }, { id: 1, username: "admin", role: "admin" });

  const saved = JSON.parse(db.prepare("SELECT dataset_json FROM plan_copies WHERE id = 1").get().dataset_json);
  assert.deepEqual(saved.spaces.map((space) => space.space_code), ["103"]);
  assert.equal(saved.spaces[0].copy_id, 1);

  const visible = service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" }).dataset;
  const copyPlan = visible.plans.find((plan) => plan.id === "copy-1");
  const basePlan = { id: "baseline", plan_code: "baseline" };

  assert.deepEqual(PlanScope.filterRowsForPlan(visible.spaces, copyPlan).map((space) => space.space_code).sort(), ["101", "103"]);
  assert.deepEqual(PlanScope.filterRowsForPlan(visible.spaces, basePlan).map((space) => space.space_code), ["101"]);
});

test("saving copy datasets scopes legacy deleted space refs to the owning copy", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStub();
  datasetService.getActiveDataset().dataset = {
    buildings: [{ id: "B0101", building_code: "B0101", building_name: "基础楼" }],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW1" }],
    spaces: [{ id: "space-1", space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "101", rear_door: "", current_status: "active" }],
    labs: [],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: "baseline", plan_code: "baseline", plan_name: "基线", plan_type: "baseline" }],
    plan_assignments: [],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "删除空间副本",
    assignments: [],
    dataset: null,
  });
  const service = createPlanCopyService(db, datasetService);

  service.saveCopyDataset(1, {
    expectedRevision: 1,
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "删除空间副本", plan_type: "copy" }],
      deleted_space_ids: ["space-1", "101", "copy:2::102"],
    },
  }, { id: 1, username: "admin", role: "admin" });

  const saved = JSON.parse(db.prepare("SELECT dataset_json FROM plan_copies WHERE id = 1").get().dataset_json);
  assert.deepEqual(saved.deleted_space_ids.sort(), ["copy:1::101", "copy:1::space-1"]);
});

test("visible copy datasets keep same-id structural rows per copy", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStubWithNormalizer();
  datasetService.getActiveDataset().dataset = {
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
  const copyDataset = (copyId, door) => ({
    buildings: [{ id: "B0101", building_code: "B0101", building_name: `副本${copyId}楼` }],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW1", element_type: "corridor" }],
    spaces: [{ id: "space-1", space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: door, rear_door: "", current_status: "active" }],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: `副本${copyId}用途` }],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: `copy-${copyId}`, plan_code: `copy-${copyId}`, plan_name: `副本${copyId}`, plan_type: "copy" }],
    plan_assignments: [],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  });
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "副本1",
    assignments: [],
    dataset: copyDataset(1, "101"),
  });
  insertPlanCopyRow(db, {
    id: 2,
    planCode: "copy-2",
    planName: "副本2",
    assignments: [],
    dataset: copyDataset(2, "102"),
  });
  const service = createPlanCopyService(db, datasetService);

  const visible = service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" }).dataset;

  assert.deepEqual(visible.floor_segments.map((row) => row.segment_code), ["EW1"]);
  assert.equal(visible.floor_segments[0].copy_id || "", "");
  assert.deepEqual(visible.spaces.map((row) => Number(row.copy_id)).sort(), [1, 2]);
  assert.deepEqual(visible.labs.map((row) => Number(row.copy_id)).sort(), [1, 2]);
});

test("saving copy assignments rewrites stale structural payload as copy scoped", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStub();
  datasetService.getActiveDataset().dataset = {
    buildings: [{ id: "B0101", building_code: "B0101", building_name: "基础楼" }],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW1" }],
    spaces: [
      { id: "space-1", space_code: "101", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "101", rear_door: "", current_status: "active" },
    ],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "基础用途单元" }],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: "baseline", plan_code: "baseline", plan_name: "基线", plan_type: "baseline" }],
    plan_assignments: [],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "旧 payload 副本",
    assignments: [],
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      spaces: [
        ...datasetService.getActiveDataset().dataset.spaces,
        { id: "space-copy", space_code: "103", building_code: "B0101", floor_code: "1", segment_code: "EW1", front_door: "103", rear_door: "", current_status: "active" },
      ],
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "旧 payload 副本", plan_type: "copy" }],
      plan_assignments: [],
    },
  });
  const service = createPlanCopyService(db, datasetService);

  service.saveAssignments(1, {
    expectedRevision: 1,
    assignments: [{ id: "copy-1__LAB001", plan_code: "copy-1", plan_id: "copy-1", lab_code: "LAB001", lab_id: "lab-1", space_code: "103", space_id: "space-copy", assignment_status: "assigned" }],
  }, { id: 1, username: "admin", role: "admin" });

  const saved = JSON.parse(db.prepare("SELECT dataset_json FROM plan_copies WHERE id = 1").get().dataset_json);
  assert.deepEqual(saved.spaces.map((space) => space.space_code), ["103"]);
  assert.equal(saved.spaces[0].copy_id, 1);
});

test("copy dataset save keeps newly added spaces readable only in the owning copy", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStubWithNormalizer();
  datasetService.getActiveDataset().dataset = {
    buildings: [{ id: "building-base", building_code: "B0101", building_name: "基线楼" }],
    floor_segments: [{ id: "seg-base", building_code: "B0101", floor_code: "1", segment_code: "EW1", element_type: "corridor" }],
    spaces: [],
    labs: [],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: "PLAN001", plan_code: "PLAN001", plan_name: "基线" }],
    plan_assignments: [],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "副本A",
    assignments: [],
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "副本A", copy_id: 1 }],
    },
  });
  insertPlanCopyRow(db, {
    id: 2,
    planCode: "copy-2",
    planName: "副本B",
    assignments: [],
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      plans: [{ id: "copy-2", plan_code: "copy-2", plan_name: "副本B", copy_id: 2 }],
    },
  });
  const service = createPlanCopyService(db, datasetService);

  service.saveCopyDataset(1, {
    expectedRevision: 1,
    dataset: {
      ...datasetService.getActiveDataset().dataset,
      buildings: [
        ...datasetService.getActiveDataset().dataset.buildings,
        { id: "building-base", copy_id: 1, building_code: "B0101", building_name: "副本A楼" },
      ],
      floor_segments: [
        ...datasetService.getActiveDataset().dataset.floor_segments,
        { id: "seg-base", copy_id: 1, building_code: "B0101", floor_code: "4", segment_code: "EW4", element_type: "corridor" },
      ],
      spaces: [
        { id: "space-new", copy_id: 1, space_code: "00101049898", building_code: "B0101", floor_code: "4", segment_code: "EW4", front_door: "9898", rear_door: "9898", current_status: "active" },
      ],
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "副本A", copy_id: 1 }],
      plan_assignments: [],
    },
  }, { id: 1, username: "admin", role: "admin" });

  const visible = service.buildVisibleDataset({ id: 1, username: "admin", role: "admin" }).dataset;
  const copy1 = PlanScope.datasetForPlan(visible, visible.plans.find((plan) => plan.id === "copy-1"));
  const copy2 = PlanScope.datasetForPlan(visible, visible.plans.find((plan) => plan.id === "copy-2"));

  assert.ok(copy1.spaces.some((space) => space.id === "space-new" && Number(space.copy_id) === 1));
  assert.equal(copy2.spaces.some((space) => space.id === "space-new"), false);
});

test("managed plan baseline service persists cancellation", () => {
  const db = createPlanCopyTestDb();
  insertPlanCopyRow(db, {
    id: 1,
    planCode: "copy-1",
    planName: "基线方案",
    isBaseline: 1,
    plan: { id: "copy-1", plan_code: "copy-1", plan_name: "基线方案", plan_type: "baseline", is_locked: true },
    assignments: [],
    dataset: {
      buildings: [],
      floor_segments: [],
      spaces: [],
      labs: [],
      colleges: [],
      majors: [],
      lab_types: [],
      plans: [{ id: "copy-1", plan_code: "copy-1", plan_name: "基线方案", plan_type: "baseline", is_locked: true }],
      plan_assignments: [],
      file_assets: [],
      imports: [],
      deleted_space_ids: [],
    },
  });
  const service = createPlanCopyService(db, createDatasetServiceStub());

  service.setManagedPlanBaseline(1, { id: 1, username: "admin", role: "admin" }, false);
  const row = db.prepare("SELECT is_baseline, baselined_at, baselined_by, plan_json, dataset_json FROM plan_copies WHERE id = 1").get();
  const plan = JSON.parse(row.plan_json);
  const dataset = JSON.parse(row.dataset_json);

  assert.equal(row.is_baseline, 0);
  assert.equal(row.baselined_at, null);
  assert.equal(row.baselined_by, null);
  assert.equal(plan.plan_type, "copy");
  assert.equal(plan.is_locked, false);
  assert.equal(dataset.plans[0].plan_type, "copy");
  assert.equal(dataset.plans[0].is_locked, false);
});

test("active managed plan baseline service persists cancellation", () => {
  const db = createPlanCopyTestDb();
  const datasetService = createDatasetServiceStub();
  datasetService.getActiveDataset().dataset = {
    buildings: [],
    floor_segments: [],
    spaces: [],
    labs: [],
    colleges: [],
    majors: [],
    lab_types: [],
    plans: [{ id: "PLAN001", plan_code: "PLAN001", plan_name: "正式基线", plan_type: "baseline", is_locked: true }],
    plan_assignments: [],
    file_assets: [],
    imports: [],
    deleted_space_ids: [],
  };
  const service = createPlanCopyService(db, datasetService);

  service.setActiveManagedPlanBaseline("PLAN001", { id: 1, username: "admin", role: "admin" }, false);
  const plan = datasetService.getActiveDataset().dataset.plans[0];

  assert.equal(plan.plan_type, "draft");
  assert.equal(plan.is_locked, false);
  assert.equal(plan.is_default_compare_before, false);
});

test("admin college editor exposes a visual color input", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "js", "app", "raw-editor.js"), "utf8");

  assert.match(appSource, /picker\.type = "color"/);
  assert.match(appSource, /picker\.dataset\.key = "color"/);
});

test("elevator structures render as box elevator cars", () => {
  const { FloorplanRender } = loadBrowserModules();
  const floorplanEl = new StubElement();
  const badgeEl = new StubElement();
  const data = {
    buildings: [],
    floor_segments: [
      { id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" },
      { id: "elevator-1", building_code: "B0101", floor_code: "1", segment_code: "ST01010101", start_x_m: 4, start_y_m: 0, end_x_m: 4, end_y_m: 4, width_m: 3, element_type: "elevator" },
    ],
    spaces: [],
    labs: [],
    plan_assignments: [],
  };

  FloorplanRender.renderFloorplan({
    floorplanEl,
    activePlanBadgeEl: badgeEl,
    data,
    building: { building_code: "B0101", building_name: "测试楼" },
    floorCode: "1",
    activePlan: { id: "plan-1", plan_name: "基线" },
    colors: {},
    selectedSpaceId: "",
    collegeFilter: "全部学院",
    onSelectSpace() {},
  });

  const elevatorMarkup = floorplanEl.innerHTML.match(/<g class="structure-elevator"[\s\S]*?<\/g>/)?.[0] || "";

  assert.match(elevatorMarkup, /elevator-door/);
  assert.doesNotMatch(elevatorMarkup, /<path/);
});

test("thumbnail previews fit without an internal scroll container", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const thumbRule = css.match(/\.thumb-preview\s*\{(?<body>[^}]+)\}/);

  assert.ok(thumbRule, "expected .thumb-preview CSS rule");
  assert.doesNotMatch(thumbRule.groups.body, /overflow\s*:\s*auto/);
  assert.match(thumbRule.groups.body, /overflow\s*:\s*hidden/);
  assert.match(thumbRule.groups.body, /aspect-ratio\s*:/);
});

test("medium viewport stacks compare plans while floor thumbnails scroll horizontally", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

  assert.match(css, /@media \(min-width: 1121px\) and \(max-width: 1360px\)\s*\{[\s\S]*?\.compare-columns\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(min-width: 1121px\) and \(max-width: 1360px\)\s*\{[\s\S]*?\.compare-column\s*\{[\s\S]*?grid-template-columns:\s*minmax\(220px,\s*280px\) minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(min-width: 1121px\) and \(max-width: 1360px\)\s*\{[\s\S]*?\.floor-thumbs\s*\{[\s\S]*?grid-auto-flow:\s*column/);
  assert.match(css, /@media \(min-width: 1121px\) and \(max-width: 1360px\)\s*\{[\s\S]*?\.floor-thumbs\s*\{[\s\S]*?overflow-x:\s*auto/);
});

test("data editor no longer exposes the business edit tab or script", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const rawEditorSource = fs.readFileSync(path.join(__dirname, "..", "js", "app", "raw-editor.js"), "utf8");

  assert.doesNotMatch(html, /business-edit\.js/);
  assert.doesNotMatch(appSource, />业务编辑</);
  assert.doesNotMatch(appSource, /editorMode:\s*"business"/);
  assert.doesNotMatch(rawEditorSource, /state\.editorMode === "business"/);
  assert.match(rawEditorSource, /els\.addRowBtn\.textContent = "新增行"/);
  assert.match(rawEditorSource, /els\.applyTableBtn\.textContent = "应用修改"/);
  assert.match(rawEditorSource, /els\.downloadSheetBtn\.hidden = false/);
});

test("detail more panel closes from outside click and escape", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

  assert.match(appSource, /document\.addEventListener\("click",\s*handleDocumentClick/);
  assert.match(appSource, /document\.addEventListener\("keydown",\s*handleDocumentKeydown/);
  assert.match(appSource, /closest\("\.detail-more-wrap"\)/);
  assert.match(appSource, /state\.detailEditor\.moreOpen = false/);
  assert.match(appSource, /event\.key === "Escape"/);
});

test("detail actions submit through action endpoints instead of full dataset save", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

  assert.match(appSource, /submitDetailActionToServer/);
  assert.match(appSource, /\/detail-actions/);
  assert.doesNotMatch(appSource, /await saveDatasetToServer\(changeNote\);\s*\n\s*}\s*catch \(error\) \{\s*\n\s*state\.data = normalizeDataset\(previousData\);/);
});

test("admin details render inline edit actions and disabled split merge menu", () => {
  const { FloorplanRender } = loadBrowserModules();
  const detailsEl = new StubElement();
  const context = {
    building: { building_code: "B0101", building_name: "测试楼" },
    activePlan: { id: "plan-1", plan_code: "PLAN001", plan_name: "基线" },
    space: { id: "space-1", building_code: "B0101", floor_code: "1", space_code: "00101010101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, area_m2: 48, network_segment: "10.0.0.0/24", current_status: "active" },
    lab: { id: "lab-1", lab_code: "UNIT000001", lab_name: "网络实验室", college: "信息学院", major: "软件工程", director: "张三", seat_count: 40, computer_count: 40 },
    assignment: { id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", assignment_status: "assigned", effective_from: "2026-05-01" },
  };

  FloorplanRender.renderDetailsPanel({
    detailsEl,
    context,
    mode: "view",
    canEdit: true,
    canAdmin: true,
    detailsEdit: { mode: "view", moreOpen: true, errors: {} },
    moveBasket: { items: [] },
  });

  assert.match(detailsEl.innerHTML, /data-detail-action="edit-lab"/);
  assert.match(detailsEl.innerHTML, /data-detail-action="renovate-room"/);
  assert.match(detailsEl.innerHTML, /data-detail-action="create-space"[^>]*>新增房间</);
  assert.match(detailsEl.innerHTML, /data-detail-action="edit-space"/);
  assert.match(detailsEl.innerHTML, /data-detail-action="delete-space"[^>]*>删除房间</);
  assert.match(detailsEl.innerHTML, /data-detail-action="merge-space"[^>]*disabled/);
  assert.match(detailsEl.innerHTML, /data-detail-action="split-space"[^>]*disabled/);
  assert.match(detailsEl.innerHTML, /暂未开放/);
  assert.ok(
    detailsEl.innerHTML.indexOf("details-card details-card-compact") < detailsEl.innerHTML.indexOf("detail-admin-actions"),
    "detail actions should render below the details card"
  );
  const scrollStart = detailsEl.innerHTML.indexOf('<div class="details-scroll">');
  const scrollEnd = detailsEl.innerHTML.indexOf('<div class="detail-action-region">');
  assert.ok(scrollStart >= 0 && scrollEnd > scrollStart, "expected detail action region after details scroll");
  const scrollHtml = detailsEl.innerHTML.slice(scrollStart, scrollEnd);
  assert.doesNotMatch(scrollHtml, /detail-admin-actions/);
  assert.match(detailsEl.innerHTML, /class="detail-more-panel"/);
  assert.doesNotMatch(detailsEl.innerHTML, /class="detail-more-menu"/);

  FloorplanRender.renderDetailsPanel({
    detailsEl,
    context,
    mode: "view",
    canEdit: true,
    canAdmin: false,
    canEditDetails: false,
    detailsEdit: { mode: "view", moreOpen: true, errors: {} },
    moveBasket: { items: [] },
  });

  assert.doesNotMatch(detailsEl.innerHTML, /data-detail-action="edit-lab"/);
  assert.doesNotMatch(detailsEl.innerHTML, /data-detail-action="edit-space"/);
});

test("editor-owned editable plan renders detail actions without admin role", () => {
  const { FloorplanRender } = loadBrowserModules();
  const detailsEl = new StubElement();
  const context = {
    building: { building_code: "B0101", building_name: "测试楼" },
    activePlan: { id: "copy-1", plan_code: "copy-1", plan_name: "我的方案" },
    space: { id: "space-1", building_code: "B0101", floor_code: "1", space_code: "00101010101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, area_m2: 48, network_segment: "", current_status: "active" },
    lab: { id: "lab-1", lab_code: "UNIT000001", lab_name: "网络实验室", college: "信息学院", seat_count: 40, computer_count: 40 },
    assignment: { id: "assign-1", plan_id: "copy-1", lab_id: "lab-1", space_id: "space-1", assignment_status: "assigned" },
  };

  FloorplanRender.renderDetailsPanel({
    detailsEl,
    context,
    mode: "view",
    canEdit: true,
    canAdmin: false,
    canEditDetails: true,
    detailsEdit: { mode: "view", moreOpen: false, errors: {} },
    moveBasket: { items: [] },
  });

  assert.match(detailsEl.innerHTML, /data-detail-action="edit-lab"/);
  assert.match(detailsEl.innerHTML, /data-detail-action="renovate-room"/);
  assert.match(detailsEl.innerHTML, /data-detail-action="create-space"[^>]*>新增房间</);
});

test("empty details panel only exposes create room when editable", () => {
  const { FloorplanRender } = loadBrowserModules();
  const detailsEl = new StubElement();
  const context = {
    building: { building_code: "B0101", building_name: "测试楼" },
    activePlan: { id: "copy-1", plan_code: "copy-1", plan_name: "我的方案" },
    space: null,
    lab: null,
    assignment: null,
  };

  FloorplanRender.renderDetailsPanel({
    detailsEl,
    context,
    mode: "view",
    canEdit: true,
    canEditDetails: true,
    detailsEdit: { mode: "view", moreOpen: false, errors: {} },
    moveBasket: { items: [] },
  });

  assert.match(detailsEl.innerHTML, /data-detail-action="create-space"[^>]*>新增房间</);
  assert.doesNotMatch(detailsEl.innerHTML, /data-detail-action="edit-lab"/);
  assert.doesNotMatch(detailsEl.innerHTML, /data-detail-action="renovate-room"/);
  assert.doesNotMatch(detailsEl.innerHTML, /data-detail-action="toggle-more"/);
});

test("admin details render lab and room edit forms inline", () => {
  const { FloorplanRender } = loadBrowserModules();
  const detailsEl = new StubElement();
  const context = {
    building: { building_code: "B0101", building_name: "测试楼" },
    space: { id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", space_code: "00101010101", front_door: "101", rear_door: "", side: "north", offset_m: 0, length_m: 8, width_m: 6, area_m2: 48, network_segment: "10.0.0.0/24", current_status: "active" },
    lab: { id: "lab-1", lab_code: "UNIT000001", lab_name: "网络实验室", college: "信息学院", major: "软件工程", director: "张三", seat_count: 40, computer_count: 40 },
    assignment: { id: "assign-1", effective_from: "2026-05-01" },
  };

  FloorplanRender.renderDetailsPanel({
    detailsEl,
    context,
    mode: "view",
    canEdit: true,
    canAdmin: true,
    detailsEdit: { mode: "editLab", moreOpen: false, errors: {} },
    detailEditOptions: {
      renovationMonth: "2026-05",
      collegeOptions: [
        { value: "信息学院", label: "信息学院" },
        { value: "计算机学院", label: "计算机学院" },
      ],
      majorOptionsByCollege: {
        信息学院: ["软件工程", "网络工程"],
        计算机学院: ["人工智能"],
      },
    },
    moveBasket: { items: [] },
  });

  assert.match(detailsEl.innerHTML, /id="detailEditLabForm"/);
  assert.match(detailsEl.innerHTML, /当前房间/);
  assert.match(detailsEl.innerHTML, /101/);
  assert.match(detailsEl.innerHTML, /00101010101/);
  assert.match(detailsEl.innerHTML, /name="labName"/);
  assert.match(detailsEl.innerHTML, /<select name="college"/);
  assert.match(detailsEl.innerHTML, /<select name="major"/);
  assert.doesNotMatch(detailsEl.innerHTML, /<input name="major"/);
  assert.match(detailsEl.innerHTML, /<option value="软件工程" selected>软件工程<\/option>/);
  assert.doesNotMatch(detailsEl.innerHTML, /<option value="人工智能"/);
  assert.match(detailsEl.innerHTML, /name="renovationMonth"/);
  assert.match(detailsEl.innerHTML, /value="2026-05"/);

  FloorplanRender.renderDetailsPanel({
    detailsEl,
    context,
    mode: "view",
    canEdit: true,
    canAdmin: true,
    detailsEdit: { mode: "editSpace", moreOpen: false, errors: {} },
    detailEditOptions: {
      segmentOptions: [{ value: "EW01010101", label: "一层东走廊", selected: true }],
      spaceCodePreview: "00101010101",
    },
    moveBasket: { items: [] },
  });

  assert.match(detailsEl.innerHTML, /id="detailEditSpaceForm"/);
  assert.match(detailsEl.innerHTML, /name="frontDoor"/);
  assert.match(detailsEl.innerHTML, /name="areaM2"/);
  assert.match(detailsEl.innerHTML, /空间编码预览/);

  FloorplanRender.renderDetailsPanel({
    detailsEl,
    context: { ...context, space: null, lab: null, assignment: null },
    mode: "view",
    canEdit: true,
    canEditDetails: true,
    detailsEdit: { mode: "createSpace", moreOpen: false, errors: {} },
    detailEditOptions: {
      createSpaceDraft: { building_code: "B0101", floor_code: "1", segment_code: "EW01010101", front_door: "", rear_door: "", side: "south", offset_m: 0, length_m: 8, width_m: 6, area_m2: 48, network_segment: "", current_status: "active" },
      segmentOptions: [{ value: "EW01010101", label: "一层东走廊", selected: true }],
      spaceCodePreview: "填写门牌后生成",
    },
    moveBasket: { items: [] },
  });

  assert.match(detailsEl.innerHTML, /id="detailCreateSpaceForm"/);
  assert.match(detailsEl.innerHTML, /新增房间/);
  assert.match(detailsEl.innerHTML, /name="frontDoor"/);
});

test("detail lab edit updates lab fields and assignment renovation month", () => {
  const dataset = {
    labs: [{ id: "lab-1", lab_code: "UNIT000001", lab_name: "旧实验室", college: "信息学院", major: "", director: "", seat_count: 20, computer_count: 10 }],
    spaces: [{ id: "space-1", space_code: "00101010101" }],
    plans: [{ id: "plan-1", plan_code: "PLAN001" }],
    plan_assignments: [{ id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", lab_code: "UNIT000001", space_code: "00101010101", assignment_status: "assigned", effective_from: "" }],
  };

  const result = DetailActions.applyDetailLabEdit(dataset, {
    lab: dataset.labs[0],
    assignment: dataset.plan_assignments[0],
  }, {
    labName: "新实验室",
    college: "计算机学院",
    major: "软件工程",
    director: "李四",
    seatCount: "42",
    computerCount: "40",
    renovationMonth: "2026-06",
  }, {
    normalizeLab: (row) => row,
    normalizeAssignment: (row) => row,
  });

  assert.equal(result.ok, true);
  assert.equal(dataset.labs[0].lab_name, "新实验室");
  assert.equal(dataset.labs[0].college, "计算机学院");
  assert.equal(dataset.labs[0].seat_count, 42);
  assert.equal(dataset.plan_assignments[0].effective_from, "2026-06-01");
});

test("detail lab edit targets the active copy when duplicate lab ids exist", () => {
  const dataset = {
    labs: [
      { id: "lab-1", copy_id: 3, lab_code: "UNIT000001", lab_name: "其他副本实验室", college: "信息学院", major: "", director: "旧负责人-3", seat_count: 20, computer_count: 10 },
      { id: "lab-1", copy_id: 6, lab_code: "UNIT000001", lab_name: "当前副本实验室", college: "信息学院", major: "", director: "旧负责人-6", seat_count: 20, computer_count: 10 },
    ],
    spaces: [],
    plans: [{ id: "copy-6", plan_code: "copy-6", copy_id: 6 }],
    plan_assignments: [{ id: "assign-1", plan_id: "copy-6", lab_id: "lab-1", lab_code: "UNIT000001", assignment_status: "assigned", effective_from: "" }],
  };

  const result = DetailActions.applyDetailLabEdit(dataset, {
    activePlan: dataset.plans[0],
    lab: dataset.labs[1],
    assignment: dataset.plan_assignments[0],
  }, {
    labName: "当前副本实验室",
    college: "信息学院",
    major: "",
    director: "新负责人",
    seatCount: "25",
    computerCount: "22",
    renovationMonth: "2026-06",
  }, {
    copyScope: { copy_id: 6 },
    normalizeLab: (row) => row,
    normalizeAssignment: (row) => row,
  });

  assert.equal(result.ok, true);
  assert.equal(dataset.labs[0].director, "旧负责人-3");
  assert.equal(dataset.labs[0].seat_count, 20);
  assert.equal(dataset.labs[1].director, "新负责人");
  assert.equal(dataset.labs[1].seat_count, 25);
  assert.equal(dataset.plan_assignments[0].effective_from, "2026-06-01");
});

test("detail delete room removes the selected space for the active plan and invalidates assignments", () => {
  const dataset = {
    spaces: [
      { id: "space-1", space_code: "00101010101", front_door: "101" },
      { id: "space-2", space_code: "00101010102", front_door: "102" },
    ],
    labs: [{ id: "lab-1", lab_code: "UNIT000001", lab_name: "网络实验室" }],
    plans: [
      { id: "plan-1", plan_code: "PLAN001" },
      { id: "plan-2", plan_code: "PLAN002" },
    ],
    plan_assignments: [
      { id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", lab_code: "UNIT000001", space_code: "00101010101", assignment_status: "assigned" },
      { id: "assign-2", plan_id: "plan-2", lab_id: "lab-1", space_id: "space-1", lab_code: "UNIT000001", space_code: "00101010101", assignment_status: "assigned" },
    ],
    deleted_space_ids: [],
  };

  const result = DetailActions.applyDetailDeleteSpace(dataset, {
    activePlan: dataset.plans[0],
    space: dataset.spaces[0],
  }, {
    copyScope: { copy_id: 8 },
    normalizeAssignment: (row) => row,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(dataset.spaces.map((row) => row.id), ["space-2"]);
  assert.deepEqual(dataset.deleted_space_ids.sort(), ["copy:8::00101010101", "copy:8::space-1"]);
  assert.equal(dataset.plan_assignments[0].assignment_status, "Invalid");
  assert.equal(dataset.plan_assignments[0].previous_space_code, "00101010101");
  assert.equal(dataset.plan_assignments[0].space_code, "");
  assert.equal(dataset.plan_assignments[1].assignment_status, "assigned");
  assert.equal(dataset.labs.length, 1);
});

test("detail space edit targets the active copy when duplicate space ids exist", () => {
  const dataset = {
    spaces: [
      { id: "space-1", copy_id: 3, space_code: "00101010101", building_code: "B0101", floor_code: "1", front_door: "101", rear_door: "", segment_code: "EW1", side: "north", offset_m: 0, length_m: 8, width_m: 6, area_m2: 48, network_segment: "old-3", current_status: "active" },
      { id: "space-1", copy_id: 6, space_code: "00101010101", building_code: "B0101", floor_code: "1", front_door: "101", rear_door: "", segment_code: "EW1", side: "north", offset_m: 0, length_m: 8, width_m: 6, area_m2: 48, network_segment: "old-6", current_status: "active" },
    ],
    plans: [{ id: "copy-6", plan_code: "copy-6", copy_id: 6 }],
    plan_assignments: [{ id: "assign-1", plan_id: "copy-6", space_id: "space-1", space_code: "00101010101", assignment_status: "assigned" }],
  };

  const result = DetailActions.applyDetailSpaceEdit(dataset, {
    activePlan: dataset.plans[0],
    building: { building_code: "B0101" },
    space: dataset.spaces[1],
  }, {
    frontDoor: "101",
    rearDoor: "",
    segmentCode: "EW1",
    side: "north",
    offsetM: "0",
    lengthM: "8",
    widthM: "6",
    areaM2: "48",
    networkSegment: "new-6",
    currentStatus: "active",
  }, {
    copyScope: { copy_id: 6 },
    generateSpaceCode: () => "00101010101",
    normalizeSpace: (row) => row,
    normalizeAssignment: (row) => row,
  });

  assert.equal(result.ok, true);
  assert.equal(dataset.spaces[0].network_segment, "old-3");
  assert.equal(dataset.spaces[1].network_segment, "new-6");
});

test("detail renovation invalidates old assignment and binds a new lab to the room", () => {
  const dataset = {
    labs: [{ id: "lab-1", lab_code: "UNIT000001", lab_name: "旧实验室", college: "信息学院", seat_count: 20, computer_count: 10 }],
    spaces: [{ id: "space-1", space_code: "00101010101", front_door: "101" }],
    plans: [{ id: "plan-1", plan_code: "PLAN001" }],
    plan_assignments: [{ id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", lab_code: "UNIT000001", space_code: "00101010101", assignment_status: "assigned", effective_from: "2025-01-01" }],
  };

  const result = DetailActions.applyDetailRenovation(dataset, {
    activePlan: dataset.plans[0],
    lab: dataset.labs[0],
    space: dataset.spaces[0],
    assignment: dataset.plan_assignments[0],
  }, {
    labName: "",
    college: "",
    major: "",
    director: "",
    seatCount: "",
    computerCount: "",
    renovationMonth: "",
  }, {
    isoNow: () => "2026-06-29T08:00:00Z",
    generateUnitCode: () => "UNIT000002",
    normalizeLab: (row) => ({ id: row.id || row.lab_code, ...row }),
    normalizeAssignment: (row) => ({ id: row.id || `${row.plan_code}-${row.lab_code}`, ...row }),
  });

  assert.equal(result.ok, true);
  assert.equal(dataset.labs.length, 2);
  assert.equal(dataset.labs[1].lab_name, "待改建房间");
  assert.equal(dataset.labs[1].college, "信息学院");
  assert.equal(dataset.plan_assignments[0].assignment_status, "Invalid");
  assert.equal(dataset.plan_assignments[0].space_code, "");
  assert.equal(dataset.plan_assignments[1].lab_code, "UNIT000002");
  assert.equal(dataset.plan_assignments[1].space_code, "00101010101");
  assert.equal(dataset.plan_assignments[1].effective_from, "2026-06-01");
});

test("detail space edit migrates assignment references and calculates area from dimensions", () => {
  const dataset = {
    buildings: [{ building_code: "B0101", campus_zone: "下沙校区", building_number: 1 }],
    floor_segments: [{ id: "seg-1", segment_code: "EW01010101" }],
    spaces: [{ id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", space_code: "OLD101", front_door: "101", rear_door: "", side: "north", offset_m: 0, length_m: 8, width_m: 6, area_m2: 48, network_segment: "", current_status: "active" }],
    labs: [],
    plans: [{ id: "plan-1", plan_code: "PLAN001" }],
    plan_assignments: [{ id: "assign-1", plan_id: "plan-1", space_id: "space-1", space_code: "OLD101", assignment_status: "assigned" }],
  };

  const result = DetailActions.applyDetailSpaceEdit(dataset, {
    building: dataset.buildings[0],
    space: dataset.spaces[0],
  }, {
    frontDoor: "103",
    rearDoor: "",
    segmentCode: "EW01010101",
    side: "south",
    offsetM: "2.5",
    lengthM: "9",
    widthM: "7",
    areaM2: "50",
    networkSegment: "10.1.0.0/24",
    currentStatus: "active",
  }, {
    generateSpaceCode: () => "00101010303",
    normalizeSpace: (row) => row,
    normalizeAssignment: (row) => row,
  });

  assert.equal(result.ok, true);
  assert.equal(dataset.spaces[0].space_code, "00101010303");
  assert.equal(dataset.spaces[0].rear_door, "");
  assert.equal(dataset.spaces[0].side, "south");
  assert.equal(dataset.spaces[0].area_m2, 63);
  assert.equal(dataset.plan_assignments[0].space_code, "00101010303");
});

test("detail space edit rejects clearing existing dimensions", () => {
  const dataset = {
    spaces: [{ id: "space-1", space_code: "OLD101", front_door: "101", length_m: 8, width_m: 6, area_m2: 48 }],
    plan_assignments: [],
  };

  const result = DetailActions.applyDetailSpaceEdit(dataset, {
    building: {},
    space: dataset.spaces[0],
  }, {
    frontDoor: "101",
    lengthM: "",
    widthM: "6",
    areaM2: "48",
  }, {
    generateSpaceCode: () => "OLD101",
    normalizeSpace: (row) => row,
    normalizeAssignment: (row) => row,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /长宽/);
});

test("detail create room creates an unplanned room with generated code and copy scope", () => {
  const dataset = {
    buildings: [{ building_code: "B0101", campus_zone: "下沙校区", building_number: 1 }],
    floor_segments: [{ id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", element_type: "corridor" }],
    spaces: [],
    plan_assignments: [],
  };

  const result = DetailActions.applyDetailCreateSpace(dataset, {
    building: dataset.buildings[0],
    buildingCode: "B0101",
    floorCode: "1",
  }, {
    frontDoor: "105",
    rearDoor: "",
    segmentCode: "EW01010101",
    side: "north",
    offsetM: "4.5",
    lengthM: "9",
    widthM: "7",
    areaM2: "50",
    networkSegment: "10.2.0.0/24",
    currentStatus: "active",
  }, {
    copyScope: { copy_id: 7 },
    generateSpaceCode: () => "00101010505",
    normalizeSpace: (row) => ({ id: row.id || row.space_code, ...row }),
    isoNow: () => "2026-06-30T08:00:00Z",
  });

  assert.equal(result.ok, true);
  assert.equal(dataset.spaces.length, 1);
  assert.equal(dataset.spaces[0].copy_id, 7);
  assert.equal(dataset.spaces[0].space_code, "00101010505");
  assert.equal(dataset.spaces[0].building_code, "B0101");
  assert.equal(dataset.spaces[0].floor_code, "1");
  assert.equal(dataset.spaces[0].area_m2, 63);
  assert.equal(dataset.plan_assignments.length, 0);
});

test("detail create room rejects missing assignable segment and invalid generated code", () => {
  const dataset = { buildings: [], floor_segments: [], spaces: [], plan_assignments: [] };

  const noSegment = DetailActions.applyDetailCreateSpace(dataset, {
    buildingCode: "B0101",
    floorCode: "1",
  }, {
    frontDoor: "105",
    segmentCode: "",
  }, {
    generateSpaceCode: () => "00101010505",
    normalizeSpace: (row) => row,
  });

  assert.equal(noSegment.ok, false);
  assert.match(noSegment.message, /骨架/);

  const noCode = DetailActions.applyDetailCreateSpace({
    buildings: [],
    floor_segments: [{ building_code: "B0101", floor_code: "1", segment_code: "EW01010101", element_type: "corridor" }],
    spaces: [],
  }, {
    buildingCode: "B0101",
    floorCode: "1",
  }, {
    frontDoor: "",
    segmentCode: "EW01010101",
  }, {
    generateSpaceCode: () => "",
    normalizeSpace: (row) => row,
  });

  assert.equal(noCode.ok, false);
  assert.match(noCode.message, /门牌/);
});

test("thumbnail list keeps existing DOM and scroll when render input is unchanged", () => {
  const { FloorplanRender } = loadBrowserModules();
  const container = new ThumbContainerStub();
  const params = {
    data: {
      floor_segments: [
        { id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" },
        { id: "seg-2", building_code: "B0101", floor_code: "2", segment_code: "EW01010201", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" },
      ],
      spaces: [
        { id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", offset_m: 0, side: "north", space_code: "101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, current_status: "active" },
        { id: "space-2", building_code: "B0101", floor_code: "2", segment_code: "EW01010201", offset_m: 0, side: "north", space_code: "201", front_door: "201", rear_door: "", length_m: 8, width_m: 6, current_status: "active" },
      ],
      labs: [],
      plan_assignments: [],
    },
    buildingCode: "B0101",
    plan: { id: "plan-1", plan_name: "Baseline" },
    activePlanId: "plan-1",
    currentFloorCode: "1",
    colors: {},
    onSelect() {},
  };

  FloorplanRender.renderThumbList(container, params);
  const firstHtml = container.innerHTML;
  const firstListenerCount = container.listenerCount;
  container.scrollTop = 800;
  FloorplanRender.renderThumbList(container, params);

  assert.equal(container.innerHTML, firstHtml);
  assert.equal(container.scrollTop, 800);
  assert.equal(container.listenerCount, firstListenerCount);
});

test("thumbnail previews update when legend muted colleges change", () => {
  const { FloorplanRender } = loadBrowserModules();
  const container = new ThumbContainerStub();
  const params = {
    data: {
      floor_segments: [
        { id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" },
      ],
      spaces: [
        { id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", offset_m: 0, side: "north", space_code: "101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, current_status: "active" },
      ],
      labs: [
        { id: "lab-1", lab_code: "LAB001", lab_name: "Lab A", college: "自定义学院", lab_type: "实验室" },
      ],
      plan_assignments: [
        { id: "assign-1", plan_id: "plan-1", lab_id: "lab-1", space_id: "space-1", assignment_status: "assigned" },
      ],
    },
    buildingCode: "B0101",
    plan: { id: "plan-1", plan_name: "Baseline" },
    activePlanId: "plan-1",
    currentFloorCode: "1",
    colors: { 自定义学院: "#123abc" },
    mutedColleges: new Set(),
    onSelect() {},
  };

  assert.equal(FloorplanRender.renderThumbList(container, params), true);
  assert.doesNotMatch(container.innerHTML, /is-muted/);

  assert.equal(FloorplanRender.renderThumbList(container, { ...params, mutedColleges: new Set(["自定义学院"]) }), true);
  assert.match(container.innerHTML, /class="room is-muted"/);

  assert.equal(FloorplanRender.renderThumbList(container, { ...params, mutedColleges: new Set(["自定义学院"]) }), false);
});

test("thumbnail module skips unchanged renders and binds floor selection", () => {
  const renderThumbListOnly = createRenderThumbList({
    unique: (values) => [...new Set(values.filter(Boolean))],
    compare: (a, b) => String(a).localeCompare(String(b), "zh-CN", { numeric: true }),
    escapeHtml: (value) => String(value ?? ""),
    THUMB_SCALE: 6,
    buildLayout: () => ({ width: 100, height: 50, corridors: [], rooms: [] }),
    floorRenderData: () => ({ segments: [{ id: "seg-1" }], spaces: [] }),
    structureSvg: () => "",
    roomSvg: () => "",
  });
  const container = new ThumbContainerStub();
  const params = {
    data: {
      floor_segments: [
        { id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "S1" },
        { id: "seg-2", building_code: "B0101", floor_code: "2", segment_code: "S2" },
      ],
      spaces: [],
      labs: [],
      plan_assignments: [],
    },
    buildingCode: "B0101",
    plan: { id: "plan-1" },
    activePlanId: "plan-1",
    currentFloorCode: "1",
    colors: {},
    onSelect() {},
  };

  assert.equal(renderThumbListOnly(container, params), true);
  assert.equal(renderThumbListOnly(container, params), false);
  assert.equal(container.listenerCount, 2);
  assert.match(container.innerHTML, /data-floor="1"/);
  assert.match(container.innerHTML, /data-floor="2"/);
});

test("visible datasets collapse stale physical duplicate spaces and migrate assignments", () => {
  const compacted = compactVisibleDataset({
    buildings: [],
    floor_segments: [],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "Lab" }],
    plans: [{ id: "copy-1", plan_code: "copy-1" }],
    spaces: [
      { id: "B0110__1__103", building_code: "B0110", floor_code: "1", space_code: "103", front_door: "103", rear_door: "105", area_m2: 48 },
      { id: "B10__1__103", building_code: "B0110", floor_code: "1", space_code: "103", front_door: "103", rear_door: "105", area_m2: 48 },
    ],
    plan_assignments: [
      { id: "copy-1__LAB001", plan_code: "copy-1", plan_id: "copy-1", lab_code: "LAB001", lab_id: "lab-1", space_code: "103", space_id: "B10__1__103", assignment_status: "assigned" },
    ],
  });

  assert.deepEqual(compacted.spaces.map((space) => space.id), ["B0110__1__103"]);
  assert.equal(compacted.plan_assignments[0].space_id, "B0110__1__103");
  assert.equal(compacted.plan_assignments[0].space_code, "103");
});

test("visible datasets prefer imported single-door spaces over stale same-door copies", () => {
  const compacted = compactVisibleDataset({
    buildings: [],
    floor_segments: [],
    labs: [],
    plans: [],
    spaces: [
      { id: "B09__6__9601", building_code: "B0109", floor_code: "6", space_code: "9601", front_door: "9601", rear_door: "9601", area_m2: 160 },
      { id: "B0109__6__00109060101", building_code: "B0109", floor_code: "6", space_code: "00109060101", front_door: "9601", rear_door: "", area_m2: 161 },
    ],
    plan_assignments: [
      { id: "copy-1__LAB001", plan_code: "copy-1", plan_id: "copy-1", lab_code: "LAB001", lab_id: "lab-1", space_code: "9601", space_id: "B09__6__9601", assignment_status: "assigned" },
    ],
  });

  assert.deepEqual(compacted.spaces.map((space) => space.id), ["B0109__6__00109060101"]);
  assert.equal(compacted.spaces[0].rear_door, "");
  assert.equal(compacted.plan_assignments[0].space_id, "B0109__6__00109060101");
  assert.equal(compacted.plan_assignments[0].space_code, "00109060101");
});

test("visible datasets honor deleted spaces by id or code", () => {
  const compacted = compactVisibleDataset({
    buildings: [],
    floor_segments: [],
    labs: [{ id: "lab-1", lab_code: "LAB001", lab_name: "Lab" }],
    plans: [{ id: "copy-1", plan_code: "copy-1" }],
    spaces: [
      { id: "space-old", building_code: "B0101", floor_code: "1", space_code: "101", front_door: "101", rear_door: "", current_status: "active" },
      { id: "space-keep", building_code: "B0101", floor_code: "1", space_code: "102", front_door: "102", rear_door: "", current_status: "active" },
    ],
    plan_assignments: [
      { id: "copy-1__LAB001", plan_code: "copy-1", plan_id: "copy-1", lab_code: "LAB001", lab_id: "lab-1", space_code: "101", space_id: "space-old", assignment_status: "assigned" },
    ],
    deleted_space_ids: ["101"],
  });

  assert.deepEqual(compacted.spaces.map((space) => space.space_code), ["102"]);
  assert.equal(compacted.plan_assignments[0].assignment_status, "Invalid");
  assert.equal(compacted.plan_assignments[0].space_id, "");
  assert.equal(compacted.plan_assignments[0].space_code, "");
  assert.equal(compacted.plan_assignments[0].previous_space_code, "101");
});
