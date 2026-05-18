(function attachFloorplanRender(global) {
  const {
    ALL_COLLEGES,
    ROOM_GAP_M,
    DETAIL_SCALE,
    THUMB_SCALE,
    COLORS,
    unique,
    compare,
    escapeHtml,
  } = global.FloorplanDomain;

  function buildLayout(segments, spaces, scale, titleHeight = 96, margin = 34) {
    const segmentMap = new Map(segments.map((segment) => [segment.segment_code, makeSegment(segment, scale, margin, titleHeight)]));
    const corridors = [...segmentMap.values()];
    const roomBoxes = spaces.map((space) => placeRoom(space, segmentMap.get(space.segment_code), scale)).filter(Boolean);
    const xs = [...corridors.flatMap((item) => [item.x1, item.x2]), ...roomBoxes.flatMap((item) => [item.x, item.x + item.width])];
    const ys = [...corridors.flatMap((item) => [item.y1, item.y2]), ...roomBoxes.flatMap((item) => [item.y, item.y + item.height])];
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const shiftX = margin - minX;
    const shiftY = titleHeight + 8 - minY;
    corridors.forEach((item) => {
      item.x1 += shiftX;
      item.x2 += shiftX;
      item.y1 += shiftY;
      item.y2 += shiftY;
    });
    roomBoxes.forEach((item) => {
      item.x += shiftX;
      item.y += shiftY;
    });
    return {
      corridors,
      rooms: roomBoxes,
      width: Math.max(titleHeight ? 620 : 1, maxX - minX + margin * 2),
      height: Math.max(titleHeight ? 260 : 1, maxY - minY + titleHeight + margin),
    };
  }

  function makeSegment(segment, scale, margin, titleHeight) {
    return {
      ...segment,
      x1: margin + segment.start_x_m * scale,
      y1: titleHeight + segment.start_y_m * scale,
      x2: margin + segment.end_x_m * scale,
      y2: titleHeight + segment.end_y_m * scale,
      width: segment.width_m * scale,
    };
  }

  function placeRoom(space, segment, scale) {
    if (!segment) return null;
    const horizontal = segment.y1 === segment.y2;
    const vertical = segment.x1 === segment.x2;
    if (!horizontal && !vertical) return null;
    const width = space.length_m * scale;
    const height = space.width_m * scale;
    const gap = ROOM_GAP_M * scale;
    const left = Math.min(segment.x1, segment.x2);
    const right = Math.max(segment.x1, segment.x2);
    const top = Math.min(segment.y1, segment.y2);
    const bottom = Math.max(segment.y1, segment.y2);
    const along = space.offset_m * scale;

    if (horizontal) {
      if (space.side === "north") return { space, x: left + along, y: segment.y1 - segment.width / 2 - gap - height, width, height };
      if (space.side === "south") return { space, x: left + along, y: segment.y1 + segment.width / 2 + gap, width, height };
      if (space.side === "west") return { space, x: left - gap - width, y: segment.y1 - height / 2, width, height };
      if (space.side === "east") return { space, x: right + gap, y: segment.y1 - height / 2, width, height };
    }

    if (vertical) {
      if (space.side === "west") return { space, x: segment.x1 - segment.width / 2 - gap - width, y: top + along, width, height };
      if (space.side === "east") return { space, x: segment.x1 + segment.width / 2 + gap, y: top + along, width, height };
      if (space.side === "north") return { space, x: segment.x1 - width / 2, y: top - gap - height, width, height };
      if (space.side === "south") return { space, x: segment.x1 - width / 2, y: bottom + gap, width, height };
    }
    return null;
  }

  function structureSvg(item, compact) {
    const base = `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="#e8edf3" stroke-width="${item.width}" stroke-linecap="square"></line>`;
    if (item.element_type !== "stairs") return base;
    const horizontal = item.y1 === item.y2;
    const count = compact ? 4 : 7;
    const steps = [];
    for (let index = 1; index < count; index += 1) {
      const ratio = index / count;
      const x = item.x1 + (item.x2 - item.x1) * ratio;
      const y = item.y1 + (item.y2 - item.y1) * ratio;
      steps.push(horizontal
        ? `<line x1="${x}" y1="${y - item.width / 2}" x2="${x}" y2="${y + item.width / 2}" stroke="#94a3b8" stroke-width="${compact ? 0.8 : 1.5}"></line>`
        : `<line x1="${x - item.width / 2}" y1="${y}" x2="${x + item.width / 2}" y2="${y}" stroke="#94a3b8" stroke-width="${compact ? 0.8 : 1.5}"></line>`);
    }
    const label = compact ? "" : `<text x="${(item.x1 + item.x2) / 2}" y="${(item.y1 + item.y2) / 2 + 4}" text-anchor="middle" font-size="12" fill="#475467">楼梯</text>`;
    return `${base}${steps.join("")}${label}`;
  }

  function colorMap(labs) {
    return Object.fromEntries(unique(labs.map((row) => row.college)).map((value, index) => [value, COLORS[index % COLORS.length]]));
  }

  function roomFill(space, colors) {
    if (!space.lab) return "#e2e8f0";
    return colors[space.lab.college] || "#64748b";
  }

  function roomSvg(box, colors, compact, selectedSpaceId, collegeFilter) {
    const fill = roomFill(box.space, colors);
    const labelFill = box.space.lab ? "#ffffff" : "#344054";
    if (compact) return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${fill}" rx="3"></rect>`;
    const muted = collegeFilter !== ALL_COLLEGES && box.space.lab?.college !== collegeFilter;
    const selected = selectedSpaceId === box.space.id;
    const label = box.space.lab?.lab_name || box.space.space_name || box.space.front_door || box.space.space_code;
    const subLabel = box.space.lab?.college || box.space.network_segment || box.space.current_status;
    return `<g class="room ${muted && box.space.lab ? "is-muted" : ""} ${selected ? "is-selected" : ""}" data-space-id="${box.space.id}">
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${fill}"></rect>
      <text x="${box.x + 8}" y="${box.y + 18}" fill="${labelFill}" font-size="13" font-weight="700">${escapeHtml(box.space.front_door || box.space.space_code)}</text>
      <text x="${box.x + 8}" y="${box.y + 36}" fill="${labelFill}" font-size="12">${escapeHtml(label)}</text>
      <text x="${box.x + 8}" y="${box.y + 53}" fill="${labelFill}" font-size="12">${escapeHtml(subLabel)}</text>
      <text x="${box.x + 8}" y="${box.y + 70}" fill="${labelFill}" font-size="12">${escapeHtml(box.space.area_m2.toFixed(1))} m²</text>
    </g>`;
  }

  function floorRenderData(data, buildingCode, floorCode, planId) {
    const segments = data.floor_segments.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
    const assignments = data.plan_assignments.filter((row) => row.plan_id === planId);
    const labs = new Map(data.labs.map((row) => [row.id, row]));
    const spaces = data.spaces
      .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
      .map((space) => {
        const assignment = assignments.find((row) => row.space_id === space.id) || null;
        return { ...space, lab: assignment ? labs.get(assignment.lab_id) || null : null, assignment };
      });
    return { segments, spaces };
  }

  function renderLegend(legendEl, data, colors, activePlanId) {
    const assignments = data.plan_assignments.filter((row) => row.plan_id === activePlanId);
    const labsById = new Map(data.labs.map((row) => [row.id, row]));
    const activeColleges = unique(assignments.map((row) => labsById.get(row.lab_id)?.college));
    const colleges = activeColleges.map((college) => `<span class="legend-item"><span class="legend-swatch" style="background:${colors[college] || "#94a3b8"}"></span>${escapeHtml(college)}</span>`);
    legendEl.innerHTML = [...colleges, `<span class="legend-item"><span class="legend-swatch" style="background:#e2e8f0"></span>未分配空间</span>`].join("");
  }

  function renderThumbList(container, params) {
    const { data, buildingCode, plan, activePlanId, currentFloorCode, colors, onSelect } = params;
    const floors = unique(data.floor_segments.filter((row) => row.building_code === buildingCode).map((row) => row.floor_code)).sort(compare);
    if (!plan || !floors.length) {
      container.innerHTML = `<div class="empty">当前楼没有可展示的楼层。</div>`;
      return;
    }
    container.innerHTML = floors.map((floorCode) => {
      const layoutData = floorRenderData(data, buildingCode, floorCode, plan.id);
      if (!layoutData.segments.length) {
        return `<button class="floor-thumb ${activePlanId === plan.id && currentFloorCode === floorCode ? "is-active" : ""}" data-plan-id="${plan.id}" data-floor="${floorCode}"><span>${escapeHtml(floorCode)}</span><div class="empty">无楼层骨架</div></button>`;
      }
      const layout = buildLayout(layoutData.segments, layoutData.spaces, THUMB_SCALE, 0, 4);
      return `<button class="floor-thumb ${activePlanId === plan.id && currentFloorCode === floorCode ? "is-active" : ""}" data-plan-id="${plan.id}" data-floor="${floorCode}">
        <span>${escapeHtml(floorCode)}</span>
        <svg viewBox="0 0 ${layout.width} ${layout.height}">${layout.corridors.map((item) => structureSvg(item, true)).join("")}${layout.rooms.map((item) => roomSvg(item, colors, true)).join("")}</svg>
      </button>`;
    }).join("");
    container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => onSelect(button.dataset.planId, button.dataset.floor)));
  }

  function renderFloorplan(params) {
    const { floorplanEl, activePlanBadgeEl, detailsEl, data, building, floorCode, activePlan, colors, selectedSpaceId, collegeFilter, onSelectSpace } = params;
    if (!activePlan) {
      floorplanEl.innerHTML = `<div class="empty">当前没有可用方案。</div>`;
      detailsEl.innerHTML = "点击主图中的空间查看当前方案下的实验室与房间信息。";
      return;
    }
    const layoutData = floorRenderData(data, building?.building_code, floorCode, activePlan.id);
    if (!layoutData.segments.length) {
      floorplanEl.innerHTML = `<div class="empty">当前楼层没有布局数据。</div>`;
      detailsEl.innerHTML = "点击主图中的空间查看当前方案下的实验室与房间信息。";
      return;
    }
    const layout = buildLayout(layoutData.segments, layoutData.spaces, DETAIL_SCALE);
    activePlanBadgeEl.textContent = `${activePlan.plan_name} · ${building?.building_name || building?.building_code || ""} ${floorCode}`;
    floorplanEl.innerHTML = `<div class="floorplan-overlay">
        <strong>${escapeHtml(building?.building_name || building?.building_code || "")} ${escapeHtml(floorCode)}</strong>
        <span class="north-mark">北</span>
      </div>
      <svg viewBox="0 0 ${layout.width} ${layout.height}" data-layout-width="${layout.width}" data-layout-height="${layout.height}">
        <rect width="${layout.width}" height="${layout.height}" fill="#fbfcfe"></rect>
        ${layout.corridors.map((item) => structureSvg(item, false)).join("")}
        ${layout.rooms.map((item) => roomSvg(item, colors, false, selectedSpaceId, collegeFilter)).join("")}
      </svg>`;
    floorplanEl.querySelectorAll(".room").forEach((node) => node.addEventListener("click", () => onSelectSpace(node.dataset.spaceId)));
    const selectedBox = layout.rooms.find((item) => item.space.id === selectedSpaceId) || null;
    renderDetails(detailsEl, selectedBox, activePlan);
  }

  function renderDetails(detailsEl, box, activePlan) {
    if (!box) {
      detailsEl.innerHTML = "点击主图中的空间查看当前方案下的实验室与房间信息。";
      return;
    }
    const { space } = box;
    const lab = space.lab;
    const assignment = space.assignment;
    const rows = [
      ["当前方案", activePlan?.plan_name || ""],
      ["空间编码", space.space_code],
      ["空间名称", space.space_name],
      ["门牌", space.front_door === space.rear_door || !space.rear_door ? space.front_door : `${space.front_door}/${space.rear_door}`],
      ["房间尺寸", `${space.length_m}m × ${space.width_m}m`],
      ["面积", `${space.area_m2.toFixed(1)} m²`],
      ["网段信息", space.network_segment],
      ["空间状态", space.current_status],
      ["实验室名称", lab?.lab_name || "未分配"],
      ["所属学院", lab?.college || ""],
      ["所属专业", lab?.major || ""],
      ["实验室类型", lab?.lab_type || ""],
      ["负责人", lab?.director || ""],
      ["座位数", lab?.seat_count ?? ""],
      ["电脑数", lab?.computer_count ?? ""],
      ["搬迁前空间", assignment?.previous_space_code || ""],
      ["分配状态", assignment?.assignment_status || ""],
      ["搬迁说明", assignment?.move_note || ""],
    ].filter(([, value]) => value !== "" && value !== null && value !== undefined);
    detailsEl.innerHTML = `<strong>${escapeHtml(lab?.lab_name || space.space_name || space.space_code)}</strong><br>${rows.map(([label, value]) => `${escapeHtml(label)}：${escapeHtml(value)}`).join("<br>")}`;
  }

  global.FloorplanRender = {
    colorMap,
    renderLegend,
    renderThumbList,
    renderFloorplan,
    floorRenderData,
  };
})(window);
