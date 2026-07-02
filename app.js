const {
  STORAGE_KEY,
  ALL_COLLEGES,
  DATASETS,
  csv,
  pick,
  compare,
  compareBuildings,
  normalizeDataset,
  normalizeColor,
  normalizeBuilding,
  normalizeSegment,
  normalizeSpace,
  normalizeLab,
  normalizeCollege,
  nextCollegeColor,
  normalizeMajor,
  normalizeLabType,
  canonicalizeLabTypes,
  normalizePlan,
  normalizeAssignment,
  relationMaps,
  generateBuildingCode,
  generateSpaceCode,
  generateSegmentCode,
  generateUnitCode,
  generatePlanCode,
  generateUseTypeCode,
  normalizeElementType,
  isAssignableSegment,
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
const { fetchJson } = window.FloorplanApp.Api;
const ImportExport = window.FloorplanApp.ImportExport;
const Canvas = window.FloorplanApp.Canvas;
const MoveBasket = window.FloorplanApp.MoveBasket;
const MoveControllerModule = window.FloorplanApp.MoveController;
const RawEditor = window.FloorplanApp.RawEditor;
const PlanManagement = window.FloorplanApp.PlanManagement;
const PlanScope = window.FloorplanApp.PlanScope;
const PlanActions = window.FloorplanApp.PlanActions;
const ManagedPlansModal = window.FloorplanApp.ManagedPlansModal;
const PlanDiff = window.FloorplanApp.PlanDiff;
const PlanDiffPanel = window.FloorplanApp.PlanDiffPanel;
const DetailActions = window.FloorplanApp.DetailActions;
const REMEMBERED_USER_KEY = "floorplan_remembered_user";
const RAW_EDITOR_REPLACED_BY_BUSINESS = new Set(["spaces", "labs", "plan_assignments"]);
const ADMIN_ONLY_RAW_EDITOR_KEYS = new Set(["colleges", "majors"]);
const RAW_EDITOR_DELETE_KEYS = new Set(["buildings", "floor_segments", "colleges", "majors", "lab_types"]);

const state = {
  data: emptyDataset(),
  serverRevision: 0,
  planCopies: [],
  user: null,
  permissions: { role: "viewer", canEdit: false, canAdmin: false },
  serverMode: false,
  maintenance: {
    textCorruptionDetected: false,
    textRepairAvailable: false,
    textRepairSourceLabel: "",
  },
  selectedSpaceId: null,
  editorMode: "raw",
  editorKey: "buildings",
  editorHighlight: null,
  activePlanId: null,
  planViewMode: "single",
  zoom: 1,
  mutedColleges: new Set(),
  detailsMode: "view",
  detailEditor: {
    mode: "view",
    moreOpen: false,
    errors: {},
  },
  inspectorMode: "details",
  moveDraft: null,
  moveErrors: {},
  moveDirty: false,
  moveTargetKey: null,
  moveBasket: {
    items: [],
    isOpen: false,
    draggingItemId: "",
  },
  moveUndoStack: [],
  moveDrag: null,
  suppressNextSpaceClick: false,
  pendingNavigation: null,
  planDeleteTargetId: null,
  loginSubmitting: false,
  userManagement: {
    users: [],
    loading: false,
  },
  planSpace: {
    planningSpaceId: "",
  },
  importDrafts: {
    drafts: [],
    selectedId: null,
    detail: null,
    loadingList: false,
    loadingDetail: false,
    preview: {
      buildingCode: "",
      floorCode: "",
      planId: "",
    },
  },
  planDraftName: "",
  planDiff: {
    summaryCollapsed: true,
    labCollapsed: true,
    spaceCollapsed: true,
  },
  statusMessage: "",
};

const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));
const MoveController = MoveControllerModule.createMoveController({
  state,
  els,
  MoveBasket,
  compare,
  colorMap,
  normalizeAssignment,
  relationMaps,
  normalizeDataset,
  cloneDataset,
  planById,
  copyMetaForPlan,
  spacesForPlan,
  canManageCopy,
  canEditActivePlan,
  getSelectedContext,
  moveTargetKey,
  buildMoveDraft,
  spaceDisplayName,
  syncSelectedSpace,
  renderEditor,
  renderApp,
  refreshStateAndRender,
  updateStatus,
  populateFloorOptions,
  saveActivePlanCopyToServer,
  saveDatasetToServer,
  saveAssignmentActionToServer: submitAssignmentActionToServer,
});
const RawEditorController = RawEditor.createRawEditor({
  state,
  els,
  DATASETS,
  RAW_EDITOR_DELETE_KEYS,
  ImportExport,
  escapeHtml,
  isoNow,
  normalizeColor,
  nextCollegeColor,
  normalizeNumberingAction,
  generateBuildingCode,
  generateSegmentCode,
  generateUnitCode,
  generateUseTypeCode,
  generatePlanCode,
  normalizeElementType,
  normalizeDataset,
  normalizeBuilding,
  normalizeSegment,
  normalizeSpace,
  normalizeLab,
  normalizeCollege,
  normalizeMajor,
  normalizeLabType,
  canonicalizeLabTypes,
  normalizePlan,
  normalizeAssignment,
  relationMaps,
  isAssignableSegment,
  canEditEditorKey,
  buildingByCode,
  planById,
  activePlanCopyMeta,
  copyScopeForActivePlan,
  rowVisibleForActivePlan,
  spacesForActivePlan,
  floorSegmentsForActivePlan,
  labsForActivePlan,
  firstAssignableSegmentCode,
  nextGeneratedBuildingDraft,
  nextSegmentCodeForDraft,
  nextUnitCode,
  activeCollegeOptions,
  segmentTypeLabel,
  saveWithRollback,
  savePlanAssignmentsWithRollback,
  saveRawMaintenanceActionToServer: submitRawMaintenanceActionToServer,
  cloneDataset,
  refreshStateAndRender,
  updateStatus,
});

bindEvents();
renderEditorTabs();
bootstrap();

function bindEvents() {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
  els.packageFileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!state.permissions.canAdmin) {
      updateStatus("只有管理员可以上传新的数据包草稿。");
      return;
    }
    if (!file) return;
    runWithUnsavedGuard(() => { void importPackageFile(file); });
  });
  els.loadSampleBtn.addEventListener("click", () => runWithUnsavedGuard(loadSampleData));
  els.downloadTemplateBtn.addEventListener("click", () => ImportExport.downloadTemplateWorkbook(updateStatus));
  els.exportWorkbookBtn.addEventListener("click", () => runWithUnsavedGuard(() => ImportExport.exportWorkbook(state, updateStatus)));
  els.manageImportsBtn.addEventListener("click", () => void manageImportDrafts());
  els.closeImportDraftsBtn.addEventListener("click", closeImportDraftsModal);
  els.refreshImportDraftsBtn.addEventListener("click", () => void loadImportDrafts());
  els.publishImportDraftBtn.addEventListener("click", () => void publishSelectedImportDraft());
  els.discardImportDraftBtn.addEventListener("click", () => void discardSelectedImportDraft());
  els.manageSnapshotsBtn.addEventListener("click", () => void manageSnapshots());
  els.manageUsersBtn.addEventListener("click", () => void manageUsers());
  els.normalizeNumberingBtn.addEventListener("click", () => void normalizeNumberingAction());
  els.repairTextBtn.addEventListener("click", () => void repairCorruptedText());
  els.loginBtn.addEventListener("click", openLoginModal);
  els.logoutBtn.addEventListener("click", () => void logoutFlow());
  els.fitCanvasBtn.addEventListener("click", () => Canvas.resetCanvasZoom(state, els));
  els.zoomOutBtn.addEventListener("click", () => Canvas.changeCanvasZoom(state, els, -0.15));
  els.zoomInBtn.addEventListener("click", () => Canvas.changeCanvasZoom(state, els, 0.15));
  Canvas.bindCanvasPan(state, els);
  els.addRowBtn.addEventListener("click", () => runWithUnsavedGuard(addEditorRow));
  els.applyTableBtn.addEventListener("click", () => runWithUnsavedGuard(() => { void applyEditorRows(); }));
  els.downloadSheetBtn.addEventListener("click", () => runWithUnsavedGuard(downloadEditorData));
  els.newPlanBtn.addEventListener("click", () => runWithUnsavedGuard(openNewPlanModal));
  els.toggleVisibilityBtn.addEventListener("click", () => void toggleActivePlanVisibility());
  els.deletePlanBtn.addEventListener("click", () => runWithUnsavedGuard(openDeletePlanModal));
  els.singleModeBtn.addEventListener("click", () => runWithUnsavedGuard(() => setPlanViewMode("single")));
  els.compareModeBtn.addEventListener("click", () => runWithUnsavedGuard(() => setPlanViewMode("compare")));
  els.legend.addEventListener("click", handleLegendClick);

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
  els.currentPlanSelect.addEventListener("change", (event) => handleSelectChange(event, onPlanSelectorChange));
  els.beforePlanSelect.addEventListener("change", (event) => handleSelectChange(event, onPlanSelectorChange));
  els.afterPlanSelect.addEventListener("change", (event) => handleSelectChange(event, onPlanSelectorChange));

  els.unsavedSaveContinueBtn.addEventListener("click", saveAndContinuePendingAction);
  els.unsavedDiscardContinueBtn.addEventListener("click", discardAndContinuePendingAction);
  els.unsavedStayBtn.addEventListener("click", closeUnsavedModal);

  els.confirmDeletePlanBtn.addEventListener("click", () => void confirmDeletePlanAction());
  els.cancelDeletePlanBtn.addEventListener("click", closeDeletePlanModal);
  els.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void loginFlow();
  });
  els.cancelLoginBtn.addEventListener("click", closeLoginModal);
  els.togglePasswordBtn.addEventListener("click", togglePasswordVisibility);
  els.userCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createManagedUserAction();
  });
  els.closeUserManagementBtn.addEventListener("click", closeUserManagementModal);
  els.refreshUsersBtn.addEventListener("click", () => void loadManagedUsers());
  els.cancelPlanSpaceBtn.addEventListener("click", closePlanSpaceModal);
  els.planSpaceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void confirmPlanSpaceAction();
  });
  els.newPlanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createPlanFromActiveAction();
  });
  els.cancelNewPlanBtn.addEventListener("click", closeNewPlanModal);
  els.newUnplacedLabForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createUnplacedLabAction();
  });
  els.cancelNewUnplacedLabBtn.addEventListener("click", closeNewUnplacedLabModal);

  window.addEventListener("resize", () => els.floorplan.classList.contains("is-fit") && Canvas.applyCanvasMode(state, els));
}

function handleDocumentClick(event) {
  if (!state.detailEditor.moreOpen) return;
  if (event.target && event.target.closest(".detail-more-wrap")) return;
  state.detailEditor.moreOpen = false;
  renderApp();
}

function handleDocumentKeydown(event) {
  if (!state.detailEditor.moreOpen) return;
  if (!(event.key === "Escape")) return;
  state.detailEditor.moreOpen = false;
  renderApp();
}

async function bootstrap() {
  try {
    // 优先连接服务端；开发或离线打开页面失败时，再降级到 localStorage 示例模式。
    const payload = await fetchJson("/api/bootstrap");
    state.serverMode = true;
    state.user = payload.user;
    state.permissions = payload.permissions;
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.maintenance = payload.maintenance || state.maintenance;
    state.data = normalizeDataset(payload.dataset);
    resetContextState();
    refreshStateAndRender(buildBootstrapStatus("已加载服务器当前数据"), { stamp: false, forceMoveReset: true });
    return;
  } catch (error) {
    console.warn("bootstrap from server failed", error);
  }
  bootstrapLocal();
}

function cloneDataset(dataset) {
  return JSON.parse(JSON.stringify(dataset));
}

async function saveWithRollback(previousData, previousRevision, changeNote, failurePrefix) {
  try {
    await saveDatasetToServer(changeNote);
    return true;
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    refreshStateAndRender(`${failurePrefix}：${error.message}`, { stamp: false, forceMoveReset: true });
    return false;
  }
}

function buildBootstrapStatus(baseText) {
  if (!state.maintenance.textCorruptionDetected) return baseText;
  const suffix = state.permissions.canAdmin && state.maintenance.textRepairAvailable
    ? ` 检测到当前正式数据的中文文本可能已损坏，可点击“修复中文显示”恢复。`
    : " 检测到当前正式数据的中文文本可能已损坏。";
  return `${baseText}。${suffix}`;
}

function applyAuthUi() {
  const role = state.permissions.role || "viewer";
  els.authStatus.textContent = state.user ? `${state.user.username} · ${role}` : "访客只读";
  els.authStatus.classList.toggle("is-viewer", role === "viewer");
  els.authStatus.classList.toggle("is-admin", role === "admin");
  els.loginBtn.hidden = Boolean(state.user);
  els.logoutBtn.hidden = !state.user;
  els.importPackageLabel.hidden = !state.permissions.canAdmin;
  els.packageFileInput.disabled = !state.permissions.canAdmin;
  els.downloadTemplateBtn.hidden = !state.permissions.canEdit;
  els.manageImportsBtn.hidden = !state.permissions.canAdmin;
  els.manageSnapshotsBtn.hidden = !state.permissions.canAdmin;
  els.manageUsersBtn.hidden = !state.permissions.canAdmin;
  els.normalizeNumberingBtn.hidden = !state.permissions.canAdmin;
  els.repairTextBtn.hidden = !(state.permissions.canAdmin && state.maintenance.textRepairAvailable);
  els.loadSampleBtn.hidden = state.serverMode;
  els.addRowBtn.hidden = !state.permissions.canEdit;
  els.applyTableBtn.hidden = !state.permissions.canEdit;
  els.newPlanBtn.hidden = !state.permissions.canEdit;
  els.toggleVisibilityBtn.hidden = !state.permissions.canEdit;
  els.deletePlanBtn.hidden = !state.permissions.canEdit;
}

function openLoginModal() {
  els.loginUsernameInput.value = localStorage.getItem(REMEMBERED_USER_KEY) || "";
  els.loginPasswordInput.value = "";
  els.loginErrorText.textContent = "";
  els.loginPasswordInput.type = "password";
  els.togglePasswordBtn.textContent = "显示";
  els.loginModal.classList.remove("is-hidden");
  els.loginModal.setAttribute("aria-hidden", "false");
  setTimeout(() => (els.loginUsernameInput.value ? els.loginPasswordInput : els.loginUsernameInput).focus(), 0);
}

function closeLoginModal() {
  els.loginModal.classList.add("is-hidden");
  els.loginModal.setAttribute("aria-hidden", "true");
  els.loginErrorText.textContent = "";
  state.loginSubmitting = false;
  els.loginSubmitBtn.disabled = false;
}

function togglePasswordVisibility() {
  const isPassword = els.loginPasswordInput.type === "password";
  els.loginPasswordInput.type = isPassword ? "text" : "password";
  els.togglePasswordBtn.textContent = isPassword ? "隐藏" : "显示";
}

async function loginFlow() {
  const username = els.loginUsernameInput.value.trim();
  const password = els.loginPasswordInput.value;
  const remember = els.rememberLoginInput.checked;
  if (!username || !password || state.loginSubmitting) {
    els.loginErrorText.textContent = "请输入账号和密码。";
    return;
  }
  state.loginSubmitting = true;
  els.loginErrorText.textContent = "";
  els.loginSubmitBtn.disabled = true;
  try {
    const payload = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, remember }),
    });
    localStorage.setItem(REMEMBERED_USER_KEY, username);
    state.user = payload.user;
    state.permissions = payload.permissions;
    await reloadDatasetFromServer(`已登录为 ${payload.user.username}`);
    closeLoginModal();
  } catch (error) {
    els.loginErrorText.textContent = error.message;
  } finally {
    state.loginSubmitting = false;
    els.loginSubmitBtn.disabled = false;
  }
}

async function logoutFlow() {
  try {
    await fetchJson("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    state.user = null;
    state.permissions = { role: "viewer", canEdit: false, canAdmin: false };
    await reloadDatasetFromServer("已退出登录");
    state.loginSubmitting = false;
  } catch (error) {
    updateStatus(`退出失败：${error.message}`);
  }
}

async function saveDatasetToServer(changeNote) {
  if (!state.serverMode) return true;
  const activeCopy = activePlanCopyMeta();
  if (activeCopy && canEditPlanDataset(activeCopy)) {
    const payload = await fetchJson(`/api/plan-copies/${activeCopy.id}/dataset`, {
      method: "PUT",
      body: JSON.stringify({
        dataset: state.data,
        expectedRevision: activeCopy.revision,
        changeNote,
      }),
    });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    if (payload.maintenance) state.maintenance = payload.maintenance;
    persistDataset();
    return true;
  }
  if (!state.permissions.canAdmin) throw new Error("只有管理员可以修改共享基线数据");
  const payload = await fetchJson("/api/dataset/active", {
    method: "PUT",
    body: JSON.stringify({
      dataset: datasetForActiveSave(state.data),
      expectedRevision: state.serverRevision,
      changeNote,
    }),
  });
  state.serverRevision = payload.revision;
  state.planCopies = payload.planCopies || [];
  state.data = normalizeDataset(payload.dataset);
  if (payload.maintenance) state.maintenance = payload.maintenance;
  persistDataset();
  return true;
}

function plainObjectFromFormData(formData) {
  if (!formData || typeof formData.entries !== "function") return { ...(formData || {}) };
  return Object.fromEntries(formData.entries());
}

function detailActionName(mode) {
  if (mode === "editLab") return "editLab";
  if (mode === "renovateRoom") return "renovateRoom";
  if (mode === "createSpace") return "createSpace";
  if (mode === "editSpace") return "editSpace";
  if (mode === "deleteSpace") return "deleteSpace";
  return mode;
}

async function submitDetailActionToServer(mode, formData, selectedSpace, changeNote) {
  if (!state.serverMode) return null;
  const activeCopy = activePlanCopyMeta();
  const endpoint = activeCopy && canEditPlanDataset(activeCopy)
    ? `/api/plan-copies/${activeCopy.id}/detail-actions`
    : "/api/dataset/active/detail-actions";
  const expectedRevision = activeCopy && canEditPlanDataset(activeCopy) ? activeCopy.revision : state.serverRevision;
  const payload = await fetchJson(endpoint, {
    method: "POST",
    body: JSON.stringify({
      action: detailActionName(mode),
      expectedRevision,
      planCode: planById(state.activePlanId)?.plan_code || planById(state.activePlanId)?.id || "",
      buildingCode: els.buildingSelect?.value || getSelectedContext().building?.building_code || "",
      floorCode: els.floorSelect?.value || getSelectedContext().floorCode || "",
      selectedSpace: selectedSpace ? { id: selectedSpace.id, space_code: selectedSpace.space_code } : null,
      form: plainObjectFromFormData(formData),
      changeNote,
    }),
  });
  state.serverRevision = payload.revision;
  state.planCopies = payload.planCopies || [];
  state.data = normalizeDataset(payload.dataset);
  if (payload.maintenance) state.maintenance = payload.maintenance;
  persistDataset();
  return payload;
}

async function submitAssignmentActionToServer(action, payload = {}) {
  if (!state.serverMode) return null;
  const activePlanValue = planById(state.activePlanId);
  const activeCopy = activePlanCopyMeta();
  const useCopyEndpoint = activeCopy && canEditPlanDataset(activeCopy);
  const endpoint = useCopyEndpoint
    ? `/api/plan-copies/${activeCopy.id}/assignment-actions`
    : "/api/dataset/active/assignment-actions";
  const expectedRevision = useCopyEndpoint ? activeCopy.revision : state.serverRevision;
  const response = await fetchJson(endpoint, {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      action,
      expectedRevision,
      planCode: activePlanValue?.plan_code || activePlanValue?.id || "",
    }),
  });
  state.serverRevision = response.revision;
  state.planCopies = response.planCopies || [];
  state.data = normalizeDataset(response.dataset);
  if (response.maintenance) state.maintenance = response.maintenance;
  persistDataset();
  return response;
}

async function submitRawMaintenanceActionToServer(key, action, payload = {}) {
  if (!state.serverMode) return null;
  const response = await fetchJson(`/api/dataset/active/raw-maintenance/${encodeURIComponent(key)}/actions`, {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      action,
      expectedRevision: state.serverRevision,
    }),
  });
  state.serverRevision = response.revision;
  state.planCopies = response.planCopies || [];
  state.data = normalizeDataset(response.dataset);
  if (response.maintenance) state.maintenance = response.maintenance;
  persistDataset();
  return response;
}

async function saveActivePlanCopyToServer() {
  if (!state.serverMode) return true;
  const activePlan = planById(state.activePlanId);
  const copy = copyMetaForPlan(activePlan);
  if (!canManageCopy(copy)) throw new Error("只能保存自己创建的方案副本");
  const payload = await fetchJson(`/api/plan-copies/${copy.id}/assignments`, {
    method: "PUT",
    body: JSON.stringify({
      assignments: assignmentRowsForPlan(activePlan.id),
      expectedRevision: copy.revision,
    }),
  });
  state.serverRevision = payload.revision;
  state.planCopies = payload.planCopies || [];
  state.data = normalizeDataset(payload.dataset);
  if (payload.maintenance) state.maintenance = payload.maintenance;
  persistDataset();
  return true;
}

async function savePlanAssignmentsWithRollback(previousData, previousRevision) {
  const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
  try {
    await saveActivePlanCopyToServer();
    return true;
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    state.planCopies = previousCopies;
    refreshStateAndRender(`方案副本保存失败：${error.message}`, { stamp: false, forceMoveReset: true });
    return false;
  }
}

async function repairCorruptedText() {
  if (!state.permissions.canAdmin || !state.maintenance.textRepairAvailable) return;
  try {
    const payload = await fetchJson("/api/dataset/repair-text", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.serverRevision = payload.revision;
    state.data = normalizeDataset(payload.dataset);
    state.maintenance = payload.maintenance || state.maintenance;
    resetContextState();
    refreshStateAndRender("已修复当前正式数据中的中文文本。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    updateStatus(`修复中文文本失败：${error.message}`);
  }
}

async function normalizeNumberingAction() {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以规范编号。");
    return;
  }
  if (!window.confirm("确认规范全量编号？系统会先创建快照，然后同步修复教学楼、骨架、空间、方案和用途类型编码。")) return;
  try {
    const payload = await fetchJson("/api/dataset/normalize-numbering", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    state.maintenance = payload.maintenance || state.maintenance;
    resetContextState();
    refreshStateAndRender("已完成全量编号规范化，系统已创建迁移前快照。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    updateStatus(`规范编号失败：${error.message}`);
  }
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
  // 先把控件值回退，等未保存搬迁内容处理完后再真正切换筛选条件。
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
    else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (!(await ImportExport.ensureWorkbookAvailable(updateStatus))) throw new Error("Excel 组件加载失败，请改为导入 JSON 数据包。");
      raw = ImportExport.readWorkbookDataset(await file.arrayBuffer());
    } else throw new Error("请导入单个 Excel 数据包，或在无法读取 Excel 时导入 JSON 数据包。");
    const normalized = normalizeDataset(raw);
    const payload = await fetchJson("/api/imports", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        sourceType: name.endsWith(".json") ? "json" : "xlsx",
        dataset: normalized,
      }),
    });
    await reloadDatasetFromServer(`已导入数据包并创建 ${payload.importedPlans?.length || 0} 个管理员私有方案，可在“管理方案”中预览和设为基线。`);
  } catch (error) {
    updateStatus(`导入失败：${error.message}`);
  }
}

async function manageImportDrafts() {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以管理方案。");
    return;
  }
  openImportDraftsModal();
  await loadImportDrafts();
}

function openImportDraftsModal() {
  els.importDraftsErrorText.textContent = "";
  els.importDraftsModal.classList.remove("is-hidden");
  els.importDraftsModal.setAttribute("aria-hidden", "false");
  renderImportDrafts();
}

function closeImportDraftsModal() {
  els.importDraftsModal.classList.add("is-hidden");
  els.importDraftsModal.setAttribute("aria-hidden", "true");
  els.importDraftsErrorText.textContent = "";
}

async function loadImportDrafts() {
  state.importDrafts.loadingList = true;
  renderImportDrafts();
  try {
    const payload = await fetchJson("/api/manage/plans");
    state.importDrafts.drafts = payload.plans || [];
    els.importDraftsErrorText.textContent = "";
    const selectedStillExists = state.importDrafts.drafts.some((plan) => String(plan.id) === String(state.importDrafts.selectedId));
    if (!selectedStillExists) {
      state.importDrafts.selectedId = null;
      state.importDrafts.detail = null;
    }
    renderImportDrafts();
    const firstPlan = state.importDrafts.drafts[0];
    if (!state.importDrafts.selectedId && firstPlan) {
      await selectImportDraft(firstPlan.id);
    } else if (state.importDrafts.selectedId && !state.importDrafts.detail) {
      await selectImportDraft(state.importDrafts.selectedId);
    }
  } catch (error) {
    els.importDraftsErrorText.textContent = `方案列表加载失败：${error.message}`;
  } finally {
    state.importDrafts.loadingList = false;
    renderImportDrafts();
  }
}

async function selectImportDraft(planId) {
  if (!planId) return;
  state.importDrafts.selectedId = planId;
  state.importDrafts.detail = null;
  state.importDrafts.loadingDetail = true;
  renderImportDrafts();
  try {
    const draft = state.importDrafts.drafts.find((plan) => String(plan.id) === String(planId));
    const payload = await fetchJson(managedPlanEndpoint(draft || { id: planId }));
    state.importDrafts.detail = {
      ...payload.plan,
      dataset: normalizeDataset(payload.dataset),
    };
    initializeImportPreviewState();
    els.importDraftsErrorText.textContent = "";
  } catch (error) {
    els.importDraftsErrorText.textContent = `方案详情加载失败：${error.message}`;
  } finally {
    state.importDrafts.loadingDetail = false;
    renderImportDrafts();
  }
}

function initializeImportPreviewState() {
  const dataset = state.importDrafts.detail?.dataset;
  const detail = state.importDrafts.detail;
  if (!dataset || !detail) return;
  const context = ManagedPlansModal.choosePreviewContext(dataset, state.importDrafts.preview, detail.planCode || state.importDrafts.preview.planId);
  const plan = resolvePreviewPlan(dataset, detail.planCode || state.importDrafts.preview.planId) || dataset.plans[0] || null;
  state.importDrafts.preview = {
    buildingCode: context.buildingCode,
    floorCode: context.floorCode,
    planId: plan?.id || plan?.plan_code || "",
  };
}

function renderImportDrafts() {
  renderImportDraftList();
  renderImportDraftDetail();
}

function renderImportDraftList() {
  els.importDraftList.innerHTML = ManagedPlansModal.renderManagedPlanListHtml({
    plans: state.importDrafts.drafts,
    selectedId: state.importDrafts.selectedId,
    loading: state.importDrafts.loadingList,
  });
  els.importDraftList.querySelectorAll("[data-import-draft-id]").forEach((button) => {
    button.addEventListener("click", () => void selectImportDraft(button.dataset.importDraftId));
  });
}

function renderImportDraftDetail() {
  const detail = state.importDrafts.detail;
  const canAct = Boolean(detail && !state.importDrafts.loadingDetail);
  els.publishImportDraftBtn.disabled = !canAct;
  els.discardImportDraftBtn.disabled = !canAct || detail?.canDelete === false;
  els.publishImportDraftBtn.textContent = detail?.isBaseline ? "取消基线" : "设为基线";
  els.importDraftDetail.innerHTML = ManagedPlansModal.renderManagedPlanDetailHtml({
    detail,
    loading: state.importDrafts.loadingDetail,
  });
  if (state.importDrafts.loadingDetail || !detail) {
    return;
  }

  const dataset = detail.dataset;
  bindImportDraftDetailEvents(dataset);
  renderImportPreviewCanvas();
}

function bindImportDraftDetailEvents(dataset) {
  els.importDraftDetail.querySelector("#renameManagedPlanBtn")?.addEventListener("click", () => void renameSelectedManagedPlan());

  const buildingSelect = els.importDraftDetail.querySelector("#importPreviewBuildingSelect");
  const planSelect = els.importDraftDetail.querySelector("#importPreviewPlanSelect");
  fillInlineSelect(buildingSelect, dataset.buildings.slice().sort(compareBuildings).map((row) => ({
    value: row.building_code,
    label: `${row.campus_zone || "未分区"} - ${row.building_name || row.building_code}`,
  })), state.importDrafts.preview.buildingCode);
  fillImportPreviewFloors(dataset);
  fillInlineSelect(planSelect, dataset.plans.map((plan) => ({ value: plan.id || plan.plan_code, label: plan.plan_name || plan.plan_code })), state.importDrafts.preview.planId);

  buildingSelect?.addEventListener("change", () => {
    state.importDrafts.preview.buildingCode = buildingSelect.value;
    const floors = unique(dataset.floor_segments.filter((row) => row.building_code === buildingSelect.value).map((row) => row.floor_code)).sort(compare);
    state.importDrafts.preview.floorCode = floors[0] || "";
    fillImportPreviewFloors(dataset);
    renderImportPreviewCanvas();
  });
  els.importDraftDetail.querySelector("#importPreviewFloorSelect")?.addEventListener("change", (event) => {
    state.importDrafts.preview.floorCode = event.target.value;
    renderImportPreviewCanvas();
  });
  planSelect?.addEventListener("change", () => {
    state.importDrafts.preview.planId = planSelect.value;
    renderImportPreviewCanvas();
  });
}

function resolvePreviewPlan(dataset, planId) {
  return dataset.plans.find((plan) => plan.id === planId || plan.plan_code === planId) || null;
}

function fillImportPreviewFloors(dataset) {
  const floorSelect = els.importDraftDetail.querySelector("#importPreviewFloorSelect");
  const floors = unique(dataset.floor_segments
    .filter((row) => row.building_code === state.importDrafts.preview.buildingCode)
    .map((row) => row.floor_code))
    .sort(compare)
    .map((row) => ({ value: row, label: row }));
  fillInlineSelect(floorSelect, floors, state.importDrafts.preview.floorCode);
  state.importDrafts.preview.floorCode = floorSelect?.value || "";
}

function fillInlineSelect(select, items, selectedValue) {
  if (!select) return;
  select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  select.value = items.some((item) => item.value === selectedValue) ? selectedValue : (items[0]?.value || "");
}

function renderImportPreviewCanvas() {
  const detail = state.importDrafts.detail;
  const canvas = els.importDraftDetail.querySelector("#importPreviewCanvas");
  const badge = els.importDraftDetail.querySelector("#importPreviewPlanBadge");
  if (!detail || !canvas || !badge) return;
  const dataset = detail.dataset;
  const building = dataset.buildings.find((row) => row.building_code === state.importDrafts.preview.buildingCode);
  const activePlan = resolvePreviewPlan(dataset, state.importDrafts.preview.planId) || dataset.plans[0] || null;
  if (!building || !state.importDrafts.preview.floorCode || !activePlan) {
    canvas.innerHTML = `<div class="empty">当前方案缺少可预览的楼栋、楼层或方案数据。</div>`;
    badge.textContent = "方案预览";
    return;
  }
  renderFloorplan({
    floorplanEl: canvas,
    activePlanBadgeEl: badge,
    data: dataset,
    building,
    floorCode: state.importDrafts.preview.floorCode,
    activePlan,
    colors: colorMap(dataset),
    selectedSpaceId: null,
    collegeFilter: ALL_COLLEGES,
    onSelectSpace: () => {},
  });
}

function managedPlanSourceLabel(plan) {
  return ManagedPlansModal.managedPlanSourceLabel(plan);
}

function managedPlanEndpoint(plan, suffix = "") {
  return ManagedPlansModal.managedPlanEndpoint(plan, suffix);
}

async function renameSelectedManagedPlan() {
  const detail = state.importDrafts.detail;
  const input = els.importDraftDetail.querySelector("#managedPlanNameInput");
  const planName = input?.value.trim();
  if (!detail || !planName) return;
  try {
    const payload = await fetchJson(managedPlanEndpoint(detail), {
      method: "PATCH",
      body: JSON.stringify({ planName }),
    });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    updateStatus(`已重命名方案为 ${planName}`);
    await loadImportDrafts();
    await selectImportDraft(detail.id);
    refreshStateAndRender(`已重命名方案为 ${planName}`, { stamp: false });
  } catch (error) {
    els.importDraftsErrorText.textContent = `方案重命名失败：${error.message}`;
  }
}

async function publishSelectedImportDraft() {
  const detail = state.importDrafts.detail;
  if (!detail) return;
  const nextBaseline = !detail.isBaseline;
  const message = nextBaseline
    ? `确认将方案“${detail.planName}”设为基线？设为基线后，除管理员外其他用户不可修改。`
    : `确认取消方案“${detail.planName}”的基线设置？取消后将不再作为基线方案展示。`;
  if (!window.confirm(message)) return;
  els.publishImportDraftBtn.disabled = true;
  try {
    const payload = await fetchJson(managedPlanEndpoint(detail, "/baseline"), { method: "POST", body: JSON.stringify({ isBaseline: nextBaseline }) });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    refreshStateAndRender(nextBaseline ? `已将 ${detail.planName} 设为基线` : `已取消 ${detail.planName} 的基线设置`, { stamp: false, forceMoveReset: true });
    await loadImportDrafts();
    await selectImportDraft(detail.id);
  } catch (error) {
    els.importDraftsErrorText.textContent = `${nextBaseline ? "设置" : "取消"}基线失败：${error.message}`;
  }
}

async function discardSelectedImportDraft() {
  const detail = state.importDrafts.detail;
  if (!detail) return;
  const risk = detail.isBaseline || !detail.isMine ? "此操作会删除基线或他人公开方案，" : "";
  if (!window.confirm(`${risk}确认删除方案“${detail.planName}”？删除后该方案及其分配将不再显示。`)) return;
  els.discardImportDraftBtn.disabled = true;
  try {
    const payload = await fetchJson(managedPlanEndpoint(detail), { method: "DELETE" });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    updateStatus(`已删除方案 ${detail.planName}`);
    state.importDrafts.selectedId = null;
    state.importDrafts.detail = null;
    resetContextState();
    await loadImportDrafts();
  } catch (error) {
    els.importDraftsErrorText.textContent = `方案删除失败：${error.message}`;
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

async function manageUsers() {
  if (!state.permissions.canAdmin) {
    updateStatus("只有管理员可以管理用户。");
    return;
  }
  openUserManagementModal();
  await loadManagedUsers();
}

function openUserManagementModal() {
  els.userManagementErrorText.textContent = "";
  els.userManagementModal.classList.remove("is-hidden");
  els.userManagementModal.setAttribute("aria-hidden", "false");
  setTimeout(() => els.newUsernameInput.focus(), 0);
}

function closeUserManagementModal() {
  els.userManagementModal.classList.add("is-hidden");
  els.userManagementModal.setAttribute("aria-hidden", "true");
  els.userManagementErrorText.textContent = "";
  els.userCreateForm.reset();
  els.newUserRoleSelect.value = "editor";
}

async function loadManagedUsers() {
  state.userManagement.loading = true;
  renderManagedUsers();
  try {
    const payload = await fetchJson("/api/users");
    state.userManagement.users = payload.users || [];
    els.userManagementErrorText.textContent = "";
  } catch (error) {
    els.userManagementErrorText.textContent = `用户列表加载失败：${error.message}`;
  } finally {
    state.userManagement.loading = false;
    renderManagedUsers();
  }
}

function renderManagedUsers() {
  if (state.userManagement.loading) {
    els.userTableBody.innerHTML = `<tr><td colspan="6">正在加载用户...</td></tr>`;
    return;
  }
  if (!state.userManagement.users.length) {
    els.userTableBody.innerHTML = `<tr><td colspan="6">暂无用户。</td></tr>`;
    return;
  }
  els.userTableBody.innerHTML = state.userManagement.users.map((user) => {
    const isSelf = state.user?.id === user.id;
    const canDisable = user.isActive && !isSelf;
    const statusClass = user.isActive ? "status-pill" : "status-pill is-disabled";
    const statusText = user.isActive ? "启用" : "禁用";
    const action = canDisable
      ? `<button type="button" data-user-disable="${user.id}">禁用</button>`
      : `<button type="button" disabled>${isSelf ? "当前账号" : "已禁用"}</button>`;
    return `
      <tr>
        <td>#${user.id}</td>
        <td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.role)}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
        <td>${escapeHtml(formatDateTime(user.createdAt))}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join("");
  els.userTableBody.querySelectorAll("[data-user-disable]").forEach((button) => {
    button.addEventListener("click", () => void disableManagedUserAction(Number(button.dataset.userDisable)));
  });
}

async function createManagedUserAction() {
  const username = els.newUsernameInput.value.trim();
  const password = els.newUserPasswordInput.value;
  const role = els.newUserRoleSelect.value;
  if (!username || !password || !["admin", "editor"].includes(role)) {
    els.userManagementErrorText.textContent = "请输入用户名、初始密码，并选择 admin 或 editor。";
    return;
  }
  els.createUserBtn.disabled = true;
  try {
    await fetchJson("/api/users", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    });
    els.userCreateForm.reset();
    els.newUserRoleSelect.value = "editor";
    updateStatus(`已创建用户 ${username}。`);
    await loadManagedUsers();
  } catch (error) {
    els.userManagementErrorText.textContent = `创建用户失败：${error.message}`;
  } finally {
    els.createUserBtn.disabled = false;
  }
}

async function disableManagedUserAction(userId) {
  const user = state.userManagement.users.find((item) => item.id === userId);
  if (!user || !user.isActive || state.user?.id === userId) return;
  if (!window.confirm(`确认禁用用户 ${user.username}？该用户现有登录会话会立即失效。`)) return;
  try {
    await fetchJson(`/api/users/${userId}`, { method: "DELETE" });
    updateStatus(`已禁用用户 ${user.username}。`);
    await loadManagedUsers();
  } catch (error) {
    els.userManagementErrorText.textContent = `禁用用户失败：${error.message}`;
  }
}

async function reloadDatasetFromServer(message) {
  const payload = await fetchJson("/api/dataset/active");
  state.serverRevision = payload.revision;
  state.planCopies = payload.planCopies || [];
  state.maintenance = payload.maintenance || state.maintenance;
  state.data = normalizeDataset(payload.dataset);
  resetContextState();
  refreshStateAndRender(message, { stamp: false, forceMoveReset: true });
}

function resetContextState() {
  state.selectedSpaceId = null;
  state.editorHighlight = null;
  state.activePlanId = null;
  state.detailsMode = "view";
  resetDetailEditorState();
  state.moveDraft = null;
  state.moveErrors = {};
  state.moveDirty = false;
  state.moveTargetKey = null;
  state.moveBasket = { items: [], isOpen: false, draggingItemId: "" };
  state.moveUndoStack = [];
  state.moveDrag = null;
  state.pendingNavigation = null;
  state.planDeleteTargetId = null;
}

function resetDetailEditorState() {
  state.detailEditor = { mode: "view", moreOpen: false, errors: {} };
}

function refreshStateAndRender(message, options = {}) {
  const { stamp = false, forceMoveReset = false } = options;
  // 统一入口：任何数据变更后都经过这里同步控件、权限、编辑表、主图和状态栏。
  if (stamp) stampMetadata(message);
  persistDataset();
  syncPlanViewMode();
  populateBuildingOptions();
  populateFloorOptions();
  populatePlanOptions();
  ensureActivePlan();
  syncSelectedSpace();
  syncMoveDraft(forceMoveReset);
  syncSavedUnplacedMoveBasketItems();
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

function copyIdFromPlan(plan) {
  return PlanManagement.copyIdFromPlan(plan);
}

function datasetForActiveSave(dataset) {
  const copyCodes = new Set(state.planCopies.map((copy) => String(copy.planCode || "")));
  const copyIds = new Set(state.planCopies.map((copy) => String(copy.id || "")));
  const next = cloneDataset(dataset);
  next.plans = (next.plans || []).filter((plan) => {
    const copyId = String(plan.copy_id || plan.copyId || "").trim();
    const code = String(plan.plan_code || "").trim();
    return !copyId && !copyIds.has(copyId) && !copyCodes.has(code) && !code.startsWith("copy-");
  });
  const activePlanCodes = new Set(next.plans.map((plan) => plan.plan_code));
  next.plan_assignments = (next.plan_assignments || []).filter((assignment) => activePlanCodes.has(assignment.plan_code));
  return next;
}

function copyMetaForPlan(plan) {
  return PlanManagement.copyMetaForPlan(plan, state.planCopies);
}

function datasetForPlanView(plan) {
  return PlanScope.datasetForPlan(state.data, plan);
}

function spacesForPlan(plan) {
  return PlanScope.filterRowsForPlan(state.data.spaces, plan, state.data.deleted_space_ids);
}

function floorSegmentsForPlan(plan) {
  return PlanScope.filterRowsForPlan(state.data.floor_segments, plan);
}

function labsForPlan(plan) {
  return PlanScope.filterRowsForPlan(state.data.labs, plan);
}

function activePlanData() {
  return datasetForPlanView(planById(state.activePlanId));
}

function rowVisibleForActivePlan(row) {
  return PlanScope.rowVisibleForPlan(row, planById(state.activePlanId));
}

function copyScopeForActivePlan() {
  const copy = activePlanCopyMeta();
  return copy ? { copy_id: copy.id } : {};
}

function spacesForActivePlan() {
  return spacesForPlan(planById(state.activePlanId));
}

function floorSegmentsForActivePlan() {
  return floorSegmentsForPlan(planById(state.activePlanId));
}

function labsForActivePlan() {
  return labsForPlan(planById(state.activePlanId));
}

function activePlanCopyMeta() {
  return copyMetaForPlan(planById(state.activePlanId));
}

function canManageCopy(copy) {
  return PlanManagement.canManageCopy(copy, state.user, state.permissions);
}

function canEditPlanDataset(copy) {
  return PlanManagement.canEditPlanDataset(copy, state.user, state.permissions);
}

function isOwnCopy(copy) {
  return PlanManagement.isOwnCopy(copy, state.user);
}

function planOptionLabel(plan, copy) {
  return PlanManagement.planOptionLabel(plan, copy, state.user);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function canEditActivePlan() {
  if (!state.serverMode) return state.permissions.canEdit;
  const copy = activePlanCopyMeta();
  if (canManageCopy(copy)) return true;
  const activePlan = planById(state.activePlanId);
  return Boolean(state.permissions.canAdmin && activePlan && (activePlan.is_locked || activePlan.plan_type === "baseline"));
}

function canEditEditorKey(key) {
  if (!state.serverMode) return state.permissions.canEdit;
  if (key === "plan_assignments") return canEditActivePlan();
  return state.permissions.canAdmin;
}

function assignmentRowsForPlan(planId) {
  return state.data.plan_assignments.filter((row) => row.plan_id === planId);
}

function syncPlanViewMode() {
  if (state.data.plans.length < 2) state.planViewMode = "single";
  else if (!["single", "compare"].includes(state.planViewMode)) state.planViewMode = "single";
}

function populateBuildingOptions() {
  const plan = planById(state.activePlanId) || planById(els.currentPlanSelect.value) || planById(els.beforePlanSelect.value) || state.data.plans[0] || null;
  const planData = plan ? datasetForPlanView(plan) : state.data;
  const rowsByCode = new Map((planData.buildings || []).slice().sort(compareBuildings).map((row) => [row.building_code, row]));
  const items = [...rowsByCode.values()].map((row) => ({
    value: row.building_code,
    label: `${row.campus_zone || "未分区"} - ${row.building_name || row.building_code}`,
  }));
  fillSelect(els.buildingSelect, items);
}

function populateFloorOptions() {
  const buildingCode = els.buildingSelect.value;
  const plan = planById(state.activePlanId) || planById(els.currentPlanSelect.value) || planById(els.beforePlanSelect.value) || state.data.plans[0] || null;
  const segments = plan ? floorSegmentsForPlan(plan) : state.data.floor_segments;
  const items = unique(segments.filter((row) => row.building_code === buildingCode).map((row) => row.floor_code))
    .sort(compare)
    .map((row) => ({ value: row, label: row }));
  fillSelect(els.floorSelect, items);
}

function populatePlanOptions() {
  const previousSingle = els.currentPlanSelect.value;
  const previousBefore = els.beforePlanSelect.value;
  const previousAfter = els.afterPlanSelect.value;
  const items = state.data.plans.slice().sort((a, b) => compare(a.plan_name, b.plan_name)).map((plan) => {
    const copy = copyMetaForPlan(plan);
    return { value: plan.id, label: planOptionLabel(plan, copy) };
  });
  fillSelect(els.currentPlanSelect, items);
  fillSelect(els.beforePlanSelect, items);
  fillSelect(els.afterPlanSelect, items);

  const defaults = defaultComparePlans(state.data.plans);
  const planIds = new Set(items.map((item) => item.value));
  const defaultSingle = planIds.has(state.activePlanId) ? state.activePlanId : (items[0]?.value || "");
  const defaultBefore = defaults.before?.id || items[0]?.value || "";
  const fallbackAfter = items.find((item) => item.value !== defaultBefore)?.value || defaultBefore;

  const singleValue = planIds.has(previousSingle) ? previousSingle : defaultSingle;
  const beforeValue = planIds.has(previousBefore) ? previousBefore : defaultBefore;
  let afterValue = planIds.has(previousAfter) ? previousAfter : defaults.after?.id || fallbackAfter;
  if (state.planViewMode === "compare" && items.length > 1 && afterValue === beforeValue) {
    afterValue = items.find((item) => item.value !== beforeValue)?.value || afterValue;
  }

  els.currentPlanSelect.value = singleValue;
  els.beforePlanSelect.value = beforeValue;
  els.afterPlanSelect.value = state.planViewMode === "single" ? singleValue : afterValue;
}

function fillSelect(select, items) {
  const previous = select.value;
  select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  if (items.some((item) => item.value === previous)) select.value = previous;
  else select.value = items[0]?.value || "";
}

function ensureActivePlan() {
  const single = planById(els.currentPlanSelect.value);
  const before = planById(els.beforePlanSelect.value);
  const after = planById(els.afterPlanSelect.value);
  if (state.planViewMode === "single") {
    state.activePlanId = single?.id || before?.id || state.data.plans[0]?.id || null;
    return;
  }
  const compareIds = [before?.id, after?.id].filter(Boolean);
  // 对比模式下，主图只能落在左右方案之一；否则默认右侧方案优先。
  if (!state.activePlanId || !compareIds.includes(state.activePlanId)) {
    state.activePlanId = after?.id || before?.id || state.data.plans[0]?.id || null;
  }
}

function syncSelectedSpace() {
  if (!state.selectedSpaceId) return;
  const stillVisible = spacesForActivePlan().some((row) =>
    row.id === state.selectedSpaceId &&
    row.building_code === els.buildingSelect.value &&
    row.floor_code === els.floorSelect.value
  );
  if (!stillVisible) state.selectedSpaceId = null;
}

function syncControlSnapshots() {
  [els.buildingSelect, els.floorSelect, els.currentPlanSelect, els.beforePlanSelect, els.afterPlanSelect].forEach((select) => {
    select.dataset.currentValue = select.value;
  });
}

function setPlanViewMode(mode) {
  if (mode === "compare" && state.data.plans.length < 2) {
    updateStatus("至少需要两套方案才能切换到对比模式。");
    return;
  }
  if (state.planViewMode === mode) return;
  state.planViewMode = mode;
  const activePlanId = state.activePlanId || els.currentPlanSelect.value || els.afterPlanSelect.value || els.beforePlanSelect.value;
  if (mode === "single") {
    els.currentPlanSelect.value = activePlanId || els.currentPlanSelect.value;
  } else {
    const beforeValue = els.beforePlanSelect.value || state.data.plans[0]?.id || "";
    let afterValue = activePlanId || els.afterPlanSelect.value || els.currentPlanSelect.value || beforeValue;
    if (afterValue === beforeValue) {
      afterValue = state.data.plans.find((plan) => plan.id !== beforeValue)?.id || afterValue;
    }
    els.beforePlanSelect.value = beforeValue;
    els.afterPlanSelect.value = afterValue;
  }
  ensureActivePlan();
  syncMoveDraft(true);
  renderEditor();
  renderApp();
  syncControlSnapshots();
}

function renderCompareChrome() {
  const isCompare = state.planViewMode === "compare";
  const currentPlan = planById(els.currentPlanSelect.value);
  const beforePlan = planById(els.beforePlanSelect.value);
  const afterPlan = planById(els.afterPlanSelect.value);
  const activePlan = planById(state.activePlanId);
  const deletePlan = activePlan;
  const activeCopy = copyMetaForPlan(activePlan);
  const activeIsBaseline = Boolean(activePlan?.is_locked || activePlan?.plan_type === "baseline" || activeCopy?.isBaseline);
  const canDeletePlan = Boolean(canManageCopy(activeCopy) && state.data.plans.length > 1);
  const canToggleVisibility = Boolean(canManageCopy(activeCopy) && !activeIsBaseline);

  els.singlePlanFilter.classList.toggle("is-hidden", isCompare);
  els.beforePlanFilter.classList.toggle("is-hidden", !isCompare);
  els.afterPlanFilter.classList.toggle("is-hidden", !isCompare);
  els.currentPlanSelect.disabled = isCompare;
  els.beforePlanSelect.disabled = !isCompare;
  els.afterPlanSelect.disabled = !isCompare;
  els.compareModeBtn.disabled = state.data.plans.length < 2;
  els.singleModeBtn.classList.toggle("is-active", !isCompare);
  els.compareModeBtn.classList.toggle("is-active", isCompare);
  els.compareColumns.classList.toggle("is-single", !isCompare);
  els.afterColumn.classList.toggle("is-hidden", !isCompare);

  els.comparePanelTitle.textContent = "缩略图";

  els.newPlanBtn.disabled = !state.permissions.canEdit;
  els.toggleVisibilityBtn.disabled = !canToggleVisibility;
  els.toggleVisibilityBtn.textContent = activeCopy?.visibility === "public" ? "设为私有" : "公开方案";
  els.toggleVisibilityBtn.title = canToggleVisibility ? "" : (activeIsBaseline ? "基线方案不能设置私有或公开" : "只能公开或私有化自己创建的副本");
  els.deletePlanBtn.disabled = !canDeletePlan;
  els.deletePlanBtn.title = canDeletePlan ? "" : (deletePlan?.is_locked ? "锁定方案不可删除" : "只能删除自己创建的副本");
}

function renderEditorTabs() {
  const visibleDefinitions = visibleRawEditorDefinitions();
  if (state.editorMode !== "raw" || !canViewRawEditorKey(state.editorKey)) {
    state.editorMode = "raw";
    state.editorKey = visibleDefinitions[0]?.key || "buildings";
  }
  els.editorTabs.innerHTML = visibleDefinitions
    .map(({ key, label }) => `<button type="button" data-mode="raw" data-key="${key}" class="${state.editorKey === key ? "is-active" : ""}">${escapeHtml(label)}</button>`)
    .join("");
  els.editorTabs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    const mode = "raw";
    const key = button.dataset.key || state.editorKey;
    if (state.editorMode === mode && state.editorKey === key) return;
    runWithUnsavedGuard(() => {
      state.editorMode = mode;
      state.editorKey = key;
      state.editorHighlight = null;
      renderEditorTabs();
      renderEditor();
    });
  }));
}

function visibleRawEditorDefinitions() {
  return DATASETS.filter(({ key }) => canViewRawEditorKey(key));
}

function canViewRawEditorKey(key) {
  if (RAW_EDITOR_REPLACED_BY_BUSINESS.has(key)) return false;
  if (ADMIN_ONLY_RAW_EDITOR_KEYS.has(key)) return state.permissions.canAdmin;
  return true;
}

function snapshotThumbnailScroll() {
  const scroller = els.compareColumns;
  if (!scroller) return null;
  return {
    top: scroller.scrollTop,
    left: scroller.scrollLeft,
  };
}

function restoreThumbnailScroll(snapshot) {
  if (!snapshot || !els.compareColumns) return;
  const scroller = els.compareColumns;
  const nextMaxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const nextMaxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  scroller.scrollTop = Math.min(snapshot.top, nextMaxTop);
  scroller.scrollLeft = Math.min(snapshot.left, nextMaxLeft);
}

function renderApp() {
  const building = buildingByCode(els.buildingSelect.value);
  const currentPlan = planById(els.currentPlanSelect.value);
  const beforePlan = planById(els.beforePlanSelect.value);
  const afterPlan = planById(els.afterPlanSelect.value);
  const activePlan = planById(state.activePlanId);
  const activeData = activePlanData();
  syncSavedUnplacedMoveBasketItems();
  const colors = colorMap(state.data);
  const thumbPlan = state.planViewMode === "compare" ? beforePlan : currentPlan || activePlan || beforePlan;
  const thumbData = datasetForPlanView(thumbPlan);
  const afterData = datasetForPlanView(afterPlan);
  const context = getSelectedContext();
  const thumbScroll = snapshotThumbnailScroll();

  renderCompareChrome();
  renderLegend(els.legend, activeData, colors, activePlan?.id, state.mutedColleges);

  renderThumbList(els.beforeThumbs, {
    data: thumbData,
    buildingCode: building?.building_code,
    plan: thumbPlan,
    activePlanId: state.activePlanId,
    currentFloorCode: els.floorSelect.value,
    colors,
    mutedColleges: state.mutedColleges,
    onSelect: handleThumbSelect,
  });

  if (state.planViewMode === "compare") {
    renderThumbList(els.afterThumbs, {
      data: afterData,
      buildingCode: building?.building_code,
      plan: afterPlan,
      activePlanId: state.activePlanId,
      currentFloorCode: els.floorSelect.value,
      colors,
      mutedColleges: state.mutedColleges,
      onSelect: handleThumbSelect,
    });
  } else {
    els.afterThumbs.innerHTML = "";
    if (els.afterThumbs.dataset) delete els.afterThumbs.dataset.thumbRenderKey;
  }

  restoreThumbnailScroll(thumbScroll);

  renderFloorplan({
    floorplanEl: els.floorplan,
    activePlanBadgeEl: els.activePlanBadge,
    data: activeData,
    building,
    floorCode: els.floorSelect.value,
    activePlan,
    colors,
    selectedSpaceId: state.selectedSpaceId,
    mutedColleges: state.mutedColleges,
    moveBasket: state.moveBasket,
    canMoveLabs: canEditActivePlan(),
    onSelectSpace: handleSpaceSelect,
    onRoomPointerDown: beginRoomMoveDrag,
  });

  renderDetailsPanel({
    detailsEl: els.roomDetails,
    context,
    mode: state.detailsMode,
    moveDraft: state.moveDraft,
    moveErrors: state.moveErrors,
    moveDirty: state.moveDirty,
    moveTargetOptions: moveTargetSpaceOptions(context),
    canEdit: canEditActivePlan(),
    canAdmin: state.permissions.canAdmin,
    canEditDetails: canEditDetailPanel(),
    detailsEdit: state.detailEditor,
    detailEditOptions: buildDetailEditOptions(context),
    inspectorMode: state.inspectorMode,
    placementDragActive: state.moveDrag?.kind === "room" && state.moveDrag.active,
    onSetInspectorMode: setInspectorMode,
    onFocusRow: focusRowFromDetails,
    onOpenMove: openMoveMode,
    onDetailAction: handleDetailAction,
    onSubmitDetailEdit: submitDetailEditAction,
    onCancelDetailEdit: cancelDetailEdit,
    onPlanSpace: planSelectedSpaceAction,
    onRenovateLab: renovateSelectedLabAction,
    onMoveFieldChange: updateMoveField,
    onConfirmMove: confirmMoveAssignmentAction,
    onCancelMove: cancelMoveMode,
    moveBasket: state.moveBasket,
    onToggleBasket: toggleMoveBasket,
    onLocateBasketSource: locateMoveBasketSource,
    onReturnBasketItem: returnMoveBasketItemAction,
    onBasketCardPointerDown: beginBasketItemDrag,
    onOpenBasket: openMoveBasket,
    onCloseBasket: closeMoveBasket,
    onCreateUnplacedLab: openNewUnplacedLabModal,
  });
  renderPlanDiffPanel(beforePlan, afterPlan);

  Canvas.applyCanvasMode(state, els);
}

function activeLegendColleges() {
  const activePlanId = state.activePlanId;
  const labsById = new Map(labsForActivePlan().map((lab) => [lab.id, lab]));
  return unique(state.data.plan_assignments
    .filter((row) => row.plan_id === activePlanId && row.assignment_status === "assigned")
    .map((row) => labsById.get(row.lab_id)?.college)
    .filter(Boolean));
}

function handleLegendClick(event) {
  const toggle = event.target.closest?.("[data-action='toggle-all-colleges']");
  if (toggle) {
    const colleges = activeLegendColleges();
    state.mutedColleges = state.mutedColleges.size ? new Set() : new Set(colleges);
    renderApp();
    return;
  }
  const item = event.target.closest?.("[data-college]");
  if (!item) return;
  const college = item.dataset.college || "";
  if (!college) return;
  const next = new Set(state.mutedColleges);
  if (next.has(college)) next.delete(college);
  else next.add(college);
  state.mutedColleges = next;
  renderApp();
}

function renderPlanDiffPanel(beforePlan, afterPlan) {
  const isCompare = state.planViewMode === "compare";
  const diff = beforePlan && afterPlan && beforePlan.id !== afterPlan.id
    ? PlanDiff.buildPlanDiff(datasetForPlanDiff(beforePlan, afterPlan), beforePlan, afterPlan, { compare, spaceDisplayName })
    : null;
  PlanDiffPanel.renderPlanDiffPanel({
    panelEl: els.planDiffPanel,
    isCompare,
    beforePlan,
    afterPlan,
    diff,
    collapsed: state.planDiff,
    onToggle: (target) => {
      if (target === "summary") state.planDiff.summaryCollapsed = !state.planDiff.summaryCollapsed;
      if (target === "labs") state.planDiff.labCollapsed = !state.planDiff.labCollapsed;
      if (target === "spaces") state.planDiff.spaceCollapsed = !state.planDiff.spaceCollapsed;
      renderPlanDiffPanel(beforePlan, afterPlan);
    },
  });
}

function datasetForPlanDiff(beforePlan, afterPlan) {
  const beforeData = datasetForPlanView(beforePlan);
  const afterData = datasetForPlanView(afterPlan);
  const mergeRows = (key) => {
    const seen = new Set();
    const rows = [];
    for (const row of [...(beforeData[key] || []), ...(afterData[key] || [])]) {
      const rowKey = `${row.copy_id || row.copyId || "active"}::${row.id || row[key] || JSON.stringify(row)}`;
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);
      rows.push(row);
    }
    return rows;
  };
  return {
    ...state.data,
    buildings: mergeRows("buildings"),
    floor_segments: mergeRows("floor_segments"),
    spaces: mergeRows("spaces"),
    labs: mergeRows("labs"),
    colleges: mergeRows("colleges"),
    majors: mergeRows("majors"),
    lab_types: mergeRows("lab_types"),
    file_assets: mergeRows("file_assets"),
  };
}

function getSelectedContext() {
  const building = buildingByCode(els.buildingSelect.value);
  const activePlan = planById(state.activePlanId);
  const activeData = datasetForPlanView(activePlan);
  const space = activeData.spaces.find((row) =>
    row.id === state.selectedSpaceId &&
    row.building_code === els.buildingSelect.value &&
    row.floor_code === els.floorSelect.value
  ) || null;
  const assignment = activePlan && space ? state.data.plan_assignments.find((row) => row.plan_id === activePlan.id && row.space_id === space.id && row.assignment_status === "assigned") || null : null;
  const lab = assignment ? activeData.labs.find((row) => row.id === assignment.lab_id) || null : null;
  return { building, activePlan, space, assignment, lab, buildingCode: els.buildingSelect.value, floorCode: els.floorSelect.value };
}

function moveTargetKey(context) {
  if (!context.space || !context.assignment || !context.lab) return null;
  return `${context.activePlan?.id || "no-plan"}::${context.assignment.id}`;
}

function buildMoveDraft(context) {
  if (!context.space || !context.assignment || !context.lab) return null;
  return {
    targetSpaceId: "",
    targetSpaceCode: "",
  };
}

function moveTargetSpaceOptions(context) {
  if (!context.activePlan || !context.space) return [];
  const occupiedSpaceIds = new Set(state.data.plan_assignments
    .filter((row) => row.plan_id === context.activePlan.id && row.assignment_status === "assigned" && row.space_id)
    .map((row) => row.space_id));
  return spacesForPlan(context.activePlan)
    .filter((space) => space.current_status !== "unavailable")
    .filter((space) => space.id !== context.space.id)
    .filter((space) => !occupiedSpaceIds.has(space.id))
    .slice()
    .sort((a, b) => compare(spaceDisplayName(a), spaceDisplayName(b)))
    .map((space) => ({
      value: space.id,
      code: space.space_code,
      label: `${spaceDisplayName(space)} · ${space.space_code} · ${(space.area_m2 || 0).toFixed(1)} m²`,
    }));
}

function moveBasketNormalizeAssignment(...args) {
  return MoveController.moveBasketNormalizeAssignment(...args);
}

function syncSavedUnplacedMoveBasketItems(...args) {
  return MoveController.syncSavedUnplacedMoveBasketItems(...args);
}

function targetSpaceOptionsForBasketItem(...args) {
  return MoveController.targetSpaceOptionsForBasketItem(...args);
}

function canDropBasketItemOnSpace(...args) {
  return MoveController.canDropBasketItemOnSpace(...args);
}

function syncMoveDraft(...args) {
  return MoveController.syncMoveDraft(...args);
}

function handleThumbSelect(planId, floorCode) {
  runWithUnsavedGuard(() => {
    state.activePlanId = planId;
    els.floorSelect.value = floorCode;
    syncSelectedSpace();
    state.zoom = 1;
    state.detailsMode = "view";
    resetDetailEditorState();
    syncMoveDraft(true);
    renderEditor();
    renderApp();
    syncControlSnapshots();
  });
}

function handleSpaceSelect(spaceId) {
  if (state.suppressNextSpaceClick) {
    state.suppressNextSpaceClick = false;
    return;
  }
  if (spaceId === state.selectedSpaceId && state.inspectorMode === "details") return;
  runWithUnsavedGuard(() => {
    state.selectedSpaceId = spaceId;
    state.detailsMode = "view";
    resetDetailEditorState();
    state.inspectorMode = "details";
    syncMoveDraft(true);
    renderApp();
  });
}

function setInspectorMode(mode) {
  const nextMode = mode === "placement" ? "placement" : "details";
  if (state.inspectorMode === nextMode) return;
  state.inspectorMode = nextMode;
  if (nextMode === "placement") state.moveBasket.isOpen = true;
  renderApp();
}

function buildDetailEditOptions(context) {
  const copySegments = floorSegmentsForActivePlan()
    .filter((segment) => isAssignableSegment(segment))
    .filter((segment) =>
      segment.building_code === (context.space?.building_code || context.buildingCode) &&
      segment.floor_code === (context.space?.floor_code || context.floorCode)
    )
    .slice()
    .sort((a, b) => compare(a.segment_code, b.segment_code));
  const currentSegment = context.space?.segment_code;
  const segmentOptions = copySegments.map((segment) => ({
    value: segment.segment_code,
    label: `${segment.segment_code} · ${segmentTypeLabel(segment.element_type)}`,
    selected: segment.segment_code === currentSegment,
  }));
  if (currentSegment && !segmentOptions.some((item) => item.value === currentSegment)) {
    segmentOptions.unshift({ value: currentSegment, label: currentSegment, selected: true });
  }
  const renovationMonth = DetailActions.effectiveDateToMonth(context.assignment?.effective_from, isoNow());
  const collegeOptions = activeCollegeOptions().map((row) => ({
    value: row.college_name,
    label: row.college_name,
  }));
  const majorOptionsByCollege = {};
  for (const college of collegeOptions) {
    majorOptionsByCollege[college.value] = activeMajorOptions(college.value).map((row) => row.major_name);
  }
  const createSpaceDraft = {
    building_code: context.buildingCode,
    floor_code: context.floorCode,
    segment_code: segmentOptions[0]?.value || "",
    front_door: "",
    rear_door: "",
    side: "south",
    offset_m: 0,
    length_m: 8,
    width_m: 6,
    area_m2: 48,
    network_segment: "",
    current_status: "active",
  };
  return {
    segmentOptions,
    renovationMonth,
    collegeOptions,
    majorOptionsByCollege,
    createSpaceDraft,
    spaceCodePreview: context.space ? generateSpaceCode(context.space, context.building) || context.space.space_code : "",
  };
}

function canEditDetailPanel() {
  return Boolean(canEditActivePlan() && canEditBusinessBaseData() && (state.permissions.canAdmin || state.permissions.role === "editor"));
}

function handleDetailAction(action) {
  if (!canEditDetailPanel()) {
    updateStatus("当前账号没有编辑此方案的权限。");
    return;
  }
  const context = getSelectedContext();
  if (action === "create-space") {
    state.detailEditor = { mode: "createSpace", moreOpen: false, errors: {} };
    renderApp();
    return;
  }
  if (!context.space) {
    updateStatus("请先选择要编辑的房间。");
    return;
  }
  if (action === "toggle-more") {
    state.detailEditor = { ...state.detailEditor, mode: "view", moreOpen: !state.detailEditor.moreOpen, errors: {} };
    renderApp();
    return;
  }
  if (action === "edit-space") {
    state.detailEditor = { mode: "editSpace", moreOpen: false, errors: {} };
    renderApp();
    return;
  }
  if (action === "edit-lab") {
    if (!context.lab || !context.assignment) {
      updateStatus("当前房间没有可编辑的实验室。");
      return;
    }
    state.detailEditor = { mode: "editLab", moreOpen: false, errors: {} };
    renderApp();
    return;
  }
  if (action === "delete-space") {
    void deleteDetailSpaceAction();
    return;
  }
  if (action === "renovate-room") {
    if (!context.lab || !context.assignment) {
      updateStatus("请选择已有已分配实验室的房间后再改建。");
      return;
    }
    state.detailEditor = { mode: "renovateRoom", moreOpen: false, errors: {} };
    renderApp();
    return;
  }
  if (action === "merge-space") updateStatus("合并房间将在后续迭代开放。");
  if (action === "split-space") updateStatus("拆分房间将在后续迭代开放。");
}

async function deleteDetailSpaceAction() {
  const context = getSelectedContext();
  if (!canDeleteSpaceInActivePlan()) {
    updateStatus("只能删除当前账号可管理方案中的房间。");
    return;
  }
  if (!context.activePlan || !context.space) {
    updateStatus("请先选择要删除的房间。");
    return;
  }
  const label = context.space.front_door || context.space.space_code;
  if (!window.confirm(`确认从当前方案删除房间“${label}”？相关落位会标记为失效，实验室资料会保留。`)) return;
  if (state.serverMode) {
    try {
      await submitDetailActionToServer("deleteSpace", {}, context.space, "删除房间");
    } catch (error) {
      updateStatus(`删除房间失败：${error.message}`);
      return;
    }
    state.selectedSpaceId = null;
    resetDetailEditorState();
    syncSelectedSpace();
    refreshStateAndRender(`${label} 已从当前方案删除。`, { stamp: false, forceMoveReset: true });
    return;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
  const result = DetailActions.applyDetailDeleteSpace(state.data, context, {
    copyScope: copyScopeForActivePlan(),
    normalizeAssignment: (row) => normalizeAssignment(row, relationMaps(state.data)),
  });
  if (!result.ok) {
    updateStatus(result.message || "删除房间失败。");
    return;
  }
  state.data = normalizeDataset(state.data);
  const saveOk = await saveWithRollback(previousData, previousRevision, "删除房间", "删除房间失败");
  if (!saveOk) {
    state.planCopies = previousCopies;
    return;
  }
  state.selectedSpaceId = null;
  resetDetailEditorState();
  syncSelectedSpace();
  refreshStateAndRender(`${label} 已从当前方案删除。`, { stamp: false, forceMoveReset: true });
}

function cancelDetailEdit() {
  resetDetailEditorState();
  renderApp();
}

async function submitDetailEditAction(mode, formData) {
  if (!canEditDetailPanel()) {
    updateStatus("当前账号没有编辑此方案的权限。");
    return;
  }
  const context = getSelectedContext();
  if (mode !== "createSpace" && !context.space) {
    updateStatus("请先选择要编辑的房间。");
    return;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
  const draft = DetailActions.formDataToDraft(formData);
  const changeNote = mode === "editLab" ? "编辑实验室详情" : mode === "renovateRoom" ? "改建房间" : mode === "createSpace" ? "新增房间" : "编辑房间详情";
  if (state.serverMode) {
    try {
      await submitDetailActionToServer(mode, formData, context.space, changeNote);
    } catch (error) {
      state.detailEditor = { ...state.detailEditor, draft, errors: { form: `${changeNote}失败：${error.message}` } };
      renderApp();
      updateStatus(`${changeNote}失败：${error.message}`);
      return;
    }
    if (mode === "createSpace") {
      const created = spacesForActivePlan().find((space) =>
        space.front_door === String(draft.frontDoor || "").trim() &&
        space.segment_code === String(draft.segmentCode || "").trim() &&
        space.building_code === (getSelectedContext().building?.building_code || space.building_code)
      );
      if (created?.id) state.selectedSpaceId = created.id;
    } else if ((mode === "editSpace" || mode === "createSpace") && context.space?.id) {
      state.selectedSpaceId = context.space.id;
    }
    resetDetailEditorState();
    syncSelectedSpace();
    refreshStateAndRender(`${changeNote}已保存。`, { stamp: false, forceMoveReset: true });
    return;
  }
  const deps = {
    normalizeLab,
    normalizeSpace,
    normalizeAssignment: (row) => normalizeAssignment(row, relationMaps(state.data)),
    generateSpaceCode,
    generateUnitCode,
    isAssignableSegment,
    isoNow,
    copyScope: copyScopeForActivePlan(),
    clearDeletedSpaceRefs,
  };
  const result = mode === "editLab"
    ? DetailActions.applyDetailLabEdit(state.data, context, formData, deps)
    : mode === "renovateRoom"
      ? DetailActions.applyDetailRenovation(state.data, context, formData, deps)
      : mode === "createSpace"
        ? DetailActions.applyDetailCreateSpace(state.data, context, formData, deps)
        : DetailActions.applyDetailSpaceEdit(state.data, context, formData, deps);
  if (!result.ok) {
    state.detailEditor = { ...state.detailEditor, draft, errors: { form: result.message || "保存失败，请检查表单。" } };
    renderApp();
    updateStatus(result.message || "保存失败，请检查表单。");
    return;
  }
  state.data = normalizeDataset(state.data);
  if ((mode === "editSpace" || mode === "createSpace") && result.space?.id) {
    state.selectedSpaceId = result.space.id;
  }
  try {
    await saveDatasetToServer(changeNote);
  } catch (error) {
    state.planCopies = previousCopies;
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    state.detailEditor = { ...state.detailEditor, draft, errors: { form: `${changeNote}失败：${error.message}` } };
    renderEditor();
    renderApp();
    updateStatus(`${changeNote}失败：${error.message}`);
    return;
  }
  resetDetailEditorState();
  refreshStateAndRender(`${changeNote}已保存。`, { stamp: false, forceMoveReset: true });
}

function openMoveMode(...args) {
  return MoveController.openMoveMode(...args);
}

function addContextToMoveBasket(...args) {
  return MoveController.addContextToMoveBasket(...args);
}

function toggleMoveBasket(...args) {
  return MoveController.toggleMoveBasket(...args);
}

function openMoveBasket(...args) {
  return MoveController.openMoveBasket(...args);
}

function closeMoveBasket(...args) {
  return MoveController.closeMoveBasket(...args);
}

function saveMoveBasketAssignmentsToServer(...args) {
  return MoveController.saveMoveBasketAssignmentsToServer(...args);
}

function locateMoveBasketSource(...args) {
  return MoveController.locateMoveBasketSource(...args);
}

function returnMoveBasketItemAction(...args) {
  return MoveController.returnMoveBasketItemAction(...args);
}

function contextForSpace(...args) {
  return MoveController.contextForSpace(...args);
}

function beginRoomMoveDrag(...args) {
  return MoveController.beginRoomMoveDrag(...args);
}

function beginBasketItemDrag(...args) {
  return MoveController.beginBasketItemDrag(...args);
}

function beginPointerMoveDrag(...args) {
  return MoveController.beginPointerMoveDrag(...args);
}

function handleMoveDragPointerMove(...args) {
  return MoveController.handleMoveDragPointerMove(...args);
}

function maybeOpenPlacementInspectorForDrag(...args) {
  return MoveController.maybeOpenPlacementInspectorForDrag(...args);
}

function handleMoveDragPointerUp(...args) {
  return MoveController.handleMoveDragPointerUp(...args);
}

function cancelMoveDrag(...args) {
  return MoveController.cancelMoveDrag(...args);
}

function createMoveDragGhost(...args) {
  return MoveController.createMoveDragGhost(...args);
}

function moveDragGhost(...args) {
  return MoveController.moveDragGhost(...args);
}

function cleanupMoveDrag(...args) {
  return MoveController.cleanupMoveDrag(...args);
}

function markMoveDropTargets(...args) {
  return MoveController.markMoveDropTargets(...args);
}

function buildMoveBasketItemFromContext(...args) {
  return MoveController.buildMoveBasketItemFromContext(...args);
}

function markRoomDirectDropTargets(...args) {
  return MoveController.markRoomDirectDropTargets(...args);
}

function setRoomDirectTarget(...args) {
  return MoveController.setRoomDirectTarget(...args);
}

function setMoveBasketTarget(...args) {
  return MoveController.setMoveBasketTarget(...args);
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
  resetDetailEditorState();
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
  const targetId = String(state.moveDraft?.targetSpaceId || "").trim();
  const targetCode = String(state.moveDraft?.targetSpaceCode || "").trim();
  if (!targetId && !targetCode) {
    errors.targetSpaceCode = "请选择目标空间。";
    return { errors, targetSpace: null, conflictAssignment: null };
  }

  const targetSpace = spacesForPlan(context.activePlan).find((row) => row.id === targetId || row.space_code === targetCode) || null;
  if (!targetSpace) {
    errors.targetSpaceCode = "未找到对应的目标空间。";
    return { errors, targetSpace: null, conflictAssignment: null };
  }
  if (targetSpace.id === context.space?.id) {
    errors.targetSpaceCode = "目标空间不能与当前空间相同。";
    return { errors, targetSpace, conflictAssignment: null };
  }
  if (targetSpace.current_status === "unavailable") {
    errors.targetSpaceCode = "不可用空间不能作为搬迁目标。";
    return { errors, targetSpace, conflictAssignment: null };
  }

  const conflictAssignment = state.data.plan_assignments.find((row) => row.plan_id === context.activePlan?.id && row.space_id === targetSpace.id && row.assignment_status === "assigned") || null;
  // 只有 assigned 状态视为硬占用，Invalid 不占用空间。
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
      // 目标空间被占用时，把原分配标记为无效，避免同一方案下出现双占用。
      return normalizeAssignment({
        ...row,
        previous_space_code: row.space_code || row.previous_space_code,
        space_code: "",
        assignment_status: "Invalid",
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
  if (!canEditActivePlan()) {
    updateStatus("当前账号没有编辑此方案副本的权限。");
    return false;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
  const ok = confirmMoveAssignment();
  if (!ok) return false;
  try {
    await saveActivePlanCopyToServer();
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    state.planCopies = previousCopies;
    refreshStateAndRender(`搬迁保存失败：${error.message}`, { stamp: false, forceMoveReset: true });
    return false;
  }
  refreshStateAndRender("已保存实验室搬迁。", { stamp: false, forceMoveReset: true });
  return true;
}

async function planSelectedSpaceAction() {
  if (!canEditActivePlan() || !state.permissions.canAdmin) {
    updateStatus("当前账号没有编辑此方案的权限。");
    return;
  }
  const context = getSelectedContext();
  if (!context.activePlan || !context.space) {
    updateStatus("请先选择一个空间。");
    return;
  }
  if (context.assignment && context.lab) {
    updateStatus("当前空间已有已分配实验室。");
    return;
  }
  const colleges = activeCollegeOptions();
  if (!colleges.length) {
    updateStatus("请先由管理员维护学院信息。");
    return;
  }
  state.planSpace.planningSpaceId = context.space.id;
  fillInlineSelect(els.planSpaceCollegeSelect, colleges.map((row) => ({ value: row.college_name, label: row.college_name })), colleges[0]?.college_name || "");
  els.planSpaceErrorText.textContent = "";
  els.planSpaceModal.classList.remove("is-hidden");
  els.planSpaceModal.setAttribute("aria-hidden", "false");
  setTimeout(() => els.planSpaceCollegeSelect.focus(), 0);
}

function closePlanSpaceModal() {
  state.planSpace.planningSpaceId = "";
  els.planSpaceModal.classList.add("is-hidden");
  els.planSpaceModal.setAttribute("aria-hidden", "true");
  els.planSpaceErrorText.textContent = "";
}

async function confirmPlanSpaceAction() {
  const space = spacesForActivePlan().find((row) => row.id === state.planSpace.planningSpaceId) || null;
  const college = String(els.planSpaceCollegeSelect.value || "").trim();
  if (!space) {
    els.planSpaceErrorText.textContent = "请选择需要规划的空间。";
    return;
  }
  if (!college) {
    els.planSpaceErrorText.textContent = "请选择所属学院。";
    return;
  }
  closePlanSpaceModal();
  await savePlaceholderLabForSpace(space, college, {
    invalidAssignment: null,
    successMessage: `${space.front_door || space.space_code} 已规划为未规划实验室。`,
  });
}

async function renovateSelectedLabAction() {
  if (!canEditActivePlan()) {
    updateStatus("当前账号没有编辑此方案的权限。");
    return;
  }
  const context = getSelectedContext();
  if (!context.activePlan || !context.space || !context.assignment || !context.lab) {
    updateStatus("请选择已有已分配实验室的空间后再改建。");
    return;
  }
  if (!window.confirm(`确认将“${context.lab.lab_name}”与当前空间解绑并开始改建？`)) return;
  await savePlaceholderLabForSpace(context.space, context.lab.college || "未设置学院", {
    invalidAssignment: context.assignment,
    successMessage: `${context.space.front_door || context.space.space_code} 已进入改建规划。`,
  });
}

async function savePlaceholderLabForSpace(space, college, options = {}) {
  const activePlan = planById(state.activePlanId);
  if (!activePlan || !space) return;
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
  const lab = createPlaceholderLab(space, college);
  state.data.labs.push(lab);
  let assignments = state.data.plan_assignments;
  if (options.invalidAssignment) {
    const relation = relationMaps(state.data);
    assignments = assignments.map((row) => {
      if (row.id !== options.invalidAssignment.id) return row;
      return normalizeAssignment({
        ...row,
        previous_space_code: row.space_code || row.previous_space_code,
        space_code: "",
        assignment_status: "Invalid",
      }, relation);
    });
  }
  const relation = relationMaps({ ...state.data, labs: [...state.data.labs], plans: state.data.plans });
  assignments = assignments.filter((row) => !(row.plan_id === activePlan.id && row.space_id === space.id && row.assignment_status === "assigned"));
  assignments.push(normalizeAssignment({
    plan_code: activePlan.plan_code,
    lab_code: lab.lab_code,
    space_code: space.space_code,
    previous_space_code: "",
    assignment_status: "assigned",
    move_note: "",
    effective_from: "",
    created_at: isoNow(),
  }, relation));
  state.data.plan_assignments = assignments;
  state.data = normalizeDataset(state.data);
  try {
    if (state.serverMode) {
      await submitAssignmentActionToServer("planSpace", {
        targetSpace: { id: space.id, space_code: space.space_code },
        invalidAssignment: options.invalidAssignment ? {
          id: options.invalidAssignment.id,
          lab_code: options.invalidAssignment.lab_code,
          lab_id: options.invalidAssignment.lab_id,
        } : null,
        form: {
          labName: lab.lab_name,
          college,
        },
      });
    } else {
      const saveOk = await saveWithRollback(previousData, previousRevision, "规划未规划实验室", "规划保存失败");
      if (!saveOk) throw new Error("规划保存失败");
    }
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    state.planCopies = previousCopies;
    refreshStateAndRender(`规划保存失败：${error.message}`, { stamp: false, forceMoveReset: true });
    return;
  }
  state.selectedSpaceId = space.id;
  refreshStateAndRender(options.successMessage || "已保存规划。", { stamp: false, forceMoveReset: true });
}

function createPlaceholderLab(space, college) {
  const door = placeholderDoorLabel(space);
  const codeBase = `UNPLANNED-${String(space.space_code || door || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const labCode = uniqueLabCode(codeBase);
  return normalizeLab({
    lab_code: labCode,
    lab_name: `未规划实验室${door}`,
    college,
    major: "",
    lab_type: "",
    director: "",
    seat_count: "",
    computer_count: "",
    status: "planning",
    notes: "",
    created_at: isoNow(),
  });
}

function placeholderDoorLabel(space) {
  return String(space?.front_door || space?.rear_door || space?.space_code || "").trim();
}

function uniqueLabCode(baseCode) {
  const used = new Set(state.data.labs.map((lab) => lab.lab_code));
  if (!used.has(baseCode)) return baseCode;
  let index = 2;
  while (used.has(`${baseCode}-${index}`)) index += 1;
  return `${baseCode}-${index}`;
}

function focusRowFromDetails(key, rowId) {
  runWithUnsavedGuard(() => {
    state.detailsMode = "view";
    state.editorMode = "raw";
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
  if (!hasUnsavedMoveChanges()) {
    action();
    return;
  }
  state.pendingNavigation = action;
  openUnsavedModal();
}

function hasUnsavedMoveChanges() {
  return Boolean(state.moveDirty);
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
  discardMoveChanges();
  closeUnsavedModal();
  pending();
}

function discardMoveChanges() {
  state.detailsMode = "view";
  resetDetailEditorState();
  state.moveDraft = null;
  state.moveErrors = {};
  state.moveDirty = false;
  state.moveTargetKey = null;
  state.moveUndoStack = [];
  state.moveDrag = null;
}

function openNewPlanModal() {
  if (!state.permissions.canEdit) {
    updateStatus("当前账号没有新增方案权限。");
    return;
  }
  const activePlan = planById(state.activePlanId) || state.data.plans[0];
  if (!activePlan) {
    updateStatus("当前没有可复制的方案。");
    return;
  }
  state.planDraftName = `${activePlan.plan_name} 副本`;
  els.newPlanNameInput.value = state.planDraftName;
  els.newPlanErrorText.textContent = "";
  els.newPlanModalText.textContent = `将基于“${activePlan.plan_name}”复制创建一套新方案，并同步复制当前分配关系。`;
  els.newPlanModal.classList.remove("is-hidden");
  els.newPlanModal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    els.newPlanNameInput.focus();
    els.newPlanNameInput.select();
  }, 0);
}

function closeNewPlanModal() {
  els.newPlanModal.classList.add("is-hidden");
  els.newPlanModal.setAttribute("aria-hidden", "true");
  els.newPlanErrorText.textContent = "";
}

function openNewUnplacedLabModal() {
  if (!canEditActivePlan()) {
    updateStatus("当前账号没有编辑此方案的权限。");
    return;
  }
  els.newUnplacedLabNameInput.value = "";
  els.newUnplacedLabCollegeInput.value = "";
  els.newUnplacedLabSeatInput.value = "";
  els.newUnplacedLabComputerInput.value = "";
  els.newUnplacedLabErrorText.textContent = "";
  els.newUnplacedLabModal.classList.remove("is-hidden");
  els.newUnplacedLabModal.setAttribute("aria-hidden", "false");
  setTimeout(() => els.newUnplacedLabNameInput.focus(), 0);
}

function closeNewUnplacedLabModal() {
  els.newUnplacedLabModal.classList.add("is-hidden");
  els.newUnplacedLabModal.setAttribute("aria-hidden", "true");
  els.newUnplacedLabErrorText.textContent = "";
}

function openDeletePlanModal() {
  if (!canManageCopy(activePlanCopyMeta())) {
    updateStatus("只能删除自己创建的方案副本。");
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

async function toggleActivePlanVisibility() {
  const copy = activePlanCopyMeta();
  if (!canManageCopy(copy)) {
    updateStatus("只能公开或私有化自己创建的方案副本。");
    return;
  }
  const nextVisibility = copy.visibility === "public" ? "private" : "public";
  try {
    await PlanActions.updatePlanCopyVisibility({
      fetchJson,
      state,
      normalizeDataset,
      copyId: copy.id,
      visibility: nextVisibility,
    });
    refreshStateAndRender(nextVisibility === "public" ? "方案副本已公开展示。" : "方案副本已设为私有。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    updateStatus(`更新公开状态失败：${error.message}`);
  }
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
  const copy = activePlanCopyMeta();
  if (!canManageCopy(copy)) {
    updateStatus("只能删除自己创建的方案副本。");
    return;
  }
  try {
    await PlanActions.deletePlanCopy({
      fetchJson,
      state,
      normalizeDataset,
      copyId: copy.id,
    });
    closeDeletePlanModal();
    resetContextState();
    refreshStateAndRender("已删除当前方案副本。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    updateStatus(`删除方案副本失败：${error.message}`);
  }
}

function renderEditor(...args) {
  return RawEditorController.renderEditor(...args);
}

function numberingToolbarHtml(...args) {
  return RawEditorController.numberingToolbarHtml(...args);
}

function enhanceCollegeColorInputs(...args) {
  return RawEditorController.enhanceCollegeColorInputs(...args);
}

function bindRawEditorTools(...args) {
  return RawEditorController.bindRawEditorTools(...args);
}

function rawEditorHelperHtml(...args) {
  return RawEditorController.rawEditorHelperHtml(...args);
}

function rawEditorNoticeHtml(...args) {
  return RawEditorController.rawEditorNoticeHtml(...args);
}

function setRawEditorNotice(...args) {
  return RawEditorController.setRawEditorNotice(...args);
}

function regenerateEditorCodes(...args) {
  return RawEditorController.regenerateEditorCodes(...args);
}

function setEditorInputValue(...args) {
  return RawEditorController.setEditorInputValue(...args);
}

function syncEditorActionButtons(...args) {
  return RawEditorController.syncEditorActionButtons(...args);
}

function firstAssignableSegmentCode(buildingCode, floorCode) {
  return floorSegmentsForActivePlan().find((row) =>
    row.building_code === buildingCode &&
    row.floor_code === floorCode &&
    isAssignableSegment(row)
  )?.segment_code || "";
}

function nextBuildingNumber() {
  return state.data.buildings.reduce((max, building) => Math.max(max, Number(building.building_number) || 0), 0) + 1;
}

function nextGeneratedBuildingDraft() {
  const buildingNumber = nextBuildingNumber();
  const draft = {
    building_code: "",
    building_name: "新增教学楼",
    campus_zone: "下沙校区",
    building_number: buildingNumber,
    notes: "",
  };
  draft.building_code = generateBuildingCode(draft);
  return draft;
}

function nextSegmentCodeForDraft(draft, building = buildingByCode(draft.building_code)) {
  return generateSegmentCode(draft, building || { building_code: draft.building_code }, state.data.floor_segments);
}

function nextUnitCode() {
  return generateUnitCode(state.data.labs);
}

function activeCollegeOptions() {
  return (state.data.colleges || [])
    .filter((row) => row.status !== "inactive")
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || compare(a.college_name, b.college_name));
}

function activeMajorOptions(collegeName = "") {
  const college = activeCollegeOptions().find((row) => row.college_name === collegeName || row.college_code === collegeName) || null;
  const collegeCode = college?.college_code || collegeName;
  return (state.data.majors || [])
    .filter((row) => row.status !== "inactive")
    .filter((row) => !collegeCode || row.college_code === collegeCode)
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || compare(a.major_name, b.major_name));
}

function activeLabTypeOptions() {
  return (state.data.lab_types || [])
    .filter((row) => row.status !== "inactive")
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || compare(a.type_name, b.type_name));
}

function doorRangeLabel(space) {
  const frontDoor = String(space?.front_door || "").trim();
  const rearDoor = String(space?.rear_door || "").trim();
  if (frontDoor && rearDoor && frontDoor !== rearDoor) return `${frontDoor}-${rearDoor}`;
  return frontDoor || rearDoor || "";
}

function spaceDisplayName(space) {
  const building = buildingByCode(space?.building_code);
  return `${building?.building_name || space?.building_code || "-"} ${space?.floor_code || "-"}层 ${doorRangeLabel(space) || space?.space_code || "-"}`;
}

function clearDeletedSpaceRefs(...args) {
  return DetailActions.clearDeletedSpaceRefs(...args);
}

function segmentTypeLabel(type) {
  return {
    corridor: "走廊",
    stairs: "楼梯",
    elevator: "电梯",
    other: "其他",
  }[type] || "走廊";
}

function spaceStatusLabel(status) {
  return {
    active: "可用",
    unavailable: "不可用",
  }[status] || status || "-";
}

function sideLabel(side) {
  return {
    north: "北",
    south: "南",
    east: "东",
    west: "西",
  }[side] || side || "-";
}

function canEditBusinessBaseData() {
  if (!state.serverMode) return state.permissions.canEdit;
  const copy = activePlanCopyMeta();
  if (copy) return canEditPlanDataset(copy);
  return state.permissions.canAdmin;
}

function canDeleteSpaceInActivePlan() {
  const copy = activePlanCopyMeta();
  return DetailActions.canDeleteSpaceForActivePlan({
    serverMode: state.serverMode,
    permissions: state.permissions,
    activePlan: planById(state.activePlanId),
    copy,
    canEditCopy: copy ? canEditPlanDataset(copy) : false,
  });
}

function firstUnassignedLabCode(assignments) {
  const assigned = new Set(assignments.map((row) => row.lab_code));
  return labsForActivePlan().find((lab) => !assigned.has(lab.lab_code))?.lab_code || "";
}

function editorRows(...args) {
  return RawEditorController.editorRows(...args);
}

function canDeleteEditorRows(...args) {
  return RawEditorController.canDeleteEditorRows(...args);
}

function collectEditorInputRows(...args) {
  return RawEditorController.collectEditorInputRows(...args);
}

function normalizeEditorRowsForKey(...args) {
  return RawEditorController.normalizeEditorRowsForKey(...args);
}

function applyBuildingEditorRows(...args) {
  return RawEditorController.applyBuildingEditorRows(...args);
}

function applyPlanEditorRows(...args) {
  return RawEditorController.applyPlanEditorRows(...args);
}

function normalizeLabTypeEditorRows(...args) {
  return RawEditorController.normalizeLabTypeEditorRows(...args);
}

function applyFloorSegmentEditorRows(...args) {
  return RawEditorController.applyFloorSegmentEditorRows(...args);
}

function editorRowDeleteBlocker(...args) {
  return RawEditorController.editorRowDeleteBlocker(...args);
}

function segmentKey(...args) {
  return RawEditorController.segmentKey(...args);
}

function spaceMatchesSegment(...args) {
  return RawEditorController.spaceMatchesSegment(...args);
}

function spacesForBuilding(...args) {
  return RawEditorController.spacesForBuilding(...args);
}

function spacesForSegment(...args) {
  return RawEditorController.spacesForSegment(...args);
}

function invalidateAssignmentsForSpaces(...args) {
  return RawEditorController.invalidateAssignmentsForSpaces(...args);
}

function cascadeDeleteBuilding(...args) {
  return RawEditorController.cascadeDeleteBuilding(...args);
}

function cascadeDeleteFloorSegment(...args) {
  return RawEditorController.cascadeDeleteFloorSegment(...args);
}

function deleteEditorRow(...args) {
  return RawEditorController.deleteEditorRow(...args);
}

function addFloorSegmentRow(...args) {
  return RawEditorController.addFloorSegmentRow(...args);
}

function addEditorRow(...args) {
  return RawEditorController.addEditorRow(...args);
}

function applyEditorRows(...args) {
  return RawEditorController.applyEditorRows(...args);
}

function downloadEditorData(...args) {
  return RawEditorController.downloadEditorData(...args);
}

function replaceFilteredRows(...args) {
  return RawEditorController.replaceFilteredRows(...args);
}

function replaceFilteredAssignments(...args) {
  return RawEditorController.replaceFilteredAssignments(...args);
}

async function createPlanFromActive(planNameInput) {
  if (!state.permissions.canEdit) {
    updateStatus("当前账号没有新增方案权限。");
    return;
  }
  const activePlan = planById(state.activePlanId) || state.data.plans[0];
  if (!activePlan) {
    updateStatus("当前没有可复制的方案。");
    return;
  }

  const planCode = `plan-${Date.now()}`;
  const normalizedName = String(planNameInput || "").trim();
  if (!normalizedName) {
    els.newPlanErrorText.textContent = "请输入方案名称。";
    return;
  }
  const planName = normalizedName;
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

  if (state.planViewMode === "compare") {
    const beforePlanId = els.beforePlanSelect.value || activePlan.id;
    els.beforePlanSelect.value = beforePlanId;
    els.afterPlanSelect.value = newPlan.id;
  } else {
    els.currentPlanSelect.value = newPlan.id;
  }
  state.activePlanId = newPlan.id;
  state.detailsMode = "view";
  closeNewPlanModal();

  refreshStateAndRender(`已基于 ${activePlan.plan_name} 新增方案 ${planName}。`, { stamp: false, forceMoveReset: true });
}

async function createPlanFromActiveAction() {
  const activePlan = planById(state.activePlanId) || state.data.plans[0];
  const planName = String(els.newPlanNameInput.value || "").trim();
  if (!activePlan) {
    els.newPlanErrorText.textContent = "当前没有可复制的方案。";
    return;
  }
  if (!planName) {
    els.newPlanErrorText.textContent = "请输入方案名称。";
    return;
  }
  try {
    const payload = await PlanActions.createPlanCopy({
      fetchJson,
      state,
      normalizeDataset,
      sourcePlanCode: activePlan.plan_code,
      planName,
    });
    const createdPlan = planById(`copy-${payload.copyId}`);
    if (createdPlan) {
      els.currentPlanSelect.value = createdPlan.id;
      state.activePlanId = createdPlan.id;
    }
    closeNewPlanModal();
    refreshStateAndRender("已创建新的个人方案副本。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    els.newPlanErrorText.textContent = error.message;
    updateStatus(`新增方案副本失败：${error.message}`);
  }
}

async function createUnplacedLabAction() {
  if (!canEditActivePlan()) {
    els.newUnplacedLabErrorText.textContent = "当前账号没有编辑此方案的权限。";
    return;
  }
  const activePlan = planById(state.activePlanId);
  if (!activePlan) {
    els.newUnplacedLabErrorText.textContent = "当前没有可编辑方案。";
    return;
  }
  const labName = String(els.newUnplacedLabNameInput.value || "").trim();
  if (!labName) {
    els.newUnplacedLabErrorText.textContent = "请输入名称。";
    els.newUnplacedLabNameInput.focus();
    return;
  }
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
  const lab = normalizeLab({
    lab_code: nextUnitCode(),
    lab_name: labName,
    college: String(els.newUnplacedLabCollegeInput.value || "").trim(),
    major: "",
    lab_type: "实验室",
    director: "",
    seat_count: Math.max(0, Number(els.newUnplacedLabSeatInput.value || 0)),
    computer_count: Math.max(0, Number(els.newUnplacedLabComputerInput.value || 0)),
    status: "planning",
    notes: "",
    created_at: isoNow(),
  });
  state.data.labs.push(lab);
  const relation = relationMaps(state.data);
  state.data.plan_assignments.push(normalizeAssignment({
    plan_code: activePlan.plan_code,
    lab_code: lab.lab_code,
    space_code: "",
    previous_space_code: "",
    assignment_status: "Invalid",
    move_note: "",
    effective_from: "",
    created_at: isoNow(),
  }, relation));
  state.data = normalizeDataset(state.data);
  closeNewUnplacedLabModal();
  state.inspectorMode = "placement";
  renderEditor();
  renderApp();
  try {
    if (state.serverMode) {
      await submitAssignmentActionToServer("createUnplacedUnit", {
        form: {
          labName,
          college: lab.college,
          seatCount: lab.seat_count,
          computerCount: lab.computer_count,
        },
      });
    } else {
      const saveOk = await saveWithRollback(previousData, previousRevision, "新增待安置用途单元", "新增待安置用途单元失败");
      if (!saveOk) throw new Error("新增待安置用途单元失败");
    }
  } catch (error) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    state.planCopies = previousCopies;
    refreshStateAndRender(`新增待安置用途单元失败：${error.message}`, { stamp: false, forceMoveReset: true });
    return;
  }
  syncSavedUnplacedMoveBasketItems();
  refreshStateAndRender(`已新增待安置用途单元 ${labName}。`, { stamp: false });
}

function buildingByCode(buildingCode) {
  return state.data.buildings.find((row) => row.building_code === buildingCode) || null;
}

function planById(id) {
  return state.data.plans.find((row) => row.id === id) || null;
}

function updateDatasetSummary(text) {
  const assignedCount = state.data.plan_assignments.filter((row) => row.space_id).length;
  updateStatus(`${text}，${state.data.buildings.length} 栋楼，${state.data.spaces.length} 个空间，${state.data.labs.length} 个用途单元，${assignedCount} 条已落位分配。`);
}

function updateStatus(text) {
  state.statusMessage = text;
  const workbookHint = ImportExport.workbookAvailable()
    ? ""
    : " Excel 组件会在导入或导出 .xlsx 时按需加载；加载失败时会自动降级到 JSON。";
  els.statusText.textContent = `${text}${workbookHint}`;
}
