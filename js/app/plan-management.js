(function attachFloorplanPlanManagement(global) {
  function copyIdFromPlan(plan) {
    const explicit = Number(plan?.copy_id || plan?.copyId || 0);
    if (explicit) return explicit;
    const match = String(plan?.plan_code || "").match(/^copy-(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  function copyMetaForPlan(plan, planCopies = []) {
    const copyId = copyIdFromPlan(plan);
    return copyId ? planCopies.find((copy) => copy.id === copyId) || null : null;
  }

  function canManageCopy(copy, user, permissions = {}) {
    return Boolean(copy && user && (permissions.canAdmin || (!copy.isBaseline && copy.ownerUserId === user.id)));
  }

  function canEditPlanDataset(copy, user, permissions = {}) {
    return canManageCopy(copy, user, permissions);
  }

  function isOwnCopy(copy, user) {
    return Boolean(copy && user && copy.ownerUserId === user.id);
  }

  function planOptionLabel(plan, copy, user) {
    const name = plan?.plan_name || plan?.plan_code || "未命名方案";
    const isBaseline = Boolean(plan?.is_locked || plan?.plan_type === "baseline" || copy?.isBaseline);
    if (isBaseline) return `基线 · ${name}`;
    if (!copy) return name;
    const copyNo = copy.id || copy.copyId || copyIdFromPlan(plan) || "";
    const visibilityLabel = copy.visibility === "public" ? `公开${copyNo}` : String(copyNo);
    const ownerLabel = isOwnCopy(copy, user) ? "我的" : "";
    return [ownerLabel, name, visibilityLabel].filter(Boolean).join(" · ");
  }

  const api = {
    canEditPlanDataset,
    canManageCopy,
    copyIdFromPlan,
    copyMetaForPlan,
    isOwnCopy,
    planOptionLabel,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.PlanManagement = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
