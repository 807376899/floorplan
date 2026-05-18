const {
  STORAGE_KEY,
  ALL_COLLEGES,
  DATASETS,
  csv,
  pick,
  compare,
  compareBuildings,
  normalizeDataset,
  normalizeBuilding,
  normalizeSegment,
  normalizeSpace,
  normalizeLab,
  normalizePlan,
  normalizeAssignment,
  relationMaps,
  templateInstructions,
  templateRows,
  sampleDataset,
  defaultComparePlans,
  emptyDataset,
  unique,
  escapeHtml,
  isoNow,
} = window.FloorplanDomain;
const { colorMap, renderLegend, renderThumbList, renderFloorplan } = window.FloorplanRender;

const state = {
  data: emptyDataset(),
  selectedSpaceId: null,
  editorKey: "spaces",
  activePlanId: null,
  displayMode: "compare",
  zoom: 1,
};

const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));

bindEvents();
renderEditorTabs();
bootstrap();

function bindEvents() {
  els.packageFileInput.addEventListener("change", handleImportPackage);
  els.loadSampleBtn.addEventListener("click", loadSampleData);
  els.downloadTemplateBtn.addEventListener("click", downloadTemplateWorkbook);
  els.exportWorkbookBtn.addEventListener("click", exportWorkbook);
  els.fitCanvasBtn.addEventListener("click", resetCanvasZoom);
  els.zoomOutBtn.addEventListener("click", () => changeCanvasZoom(-0.15));
  els.zoomInBtn.addEventListener("click", () => changeCanvasZoom(0.15));
  els.addRowBtn.addEventListener("click", addEditorRow);
  els.applyTableBtn.addEventListener("click", applyEditorRows);
  els.downloadSheetBtn.addEventListener("click", downloadCurrentSheet);
  els.displayModeSelect.addEventListener("change", () => {
    state.displayMode = els.displayModeSelect.value;
    ensureActivePlan();
    renderComparePlanNames();
    renderEditor();
    renderApp();
  });
  els.buildingSelect.addEventListener("change", () => {
    populateFloorOptions();
    syncSelectedSpace();
    state.zoom = 1;
    renderEditor();
    renderApp();
  });
  els.floorSelect.addEventListener("change", () => {
    syncSelectedSpace();
    state.zoom = 1;
    renderEditor();
    renderApp();
  });
  els.collegeSelect.addEventListener("change", () => {
    renderEditor();
    renderApp();
  });
  els.beforePlanSelect.addEventListener("change", onPlanSelectorChange);
  els.afterPlanSelect.addEventListener("change", onPlanSelectorChange);
  window.addEventListener("resize", () => els.floorplan.classList.contains("is-fit") && applyCanvasMode());
}

function bootstrap() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      state.data = normalizeDataset(JSON.parse(stored));
      hydrate("已恢复上次保存的数据包");
      return;
    } catch (error) {
      console.warn("restore failed", error);
    }
  }
  loadSampleData();
}

function onPlanSelectorChange() {
  ensureActivePlan();
  renderComparePlanNames();
  renderEditor();
  renderApp();
}

function loadSampleData() {
  state.data = normalizeDataset(sampleDataset());
  hydrate("已加载示例数据");
}

async function handleImportPackage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    let raw;
    const name = file.name.toLowerCase();
    if (name.endsWith(".json")) {
      raw = JSON.parse(await file.text());
    } else if ((name.endsWith(".xlsx") || name.endsWith(".xls")) && workbookAvailable()) {
      raw = readWorkbookDataset(await file.arrayBuffer());
    } else {
      throw new Error("请导入单个 Excel 数据包，或在无 Excel 依赖时导入 JSON 数据包。");
    }
    state.data = normalizeDataset(raw);
    hydrate(`已导入数据包 ${file.name}`);
  } catch (error) {
    updateStatus(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function workbookAvailable() {
  return Boolean(window.XLSX?.utils?.book_new);
}

function readWorkbookDataset(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const data = emptyDataset();
  for (const definition of DATASETS) {
    const sheet = workbook.Sheets[definition.sheet] || workbook.Sheets[definition.label];
    data[definition.key] = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
  }
  const filesSheet = workbook.Sheets.file_assets;
  const importsSheet = workbook.Sheets.imports;
  data.file_assets = filesSheet ? XLSX.utils.sheet_to_json(filesSheet, { defval: "" }) : [];
  data.imports = importsSheet ? XLSX.utils.sheet_to_json(importsSheet, { defval: "" }) : [];
  return data;
}

function hydrate(message) {
  stampMetadata(message);
  persistDataset();
  populateBuildingOptions();
  populateFloorOptions();
  populateCollegeOptions();
  populatePlanOptions();
  ensureActivePlan();
  renderComparePlanNames();
  renderEditorTabs();
  renderEditor();
  renderApp();
  const assignedCount = state.data.plan_assignments.filter((row) => row.space_id).length;
  updateStatus(`${message}：${state.data.buildings.length} 栋楼，${state.data.spaces.length} 个空间，${state.data.labs.length} 个实验室，${assignedCount} 条已落位分配。`);
}

function stampMetadata(message) {
  const now = isoNow();
  const fileId = `file-${Date.now()}`;
  const importId = `import-${Date.now()}`;
  state.data.file_assets = [
    ...state.data.file_assets,
    {
      id: fileId,
      file_name: message,
      file_ext: "local",
      mime_type: "application/json",
      storage_path: "browser-local-storage",
      file_size: JSON.stringify(state.data).length,
      sha256: "",
      uploaded_by: "local-user",
      uploaded_at: now,
      notes: "由前端本地持久化记录",
    },
  ].slice(-10);
  state.data.imports = [
    ...state.data.imports,
    {
      id: importId,
      file_asset_id: fileId,
      import_type: "package",
      target_plan_id: "",
      import_status: "success",
      row_count: state.data.spaces.length + state.data.floor_segments.length + state.data.labs.length,
      success_count: state.data.spaces.length + state.data.floor_segments.length + state.data.labs.length,
      error_count: 0,
      error_summary: "",
      started_at: now,
      finished_at: now,
    },
  ].slice(-10);
}

function persistDataset() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function populateBuildingOptions() {
  const items = state.data.buildings.slice().sort(compareBuildings).map((row) => ({ value: row.building_code, label: row.building_name || row.building_code }));
  fillSelect(els.buildingSelect, items);
}

function populateFloorOptions() {
  const buildingCode = els.buildingSelect.value;
  const items = unique(state.data.floor_segments.filter((row) => row.building_code === buildingCode).map((row) => row.floor_code))
    .sort(compare)
    .map((row) => ({ value: row, label: row }));
  fillSelect(els.floorSelect, items);
}

function populateCollegeOptions() {
  const items = [{ value: ALL_COLLEGES, label: ALL_COLLEGES }, ...unique(state.data.labs.map((row) => row.college)).map((row) => ({ value: row, label: row }))];
  fillSelect(els.collegeSelect, items);
}

function populatePlanOptions() {
  const items = state.data.plans.slice().sort((a, b) => compare(a.plan_name, b.plan_name)).map((plan) => ({ value: plan.id, label: plan.plan_name }));
  fillSelect(els.beforePlanSelect, items);
  fillSelect(els.afterPlanSelect, items);
  const defaults = defaultComparePlans(state.data.plans);
  if (!els.beforePlanSelect.value && defaults.before) els.beforePlanSelect.value = defaults.before.id;
  if (!els.afterPlanSelect.value && defaults.after) els.afterPlanSelect.value = defaults.after.id;
}

function fillSelect(select, items) {
  const previous = select.value;
  select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  if (items.some((item) => item.value === previous)) select.value = previous;
  else if (items[0]) select.value = items[0].value;
}

function ensureActivePlan() {
  const before = planById(els.beforePlanSelect.value);
  const after = planById(els.afterPlanSelect.value);
  if (state.displayMode === "before") {
    state.activePlanId = before?.id || null;
    return;
  }
  if (state.displayMode === "after") {
    state.activePlanId = after?.id || null;
    return;
  }
  if (!state.activePlanId || !planById(state.activePlanId)) state.activePlanId = before?.id || after?.id || state.data.plans[0]?.id || null;
  if (state.activePlanId !== before?.id && state.activePlanId !== after?.id) state.activePlanId = before?.id || after?.id || null;
}

function renderComparePlanNames() {
  els.beforePlanName.textContent = planById(els.beforePlanSelect.value)?.plan_name || "";
  els.afterPlanName.textContent = planById(els.afterPlanSelect.value)?.plan_name || "";
}

function renderEditorTabs() {
  els.editorTabs.innerHTML = DATASETS.map(({ key, label }) => `<button type="button" data-key="${key}" class="${state.editorKey === key ? "is-active" : ""}">${escapeHtml(label)}</button>`).join("");
  els.editorTabs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    state.editorKey = button.dataset.key;
    renderEditorTabs();
    renderEditor();
  }));
}

function renderApp() {
  const building = buildingByCode(els.buildingSelect.value);
  const beforePlan = planById(els.beforePlanSelect.value);
  const afterPlan = planById(els.afterPlanSelect.value);
  const activePlan = planById(state.activePlanId);
  const colors = colorMap(state.data.labs);
  const showAfter = state.displayMode === "compare" || state.displayMode === "after";
  const showBefore = state.displayMode === "compare" || state.displayMode === "before";

  els.beforeThumbs.parentElement.classList.toggle("is-hidden", !showBefore);
  els.afterColumn.classList.toggle("is-hidden", !showAfter);
  els.beforeThumbs.parentElement.parentElement.classList.toggle("is-single", state.displayMode !== "compare");

  renderLegend(els.legend, state.data, colors, activePlan?.id);
  if (showBefore) {
    renderThumbList(els.beforeThumbs, {
      data: state.data,
      buildingCode: building?.building_code,
      plan: beforePlan,
      activePlanId: state.activePlanId,
      currentFloorCode: els.floorSelect.value,
      colors,
      onSelect: handleThumbSelect,
    });
  } else {
    els.beforeThumbs.innerHTML = "";
  }
  if (showAfter) {
    renderThumbList(els.afterThumbs, {
      data: state.data,
      buildingCode: building?.building_code,
      plan: afterPlan,
      activePlanId: state.activePlanId,
      currentFloorCode: els.floorSelect.value,
      colors,
      onSelect: handleThumbSelect,
    });
  } else {
    els.afterThumbs.innerHTML = "";
  }
  renderFloorplan({
    floorplanEl: els.floorplan,
    activePlanBadgeEl: els.activePlanBadge,
    detailsEl: els.roomDetails,
    data: state.data,
    building,
    floorCode: els.floorSelect.value,
    activePlan,
    colors,
    selectedSpaceId: state.selectedSpaceId,
    collegeFilter: els.collegeSelect.value,
    onSelectSpace: handleSpaceSelect,
  });
  applyCanvasMode();
}

function handleThumbSelect(planId, floorCode) {
  state.activePlanId = planId;
  els.floorSelect.value = floorCode;
  syncSelectedSpace();
  state.zoom = 1;
  renderEditor();
  renderApp();
}

function handleSpaceSelect(spaceId) {
  state.selectedSpaceId = spaceId;
  renderApp();
}

function renderEditor() {
  const definition = DATASETS.find((item) => item.key === state.editorKey);
  const rows = editorRows();
  if (!rows.length) {
    els.dataEditor.innerHTML = `<div class="empty">当前筛选下暂无数据，可点击“新增行”开始录入。</div>`;
    return;
  }
  els.dataEditor.innerHTML = `<table><thead><tr>${definition.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr>${definition.columns.map(([key]) => `<td data-key="${key}"><input data-row="${rowIndex}" data-key="${key}" value="${escapeHtml(row[key] ?? "")}"></td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function editorRows() {
  const buildingCode = els.buildingSelect.value;
  const floorCode = els.floorSelect.value;
  if (state.editorKey === "floor_segments") return state.data.floor_segments.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
  if (state.editorKey === "spaces") return state.data.spaces.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
  if (state.editorKey === "plan_assignments") return state.data.plan_assignments.filter((row) => row.plan_id === state.activePlanId);
  return state.data[state.editorKey];
}

function syncSelectedSpace() {
  if (!state.selectedSpaceId) return;
  const activePlan = planById(state.activePlanId);
  const stillVisible = state.data.spaces.some((row) =>
    row.id === state.selectedSpaceId &&
    row.building_code === els.buildingSelect.value &&
    row.floor_code === els.floorSelect.value
  );
  if (!stillVisible) {
    state.selectedSpaceId = null;
    return;
  }
  if (!activePlan) {
    state.selectedSpaceId = null;
    return;
  }
  const assignedHere = state.data.plan_assignments.some((row) => row.plan_id === activePlan.id && row.space_id === state.selectedSpaceId);
  if (!assignedHere) state.selectedSpaceId = null;
}

function addEditorRow() {
  const now = isoNow();
  const buildingCode = els.buildingSelect.value || "B01";
  const floorCode = els.floorSelect.value || "1";
  if (state.editorKey === "buildings") {
    state.data.buildings.push(normalizeBuilding({ building_code: `B${String(state.data.buildings.length + 1).padStart(2, "0")}`, building_name: "新增教学楼", campus_zone: "本部", building_number: state.data.buildings.length + 1, notes: "", created_at: now }));
  } else if (state.editorKey === "floor_segments") {
    state.data.floor_segments.push(normalizeSegment({ building_code: buildingCode, floor_code: floorCode, segment_code: `segment-${Date.now()}`, start_x_m: 0, start_y_m: 0, end_x_m: 18, end_y_m: 0, width_m: 2.4, element_type: "corridor", notes: "", created_at: now }));
  } else if (state.editorKey === "spaces") {
    state.data.spaces.push(normalizeSpace({ space_code: `S-${Date.now()}`, building_code: buildingCode, floor_code: floorCode, segment_code: state.data.floor_segments.find((row) => row.building_code === buildingCode && row.floor_code === floorCode)?.segment_code || "main", offset_m: 0, side: "north", front_door: "000", rear_door: "", space_name: "新增空间", length_m: 8, width_m: 6, network_segment: "", current_status: "active", created_at: now }));
  } else if (state.editorKey === "labs") {
    state.data.labs.push(normalizeLab({ lab_code: `LAB-${Date.now()}`, lab_name: "新增实验室", college: "未设置学院", major: "", lab_type: "教学实验室", director: "", seat_count: 0, computer_count: 0, status: "planning", created_at: now }));
  } else if (state.editorKey === "plans") {
    state.data.plans.push(normalizePlan({ plan_code: `plan-${Date.now()}`, plan_name: "新增方案", plan_type: "draft", source_plan_code: "", description: "", is_locked: false, is_default_compare_before: false, is_default_compare_after: false, created_at: now }));
  } else if (state.editorKey === "plan_assignments") {
    state.data.plan_assignments.push(normalizeAssignment({ plan_code: planById(state.activePlanId)?.plan_code || state.data.plans[0]?.plan_code || "baseline", lab_code: state.data.labs[0]?.lab_code || "", space_code: state.data.spaces.find((row) => row.building_code === buildingCode && row.floor_code === floorCode)?.space_code || "", previous_space_code: "", assignment_status: "assigned", move_note: "", effective_from: "", created_at: now }, relationMaps(state.data)));
  }
  hydrate("已新增一行");
}

function applyEditorRows() {
  const rows = editorRows().map(() => ({}));
  els.dataEditor.querySelectorAll("input").forEach((input) => {
    rows[Number(input.dataset.row)][input.dataset.key] = input.value;
  });
  if (state.editorKey === "buildings") state.data.buildings = rows.map((row) => normalizeBuilding(row));
  if (state.editorKey === "labs") state.data.labs = rows.map((row) => normalizeLab(row));
  if (state.editorKey === "plans") state.data.plans = rows.map((row) => normalizePlan(row));
  if (state.editorKey === "floor_segments") replaceFilteredRows("floor_segments", rows.map((row) => normalizeSegment(row)));
  if (state.editorKey === "spaces") replaceFilteredRows("spaces", rows.map((row) => normalizeSpace(row)));
  if (state.editorKey === "plan_assignments") replaceFilteredAssignments(rows.map((row) => normalizeAssignment(row, relationMaps(state.data))));
  state.data = normalizeDataset(state.data);
  hydrate("已应用修改");
}

function replaceFilteredRows(key, replacement) {
  const buildingCode = els.buildingSelect.value;
  const floorCode = els.floorSelect.value;
  state.data[key] = [
    ...state.data[key].filter((row) => row.building_code !== buildingCode || row.floor_code !== floorCode),
    ...replacement,
  ];
}

function replaceFilteredAssignments(replacement) {
  state.data.plan_assignments = [
    ...state.data.plan_assignments.filter((row) => row.plan_id !== state.activePlanId),
    ...replacement,
  ];
}

function downloadCurrentSheet() {
  const definition = DATASETS.find((item) => item.key === state.editorKey);
  const rows = editorRows().map((row) => Object.fromEntries(definition.columns.map(([key]) => [key, row[key] ?? ""])));
  exportCsv(`${definition.sheet}.csv`, definition.columns, rows);
}

function downloadTemplateWorkbook() {
  try {
    if (!workbookAvailable()) {
      downloadJson("实验室搬迁规划模板.json", buildTemplatePackage());
      updateStatus("当前环境未加载 Excel 组件，已降级下载 JSON 模板。");
      return;
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(templateInstructions()), "说明");
    for (const definition of DATASETS) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(templateRows(definition.key)), definition.sheet);
    XLSX.writeFile(workbook, "实验室搬迁规划模板.xlsx");
    updateStatus("模板已开始下载。");
  } catch (error) {
    downloadJson("实验室搬迁规划模板.json", buildTemplatePackage());
    updateStatus(`Excel 模板生成失败，已降级下载 JSON 模板：${error.message}`);
  }
}

function exportWorkbook() {
  try {
    if (!workbookAvailable()) {
      downloadJson("实验室搬迁规划数据包.json", state.data);
      updateStatus("当前环境未加载 Excel 组件，已降级下载 JSON 数据包。");
      return;
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(templateInstructions()), "说明");
    for (const definition of DATASETS) {
      const rows = state.data[definition.key].map((row) => exportRow(definition.key, row));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), definition.sheet);
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.data.file_assets), "file_assets");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(state.data.imports), "imports");
    XLSX.writeFile(workbook, "实验室搬迁规划数据包.xlsx");
    updateStatus("数据包已开始下载。");
  } catch (error) {
    downloadJson("实验室搬迁规划数据包.json", state.data);
    updateStatus(`Excel 数据包导出失败，已降级下载 JSON 数据包：${error.message}`);
  }
}

function buildTemplatePackage() {
  return Object.fromEntries(DATASETS.map((definition) => [definition.key, templateRows(definition.key)]));
}

function exportRow(key, row) {
  const fields = DATASETS.find((item) => item.key === key).columns.map(([field]) => field);
  return pick(row, fields);
}

function exportCsv(name, columns, rows) {
  const table = [columns.map(([, label]) => label), ...rows.map((row) => columns.map(([key]) => row[key] ?? ""))];
  download(name, `\uFEFF${table.map((row) => row.map(csv).join(",")).join("\n")}`, "text/csv;charset=utf-8");
}

function downloadJson(name, data) {
  download(name, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
}

function download(name, text, type) {
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type }));
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildingByCode(buildingCode) {
  return state.data.buildings.find((row) => row.building_code === buildingCode) || null;
}

function planById(id) {
  return state.data.plans.find((row) => row.id === id) || null;
}

function changeCanvasZoom(delta) {
  state.zoom = Math.min(2.5, Math.max(0.4, Number((state.zoom + delta).toFixed(2))));
  applyCanvasMode();
}

function resetCanvasZoom() {
  state.zoom = 1;
  applyCanvasMode();
}

function applyCanvasMode() {
  const svg = els.floorplan.querySelector("svg");
  if (!svg) return;
  const width = Number(svg.dataset.layoutWidth);
  const height = Number(svg.dataset.layoutHeight);
  const bounds = els.floorplan.getBoundingClientRect();
  const fit = Math.min(1, (bounds.width - 24) / width, (bounds.height - 24) / height);
  const scale = fit * state.zoom;
  els.floorplan.classList.toggle("is-zoomed", state.zoom > 1);
  els.canvasModeText.textContent = state.zoom === 1 ? "适配显示" : `缩放 ${Math.round(state.zoom * 100)}%`;
  svg.style.width = `${width * scale}px`;
  svg.style.height = `${height * scale}px`;
}

function updateStatus(text) {
  els.statusText.textContent = text;
}
