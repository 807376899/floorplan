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
const { colorMap, renderLegend, renderThumbList, renderFloorplan, renderDetailsPanel } = window.FloorplanRender;

const state = {
  data: emptyDataset(),
  serverRevision: 0,
  user: null,
  permissions: { role: "viewer", canEdit: false, canAdmin: false },
  serverMode: false,
  selectedSpaceId: null,
  editorKey: "spaces",
  editorHighlight: null,
  activePlanId: null,
  planViewMode: "single",
  zoom: 1,
  detailsMode: "view",
  moveDraft: null,
  moveErrors: {},
  moveDirty: false,
  moveTargetKey: null,
  pendingNavigation: null,
  planDeleteTargetId: null,
  statusMessage: "",
};

const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));

bindEvents();
renderEditorTabs();
bootstrap();

function bindEvents() {
  els.packageFileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    runWithUnsavedGuard(() => { void importPackageFile(file); });
  });
  els.loadSampleBtn.addEventListener("click", () => runWithUnsavedGuard(loadSampleData));
  els.downloadTemplateBtn.addEventListener("click", downloadTemplateWorkbook);
  els.exportWorkbookBtn.addEventListener("click", () => runWithUnsavedGuard(exportWorkbook));
  els.manageImportsBtn.addEventListener("click", () => void manageImportDrafts());
  els.manageSnapshotsBtn.addEventListener("click", () => void manageSnapshots());
  els.loginBtn.addEventListener("click", () => void loginFlow());
  els.logoutBtn.addEventListener("click", () => void logoutFlow());
  els.fitCanvasBtn.addEventListener("click", resetCanvasZoom);
  els.zoomOutBtn.addEventListener("click", () => changeCanvasZoom(-0.15));
  els.zoomInBtn.addEventListener("click", () => changeCanvasZoom(0.15));
  els.addRowBtn.addEventListener("click", () => runWithUnsavedGuard(addEditorRow));
  els.applyTableBtn.addEventListener("click", () => runWithUnsavedGuard(() => { void applyEditorRows(); }));
  els.downloadSheetBtn.addEventListener("click", () => runWithUnsavedGuard(downloadCurrentSheet));
  els.newPlanBtn.addEventListener("click", () => runWithUnsavedGuard(() => { void createPlanFromActiveAction(); }));
  els.deletePlanBtn.addEventListener("click", () => runWithUnsavedGuard(openDeletePlanModal));

  els.buildingSelect.addEventListener("change", (event) => handleSelectChange(event, () => {
    populateFloorOptions();
    syncSelectedSpace();
    state.zoom = 1;
    syncMoveDraft(true);
    renderEditor();
    renderApp();
  }));
  els.floorSelect.addEventListener("change", (event) => handleSelectChange(event, () => {
    syncSelectedSpace();
    state.zoom = 1;
    syncMoveDraft(true);
    renderEditor();
    renderApp();
  }));
  els.collegeSelect.addEventListener("change", (event) => handleSelectChange(event, renderApp));
  els.beforePlanSelect.addEventListener("change", (event) => handleSelectChange(event, onPlanSelectorChange));
  els.afterPlanSelect.addEventListener("change", (event) => handleSelectChange(event, onPlanSelectorChange));

  els.unsavedSaveContinueBtn.addEventListener("click", saveAndContinuePendingAction);
  els.unsavedDiscardContinueBtn.addEventListener("click", discardAndContinuePendingAction);
  els.unsavedStayBtn.addEventListener("click", closeUnsavedModal);

  els.confirmDeletePlanBtn.addEventListener("click", () => void confirmDeletePlanAction());
  els.cancelDeletePlanBtn.addEventListener("click", closeDeletePlanModal);

  window.addEventListener("resize", () => els.floorplan.classList.contains("is-fit") && applyCanvasMode());
}

async function bootstrap() {
  try {
    const payload = await fetchJson("/api/bootstrap");
    state.serverMode = true;
    state.user = payload.user;
    state.permissions = payload.permissions;
    state.serverRevision = payload.revision;
    state.data = normalizeDataset(payload.dataset);
    resetContextState();
    refreshStateAndRender("已加载服务器当前数据", { stamp: false, forceMoveReset: true });
    return;
  } catch (error) {
    console.warn("bootstrap from server failed", error);
  }
  bootstrapLocal();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || "请求失败");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function cloneDataset(dataset) {
  return JSON.parse(JSON.stringify(dataset));
}

function applyAuthUi() {
  const role = state.permissions.role || "viewer";
  els.authStatus.textContent = state.user ? `${state.user.username} · ${role}` : "访客只读";
  els.authStatus.classList.toggle("is-viewer", role === "viewer");
  els.authStatus.classList.toggle("is-admin", role === "admin");
  els.loginBtn.hidden = Boolean(state.user);
  els.logoutBtn.hidden = !state.user;
  els.importPackageLabel.hidden = !state.permissions.canAdmin;
  els.manageImportsBtn.hidden = !state.permissions.canAdmin;
  els.manageSnapshotsBtn.hidden = !state.permissions.canAdmin;
  els.loadSampleBtn.hidden = state.serverMode;
  els.addRowBtn.disabled = !state.permissions.canEdit;
  els.applyTableBtn.disabled = !state.permissions.canEdit;
  els.newPlanBtn.disabled = !state.permissions.canEdit;
}

async function loginFlow() {
  const username = window.prompt("请输入账号");
  if (!username) return;
  const password = window.prompt("请输入密码");
  if (!password) return;
  try {
    const payload = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.user = payload.user;
    state.permissions = payload.permissions;
    applyAuthUi();
    renderApp();
    updateStatus(`已登录为 ${payload.user.username}`);
  } catch (error) {
    updateStatus(`登录失败：${error.message}`);
  }
}

async function logoutFlow() {
  try {
    await fetchJson("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    state.user = null;
    state.permissions = { role: "viewer", canEdit: false, canAdmin: false };
    applyAuthUi();
    renderApp();
    updateStatus("已退出登录");
  } catch (error) {
    updateStatus(`退出失败：${error.message}`);
  }
}

async function saveDatasetToServer(changeNote) {
  if (!state.serverMode) return true;
  const payload = await fetchJson("/api/dataset/active", {
    method: "PUT",
    body: JSON.stringify({
      dataset: state.data,
      expectedRevision: state.serverRevision,
      changeNote,
    }),
  });
  state.serverRevision = payload.revision;
  state.data = normalizeDataset(payload.dataset);
  persistDataset();
  return true;
}

function bootstrapLocal() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      state.data = normalizeDataset(JSON.parse(stored));
      refreshStateAndRender("已恢复上次保存的数据包", { stamp: false, forceMoveReset: true });
      return;
    } catch (error) {
      console.warn("restore failed", error);
    }
  }
  loadSampleData();
}

function handleSelectChange(event, applyChange) {
  const select = event.target;
  const nextValue = select.value;
  const previousValue = select.dataset.currentValue ?? nextValue;
  if (nextValue === previousValue) return;
  select.value = previousValue;
  runWithUnsavedGuard(() => {
    select.value = nextValue;
    applyChange();
    syncControlSnapshots();
  });
}

function onPlanSelectorChange() {
  ensureActivePlan();
  syncSelectedSpace();
  syncMoveDraft(true);
  renderEditor();
  renderApp();
}

function loadSampleData() {
  state.data = normalizeDataset(sampleDataset());
  resetContextState();
  refreshStateAndRender("已加载示例数据", { stamp: true, forceMoveReset: true });
}

async function importPackageFile(file) {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以上传新的数据包草稿。");
    return;
  }
  try {
    let raw;
    const name = file.name.toLowerCase();
    if (name.endsWith(".json")) raw = JSON.parse(await file.text());
    else if ((name.endsWith(".xlsx") || name.endsWith(".xls")) && workbookAvailable()) raw = readWorkbookDataset(await file.arrayBuffer());
    else throw new Error("请导入单个 Excel 数据包，或在无法读取 Excel 时导入 JSON 数据包。");
    const normalized = normalizeDataset(raw);
    const payload = await fetchJson("/api/imports", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        sourceType: name.endsWith(".json") ? "json" : "xlsx",
        dataset: normalized,
      }),
    });
    updateStatus(`已创建导入草稿 #${payload.draftId}，请在“管理导入草稿”中发布或丢弃。`);
  } catch (error) {
    updateStatus(`导入失败：${error.message}`);
  }
}

async function manageImportDrafts() {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以管理导入草稿。");
    return;
  }
  try {
    const payload = await fetchJson("/api/imports");
    if (!payload.drafts.length) {
      updateStatus("当前没有待处理的导入草稿。");
      return;
    }
    const summary = payload.drafts
      .map((draft) => `#${draft.id} ${draft.file_name} [${draft.status}] Δ空间${draft.summary.delta.spaces}, Δ实验室${draft.summary.delta.labs}, Δ方案${draft.summary.delta.plans}`)
      .join("\n");
    const command = window.prompt(`导入草稿列表：\n${summary}\n\n输入“P 空格 ID”发布，输入“D 空格 ID”丢弃。`);
    if (!command) return;
    const [action, rawId] = command.trim().split(/\s+/);
    const draftId = Number(rawId);
    if (!draftId) return;
    if (String(action).toUpperCase() === "P") {
      await fetchJson(`/api/imports/${draftId}/publish`, { method: "POST", body: JSON.stringify({}) });
      await reloadDatasetFromServer("已发布导入草稿并替换当前正式数据");
      return;
    }
    if (String(action).toUpperCase() === "D") {
      await fetchJson(`/api/imports/${draftId}`, { method: "DELETE" });
      updateStatus(`已丢弃导入草稿 #${draftId}`);
    }
  } catch (error) {
    updateStatus(`草稿管理失败：${error.message}`);
  }
}

async function manageSnapshots() {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以恢复快照。");
    return;
  }
  try {
    const payload = await fetchJson("/api/snapshots");
    if (!payload.snapshots.length) {
      updateStatus("当前没有可恢复的快照。");
      return;
    }
    const summary = payload.snapshots
      .map((snapshot) => `#${snapshot.id} ${snapshot.kind} rev:${snapshot.source_revision} ${snapshot.label}`)
      .join("\n");
    const command = window.prompt(`快照列表：\n${summary}\n\n输入“R 空格 ID”恢复对应快照。`);
    if (!command) return;
    const [action, rawId] = command.trim().split(/\s+/);
    const snapshotId = Number(rawId);
    if (String(action).toUpperCase() !== "R" || !snapshotId) return;
    await fetchJson(`/api/snapshots/${snapshotId}/restore`, { method: "POST", body: JSON.stringify({}) });
    await reloadDatasetFromServer(`已从快照 #${snapshotId} 恢复当前正式数据`);
  } catch (error) {
    updateStatus(`快照恢复失败：${error.message}`);
  }
}

async function reloadDatasetFromServer(message) {
  const payload = await fetchJson("/api/dataset/active");
  state.serverRevision = payload.revision;
  state.data = normalizeDataset(payload.dataset);
  resetContextState();
  refreshStateAndRender(message, { stamp: false, forceMoveReset: true });
}

function resetContextState() {
  state.selectedSpaceId = null;
  state.editorHighlight = null;
  state.activePlanId = null;
  state.detailsMode = "view";
  state.moveDraft = null;
  state.moveErrors = {};
  state.moveDirty = false;
  state.moveTargetKey = null;
  state.pendingNavigation = null;
  state.planDeleteTargetId = null;
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
  data.file_assets = workbook.Sheets.file_assets ? XLSX.utils.sheet_to_json(workbook.Sheets.file_assets, { defval: "" }) : [];
  data.imports = workbook.Sheets.imports ? XLSX.utils.sheet_to_json(workbook.Sheets.imports, { defval: "" }) : [];
  return data;
}

function refreshStateAndRender(message, options = {}) {
  const { stamp = false, forceMoveReset = false } = options;
  if (stamp) stampMetadata(message);
  persistDataset();
  syncPlanViewMode();
  populateBuildingOptions();
  populateFloorOptions();
  populateCollegeOptions();
  populatePlanOptions();
  ensureActivePlan();
  syncSelectedSpace();
  syncMoveDraft(forceMoveReset);
  applyAuthUi();
  renderEditorTabs();
  renderEditor();
  renderApp();
  syncControlSnapshots();
  updateDatasetSummary(message);
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

function syncPlanViewMode() {
  state.planViewMode = state.data.plans.length >= 2 ? "compare" : "single";
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
  const previousBefore = els.beforePlanSelect.value;
  const previousAfter = els.afterPlanSelect.value;
  const items = state.data.plans.slice().sort((a, b) => compare(a.plan_name, b.plan_name)).map((plan) => ({ value: plan.id, label: plan.plan_name }));
  fillSelect(els.beforePlanSelect, items);
  fillSelect(els.afterPlanSelect, items);

  const defaults = defaultComparePlans(state.data.plans);
  const planIds = new Set(items.map((item) => item.value));
  const defaultBefore = defaults.before?.id || items[0]?.value || "";
  const fallbackAfter = items.find((item) => item.value !== defaultBefore)?.value || defaultBefore;

  const beforeValue = planIds.has(previousBefore) ? previousBefore : defaultBefore;
  let afterValue = planIds.has(previousAfter) ? previousAfter : defaults.after?.id || fallbackAfter;
  if (state.planViewMode === "single") afterValue = beforeValue;
  if (state.planViewMode === "compare" && items.length > 1 && afterValue === beforeValue) {
    afterValue = items.find((item) => item.value !== beforeValue)?.value || afterValue;
  }

  els.beforePlanSelect.value = beforeValue;
  els.afterPlanSelect.value = afterValue;
}

function fillSelect(select, items) {
  const previous = select.value;
  select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  if (items.some((item) => item.value === previous)) select.value = previous;
  else select.value = items[0]?.value || "";
}

function ensureActivePlan() {
  const before = planById(els.beforePlanSelect.value);
  const after = planById(els.afterPlanSelect.value);
  if (state.planViewMode === "single") {
    state.activePlanId = before?.id || state.data.plans[0]?.id || null;
    return;
  }
  const compareIds = [before?.id, after?.id].filter(Boolean);
  if (!state.activePlanId || !compareIds.includes(state.activePlanId)) {
    state.activePlanId = after?.id || before?.id || state.data.plans[0]?.id || null;
  }
}

function syncSelectedSpace() {
  if (!state.selectedSpaceId) return;
  const stillVisible = state.data.spaces.some((row) =>
    row.id === state.selectedSpaceId &&
    row.building_code === els.buildingSelect.value &&
    row.floor_code === els.floorSelect.value
  );
  if (!stillVisible) state.selectedSpaceId = null;
}

function syncControlSnapshots() {
  [els.buildingSelect, els.floorSelect, els.collegeSelect, els.beforePlanSelect, els.afterPlanSelect].forEach((select) => {
    select.dataset.currentValue = select.value;
  });
}

function renderCompareChrome() {
  const isCompare = state.planViewMode === "compare";
  const beforePlan = planById(els.beforePlanSelect.value);
  const afterPlan = planById(els.afterPlanSelect.value);
  const activePlan = planById(state.activePlanId);
  const deletePlan = activePlan;
  const canDeletePlan = Boolean(state.permissions.canAdmin && deletePlan && !deletePlan.is_locked && state.data.plans.length > 1);

  els.planCompareFilters.classList.toggle("is-hidden", !isCompare);
  els.beforePlanSelect.disabled = !isCompare;
  els.afterPlanSelect.disabled = !isCompare;
  els.compareColumns.classList.toggle("is-single", !isCompare);
  els.afterColumn.classList.toggle("is-hidden", !isCompare);

  els.planModeBadge.textContent = isCompare ? `对比模式 · ${state.data.plans.length} 套` : "单方案维护";
  els.comparePanelTitle.textContent = "缩略图";
  els.comparePanelHint.textContent = "";
  els.beforePlanName.textContent = beforePlan?.plan_name || activePlan?.plan_name || "";
  els.afterPlanName.textContent = isCompare ? afterPlan?.plan_name || "" : "";

  els.newPlanBtn.disabled = !state.permissions.canEdit;
  els.deletePlanBtn.disabled = !canDeletePlan;
  els.deletePlanBtn.title = canDeletePlan ? "" : (deletePlan?.is_locked ? "锁定方案不可删除" : "至少保留一套方案");
}

function renderEditorTabs() {
  els.editorTabs.innerHTML = DATASETS.map(({ key, label }) => `<button type="button" data-key="${key}" class="${state.editorKey === key ? "is-active" : ""}">${escapeHtml(label)}</button>`).join("");
  els.editorTabs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    if (state.editorKey === button.dataset.key) return;
    runWithUnsavedGuard(() => {
      state.editorKey = button.dataset.key;
      state.editorHighlight = null;
      renderEditorTabs();
      renderEditor();
    });
  }));
}

function renderApp() {
  const building = buildingByCode(els.buildingSelect.value);
  const beforePlan = planById(els.beforePlanSelect.value);
  const afterPlan = planById(els.afterPlanSelect.value);
  const activePlan = planById(state.activePlanId);
  const colors = colorMap(state.data.labs);
  const thumbPlan = state.planViewMode === "compare" ? beforePlan : activePlan || beforePlan;
  const context = getSelectedContext();

  renderCompareChrome();
  renderLegend(els.legend, state.data, colors, activePlan?.id);

  renderThumbList(els.beforeThumbs, {
    data: state.data,
    buildingCode: building?.building_code,
    plan: thumbPlan,
    activePlanId: state.activePlanId,
    currentFloorCode: els.floorSelect.value,
    colors,
    onSelect: handleThumbSelect,
  });

  if (state.planViewMode === "compare") {
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
    data: state.data,
    building,
    floorCode: els.floorSelect.value,
    activePlan,
    colors,
    selectedSpaceId: state.selectedSpaceId,
    collegeFilter: els.collegeSelect.value,
    onSelectSpace: handleSpaceSelect,
  });

  renderDetailsPanel({
    detailsEl: els.roomDetails,
    context,
    mode: state.detailsMode,
    moveDraft: state.moveDraft,
    moveErrors: state.moveErrors,
    moveDirty: state.moveDirty,
    canEdit: state.permissions.canEdit,
    onFocusRow: focusRowFromDetails,
    onOpenMove: openMoveMode,
    onMoveFieldChange: updateMoveField,
    onConfirmMove: confirmMoveAssignmentAction,
    onCancelMove: cancelMoveMode,
  });

  applyCanvasMode();
}

function getSelectedContext() {
  const building = buildingByCode(els.buildingSelect.value);
  const activePlan = planById(state.activePlanId);
  const space = state.data.spaces.find((row) =>
    row.id === state.selectedSpaceId &&
    row.building_code === els.buildingSelect.value &&
    row.floor_code === els.floorSelect.value
  ) || null;
  const assignment = activePlan && space ? state.data.plan_assignments.find((row) => row.plan_id === activePlan.id && row.space_id === space.id) || null : null;
  const lab = assignment ? state.data.labs.find((row) => row.id === assignment.lab_id) || null : null;
  return { building, activePlan, space, assignment, lab };
}

function moveTargetKey(context) {
  if (!context.space || !context.assignment || !context.lab) return null;
  return `${context.activePlan?.id || "no-plan"}::${context.assignment.id}`;
}

function buildMoveDraft(context) {
  if (!context.space || !context.assignment || !context.lab) return null;
  return {
    targetSpaceCode: "",
  };
}

function syncMoveDraft(force = false) {
  const context = getSelectedContext();
  const targetKey = moveTargetKey(context);
  if (state.detailsMode !== "move") {
    state.moveDirty = false;
    state.moveErrors = {};
    state.moveTargetKey = targetKey;
    if (!targetKey) state.moveDraft = null;
    return;
  }
  if (!targetKey) {
    state.detailsMode = "view";
    state.moveDraft = null;
    state.moveDirty = false;
    state.moveErrors = {};
    state.moveTargetKey = null;
    return;
  }
  if (force || !state.moveDirty || state.moveTargetKey !== targetKey || !state.moveDraft) {
    state.moveDraft = buildMoveDraft(context);
    state.moveDirty = false;
    state.moveErrors = {};
    state.moveTargetKey = targetKey;
  }
}

function handleThumbSelect(planId, floorCode) {
  runWithUnsavedGuard(() => {
    state.activePlanId = planId;
    els.floorSelect.value = floorCode;
    syncSelectedSpace();
    state.zoom = 1;
    state.detailsMode = "view";
    syncMoveDraft(true);
    renderEditor();
    renderApp();
    syncControlSnapshots();
  });
}

function handleSpaceSelect(spaceId) {
  if (spaceId === state.selectedSpaceId) return;
  runWithUnsavedGuard(() => {
    state.selectedSpaceId = spaceId;
    state.detailsMode = "view";
    syncMoveDraft(true);
    renderApp();
  });
}

function openMoveMode() {
  if (!state.permissions.canEdit) {
    updateStatus("请先以 editor 或 admin 身份登录后再执行搬迁。");
    return;
  }
  const context = getSelectedContext();
  if (!context.assignment || !context.lab) {
    updateStatus("当前空间在此方案下没有已绑定实验室，无法直接搬迁。");
    return;
  }
  state.detailsMode = "move";
  syncMoveDraft(true);
  renderApp();
}

function updateMoveField(field, value) {
  if (!state.moveDraft) return;
  state.moveDraft = { ...state.moveDraft, [field]: value };
  state.moveDirty = true;
  if (state.moveErrors[field]) {
    delete state.moveErrors[field];
    renderApp();
    return;
  }
}

function cancelMoveMode() {
  state.detailsMode = "view";
  state.moveDraft = null;
  state.moveErrors = {};
  state.moveDirty = false;
  state.moveTargetKey = null;
  renderApp();
  updateStatus("已取消当前搬迁操作。");
}

function validateMoveDraft() {
  const context = getSelectedContext();
  const errors = {};
  const targetCode = String(state.moveDraft?.targetSpaceCode || "").trim();
  if (!targetCode) {
    errors.targetSpaceCode = "请输入目标空间编码。";
    return { errors, targetSpace: null, conflictAssignment: null };
  }

  const targetSpace = state.data.spaces.find((row) => row.space_code === targetCode) || null;
  if (!targetSpace) {
    errors.targetSpaceCode = "未找到对应的空间编码。";
    return { errors, targetSpace: null, conflictAssignment: null };
  }
  if (targetSpace.id === context.space?.id) {
    errors.targetSpaceCode = "目标空间不能与当前空间相同。";
    return { errors, targetSpace, conflictAssignment: null };
  }

  const conflictAssignment = state.data.plan_assignments.find((row) => row.plan_id === context.activePlan?.id && row.space_id === targetSpace.id) || null;
  if (conflictAssignment && conflictAssignment.id !== context.assignment?.id && conflictAssignment.assignment_status === "assigned") {
    errors.targetSpaceCode = "目标空间已有 assigned 占用，无法搬迁。";
  }

  return { errors, targetSpace, conflictAssignment };
}

function confirmMoveAssignment() {
  const context = getSelectedContext();
  if (!context.assignment || !context.lab || !context.activePlan || !context.space) return false;

  const { errors, targetSpace, conflictAssignment } = validateMoveDraft();
  if (Object.keys(errors).length) {
    state.moveErrors = errors;
    renderApp();
    updateStatus("搬迁失败，请先修正右侧表单。");
    return false;
  }

  const relation = relationMaps(state.data);
  const updatedAssignments = state.data.plan_assignments.map((row) => {
    if (row.id === context.assignment.id) {
      return normalizeAssignment({
        ...row,
        previous_space_code: row.space_code || context.space.space_code,
        space_code: targetSpace.space_code,
        assignment_status: "assigned",
      }, relation);
    }
    if (conflictAssignment && row.id === conflictAssignment.id) {
      return normalizeAssignment({
        ...row,
        previous_space_code: row.space_code || row.previous_space_code,
        space_code: "",
        assignment_status: "unplaced",
      }, relation);
    }
    return row;
  });

  state.data.plan_assignments = updatedAssignments;
  state.data = normalizeDataset(state.data);
  state.detailsMode = "view";
  state.moveDraft = null;
  state.moveErrors = {};
  state.moveDirty = false;
  state.moveTargetKey = null;
  refreshStateAndRender(`已将 ${context.lab.lab_name} 搬迁到 ${targetSpace.space_code}`, { stamp: false, forceMoveReset: true });
  return true;
}

async function confirmMoveAssignmentAction() {
  if (!state.permissions.canEdit) {
    updateStatus("当前账号没有搬迁权限。");
    return false;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const ok = confirmMoveAssignment();
  if (!ok) return false;
  try {
    await saveDatasetToServer("搬迁实验室");
    refreshStateAndRender("已保存实验室搬迁。", { stamp: false, forceMoveReset: true });
    return true;
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    refreshStateAndRender(`搬迁保存失败：${error.message}`, { stamp: false, forceMoveReset: true });
    return false;
  }
}

function focusRowFromDetails(key, rowId) {
  runWithUnsavedGuard(() => {
    state.detailsMode = "view";
    state.editorKey = key;
    state.editorHighlight = rowId ? { key, rowId } : null;
    renderEditorTabs();
    renderEditor();
    if (key === "plan_assignments" && !rowId) {
      updateStatus("当前空间在此方案下还没有分配记录，请在方案分配表中新增。");
    } else {
      updateStatus("已定位到底部高级编辑表。");
    }
  });
}

function runWithUnsavedGuard(action) {
  if (!state.moveDirty) {
    action();
    return;
  }
  state.pendingNavigation = action;
  openUnsavedModal();
}

function openUnsavedModal() {
  els.unsavedModal.classList.remove("is-hidden");
  els.unsavedModal.setAttribute("aria-hidden", "false");
}

function closeUnsavedModal() {
  state.pendingNavigation = null;
  els.unsavedModal.classList.add("is-hidden");
  els.unsavedModal.setAttribute("aria-hidden", "true");
}

async function saveAndContinuePendingAction() {
  const pending = state.pendingNavigation;
  if (!pending) return;
  if (!(await confirmMoveAssignmentAction())) return;
  closeUnsavedModal();
  pending();
}

function discardAndContinuePendingAction() {
  const pending = state.pendingNavigation;
  if (!pending) return;
  state.detailsMode = "view";
  state.moveDraft = null;
  state.moveErrors = {};
  state.moveDirty = false;
  state.moveTargetKey = null;
  closeUnsavedModal();
  pending();
}

function openDeletePlanModal() {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以删除方案。");
    return;
  }
  const plan = planById(state.activePlanId);
  if (!plan) return;
  if (plan.is_locked) {
    updateStatus("锁定方案不可删除。");
    return;
  }
  if (state.data.plans.length <= 1) {
    updateStatus("至少需要保留一套方案。");
    return;
  }
  state.planDeleteTargetId = plan.id;
  els.deletePlanModalText.textContent = `删除方案“${plan.plan_name}”后，该方案下的全部分配关系也会一并删除。`;
  els.deletePlanModal.classList.remove("is-hidden");
  els.deletePlanModal.setAttribute("aria-hidden", "false");
}

function closeDeletePlanModal() {
  state.planDeleteTargetId = null;
  els.deletePlanModal.classList.add("is-hidden");
  els.deletePlanModal.setAttribute("aria-hidden", "true");
}

function confirmDeletePlan() {
  const planId = state.planDeleteTargetId;
  const plan = planById(planId);
  if (!plan) {
    closeDeletePlanModal();
    return;
  }

  state.data.plans = state.data.plans.filter((row) => row.id !== planId);
  state.data.plan_assignments = state.data.plan_assignments.filter((row) => row.plan_id !== planId);
  state.data = normalizeDataset(state.data);
  state.activePlanId = null;
  state.detailsMode = "view";
  syncMoveDraft(true);
  closeDeletePlanModal();
  refreshStateAndRender(`已删除方案 ${plan.plan_name}`, { stamp: false, forceMoveReset: true });
}

async function confirmDeletePlanAction() {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以删除方案。");
    return;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  confirmDeletePlan();
  if (JSON.stringify(previousData) === JSON.stringify(state.data)) return;
  try {
    await saveDatasetToServer("删除方案");
    refreshStateAndRender("已删除当前方案。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    closeDeletePlanModal();
    refreshStateAndRender(`删除方案失败：${error.message}`, { stamp: false, forceMoveReset: true });
  }
}

function renderEditor() {
  const definition = DATASETS.find((item) => item.key === state.editorKey);
  const rows = editorRows();
  const highlightRowId = state.editorHighlight?.key === state.editorKey ? state.editorHighlight.rowId : "";

  if (!rows.length) {
    const emptyText = state.editorKey === "plan_assignments"
      ? "当前方案下暂无分配记录，可点击“新增行”开始录入。"
      : "当前筛选下暂无数据，可点击“新增行”开始录入。";
    els.dataEditor.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }

  const inputDisabled = state.permissions.canEdit ? "" : "disabled";
  els.dataEditor.innerHTML = `<table><thead><tr>${definition.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr data-row-id="${escapeHtml(row.id || "")}" class="${highlightRowId && row.id === highlightRowId ? "is-highlight" : ""}">${definition.columns.map(([key]) => `<td data-key="${key}"><input data-row="${rowIndex}" data-key="${key}" value="${escapeHtml(row[key] ?? "")}" ${inputDisabled}></td>`).join("")}</tr>`).join("")}</tbody></table>`;

  if (highlightRowId) {
    const highlightedRow = [...els.dataEditor.querySelectorAll("tr")].find((row) => row.dataset.rowId === highlightRowId);
    highlightedRow?.scrollIntoView({ block: "nearest" });
  }
}

function editorRows() {
  const buildingCode = els.buildingSelect.value;
  const floorCode = els.floorSelect.value;
  if (state.editorKey === "floor_segments") return state.data.floor_segments.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
  if (state.editorKey === "spaces") return state.data.spaces.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
  if (state.editorKey === "plan_assignments") return state.data.plan_assignments.filter((row) => row.plan_id === state.activePlanId);
  return state.data[state.editorKey];
}

function addEditorRow() {
  if (!state.permissions.canEdit) {
    updateStatus("当前账号没有编辑权限。");
    return;
  }
  const now = isoNow();
  const buildingCode = els.buildingSelect.value || "B01";
  const floorCode = els.floorSelect.value || "1";
  if (state.editorKey === "buildings") {
    state.data.buildings.push(normalizeBuilding({ building_code: `B${String(state.data.buildings.length + 1).padStart(2, "0")}`, building_name: "新增教学楼", campus_zone: "本部", building_number: state.data.buildings.length + 1, notes: "", created_at: now }));
  } else if (state.editorKey === "floor_segments") {
    state.data.floor_segments.push(normalizeSegment({ building_code: buildingCode, floor_code: floorCode, segment_code: `segment-${Date.now()}`, start_x_m: 0, start_y_m: 0, end_x_m: 18, end_y_m: 0, width_m: 2.4, element_type: "corridor", notes: "", created_at: now }));
  } else if (state.editorKey === "spaces") {
    state.data.spaces.push(normalizeSpace({ space_code: `S-${Date.now()}`, building_code: buildingCode, floor_code: floorCode, segment_code: state.data.floor_segments.find((row) => row.building_code === buildingCode && row.floor_code === floorCode)?.segment_code || "main", offset_m: 0, side: "north", front_door: "000", rear_door: "", length_m: 8, width_m: 6, network_segment: "", current_status: "active", created_at: now }));
  } else if (state.editorKey === "labs") {
    state.data.labs.push(normalizeLab({ lab_code: `LAB-${Date.now()}`, lab_name: "新增实验室", college: "未设置学院", major: "", lab_type: "教学实验室", director: "", seat_count: 0, computer_count: 0, status: "planning", notes: "", created_at: now }));
  } else if (state.editorKey === "plans") {
    state.data.plans.push(normalizePlan({ plan_code: `plan-${Date.now()}`, plan_name: "新增方案", plan_type: "draft", source_plan_code: "", description: "", is_locked: false, is_default_compare_before: false, is_default_compare_after: false, created_at: now }));
  } else if (state.editorKey === "plan_assignments") {
    const relation = relationMaps(state.data);
    state.data.plan_assignments.push(normalizeAssignment({
      plan_code: planById(state.activePlanId)?.plan_code || state.data.plans[0]?.plan_code || "baseline",
      lab_code: state.data.labs[0]?.lab_code || "",
      space_code: state.data.spaces.find((row) => row.building_code === buildingCode && row.floor_code === floorCode)?.space_code || "",
      previous_space_code: "",
      assignment_status: "assigned",
      move_note: "",
      effective_from: "",
      created_at: now,
    }, relation));
  }
  state.data = normalizeDataset(state.data);
  refreshStateAndRender("已新增一行。", { stamp: false, forceMoveReset: true });
}

async function applyEditorRows() {
  if (!state.permissions.canEdit) {
    updateStatus("当前账号没有编辑权限。");
    return;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
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
  try {
    await saveDatasetToServer(`编辑 ${state.editorKey}`);
    refreshStateAndRender("已应用表格修改。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    refreshStateAndRender(`表格保存失败：${error.message}`, { stamp: false, forceMoveReset: true });
  }
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

async function createPlanFromActive() {
  if (!state.permissions.canEdit) {
    updateStatus("当前账号没有新增方案权限。");
    return;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const activePlan = planById(state.activePlanId) || state.data.plans[0];
  if (!activePlan) {
    updateStatus("当前没有可复制的方案。");
    return;
  }

  const planCode = `plan-${Date.now()}`;
  const planName = uniquePlanName(`${activePlan.plan_name} 副本`);
  const newPlan = normalizePlan({
    plan_code: planCode,
    plan_name: planName,
    plan_type: "draft",
    source_plan_code: activePlan.plan_code,
    description: `基于 ${activePlan.plan_name} 复制创建`,
    is_locked: false,
    is_default_compare_before: false,
    is_default_compare_after: false,
    created_at: isoNow(),
  });

  const nextPlans = [...state.data.plans, newPlan];
  const relation = relationMaps({ spaces: state.data.spaces, labs: state.data.labs, plans: nextPlans });
  const copiedAssignments = state.data.plan_assignments
    .filter((row) => row.plan_id === activePlan.id)
    .map((row) => normalizeAssignment({
      plan_code: newPlan.plan_code,
      lab_code: row.lab_code,
      space_code: row.space_code,
      previous_space_code: row.previous_space_code,
      assignment_status: row.assignment_status,
      move_note: row.move_note,
      effective_from: row.effective_from,
      created_at: isoNow(),
    }, relation));

  state.data.plans = nextPlans;
  state.data.plan_assignments = [...state.data.plan_assignments, ...copiedAssignments];
  state.data = normalizeDataset(state.data);

  const beforePlanId = state.planViewMode === "compare" ? (els.beforePlanSelect.value || activePlan.id) : activePlan.id;
  els.beforePlanSelect.value = beforePlanId;
  els.afterPlanSelect.value = newPlan.id;
  state.activePlanId = newPlan.id;
  state.detailsMode = "view";

  refreshStateAndRender(`已基于 ${activePlan.plan_name} 新增方案 ${planName}。`, { stamp: false, forceMoveReset: true });
}

async function createPlanFromActiveAction() {
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  await createPlanFromActive();
  if (JSON.stringify(previousData) === JSON.stringify(state.data)) return;
  try {
    await saveDatasetToServer("新增方案");
    refreshStateAndRender("已保存新增方案。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    refreshStateAndRender(`新增方案失败：${error.message}`, { stamp: false, forceMoveReset: true });
  }
}

function uniquePlanName(baseName) {
  const names = new Set(state.data.plans.map((plan) => plan.plan_name));
  if (!names.has(baseName)) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function downloadCurrentSheet() {
  const definition = DATASETS.find((item) => item.key === state.editorKey);
  const rows = editorRows().map((row) => Object.fromEntries(definition.columns.map(([key]) => [key, row[key] ?? ""])));
  exportCsv(`${definition.sheet}.csv`, definition.columns, rows);
}

function downloadTemplateWorkbook() {
  try {
    if (!workbookAvailable()) {
      downloadJson("实验室布局维护模板.json", buildTemplatePackage());
      updateStatus("当前环境未加载 Excel 组件，已降级下载 JSON 模板。");
      return;
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(templateInstructions()), "说明");
    for (const definition of DATASETS) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(templateRows(definition.key)), definition.sheet);
    XLSX.writeFile(workbook, "实验室布局维护模板.xlsx");
    updateStatus("模板已开始下载。");
  } catch (error) {
    downloadJson("实验室布局维护模板.json", buildTemplatePackage());
    updateStatus(`Excel 模板生成失败，已降级下载 JSON 模板：${error.message}`);
  }
}

function exportWorkbook() {
  try {
    if (!workbookAvailable()) {
      downloadJson("实验室布局维护数据包.json", state.data);
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
    XLSX.writeFile(workbook, "实验室布局维护数据包.xlsx");
    updateStatus("数据包已开始下载。");
  } catch (error) {
    downloadJson("实验室布局维护数据包.json", state.data);
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
  const stage = els.floorplan.querySelector(".floorplan-stage");
  const svg = stage?.querySelector("svg");
  if (!stage || !svg) return;
  const width = Number(stage.dataset.layoutWidth);
  const height = Number(stage.dataset.layoutHeight);
  const bounds = els.floorplan.getBoundingClientRect();
  const paddingAllowance = 72;
  const fit = Math.max(0.1, Math.min(1, (bounds.width - paddingAllowance) / width, (bounds.height - paddingAllowance) / height));
  const scale = fit * state.zoom;
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const stageWidth = state.zoom > 1 ? scaledWidth : Math.max(scaledWidth, bounds.width - paddingAllowance);
  const stageHeight = state.zoom > 1 ? scaledHeight : Math.max(scaledHeight, bounds.height - paddingAllowance);

  els.floorplan.classList.toggle("is-zoomed", state.zoom > 1);
  els.canvasModeText.textContent = state.zoom === 1 ? "适配显示" : `缩放 ${Math.round(state.zoom * 100)}%`;
  stage.style.width = `${stageWidth}px`;
  stage.style.height = `${stageHeight}px`;
  svg.style.width = `${scaledWidth}px`;
  svg.style.height = `${scaledHeight}px`;

  if (state.zoom > 1) {
    els.floorplan.scrollLeft = Math.max(0, (stageWidth - bounds.width) / 2);
    els.floorplan.scrollTop = Math.max(0, (stageHeight - bounds.height) / 2);
  } else {
    els.floorplan.scrollLeft = 0;
    els.floorplan.scrollTop = 0;
  }
}

function updateDatasetSummary(text) {
  const assignedCount = state.data.plan_assignments.filter((row) => row.space_id).length;
  updateStatus(`${text}，${state.data.buildings.length} 栋楼，${state.data.spaces.length} 个空间，${state.data.labs.length} 个实验室，${assignedCount} 条已落位分配。`);
}

function updateStatus(text) {
  state.statusMessage = text;
  const workbookHint = workbookAvailable()
    ? ""
    : " 当前未加载 Excel 组件，可正常浏览和导入导出 JSON；如需导入 .xlsx 或导出 Excel，请在可访问 SheetJS CDN 的环境中打开。";
  els.statusText.textContent = `${text}${workbookHint}`;
}
