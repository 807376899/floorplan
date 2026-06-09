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
  els.downloadSheetBtn.addEventListener("click", () => runWithUnsavedGuard(() => ImportExport.downloadCurrentSheet(state, editorRows, updateStatus)));
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
  if (!state.permissions.canAdmin) throw new Error("只有管理员可以修改共享基线数据");
  const activeCopy = activePlanCopyMeta();
  if (activeCopy && canManageCopy(activeCopy) && (activeCopy.hasDataset || activeCopy.isBaseline)) {
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
  const building = dataset.buildings.slice().sort(compareBuildings)[0];
  const floors = unique(dataset.floor_segments.filter((row) => row.building_code === building?.building_code).map((row) => row.floor_code)).sort(compare);
  state.importDrafts.preview = {
    buildingCode: building?.building_code || "",
    floorCode: floors[0] || "",
    planId: detail.planCode || dataset.plans[0]?.id || "",
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
  fillInlineSelect(planSelect, dataset.plans.map((plan) => ({ value: plan.id, label: plan.plan_name || plan.plan_code })), state.importDrafts.preview.planId);

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
  return canManageCopy(activePlanCopyMeta());
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

  const conflictAssignment = state.data.plan_assignments.find((row) => row.plan_id === context.activePlan?.id && row.space_id === targetSpace.id) || null;
  // 只有 assigned 状态视为硬占用，unplaced/pending_move 仍允许被后续流程处理。
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
      // 目标空间被占用时，把原分配释放为未落位，避免同一方案下出现双占用。
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

function editorRows() {
  const buildingCode = els.buildingSelect.value;
  const floorCode = els.floorSelect.value;
  if (state.editorKey === "floor_segments") return state.data.floor_segments.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
  if (state.editorKey === "spaces") return state.data.spaces.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
  if (state.editorKey === "plan_assignments") return state.data.plan_assignments.filter((row) => row.plan_id === state.activePlanId);
  return state.data[state.editorKey];
}

function addEditorRow() {
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
  const saveOk = state.editorKey === "plan_assignments"
    ? await savePlanAssignmentsWithRollback(previousData, previousRevision)
    : await saveWithRollback(previousData, previousRevision, `编辑 ${state.editorKey}`, "表格保存失败");
  if (saveOk) {
    refreshStateAndRender("已应用表格修改。", { stamp: false, forceMoveReset: true });
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
