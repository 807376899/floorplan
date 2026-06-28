(function attachFloorplanManagedPlansModal(global) {
  function renderManagedPlanListHtml(options) {
    const { plans = [], selectedId = null, loading = false } = options;
    if (loading) return `<div class="empty">正在加载方案...</div>`;
    if (!plans.length) return `<div class="empty">当前没有可管理方案。</div>`;
    return plans.map((plan) => {
      const selectedClass = String(plan.id) === String(selectedId) ? " is-active" : "";
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
  }

  function renderManagedPlanDetailHtml(options) {
    const { detail = null, loading = false } = options;
    if (loading) return `<div class="import-draft-detail-empty">正在打开方案详情...</div>`;
    if (!detail) return `<div class="import-draft-detail-empty">请选择一个方案查看预览。</div>`;
    const dataset = detail.dataset;
    return `
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
      ${managedSummaryCard("用途单元", dataset.labs.length)}
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
  }

  function managedSummaryCard(label, value) {
    return `<div class="import-summary-card"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></div>`;
  }

  function managedPlanSourceLabel(plan) {
    if (plan.kind === "active") return "正式数据方案";
    if (plan.sourceType === "import") return "admin 上传数据包";
    if (plan.ownerRole === "admin") return "admin 创建方案";
    if (plan.isPublic) return "editor 公开方案";
    return "方案副本";
  }

  function managedPlanEndpoint(plan, suffix = "") {
    if (plan?.kind === "active" || String(plan?.id || "").startsWith("active:")) {
      const code = plan.planCode || String(plan.id || "").replace(/^active:/, "");
      return `/api/manage/active-plans/${encodeURIComponent(code)}${suffix}`;
    }
    return `/api/manage/plans/${encodeURIComponent(plan.id)}${suffix}`;
  }

  function choosePreviewContext(dataset, current = {}, planId = "") {
    if (hasSegments(dataset, current.buildingCode, current.floorCode)) {
      return { buildingCode: current.buildingCode, floorCode: current.floorCode };
    }
    const assignedContext = assignedPlanContext(dataset, planId);
    if (assignedContext) return assignedContext;
    for (const building of (dataset.buildings || []).slice().sort(compareBuildings)) {
      const floorCode = unique((dataset.floor_segments || [])
        .filter((row) => row.building_code === building.building_code)
        .map((row) => row.floor_code))
        .sort(compare)[0] || "";
      if (floorCode) return { buildingCode: building.building_code, floorCode };
    }
    return {
      buildingCode: (dataset.buildings || []).slice().sort(compareBuildings)[0]?.building_code || "",
      floorCode: unique((dataset.floor_segments || []).map((row) => row.floor_code)).sort(compare)[0] || "",
    };
  }

  function assignedPlanContext(dataset, planId) {
    const spacesById = new Map((dataset.spaces || []).map((space) => [String(space.id), space]));
    const spacesByCode = new Map((dataset.spaces || []).map((space) => [String(space.space_code), space]));
    const plan = (dataset.plans || []).find((item) => String(item.id) === String(planId) || String(item.plan_code) === String(planId));
    const planKeys = new Set([planId, plan?.id, plan?.plan_code].filter(Boolean).map(String));
    for (const assignment of dataset.plan_assignments || []) {
      const assignmentPlans = [assignment.plan_id, assignment.plan_code].filter(Boolean).map(String);
      if (!assignmentPlans.some((value) => planKeys.has(value)) || assignment.assignment_status !== "assigned") continue;
      const space = spacesById.get(String(assignment.space_id || "")) || spacesByCode.get(String(assignment.space_code || ""));
      if (space && hasSegments(dataset, space.building_code, space.floor_code)) {
        return { buildingCode: space.building_code, floorCode: space.floor_code };
      }
    }
    return null;
  }

  function hasSegments(dataset, buildingCode, floorCode) {
    return Boolean(buildingCode && floorCode && (dataset.floor_segments || [])
      .some((row) => row.building_code === buildingCode && row.floor_code === floorCode));
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function compare(a, b) {
    return String(a).localeCompare(String(b), "zh-CN", { numeric: true });
  }

  function compareBuildings(a, b) {
    return compare(a.sort_order || a.building_number || a.building_code, b.sort_order || b.building_number || b.building_code);
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  const api = {
    choosePreviewContext,
    managedPlanEndpoint,
    managedPlanSourceLabel,
    renderManagedPlanDetailHtml,
    renderManagedPlanListHtml,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.ManagedPlansModal = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
