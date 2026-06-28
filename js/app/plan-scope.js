(function attachFloorplanPlanScope(global) {
  function copyIdFromPlan(plan) {
    const explicit = Number(plan?.copy_id || plan?.copyId || 0);
    if (explicit) return explicit;
    const match = String(plan?.plan_code || "").match(/^copy-(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  function copyIdFromRow(row) {
    const explicit = Number(row?.copy_id || row?.copyId || 0);
    return explicit || null;
  }

  function parseDeletedSpaceRef(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^copy:(\d+)::(.+)$/);
    if (!match) return { copyId: null, ref: raw };
    return { copyId: Number(match[1]), ref: String(match[2] || "").trim() };
  }

  function rowDeletedForPlan(row, plan, deletedSpaceRefs = []) {
    const rowCopyId = copyIdFromRow(row);
    const planCopyId = copyIdFromPlan(plan);
    for (const item of deletedSpaceRefs || []) {
      const deleted = parseDeletedSpaceRef(item);
      if (!deleted.ref) continue;
      if (deleted.copyId) {
        if (deleted.copyId !== planCopyId) continue;
      } else if (rowCopyId) {
        continue;
      }
      if (String(row?.id || "").trim() === deleted.ref || String(row?.space_code || "").trim() === deleted.ref) return true;
    }
    return false;
  }

  function rowVisibleForPlan(row, plan) {
    const rowCopyId = copyIdFromRow(row);
    if (!rowCopyId) return true;
    return rowCopyId === copyIdFromPlan(plan);
  }

  function filterRowsForPlan(rows = [], plan, deletedSpaceRefs = null) {
    return (rows || []).filter((row) =>
      rowVisibleForPlan(row, plan) &&
      (!deletedSpaceRefs || !rowDeletedForPlan(row, plan, deletedSpaceRefs))
    );
  }

  function datasetForPlan(dataset, plan) {
    const next = { ...(dataset || {}) };
    for (const key of ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "file_assets"]) {
      next[key] = filterRowsForPlan(dataset?.[key] || [], plan, key === "spaces" ? dataset?.deleted_space_ids || [] : null);
    }
    return next;
  }

  const api = {
    copyIdFromPlan,
    copyIdFromRow,
    datasetForPlan,
    filterRowsForPlan,
    rowDeletedForPlan,
    rowVisibleForPlan,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.PlanScope = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
