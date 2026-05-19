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
      container.innerHTML = `<div class="empty">当前楼栋没有可展示的楼层。</div>`;
      return;
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
          <svg viewBox="0 0 ${layout.width} ${layout.height}">${layout.corridors.map((item) => structureSvg(item, true)).join("")}${layout.rooms.map((item) => roomSvg(item, colors, true)).join("")}</svg>
        </div>
      </button>`;
    }).join("");

    container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => onSelect(button.dataset.planId, button.dataset.floor)));
  }

  function renderFloorplan(params) {
    const { floorplanEl, activePlanBadgeEl, data, building, floorCode, activePlan, colors, selectedSpaceId, collegeFilter, onSelectSpace } = params;
    if (!activePlan) {
      floorplanEl.innerHTML = `<div class="empty">当前没有可用方案。</div>`;
      activePlanBadgeEl.textContent = "当前主图";
      return;
    }

    const layoutData = floorRenderData(data, building?.building_code, floorCode, activePlan.id);
    if (!layoutData.segments.length) {
      floorplanEl.innerHTML = `<div class="empty">当前楼层没有布局数据。</div>`;
      activePlanBadgeEl.textContent = `${activePlan.plan_name} · ${building?.building_name || building?.building_code || ""} ${floorCode || ""}`.trim();
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
  }

  function renderDetailsPanel(params) {
    const {
      detailsEl,
      context,
      mode,
      moveDraft,
      moveErrors,
      moveDirty,
      onFocusRow,
      onOpenMove,
      onMoveFieldChange,
      onConfirmMove,
      onCancelMove,
    } = params;

    if (!context.space) {
      detailsEl.innerHTML = `<div class="details-empty">
        <h2>当前选中对象</h2>
        <p>点击主图中的空间，在这里查看当前方案下的空间、实验室和分配信息。</p>
      </div>`;
      return;
    }

    if (mode === "move") {
      renderMovePanel(detailsEl, context, moveDraft, moveErrors, moveDirty, onMoveFieldChange, onConfirmMove, onCancelMove);
      return;
    }

    renderReadonlyDetails(detailsEl, context, onFocusRow, onOpenMove);
  }

  function renderReadonlyDetails(detailsEl, context, onFocusRow, onOpenMove) {
    const { activePlan, building, space, lab, assignment } = context;
    const pageTitle = lab?.lab_name || space.space_name || space.space_code;
    const canMove = Boolean(assignment && lab);
    const detailRows = [
      detailLine("当前方案", activePlan?.plan_name || "当前方案"),
      detailLine("空间编码", space.space_code),
      detailLine("空间名称", space.space_name || "未填写"),
      detailLine("门牌", space.front_door || "未填写"),
      detailLine("房间尺寸", `${space.length_m}m × ${space.width_m}m`),
      detailLine("面积", `${space.area_m2.toFixed(1)} m²`),
      detailLine("网段信息", space.network_segment || "未填写"),
      detailLine("空间状态", space.current_status || "active"),
    ];

    if (lab) {
      detailRows.push(
        detailLine("实验室名称", lab.lab_name),
        detailLine("所属学院", lab.college),
        detailLine("所属专业", lab.major || "未填写"),
        detailLine("实验室类型", lab.lab_type || "未填写"),
        detailLine("负责人", lab.director || "未填写"),
        detailLine("座位数", String(lab.seat_count)),
        detailLine("电脑数", String(lab.computer_count)),
      );
    }

    if (assignment) {
      detailRows.push(detailLine("分配状态", assignment.assignment_status || "未填写"));
    }

    detailsEl.innerHTML = `<div class="details-panel is-readonly">
      <div class="details-header">
        <div>
          <h2>详细信息</h2>
        </div>
      </div>

      <div class="details-scroll">
        <section class="details-card details-card-compact">
          <div class="details-card-head">
            <div>
              <h3>${escapeHtml(pageTitle)}</h3>
              <p>${escapeHtml(`${building?.building_name || building?.building_code || ""} · ${space.floor_code}`)}</p>
            </div>
          </div>
          <div class="details-info-list">
            ${detailRows.join("")}
          </div>
        </section>
      </div>

      <div class="details-actions">
        <button type="button" class="link-button action-link" data-focus-key="spaces" data-focus-id="${escapeHtml(space.id)}">编辑此空间</button>
        <button type="button" class="link-button action-link" data-focus-key="labs" data-focus-id="${escapeHtml(lab?.id || "")}" ${lab ? "" : "disabled"}>编辑此实验室</button>
        <button type="button" class="link-button action-link" data-focus-key="plan_assignments" data-focus-id="${escapeHtml(assignment?.id || "")}">${assignment ? "查看当前分配" : "去分配表处理"}</button>
        <button type="button" class="primary-button" data-action="move" ${canMove ? "" : "disabled"}>搬迁实验室</button>
      </div>
    </div>`;

    detailsEl.querySelectorAll("[data-focus-key]").forEach((node) => {
      node.addEventListener("click", () => onFocusRow(node.dataset.focusKey, node.dataset.focusId));
    });
    detailsEl.querySelector('[data-action="move"]')?.addEventListener("click", onOpenMove);
  }

  function renderMovePanel(detailsEl, context, moveDraft, moveErrors, moveDirty, onMoveFieldChange, onConfirmMove, onCancelMove) {
    const { activePlan, building, space, lab, assignment } = context;
    const errorText = moveErrors.targetSpaceCode || "";
    detailsEl.innerHTML = `<div class="details-panel is-move ${moveDirty ? "is-dirty" : ""}">
      <div class="details-header">
        <div>
          <h2>搬迁实验室</h2>
          <p>${escapeHtml(`${activePlan?.plan_name || "当前方案"} · ${building?.building_name || building?.building_code || ""} · ${space.floor_code}`)}</p>
        </div>
        <span class="details-status">${moveDirty ? "未保存搬迁" : "待确认"}</span>
      </div>

      <section class="details-card">
        <div class="details-card-head">
          <div>
            <h3>当前落位</h3>
            <p>确认实验室与原空间后，再填写目标空间编码。</p>
          </div>
        </div>
        <div class="details-meta-grid">
          ${readonlyField("实验室名称", lab?.lab_name || "未分配实验室")}
          ${readonlyField("当前空间编码", assignment?.space_code || space.space_code)}
          ${readonlyField("搬迁前空间", assignment?.previous_space_code || "未填写")}
          ${readonlyField("当前分配状态", assignment?.assignment_status || "未填写")}
        </div>
      </section>

      <section class="details-card">
        <div class="details-card-head">
          <div>
            <h3>目标空间</h3>
            <p>输入目标空间编码。目标空间若已有 assigned 占用，将阻止本次搬迁。</p>
          </div>
        </div>
        <label class="detail-field ${errorText ? "has-error" : ""}">
          <span>目标空间编码</span>
          <input type="text" data-move-field="targetSpaceCode" value="${escapeHtml(moveDraft?.targetSpaceCode || "")}" placeholder="例如 201 或 A-101" />
          <small>${escapeHtml(errorText)}</small>
        </label>
      </section>

      <div class="details-actions">
        <button type="button" class="primary-button" data-action="confirm-move">确认搬迁</button>
        <button type="button" data-action="cancel-move">取消</button>
      </div>
    </div>`;

    detailsEl.querySelector('[data-move-field="targetSpaceCode"]')?.addEventListener("input", (event) => onMoveFieldChange("targetSpaceCode", event.target.value));
    detailsEl.querySelector('[data-action="confirm-move"]')?.addEventListener("click", onConfirmMove);
    detailsEl.querySelector('[data-action="cancel-move"]')?.addEventListener("click", onCancelMove);
  }

  function sideLabel(side) {
    const labels = { north: "北侧", south: "南侧", east: "东侧", west: "西侧" };
    return labels[side] || side || "未填写";
  }

  function detailLine(label, value) {
    return `<p><strong>${escapeHtml(label)}：</strong>${escapeHtml(value || "未填写")}</p>`;
  }

  function renderSummaryChips(space, lab, assignment) {
    return `<div class="details-chip-row">
      <span class="details-chip">${escapeHtml(space.front_door || space.space_code)}</span>
      <span class="details-chip">${escapeHtml(space.current_status || "active")}</span>
      <span class="details-chip">${escapeHtml(lab?.college || "未分配实验室")}</span>
      <span class="details-chip">${escapeHtml(assignment?.assignment_status || "待分配")}</span>
    </div>`;
  }

  function readonlyField(label, value) {
    return `<div class="detail-meta-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "未填写")}</strong></div>`;
  }

  global.FloorplanRender = {
    colorMap,
    renderLegend,
    renderThumbList,
    renderFloorplan,
    renderDetailsPanel,
    floorRenderData,
  };
})(window);
