(function attachFloorplanThumbnails(global) {
  function createRenderThumbList(deps) {
    const {
      unique,
      compare,
      escapeHtml,
      THUMB_SCALE,
      buildLayout,
      floorRenderData,
      structureSvg,
      roomSvg,
    } = deps;

    function thumbRenderKey(params) {
      const { data, buildingCode, plan, activePlanId, currentFloorCode, colors, mutedColleges = new Set() } = params;
      const planId = plan?.id || "";
      const floors = unique(data.floor_segments.filter((row) => row.building_code === buildingCode).map((row) => row.floor_code)).sort(compare);
      const assigned = data.plan_assignments.filter((row) => row.plan_id === planId && row.assignment_status === "assigned");
      const assignmentsBySpace = new Map(assigned.map((row) => [row.space_id, row]));
      const labsById = new Map(data.labs.map((row) => [row.id, row]));
      const floorParts = floors.map((floorCode) => {
        const segments = data.floor_segments
          .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
          .map((row) => [row.id, row.segment_code, row.start_x_m, row.start_y_m, row.end_x_m, row.end_y_m, row.width_m, row.element_type].join(":"))
          .join("|");
        const spaces = data.spaces
          .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
          .map((row) => {
            const assignment = assignmentsBySpace.get(row.id);
            const lab = assignment ? labsById.get(assignment.lab_id) : null;
            return [
              row.id,
              row.space_code,
              row.segment_code,
              row.offset_m,
              row.side,
              row.length_m,
              row.width_m,
              row.current_status,
              assignment?.id || "",
              assignment?.lab_id || "",
              lab?.college || "",
              lab?.lab_type || "",
            ].join(":");
          })
          .join("|");
        return [floorCode, segments, spaces].join("~");
      });
      const colorPart = Object.entries(colors || {}).sort(([a], [b]) => compare(a, b)).map(([key, value]) => `${key}:${value}`).join("|");
      const mutedPart = Array.from(mutedColleges || []).sort(compare).join("|");
      return JSON.stringify({ buildingCode, planId, activePlanId, currentFloorCode, floors: floorParts, colors: colorPart, mutedColleges: mutedPart });
    }

    function renderThumbList(container, params) {
      const { data, buildingCode, plan, activePlanId, currentFloorCode, colors, mutedColleges = new Set(), onSelect } = params;
      const nextKey = thumbRenderKey(params);
      if (container.dataset?.thumbRenderKey === nextKey) return false;
      const floors = unique(data.floor_segments.filter((row) => row.building_code === buildingCode).map((row) => row.floor_code)).sort(compare);
      if (!plan || !floors.length) {
        container.innerHTML = `<div class="empty">当前楼栋没有可展示的楼层。</div>`;
        if (container.dataset) container.dataset.thumbRenderKey = nextKey;
        return true;
      }

      container.innerHTML = floors.map((floorCode) => {
        const layoutData = floorRenderData(data, buildingCode, floorCode, plan.id);
        if (!layoutData.segments.length) {
          return `<button class="floor-thumb ${activePlanId === plan.id && currentFloorCode === floorCode ? "is-active" : ""}" data-plan-id="${plan.id}" data-floor="${floorCode}"><span>${escapeHtml(floorCode)}</span><div class="thumb-preview thumb-preview-empty"><div class="empty">无楼层骨架</div></div></button>`;
        }
        const layout = buildLayout(layoutData.segments, layoutData.spaces, THUMB_SCALE, 0, 4);
        return `<button class="floor-thumb ${activePlanId === plan.id && currentFloorCode === floorCode ? "is-active" : ""}" data-plan-id="${plan.id}" data-floor="${floorCode}">
        <span>${escapeHtml(floorCode)}</span>
        <div class="thumb-preview">
          <svg viewBox="0 0 ${layout.width} ${layout.height}">${layout.corridors.map((item) => structureSvg(item, true)).join("")}${layout.rooms.map((item) => roomSvg(item, colors, true, undefined, mutedColleges)).join("")}</svg>
        </div>
      </button>`;
      }).join("");

      if (container.dataset) container.dataset.thumbRenderKey = nextKey;
      container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => onSelect(button.dataset.planId, button.dataset.floor)));
      return true;
    }

    return renderThumbList;
  }

  const api = { createRenderThumbList };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.Thumbnails = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
