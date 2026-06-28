(function attachFloorplanPlanDiffPanel(global) {
  function renderPlanDiffPanel(options) {
    const {
      panelEl,
      isCompare,
      beforePlan,
      afterPlan,
      diff,
      collapsed = {},
      onToggle,
    } = options;
    if (!panelEl) return;
    panelEl.hidden = !isCompare;
    if (!isCompare) {
      panelEl.innerHTML = "";
      return;
    }
    if (!beforePlan || !afterPlan || beforePlan.id === afterPlan.id) {
      panelEl.innerHTML = `<div class="plan-diff-empty">请选择两套不同方案查看差异。</div>`;
      return;
    }

    const summaryOpen = !collapsed.summaryCollapsed;
    const labsOpen = !collapsed.labCollapsed;
    const spacesOpen = !collapsed.spaceCollapsed;
    panelEl.innerHTML = `
    <div class="plan-diff-heading">
      <div>
        <h2>方案差异对比</h2>
        <p>${escapeHtml(beforePlan.plan_name)} → ${escapeHtml(afterPlan.plan_name)}</p>
      </div>
      <button type="button" class="plan-diff-toggle" data-plan-diff-toggle="summary" aria-expanded="${summaryOpen}">
        ${summaryOpen ? "折叠全部对比" : "展开全部对比"}
      </button>
    </div>
    ${summaryOpen ? `
      <div class="plan-diff-metrics">
        ${diffMetric("变化实验室", diff.labChanges.length)}
        ${diffMetric("变化空间", diff.spaceChanges.length)}
        ${diffMetric("面积变化", signedNumber(diff.totalAreaDelta, " m²"))}
      </div>
      <div class="plan-diff-grid">
      <section class="plan-diff-section">
        <h3>学院汇总</h3>
        ${diffTable(["学院", "左侧场地", "左侧面积", "右侧场地", "右侧面积", "数量差", "面积差"], diff.collegeRows.map((row) => [
          row.college,
          row.beforeCount,
          `${formatNumber(row.beforeArea)} m²`,
          row.afterCount,
          `${formatNumber(row.afterArea)} m²`,
          signedNumber(row.countDelta),
          signedNumber(row.areaDelta, " m²"),
        ]), "两套方案的学院场地数量和面积没有差异。")}
      </section>
      <section class="plan-diff-section">
        <button type="button" class="plan-diff-section-toggle" data-plan-diff-toggle="labs" aria-expanded="${labsOpen}">
          <span>实验室变化</span><strong>${diff.labChanges.length}</strong>
        </button>
        ${labsOpen ? diffTable(["变化", "实验室", "左侧方案", "右侧方案", "面积"], diff.labChanges.map((row) => [
          row.type,
          row.labName,
          row.beforeText,
          row.afterText,
          signedNumber(row.areaDelta, " m²"),
        ]), "两套方案的实验室落位没有差异。") : ""}
      </section>
      <section class="plan-diff-section">
        <button type="button" class="plan-diff-section-toggle" data-plan-diff-toggle="spaces" aria-expanded="${spacesOpen}">
          <span>空间变化</span><strong>${diff.spaceChanges.length}</strong>
        </button>
        ${spacesOpen ? diffTable(["变化", "空间", "左侧实验室", "右侧实验室", "面积"], diff.spaceChanges.map((row) => [
          row.type,
          row.spaceText,
          row.beforeLab,
          row.afterLab,
          signedNumber(row.areaDelta, " m²"),
        ]), "两套方案的空间占用没有差异。") : ""}
      </section>
      </div>
    ` : `<div class="plan-diff-empty">对比详情已折叠。</div>`}
  `;
    panelEl.querySelectorAll?.("[data-plan-diff-toggle]").forEach((button) => {
      button.addEventListener("click", () => onToggle?.(button.dataset.planDiffToggle));
    });
  }

  function signedNumber(value, suffix = "") {
    const rounded = Math.round(Number(value || 0) * 10) / 10;
    if (!rounded) return `0${suffix}`;
    return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
  }

  function formatNumber(value) {
    const rounded = Math.round(Number(value || 0) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function diffMetric(label, value) {
    return `<div class="plan-diff-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function diffTable(headers, rows, emptyText) {
    if (!rows.length) return `<div class="plan-diff-empty">${escapeHtml(emptyText)}</div>`;
    return `<div class="plan-diff-table-wrap"><table class="plan-diff-table">
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  const api = { renderPlanDiffPanel };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.PlanDiffPanel = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
