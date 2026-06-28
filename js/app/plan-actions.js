(function attachFloorplanPlanActions(global) {
  function applyVisibleDatasetPayload(state, payload, normalizeDataset) {
    state.serverRevision = payload.revision;
    state.planCopies = payload.planCopies || [];
    state.data = normalizeDataset(payload.dataset);
    return payload;
  }

  async function createPlanCopy(options) {
    const { fetchJson, state, normalizeDataset, sourcePlanCode, planName } = options;
    const payload = await fetchJson("/api/plan-copies", {
      method: "POST",
      body: JSON.stringify({ sourcePlanCode, planName }),
    });
    return applyVisibleDatasetPayload(state, payload, normalizeDataset);
  }

  async function updatePlanCopyVisibility(options) {
    const { fetchJson, state, normalizeDataset, copyId, visibility } = options;
    const payload = await fetchJson(`/api/plan-copies/${copyId}`, {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    });
    return applyVisibleDatasetPayload(state, payload, normalizeDataset);
  }

  async function deletePlanCopy(options) {
    const { fetchJson, state, normalizeDataset, copyId } = options;
    const payload = await fetchJson(`/api/plan-copies/${copyId}`, { method: "DELETE" });
    return applyVisibleDatasetPayload(state, payload, normalizeDataset);
  }

  const api = {
    createPlanCopy,
    deletePlanCopy,
    updatePlanCopyVisibility,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.PlanActions = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
