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
const { fetchJson } = window.FloorplanApp.Api;
const ImportExport = window.FloorplanApp.ImportExport;
const Canvas = window.FloorplanApp.Canvas;
const REMEMBERED_USER_KEY = "floorplan_remembered_user";

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
  editorMode: "business",
  editorKey: "spaces",
  editorHighlight: null,
  businessEditor: {
    selectedAssignmentId: "",
    selectedSpaceId: "",
    newSpaceId: "",
  },
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
  loginSubmitting: false,
  userManagement: {
    users: [],
    loading: false,
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
  els.repairTextBtn.addEventListener("click", () => void repairCorruptedText());
  els.loginBtn.addEventListener("click", openLoginModal);
  els.logoutBtn.addEventListener("click", () => void logoutFlow());
  els.fitCanvasBtn.addEventListener("click", () => Canvas.resetCanvasZoom(state, els));
  els.zoomOutBtn.addEventListener("click", () => Canvas.changeCanvasZoom(state, els, -0.15));
  els.zoomInBtn.addEventListener("click", () => Canvas.changeCanvasZoom(state, els, 0.15));
  els.addRowBtn.addEventListener("click", () => runWithUnsavedGuard(addEditorRow));
  els.applyTableBtn.addEventListener("click", () => runWithUnsavedGuard(() => { void applyEditorRows(); }));
  els.downloadSheetBtn.addEventListener("click", () => runWithUnsavedGuard(downloadEditorData));
  els.newPlanBtn.addEventListener("click", () => runWithUnsavedGuard(openNewPlanModal));
  els.toggleVisibilityBtn.addEventListener("click", () => void toggleActivePlanVisibility());
  els.deletePlanBtn.addEventListener("click", () => runWithUnsavedGuard(openDeletePlanModal));
  els.singleModeBtn.addEventListener("click", () => runWithUnsavedGuard(() => setPlanViewMode("single")));
  els.compareModeBtn.addEventListener("click", () => runWithUnsavedGuard(() => setPlanViewMode("compare")));

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
  els.newPlanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void createPlanFromActiveAction();
  });
  els.cancelNewPlanBtn.addEventListener("click", closeNewPlanModal);

  window.addEventListener("resize", () => els.floorplan.classList.contains("is-fit") && Canvas.applyCanvasMode(state, els));
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
      dataset: state.data,
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
  state.businessEditor.selectedAssignmentId = "";
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
    else if ((name.endsWith(".xlsx") || name.endsWith(".xls")) && ImportExport.workbookAvailable()) raw = ImportExport.readWorkbookDataset(await file.arrayBuffer());
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
    const selectedStillExists = state.importDrafts.drafts.some((plan) => plan.id === state.importDrafts.selectedId);
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
    const payload = await fetchJson(`/api/manage/plans/${planId}`);
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
  const context = findRenderablePreviewContext(dataset);
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
  if (state.importDrafts.loadingList) {
    els.importDraftList.innerHTML = `<div class="empty">正在加载方案...</div>`;
    return;
  }
  if (!state.importDrafts.drafts.length) {
    els.importDraftList.innerHTML = `<div class="empty">当前没有可管理方案。</div>`;
    return;
  }
  els.importDraftList.innerHTML = state.importDrafts.drafts.map((plan) => {
    const selectedClass = plan.id === state.importDrafts.selectedId ? " is-active" : "";
    return `
      <button type="button" class="import-draft-item${selectedClass}" data-import-draft-id="${plan.id}">
        <span class="import-draft-item-head">
          <strong>#${plan.id} ${escapeHtml(plan.planName)}</strong>
          <span class="status-pill ${plan.isBaseline ? "" : "is-disabled"}">${plan.isBaseline ? "基线" : "非基线"}</span>
        </span>
        <span>${escapeHtml(managedPlanSourceLabel(plan))} · ${plan.isMine ? "我创建" : escapeHtml(plan.ownerUsername || "-")}</span>
        <span>${plan.isPublic ? "公开" : "私有"} · 更新于 ${escapeHtml(formatDateTime(plan.updatedAt))}</span>
      </button>
    `;
  }).join("");
  els.importDraftList.querySelectorAll("[data-import-draft-id]").forEach((button) => {
    button.addEventListener("click", () => void selectImportDraft(Number(button.dataset.importDraftId)));
  });
}

function renderImportDraftDetail() {
  const detail = state.importDrafts.detail;
  const canAct = Boolean(detail && !state.importDrafts.loadingDetail);
  els.publishImportDraftBtn.disabled = !canAct || detail?.isBaseline;
  els.discardImportDraftBtn.disabled = !canAct;
  els.publishImportDraftBtn.textContent = detail?.isBaseline ? "已是基线" : "设为基线";
  if (state.importDrafts.loadingDetail) {
    els.importDraftDetail.innerHTML = `<div class="import-draft-detail-empty">正在打开方案详情...</div>`;
    return;
  }
  if (!detail) {
    els.importDraftDetail.innerHTML = `<div class="import-draft-detail-empty">请选择一个方案查看预览。</div>`;
    return;
  }

  const dataset = detail.dataset;
  els.importDraftDetail.innerHTML = `
    <div class="import-detail-header">
      <div>
        <h4>#${detail.id} ${escapeHtml(detail.planName)}</h4>
        <p>${escapeHtml(managedPlanSourceLabel(detail))} · ${detail.isMine ? "我创建" : escapeHtml(detail.ownerUsername || "-")} · ${detail.isPublic ? "公开" : "私有"}</p>
      </div>
      <span class="status-pill ${detail.isBaseline ? "" : "is-disabled"}">${detail.isBaseline ? "基线" : "非基线"}</span>
    </div>
    <div class="import-summary-grid">
      ${managedSummaryCard("教学楼", dataset.buildings.length)}
      ${managedSummaryCard("楼层骨架", dataset.floor_segments.length)}
      ${managedSummaryCard("空间", dataset.spaces.length)}
      ${managedSummaryCard("实验室", dataset.labs.length)}
      ${managedSummaryCard("分配", dataset.plan_assignments.length)}
      ${managedSummaryCard("修订", detail.revision || 1)}
    </div>
    <div class="managed-plan-form">
      <label>方案名称<input id="managedPlanNameInput" type="text" value="${escapeHtml(detail.planName)}" maxlength="80" /></label>
      <button id="renameManagedPlanBtn" type="button">保存名称</button>
    </div>
    <div class="import-preview-controls">
      <label>楼栋<select id="importPreviewBuildingSelect"></select></label>
      <label>楼层<select id="importPreviewFloorSelect"></select></label>
      <label>方案<select id="importPreviewPlanSelect"></select></label>
    </div>
    <div class="import-preview-shell">
      <div id="importPreviewPlanBadge" class="import-preview-badge">方案预览</div>
      <div id="importPreviewCanvas" class="floorplan import-preview-canvas"></div>
    </div>
  `;
  bindImportDraftDetailEvents(dataset);
  renderImportPreviewCanvas();
}

function bindImportDraftDetailEvents(dataset) {
  els.importDraftDetail.querySelector("#renameManagedPlanBtn")?.addEventListener("click", () => void renameSelectedManagedPlan());

  const buildingSelect = els.importDraftDetail.querySelector("#importPreviewBuildingSelect");
  const planSelect = els.importDraftDetail.querySelector("#importPreviewPlanSelect");
  fillInlineSelect(buildingSelect, dataset.buildings.slice().sort(compareBuildings).map((row) => ({ value: row.building_code, label: row.building_name || row.building_code })), state.importDrafts.preview.buildingCode);
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

function managedSummaryCard(label, value) {
  return `<div class="import-summary-card"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></div>`;
}

function findRenderablePreviewContext(dataset) {
  const currentBuilding = state.importDrafts.preview.buildingCode;
  const currentFloor = state.importDrafts.preview.floorCode;
  const currentHasSegments = dataset.floor_segments.some((row) => row.building_code === currentBuilding && row.floor_code === currentFloor);
  if (currentHasSegments) return { buildingCode: currentBuilding, floorCode: currentFloor };
  for (const building of dataset.buildings.slice().sort(compareBuildings)) {
    const floorCode = unique(dataset.floor_segments
      .filter((row) => row.building_code === building.building_code)
      .map((row) => row.floor_code))
      .sort(compare)[0] || "";
    if (floorCode) return { buildingCode: building.building_code, floorCode };
  }
  return {
    buildingCode: dataset.buildings.slice().sort(compareBuildings)[0]?.building_code || "",
    floorCode: unique(dataset.floor_segments.map((row) => row.floor_code)).sort(compare)[0] || "",
  };
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
    colors: colorMap(dataset.labs),
    selectedSpaceId: null,
    collegeFilter: ALL_COLLEGES,
    onSelectSpace: () => {},
  });
}

function managedPlanSourceLabel(plan) {
  if (plan.sourceType === "import") return "admin 上传数据包";
  if (plan.ownerRole === "admin") return "admin 创建方案";
  if (plan.isPublic) return "editor 公开方案";
  return "方案副本";
}

async function renameSelectedManagedPlan() {
  const detail = state.importDrafts.detail;
  const input = els.importDraftDetail.querySelector("#managedPlanNameInput");
  const planName = input?.value.trim();
  if (!detail || !planName) return;
  try {
    const payload = await fetchJson(`/api/manage/plans/${detail.id}`, {
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
  if (!detail || detail.isBaseline) return;
  if (!window.confirm(`确认将方案“${detail.planName}”设为基线？设为基线后，除管理员外其他用户不可修改。`)) return;
  els.publishImportDraftBtn.disabled = true;
  try {
    const payload = await fetchJson(`/api/manage/plans/${detail.id}/baseline`, { method: "POST", body: JSON.stringify({}) });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    refreshStateAndRender(`已将 ${detail.planName} 设为基线`, { stamp: false, forceMoveReset: true });
    await loadImportDrafts();
    await selectImportDraft(detail.id);
  } catch (error) {
    els.importDraftsErrorText.textContent = `设置基线失败：${error.message}`;
  }
}

async function discardSelectedImportDraft() {
  const detail = state.importDrafts.detail;
  if (!detail) return;
  const risk = detail.isBaseline || !detail.isMine ? "此操作会删除基线或他人公开方案，" : "";
  if (!window.confirm(`${risk}确认删除方案“${detail.planName}”？删除后该方案及其分配将不再显示。`)) return;
  els.discardImportDraftBtn.disabled = true;
  try {
    const payload = await fetchJson(`/api/manage/plans/${detail.id}`, { method: "DELETE" });
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
  state.moveDraft = null;
  state.moveErrors = {};
  state.moveDirty = false;
  state.moveTargetKey = null;
  state.pendingNavigation = null;
  state.planDeleteTargetId = null;
}

function refreshStateAndRender(message, options = {}) {
  const { stamp = false, forceMoveReset = false } = options;
  // 统一入口：任何数据变更后都经过这里同步控件、权限、编辑表、主图和状态栏。
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

function copyIdFromPlan(plan) {
  const match = String(plan?.plan_code || "").match(/^copy-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function copyMetaForPlan(plan) {
  const copyId = copyIdFromPlan(plan);
  return copyId ? state.planCopies.find((copy) => copy.id === copyId) || null : null;
}

function activePlanCopyMeta() {
  return copyMetaForPlan(planById(state.activePlanId));
}

function canManageCopy(copy) {
  return Boolean(copy && state.user && (state.permissions.canAdmin || (!copy.isBaseline && copy.ownerUserId === state.user.id)));
}

function canEditPlanDataset(copy) {
  return Boolean(copy && state.user && (state.permissions.canAdmin || (!copy.isBaseline && copy.ownerUserId === state.user.id)));
}

function isOwnCopy(copy) {
  return Boolean(copy && state.user && copy.ownerUserId === state.user.id);
}

function planCopyLabel(plan, copy) {
  if (!copy) return plan.plan_name;
  const idLabel = copy.visibility === "public" ? `公开 #${copy.id}` : `#${copy.id}`;
  if (isOwnCopy(copy)) return `我的副本 · ${plan.plan_name} · ${idLabel}`;
  if (state.permissions.canAdmin && copy.ownerUsername) return `${copy.ownerUsername} 的副本 · ${plan.plan_name} · ${idLabel}`;
  return `公开副本 · ${plan.plan_name} · 公开 #${copy.id}`;
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
  const previousSingle = els.currentPlanSelect.value;
  const previousBefore = els.beforePlanSelect.value;
  const previousAfter = els.afterPlanSelect.value;
  const items = state.data.plans.slice().sort((a, b) => compare(a.plan_name, b.plan_name)).map((plan) => {
    const copy = copyMetaForPlan(plan);
    return { value: plan.id, label: planCopyLabel(plan, copy) };
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
  const stillVisible = state.data.spaces.some((row) =>
    row.id === state.selectedSpaceId &&
    row.building_code === els.buildingSelect.value &&
    row.floor_code === els.floorSelect.value
  );
  if (!stillVisible) state.selectedSpaceId = null;
}

function syncControlSnapshots() {
  [els.buildingSelect, els.floorSelect, els.collegeSelect, els.currentPlanSelect, els.beforePlanSelect, els.afterPlanSelect].forEach((select) => {
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
  const canDeletePlan = Boolean(canManageCopy(activeCopy) && state.data.plans.length > 1);
  const canToggleVisibility = Boolean(canManageCopy(activeCopy));

  els.singlePlanFilter.classList.toggle("is-hidden", isCompare);
  els.planCompareFilters.classList.toggle("is-hidden", !isCompare);
  els.currentPlanSelect.disabled = isCompare;
  els.beforePlanSelect.disabled = !isCompare;
  els.afterPlanSelect.disabled = !isCompare;
  els.compareModeBtn.disabled = state.data.plans.length < 2;
  els.singleModeBtn.classList.toggle("is-active", !isCompare);
  els.compareModeBtn.classList.toggle("is-active", isCompare);
  els.compareColumns.classList.toggle("is-single", !isCompare);
  els.afterColumn.classList.toggle("is-hidden", !isCompare);

  els.comparePanelTitle.textContent = "缩略图";
  els.comparePanelHint.textContent = isCompare ? "点击左右缩略图，切换主图中的对比方案。" : "当前按单方案维护，可随时切换到对比模式。";
  els.beforePlanName.textContent = isCompare
    ? beforePlan?.plan_name || activePlan?.plan_name || ""
    : currentPlan?.plan_name || activePlan?.plan_name || "";
  els.afterPlanName.textContent = isCompare ? afterPlan?.plan_name || "" : "";

  els.newPlanBtn.disabled = !state.permissions.canEdit;
  els.toggleVisibilityBtn.disabled = !canToggleVisibility;
  els.toggleVisibilityBtn.textContent = activeCopy?.visibility === "public" ? "设为私有" : "公开副本";
  els.toggleVisibilityBtn.title = canToggleVisibility ? "" : "只能公开或私有化自己创建的副本";
  els.deletePlanBtn.disabled = !canDeletePlan;
  els.deletePlanBtn.title = canDeletePlan ? "" : (deletePlan?.is_locked ? "锁定方案不可删除" : "只能删除自己创建的副本");
}

function renderEditorTabs() {
  els.editorTabs.innerHTML = [
    `<button type="button" data-mode="business" class="${state.editorMode === "business" ? "is-active" : ""}">业务编辑</button>`,
    ...DATASETS.map(({ key, label }) => `<button type="button" data-mode="raw" data-key="${key}" class="${state.editorMode === "raw" && state.editorKey === key ? "is-active" : ""}">${escapeHtml(label)}</button>`),
  ].join("");
  els.editorTabs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    const mode = button.dataset.mode === "raw" ? "raw" : "business";
    const key = button.dataset.key || state.editorKey;
    if (state.editorMode === mode && state.editorKey === key) return;
    runWithUnsavedGuard(() => {
      state.editorMode = mode;
      if (mode === "raw") state.editorKey = key;
      state.editorHighlight = null;
      renderEditorTabs();
      renderEditor();
    });
  }));
}

function renderApp() {
  const building = buildingByCode(els.buildingSelect.value);
  const currentPlan = planById(els.currentPlanSelect.value);
  const beforePlan = planById(els.beforePlanSelect.value);
  const afterPlan = planById(els.afterPlanSelect.value);
  const activePlan = planById(state.activePlanId);
  const colors = colorMap(state.data.labs);
  const thumbPlan = state.planViewMode === "compare" ? beforePlan : currentPlan || activePlan || beforePlan;
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
    canEdit: canEditActivePlan(),
    onFocusRow: focusRowFromDetails,
    onOpenMove: openMoveMode,
    onPlanSpace: planSelectedSpaceAction,
    onRenovateLab: renovateSelectedLabAction,
    onMoveFieldChange: updateMoveField,
    onConfirmMove: confirmMoveAssignmentAction,
    onCancelMove: cancelMoveMode,
  });

  Canvas.applyCanvasMode(state, els);
}

function getSelectedContext() {
  const building = buildingByCode(els.buildingSelect.value);
  const activePlan = planById(state.activePlanId);
  const space = state.data.spaces.find((row) =>
    row.id === state.selectedSpaceId &&
    row.building_code === els.buildingSelect.value &&
    row.floor_code === els.floorSelect.value
  ) || null;
  const assignment = activePlan && space ? state.data.plan_assignments.find((row) => row.plan_id === activePlan.id && row.space_id === space.id && row.assignment_status === "assigned") || null : null;
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
    state.businessEditor.selectedAssignmentId = "";
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
    state.businessEditor.selectedSpaceId = spaceId;
    state.detailsMode = "view";
    syncMoveDraft(true);
    if (state.editorMode === "business") renderEditor();
    renderApp();
  });
}

function openMoveMode() {
  if (!canEditActivePlan()) {
    updateStatus("请先选择自己创建的方案副本后再执行搬迁。");
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
  if (!canEditActivePlan()) {
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
  const college = String(window.prompt("请输入该未规划实验室所属学院：", "") || "").trim();
  if (!college) {
    updateStatus("已取消规划。");
    return;
  }
  await savePlaceholderLabForSpace(context.space, college, {
    invalidAssignment: null,
    successMessage: `${context.space.front_door || context.space.space_code} 已规划为未规划实验室。`,
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
  const saveOk = await saveWithRollback(previousData, previousRevision, "规划未规划实验室", "规划保存失败");
  if (!saveOk) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    state.planCopies = previousCopies;
    return;
  }
  state.selectedSpaceId = space.id;
  state.businessEditor.selectedSpaceId = space.id;
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
    construction_time: "",
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
  state.planDraftName = uniquePlanName(`${activePlan.plan_name} 副本`);
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
    const payload = await fetchJson(`/api/plan-copies/${copy.id}`, {
      method: "PATCH",
      body: JSON.stringify({ visibility: nextVisibility }),
    });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
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
    const payload = await fetchJson(`/api/plan-copies/${copy.id}`, { method: "DELETE" });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    closeDeletePlanModal();
    resetContextState();
    refreshStateAndRender("已删除当前方案副本。", { stamp: false, forceMoveReset: true });
  } catch (error) {
    updateStatus(`删除方案副本失败：${error.message}`);
  }
}

function renderEditor() {
  syncEditorActionButtons();
  els.dataEditor.classList.toggle("is-business-mode", state.editorMode === "business");
  if (state.editorMode === "business") {
    renderBusinessAssignmentEditor();
    return;
  }
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

  const inputDisabled = canEditEditorKey(state.editorKey) ? "" : "disabled";
  els.dataEditor.innerHTML = `<table><thead><tr>${definition.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr data-row-id="${escapeHtml(row.id || "")}" class="${highlightRowId && row.id === highlightRowId ? "is-highlight" : ""}">${definition.columns.map(([key]) => `<td data-key="${key}"><input data-row="${rowIndex}" data-key="${key}" value="${escapeHtml(row[key] ?? "")}" ${inputDisabled}></td>`).join("")}</tr>`).join("")}</tbody></table>`;

  if (highlightRowId) {
    const highlightedRow = [...els.dataEditor.querySelectorAll("tr")].find((row) => row.dataset.rowId === highlightRowId);
    highlightedRow?.scrollIntoView({ block: "nearest" });
  }
}

function syncEditorActionButtons() {
  if (state.editorMode === "business") {
    const canEditAssignment = canEditActivePlan();
    const canEditBase = canEditBusinessBaseData();
    els.addRowBtn.textContent = "新增空间";
    els.applyTableBtn.textContent = "保存当前空间";
    els.addRowBtn.hidden = !state.permissions.canEdit;
    els.applyTableBtn.hidden = !state.permissions.canEdit;
    els.addRowBtn.disabled = !canEditBase;
    els.applyTableBtn.disabled = !(canEditAssignment || canEditBase);
    els.downloadSheetBtn.hidden = true;
    return;
  }
  els.addRowBtn.textContent = "新增行";
  els.applyTableBtn.textContent = "应用修改";
  els.addRowBtn.hidden = !state.permissions.canEdit;
  els.applyTableBtn.hidden = !state.permissions.canEdit;
  els.addRowBtn.disabled = !canEditEditorKey(state.editorKey);
  els.applyTableBtn.disabled = !canEditEditorKey(state.editorKey);
  els.downloadSheetBtn.hidden = false;
}

function renderBusinessAssignmentEditor() {
  const activePlan = planById(state.activePlanId);
  if (!activePlan) {
    els.dataEditor.innerHTML = `<div class="empty">请先选择一个方案。</div>`;
    return;
  }
  const assignments = assignmentRowsForPlan(activePlan.id);
  const floorSpaces = currentFloorSpaces();
  const floorSpaceIds = new Set(floorSpaces.map((space) => space.id));
  const floorAssignments = assignments.filter((assignment) => floorSpaceIds.has(assignment.space_id) && assignment.assignment_status === "assigned");
  const selectedSpace = ensureBusinessSpaceSelection(floorSpaces);
  const selected = selectedSpace ? assignedAssignmentForSpace(assignments, selectedSpace) : null;
  const selectedLabCode = selected?.lab_code || "";
  const selectedLab = selected ? state.data.labs.find((row) => row.lab_code === selected.lab_code) || null : null;
  const isNewSpace = Boolean(selectedSpace && state.businessEditor.newSpaceId === selectedSpace.id);
  const building = buildingByCode(els.buildingSelect.value);
  const segments = currentFloorSegments();
  const segment = selectedSpace
    ? segments.find((row) => row.segment_code === selectedSpace.segment_code) || segments[0] || null
    : segments[0] || null;
  const canEditAssignment = canEditActivePlan();
  const canEditBase = canEditBusinessBaseData();
  const conflict = selectedSpace && selectedLabCode
    ? assignments.find((row) => row.space_id === selectedSpace.id && row.assignment_status === "assigned" && row.lab_code !== selectedLabCode)
    : null;
  const canSaveAnything = canEditAssignment || canEditBase;

  els.dataEditor.innerHTML = `
    <div class="business-editor">
      <div class="business-editor-list">
        <div class="business-editor-heading">
          <strong>${escapeHtml(building?.building_name || building?.building_code || "当前楼栋")} ${escapeHtml(els.floorSelect.value || "")}层</strong>
          <span>${floorAssignments.length}/${floorSpaces.length} 已分配</span>
        </div>
        ${floorSpaces.length ? floorSpaces.map((space) => businessSpaceCard(space, assignments, selectedSpace?.id || "")).join("") : `<div class="empty">当前楼层还没有空间资料。</div>`}
      </div>
      <form id="businessAssignmentForm" class="business-assignment-form">
        <div class="business-editor-heading">
          <strong>${selectedSpace ? `编辑 ${businessDoorRangeLabel(selectedSpace) || selectedSpace.space_code}` : "当前楼层业务编辑"}</strong>
          <span>${escapeHtml(activePlan.plan_name)}</span>
        </div>
        <div class="business-form-section business-form-section-space">
          <strong>空间信息</strong>
          ${isNewSpace ? `<label>前门牌
            <input name="frontDoor" type="text" value="${escapeHtml(selectedSpace?.front_door || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
          </label>
          <label>后门牌
            <input name="rearDoor" type="text" value="${escapeHtml(selectedSpace?.rear_door || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
          </label>
          <label>骨架段
            <select name="segmentCode" ${canEditBase && selectedSpace ? "" : "disabled"}>
              ${segments.map((item) => `<option value="${escapeHtml(item.segment_code)}" ${item.segment_code === selectedSpace?.segment_code ? "selected" : ""}>${escapeHtml(item.segment_code)} · ${segmentTypeLabel(item.element_type)}</option>`).join("")}
            </select>
          </label>` : `<input name="frontDoor" type="hidden" value="${escapeHtml(selectedSpace?.front_door || "")}" />
          <input name="rearDoor" type="hidden" value="${escapeHtml(selectedSpace?.rear_door || "")}" />
          <input name="segmentCode" type="hidden" value="${escapeHtml(selectedSpace?.segment_code || "")}" />`}
          <label>物理状态
            <select name="spaceStatus" ${canEditBase && selectedSpace ? "" : "disabled"}>
              ${["active", "unavailable"].map((status) => `<option value="${status}" ${status === selectedSpace?.current_status ? "selected" : ""}>${spaceStatusLabel(status)}</option>`).join("")}
            </select>
          </label>
          <label>所在侧
            <select name="spaceSide" ${canEditBase && selectedSpace ? "" : "disabled"}>
              ${["north", "south", "east", "west"].map((side) => `<option value="${side}" ${side === selectedSpace?.side ? "selected" : ""}>${sideLabel(side)}</option>`).join("")}
            </select>
          </label>
          <label>沿段偏移
            <input name="offsetM" type="number" step="0.1" min="0" value="${escapeHtml(selectedSpace?.offset_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
          </label>
          <label>长度
            <input name="lengthM" type="number" step="0.1" min="0.1" value="${escapeHtml(selectedSpace?.length_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
          </label>
          <label>宽度
            <input name="widthM" type="number" step="0.1" min="0.1" value="${escapeHtml(selectedSpace?.width_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
          </label>
          <label>网段
            <input name="networkSegment" type="text" value="${escapeHtml(selectedSpace?.network_segment || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
          </label>
        </div>
        <div class="business-form-section business-form-section-lab">
          <strong>实验室信息</strong>
          <label>落位实验室
            <select name="labCode" ${canEditAssignment && selectedSpace ? "" : "disabled"}>
              <option value="" ${!selectedLabCode ? "selected" : ""}>未分配实验室</option>
              ${businessLabOptions(selectedLabCode)}
            </select>
          </label>
          <label>实验室名称
            <input name="labName" type="text" value="${escapeHtml(selectedLab?.lab_name || "")}" ${canEditBase && selectedLab ? "" : "disabled"} />
          </label>
          <label>类型
            <input name="labType" type="text" value="${escapeHtml(selectedLab?.lab_type || "")}" ${canEditBase && selectedLab ? "" : "disabled"} />
          </label>
          <label>学院
            <input name="college" type="text" value="${escapeHtml(selectedLab?.college || "")}" ${canEditBase && selectedLab ? "" : "disabled"} />
          </label>
          <label>专业
            <input name="major" type="text" value="${escapeHtml(selectedLab?.major || "")}" ${canEditBase && selectedLab ? "" : "disabled"} />
          </label>
          <label>负责人
            <input name="director" type="text" value="${escapeHtml(selectedLab?.director || "")}" ${canEditBase && selectedLab ? "" : "disabled"} />
          </label>
          <label>座位数
            <input name="seatCount" type="number" step="1" min="0" value="${escapeHtml(selectedLab?.seat_count ?? "")}" ${canEditBase && selectedLab ? "" : "disabled"} />
          </label>
          <label>电脑数
            <input name="computerCount" type="number" step="1" min="0" value="${escapeHtml(selectedLab?.computer_count ?? "")}" ${canEditBase && selectedLab ? "" : "disabled"} />
          </label>
          <label>备注
            <input name="moveNote" type="text" value="${escapeHtml(selected?.move_note || "")}" ${canEditAssignment && selectedSpace ? "" : "disabled"} />
          </label>
          ${!selectedLab ? `<div class="business-preview business-unplanned-card">
            <strong>未规划</strong>
            <span>当前空间没有已分配实验室，可在右侧详情栏点击“规划”。</span>
          </div>` : ""}
          ${conflict ? `<div class="business-conflict">当前空间已被 ${escapeHtml(labNameByCode(conflict.lab_code))} 占用。勾选后保存会将原分配改为无效。</div>
          <label class="business-checkbox"><input name="replaceConflict" type="checkbox" ${canEditAssignment ? "" : "disabled"} /> 替换当前占用</label>` : ""}
        </div>
        <div class="business-preview">
          <strong>系统自动维护</strong>
          <span>${selectedSpace ? escapeHtml(`${spaceDisplayName(selectedSpace)} · ${selectedLab?.lab_name || "未分配实验室"}`) : "请先在当前楼层选择一个空间"}</span>
        </div>
        ${canDeleteSpaceInActivePlan() && selectedSpace && !isNewSpace ? `<div class="business-danger-row"><button id="businessDeleteSpaceBtn" type="button">删除空间</button><span>从当前非基线方案中删除该空间，并将相关分配标记为无效。</span></div>` : ""}
        ${canSaveAnything ? "" : `<div class="business-readonly">当前账号只能查看业务信息，不能保存修改。</div>`}
        <input name="selectedSpaceId" type="hidden" value="${escapeHtml(selectedSpace?.id || "")}" />
        <input name="currentAssignmentId" type="hidden" value="${escapeHtml(selected?.id || "")}" />
      </form>
    </div>
  `;
  els.dataEditor.querySelectorAll("[data-business-space-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.businessEditor.selectedSpaceId = button.dataset.businessSpaceId;
      state.selectedSpaceId = button.dataset.businessSpaceId;
      const assignment = assignments.find((row) => row.space_id === button.dataset.businessSpaceId && row.assignment_status === "assigned") || null;
      state.businessEditor.selectedAssignmentId = assignment?.id || "";
      renderEditor();
      renderApp();
    });
  });
  els.dataEditor.querySelector('select[name="labCode"]')?.addEventListener("change", renderBusinessLabPreview);
  els.dataEditor.querySelector("#businessDeleteSpaceBtn")?.addEventListener("click", () => { void markSelectedBusinessSpaceUnavailable(); });
}

function currentFloorSpaces() {
  const buildingCode = els.buildingSelect.value;
  const floorCode = els.floorSelect.value;
  return state.data.spaces
    .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
    .slice()
    .sort((a, b) => compare(spaceDisplayName(a), spaceDisplayName(b)));
}

function currentFloorSegments() {
  const buildingCode = els.buildingSelect.value;
  const floorCode = els.floorSelect.value;
  return state.data.floor_segments
    .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
    .slice()
    .sort((a, b) => compare(a.segment_code, b.segment_code));
}

function ensureBusinessSpaceSelection(floorSpaces) {
  if (!floorSpaces.length) {
    state.businessEditor.selectedSpaceId = "";
    state.businessEditor.selectedAssignmentId = "";
    return null;
  }
  const preferredId = state.businessEditor.selectedSpaceId || state.selectedSpaceId;
  const selected = floorSpaces.find((space) => space.id === preferredId) || floorSpaces[0];
  state.businessEditor.selectedSpaceId = selected.id;
  state.selectedSpaceId = selected.id;
  const activePlan = planById(state.activePlanId);
  const assignment = activePlan ? assignedAssignmentForSpace(assignmentRowsForPlan(activePlan.id), selected) : null;
  state.businessEditor.selectedAssignmentId = assignment?.id || "";
  return selected;
}

function businessSpaceCard(space, assignments, selectedSpaceId) {
  const assignment = assignedAssignmentForSpace(assignments, space);
  const lab = assignment ? state.data.labs.find((row) => row.lab_code === assignment.lab_code) || null : null;
  const status = deriveBusinessSpaceStatus(space, assignment);
  return `<button type="button" class="business-assignment-card ${space.id === selectedSpaceId ? "is-active" : ""}" data-business-space-id="${escapeHtml(space.id)}">
    <strong>${escapeHtml(businessDoorRangeLabel(space) || space.space_code)}</strong>
    <span><b class="business-status-pill is-${status.key}">${status.label}</b>${escapeHtml(lab?.lab_name || "未分配实验室")}</span>
    <small>${escapeHtml(sideLabel(space.side))}侧 · ${escapeHtml((space.area_m2 || 0).toFixed(1))} m²</small>
  </button>`;
}

function businessLabOptions(selectedLabCode) {
  return state.data.labs
    .slice()
    .sort((a, b) => compare(a.lab_name, b.lab_name))
    .map((lab) => `<option value="${escapeHtml(lab.lab_code)}" ${lab.lab_code === selectedLabCode ? "selected" : ""}>${escapeHtml(lab.lab_name || lab.lab_code)} · ${escapeHtml(lab.college || "-")}</option>`)
    .join("");
}

function businessDoorRangeLabel(space) {
  const frontDoor = String(space?.front_door || "").trim();
  const rearDoor = String(space?.rear_door || "").trim();
  if (frontDoor && rearDoor && frontDoor !== rearDoor) return `${frontDoor}-${rearDoor}`;
  return frontDoor || rearDoor || "";
}

function renderBusinessLabPreview() {
  const form = els.dataEditor.querySelector("#businessAssignmentForm");
  if (!form) return;
  const lab = state.data.labs.find((row) => row.lab_code === form.labCode?.value) || null;
  [
    ["labName", lab?.lab_name || ""],
    ["college", lab?.college || ""],
    ["major", lab?.major || ""],
    ["labType", lab?.lab_type || ""],
    ["director", lab?.director || ""],
    ["seatCount", lab?.seat_count ?? ""],
    ["computerCount", lab?.computer_count ?? ""],
  ].forEach(([name, value]) => {
    if (form[name]) form[name].value = value;
  });
}

function spaceDisplayName(space) {
  const building = state.data.buildings.find((row) => row.building_code === space.building_code);
  return `${building?.building_name || space.building_code} ${space.floor_code}层 ${businessDoorRangeLabel(space) || space.space_code}`;
}

function labNameByCode(labCode) {
  return state.data.labs.find((row) => row.lab_code === labCode)?.lab_name || labCode || "-";
}

function businessStatusLabel(status) {
  return {
    assigned: "已分配",
    Invalid: "无效",
  }[status] || status || "-";
}

function normalizeBusinessAssignmentStatus(status, hasSpace = false) {
  const raw = String(status || "").trim().toLowerCase();
  if (["assigned", "pending_move", "已分配", "已落位", "待搬迁"].includes(raw)) return "assigned";
  if (["invalid", "unplaced", "无效", "未落位", "未分配"].includes(raw)) return "Invalid";
  return hasSpace ? "assigned" : "Invalid";
}

function assignedAssignmentForSpace(assignments, space) {
  return assignments.find((row) => row.space_id === space.id && row.assignment_status === "assigned") || null;
}

function deriveBusinessSpaceStatus(space, assignment) {
  if (space?.current_status === "unavailable") return { key: "unavailable", label: "不可用" };
  if (assignment?.assignment_status === "assigned" && assignment.lab_code) {
    return assignment.effective_from
      ? { key: "built", label: "已建设" }
      : { key: "planned", label: "已规划" };
  }
  return { key: "unplanned", label: "未规划" };
}

function segmentTypeLabel(type) {
  return type === "stairs" ? "楼梯" : "走廊";
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
  if (!state.serverMode) return state.permissions.canEdit;
  const copy = activePlanCopyMeta();
  return Boolean(copy && !copy.isBaseline && canEditPlanDataset(copy));
}

function firstUnassignedLabCode(assignments) {
  const assigned = new Set(assignments.map((row) => row.lab_code));
  return state.data.labs.find((lab) => !assigned.has(lab.lab_code))?.lab_code || "";
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
  if (state.editorMode === "business") {
    if (!canEditBusinessBaseData()) {
      updateStatus("只有管理员可以新增当前楼层空间。");
      return;
    }
    const now = isoNow();
    const buildingCode = els.buildingSelect.value || state.data.buildings[0]?.building_code || "B01";
    const floorCode = els.floorSelect.value || "1";
    const space = normalizeSpace({
      space_code: `S-${Date.now()}`,
      building_code: buildingCode,
      floor_code: floorCode,
      segment_code: currentFloorSegments()[0]?.segment_code || "main",
      offset_m: 0,
      side: "south",
      front_door: "新空间",
      rear_door: "",
      length_m: 8,
      width_m: 6,
      network_segment: "",
      current_status: "active",
      created_at: now,
    });
    state.data.spaces.push(space);
    state.data = normalizeDataset(state.data);
    state.businessEditor.selectedSpaceId = space.id;
    state.businessEditor.newSpaceId = space.id;
    state.selectedSpaceId = space.id;
    refreshStateAndRender("已新增当前楼层空间，请完善右侧业务信息后保存。", { stamp: false, forceMoveReset: true });
    return;
  }
  if (!canEditEditorKey(state.editorKey)) {
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
  if (state.editorMode === "business") {
    await applyBusinessAssignmentForm();
    return;
  }
  if (!canEditEditorKey(state.editorKey)) {
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
  const saveOk = state.editorKey === "plan_assignments" && activePlanCopyMeta()
    ? await savePlanAssignmentsWithRollback(previousData, previousRevision)
    : await saveWithRollback(previousData, previousRevision, `编辑 ${state.editorKey}`, "表格保存失败");
  if (saveOk) {
    refreshStateAndRender("已应用表格修改。", { stamp: false, forceMoveReset: true });
  }
}

async function applyBusinessAssignmentForm() {
  const canEditAssignment = canEditActivePlan();
  const canEditBase = canEditBusinessBaseData();
  if (!canEditAssignment && !canEditBase) {
    updateStatus("当前账号没有保存业务编辑的权限。");
    return;
  }
  const activePlan = planById(state.activePlanId);
  const form = els.dataEditor.querySelector("#businessAssignmentForm");
  if (!activePlan || !form) return;
  const formData = new FormData(form);
  const selectedSpaceId = String(formData.get("selectedSpaceId") || "").trim();
  const selectedSpace = state.data.spaces.find((row) => row.id === selectedSpaceId) || null;
  if (!selectedSpace) {
    updateStatus("请先在当前楼层选择一个空间。");
    return;
  }
  const labCode = String(formData.get("labCode") || "").trim();
  const assignmentStatus = labCode ? "assigned" : "Invalid";
  const moveNote = String(formData.get("moveNote") || "").trim();
  const replaceConflict = formData.get("replaceConflict") === "on";
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
  const relation = relationMaps(state.data);
  const currentAssignments = assignmentRowsForPlan(activePlan.id);

  if (canEditBase) {
    const building = buildingByCode(selectedSpace.building_code);
    if (building) {
      Object.assign(building, normalizeBuilding({
        ...building,
        building_name: String(formData.get("buildingName") || building.building_name).trim(),
        campus_zone: String(formData.get("campusZone") || building.campus_zone).trim(),
        updated_at: isoNow(),
      }));
    }
    const nextSegmentCode = String(formData.get("segmentCode") || selectedSpace.segment_code).trim();
    const segment = state.data.floor_segments.find((row) =>
      row.building_code === selectedSpace.building_code &&
      row.floor_code === selectedSpace.floor_code &&
      row.segment_code === nextSegmentCode
    );
    if (segment) {
      Object.assign(segment, normalizeSegment({
        ...segment,
        width_m: formData.get("segmentWidth") || segment.width_m,
      }));
    }
    Object.assign(selectedSpace, normalizeSpace({
      ...selectedSpace,
      segment_code: nextSegmentCode || selectedSpace.segment_code,
      front_door: String(formData.get("frontDoor") || selectedSpace.front_door).trim(),
      rear_door: String(formData.get("rearDoor") || "").trim(),
      current_status: String(formData.get("spaceStatus") || selectedSpace.current_status).trim(),
      side: String(formData.get("spaceSide") || selectedSpace.side).trim(),
      offset_m: formData.get("offsetM") || selectedSpace.offset_m,
      length_m: formData.get("lengthM") || selectedSpace.length_m,
      width_m: formData.get("widthM") || selectedSpace.width_m,
      network_segment: String(formData.get("networkSegment") || "").trim(),
    }));
    const lab = labCode ? state.data.labs.find((row) => row.lab_code === labCode) || null : null;
    if (lab) {
      Object.assign(lab, normalizeLab({
        ...lab,
        lab_name: String(formData.get("labName") || lab.lab_name).trim(),
        college: String(formData.get("college") || lab.college).trim(),
        major: String(formData.get("major") || "").trim(),
        lab_type: String(formData.get("labType") || lab.lab_type).trim(),
        director: String(formData.get("director") || "").trim(),
        seat_count: formData.get("seatCount") || lab.seat_count,
        computer_count: formData.get("computerCount") || lab.computer_count,
      }));
    }
  }

  if (canEditAssignment) {
    if (selectedSpace.current_status === "unavailable" && assignmentStatus === "assigned") {
      state.data = normalizeDataset(previousData);
      state.serverRevision = previousRevision;
      state.planCopies = previousCopies;
      updateStatus("不可用空间不能保存为已分配，请先将人工状态改为可用。");
      return;
    }
    const existingForLab = labCode ? currentAssignments.find((row) => row.lab_code === labCode && row.assignment_status === "assigned") || null : null;
    const currentForSpace = assignedAssignmentForSpace(currentAssignments, selectedSpace);
    const conflict = labCode && currentForSpace && currentForSpace.lab_code !== labCode && currentForSpace.assignment_status === "assigned"
      ? currentForSpace
      : null;
    if (conflict && !replaceConflict) {
      state.data = normalizeDataset(previousData);
      state.serverRevision = previousRevision;
      state.planCopies = previousCopies;
      updateStatus(`当前空间已被 ${labNameByCode(conflict.lab_code)} 占用，请勾选“替换当前占用”后再保存。`);
      return;
    }

    const removeIds = new Set([existingForLab?.id, currentForSpace?.id].filter(Boolean));
    const nextAssignments = state.data.plan_assignments.filter((row) => row.plan_id !== activePlan.id || !removeIds.has(row.id));
    if (conflict) {
      nextAssignments.push(normalizeAssignment({
        ...conflict,
        plan_code: activePlan.plan_code,
        space_code: "",
        previous_space_code: conflict.space_code || conflict.previous_space_code,
        assignment_status: "Invalid",
      }, relation));
    }

    if (labCode && assignmentStatus === "assigned") {
      nextAssignments.push(normalizeAssignment({
        plan_code: activePlan.plan_code,
        lab_code: labCode,
        space_code: selectedSpace.space_code,
        previous_space_code: existingForLab?.space_code || currentForSpace?.space_code || "",
        assignment_status: assignmentStatus,
        move_note: moveNote,
        effective_from: existingForLab?.effective_from || currentForSpace?.effective_from || "",
        created_at: existingForLab?.created_at || currentForSpace?.created_at || isoNow(),
      }, relationMaps(state.data)));
    } else if (currentForSpace) {
      nextAssignments.push(normalizeAssignment({
        ...currentForSpace,
        plan_code: activePlan.plan_code,
        space_code: "",
        previous_space_code: currentForSpace.space_code || currentForSpace.previous_space_code,
        assignment_status: "Invalid",
        move_note: moveNote,
        effective_from: currentForSpace.effective_from || "",
      }, relation));
    }
    state.data.plan_assignments = nextAssignments;
  }

  state.data = normalizeDataset(state.data);
  let saveOk = true;
  if (canEditBase) {
    saveOk = await saveWithRollback(previousData, previousRevision, "业务编辑当前楼层资料", "业务资料保存失败");
  }
  if (saveOk && canEditAssignment && !canEditBase) {
    saveOk = await savePlanAssignmentsWithRollback(previousData, previousRevision);
  }
  if (!saveOk) {
    state.data = normalizeDataset(previousData);
    state.serverRevision = previousRevision;
    state.planCopies = previousCopies;
    return;
  }
  state.businessEditor.selectedSpaceId = selectedSpace.id;
  if (state.businessEditor.newSpaceId === selectedSpace.id) state.businessEditor.newSpaceId = "";
  state.selectedSpaceId = selectedSpace.id;
  refreshStateAndRender(`已保存 ${selectedSpace.front_door || selectedSpace.space_code} 的业务信息。`, { stamp: false, forceMoveReset: true });
}

async function markSelectedBusinessSpaceUnavailable() {
  if (!canDeleteSpaceInActivePlan()) {
    updateStatus("只能删除自己可管理的非基线方案中的空间。");
    return;
  }
  const activePlan = planById(state.activePlanId);
  const space = state.data.spaces.find((row) => row.id === state.businessEditor.selectedSpaceId) || null;
  if (!activePlan || !space) {
    updateStatus("请先选择一个空间。");
    return;
  }
  if (!window.confirm(`确认从当前方案删除空间“${space.front_door || space.space_code}”？`)) return;
  const previousData = cloneDataset(state.data);
  const previousRevision = state.serverRevision;
  const relation = relationMaps(state.data);
  state.data.deleted_space_ids = [...new Set([...(state.data.deleted_space_ids || []), space.id])];
  state.data.spaces = state.data.spaces.filter((row) => row.id !== space.id);
  state.data.plan_assignments = state.data.plan_assignments.map((row) => {
    if (row.plan_id !== activePlan.id || row.space_id !== space.id) return row;
    return normalizeAssignment({
      ...row,
      previous_space_code: row.space_code || row.previous_space_code,
      space_code: "",
      assignment_status: "Invalid",
    }, relation);
  });
  state.data = normalizeDataset(state.data);
  const saveOk = await saveWithRollback(previousData, previousRevision, "删除当前楼层空间", "删除空间失败");
  if (saveOk) {
    state.businessEditor.newSpaceId = "";
    state.businessEditor.selectedSpaceId = "";
    state.selectedSpaceId = null;
    syncSelectedSpace();
    refreshStateAndRender(`${space.front_door || space.space_code} 已从当前方案删除。`, { stamp: false, forceMoveReset: true });
  }
}

function downloadEditorData() {
  if (state.editorMode === "business") {
    updateStatus("业务编辑不需要导出；请切换到原始表格后导出当前表。");
    return;
  }
  ImportExport.downloadCurrentSheet(state, editorRows, updateStatus);
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
  const planName = uniquePlanName(normalizedName);
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
    const payload = await fetchJson("/api/plan-copies", {
      method: "POST",
      body: JSON.stringify({
        sourcePlanCode: activePlan.plan_code,
        planName,
      }),
    });
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
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

function uniquePlanName(baseName) {
  const names = new Set(state.data.plans.map((plan) => plan.plan_name));
  if (!names.has(baseName)) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function buildingByCode(buildingCode) {
  return state.data.buildings.find((row) => row.building_code === buildingCode) || null;
}

function planById(id) {
  return state.data.plans.find((row) => row.id === id) || null;
}

function updateDatasetSummary(text) {
  const assignedCount = state.data.plan_assignments.filter((row) => row.space_id).length;
  updateStatus(`${text}，${state.data.buildings.length} 栋楼，${state.data.spaces.length} 个空间，${state.data.labs.length} 个实验室，${assignedCount} 条已落位分配。`);
}

function updateStatus(text) {
  state.statusMessage = text;
  const workbookHint = ImportExport.workbookAvailable()
    ? ""
    : " 当前未加载 Excel 组件，可正常浏览和导入导出 JSON；如需导入 .xlsx 或导出 Excel，请在可访问 SheetJS CDN 的环境中打开。";
  els.statusText.textContent = `${text}${workbookHint}`;
}
