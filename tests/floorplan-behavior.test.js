const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { compactVisibleDataset } = require("../server/plan-copy-service");

function loadBrowserModules() {
  const context = {
    window: {},
    console,
  };
  vm.createContext(context);
  for (const file of ["js/domain.js", "js/render.js"]) {
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

test("thumbnail previews fit without an internal scroll container", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const thumbRule = css.match(/\.thumb-preview\s*\{(?<body>[^}]+)\}/);

  assert.ok(thumbRule, "expected .thumb-preview CSS rule");
  assert.doesNotMatch(thumbRule.groups.body, /overflow\s*:\s*auto/);
  assert.match(thumbRule.groups.body, /overflow\s*:\s*hidden/);
  assert.match(thumbRule.groups.body, /aspect-ratio\s*:/);
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
