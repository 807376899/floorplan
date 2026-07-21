(function attachFloorplanRender(global) {
  // 渲染模块负责把已规范化的数据转成 SVG/HTML；交互状态和保存逻辑由 app.js 编排。
  const {
    ALL_COLLEGES,
    ROOM_GAP_M,
    DETAIL_SCALE,
    THUMB_SCALE,
    unique,
    compare,
    escapeHtml,
  } = global.FloorplanDomain;
  const LegendColors = global.FloorplanApp?.LegendColors;
  const Thumbnails = global.FloorplanApp?.Thumbnails;

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

    const lengthPx = space.length_m * scale;
    const widthPx = space.width_m * scale;
    const roomSize = (side) => {
      if (vertical && (side === "west" || side === "east")) return { width: widthPx, height: lengthPx };
      return { width: lengthPx, height: widthPx };
    };
    const gap = ROOM_GAP_M * scale;
    const left = Math.min(segment.x1, segment.x2);
    const right = Math.max(segment.x1, segment.x2);
    const top = Math.min(segment.y1, segment.y2);
    const bottom = Math.max(segment.y1, segment.y2);
    const along = space.offset_m * scale;

    if (horizontal) {
      const { width, height } = roomSize(space.side);
      if (space.side === "north") return { space, x: left + along, y: segment.y1 - segment.width / 2 - gap - height, width, height };
      if (space.side === "south") return { space, x: left + along, y: segment.y1 + segment.width / 2 + gap, width, height };
      if (space.side === "west") return { space, x: left - gap - width, y: segment.y1 - height / 2, width, height };
      if (space.side === "east") return { space, x: right + gap, y: segment.y1 - height / 2, width, height };
    }

    if (vertical) {
      const { width, height } = roomSize(space.side);
      if (space.side === "west") return { space, x: segment.x1 - segment.width / 2 - gap - width, y: top + along, width, height };
      if (space.side === "east") return { space, x: segment.x1 + segment.width / 2 + gap, y: top + along, width, height };
      if (space.side === "north") return { space, x: segment.x1 - width / 2, y: top - gap - height, width, height };
      if (space.side === "south") return { space, x: segment.x1 - width / 2, y: bottom + gap, width, height };
    }
    return null;
  }

  function structureSvg(item, compact) {
    const isElevator = item.element_type === "elevator";
    const baseStroke = isElevator ? "#d1d5db" : "#e8edf3";
    const base = `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${baseStroke}" stroke-width="${item.width}" stroke-linecap="square"></line>`;
    if (isElevator) return `${base}${elevatorSvg(item, compact)}`;
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

  function elevatorSvg(item, compact) {
    const cx = (item.x1 + item.x2) / 2;
    const cy = (item.y1 + item.y2) / 2;
    const size = compact ? Math.max(7, item.width * 1.3) : Math.max(22, item.width * 1.35);
    const half = size / 2;
    const strokeWidth = compact ? 0.8 : 1.8;
    const boxLabel = compact ? "" : `<text x="${cx}" y="${cy + half + 14}" text-anchor="middle" font-size="12" fill="#475467">电梯</text>`;
    return `<g class="structure-elevator" aria-label="elevator">
      <rect class="elevator-car" x="${cx - half}" y="${cy - half}" width="${size}" height="${size}" rx="${compact ? 2 : 4}" fill="#f3f4f6" stroke="#6b7280" stroke-width="${strokeWidth}"></rect>
      <rect class="elevator-door elevator-door-left" x="${cx - size * 0.34}" y="${cy - size * 0.26}" width="${size * 0.34}" height="${size * 0.56}" rx="${compact ? 1 : 2}" fill="#ffffff" stroke="#9ca3af" stroke-width="${strokeWidth * 0.75}"></rect>
      <rect class="elevator-door elevator-door-right" x="${cx}" y="${cy - size * 0.26}" width="${size * 0.34}" height="${size * 0.56}" rx="${compact ? 1 : 2}" fill="#ffffff" stroke="#9ca3af" stroke-width="${strokeWidth * 0.75}"></rect>
      <line class="elevator-door-seam" x1="${cx}" y1="${cy - size * 0.26}" x2="${cx}" y2="${cy + size * 0.3}" stroke="#6b7280" stroke-width="${strokeWidth * 0.7}"></line>
      <rect class="elevator-indicator" x="${cx - size * 0.16}" y="${cy - size * 0.42}" width="${size * 0.32}" height="${size * 0.08}" rx="${compact ? 0.5 : 1}" fill="#9ca3af"></rect>
    </g>${boxLabel}`;
    const label = compact ? "" : `<text x="${cx}" y="${cy + half + 14}" text-anchor="middle" font-size="12" fill="#475467">电梯</text>`;
    return `<g class="structure-elevator" aria-label="电梯">
      <rect x="${cx - half}" y="${cy - half}" width="${size}" height="${size}" rx="${compact ? 2 : 4}" fill="#f3f4f6" stroke="#6b7280" stroke-width="${strokeWidth}"></rect>
      <path d="M ${cx - size * 0.18} ${cy - size * 0.18} L ${cx} ${cy - size * 0.34} L ${cx + size * 0.18} ${cy - size * 0.18}" fill="none" stroke="#6b7280" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M ${cx - size * 0.18} ${cy + size * 0.18} L ${cx} ${cy + size * 0.34} L ${cx + size * 0.18} ${cy + size * 0.18}" fill="none" stroke="#6b7280" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"></path>
      <line x1="${cx}" y1="${cy - size * 0.08}" x2="${cx}" y2="${cy + size * 0.08}" stroke="#9ca3af" stroke-width="${strokeWidth}"></line>
    </g>${label}`;
  }

  function roomFill(space, colors, previewItem = null) {
    if (previewItem) return previewItem.color || colors[previewItem.college] || "#64748b";
    if (!space.lab) return "#e2e8f0";
    if (String(space.lab.lab_type || "").trim() === "教室") return "#94a3b8";
    return colors[space.lab.college] || "#64748b";
  }

  function roomSvg(box, colors, compact, selectedSpaceId, mutedColleges = new Set(), moveBasket = {}, canMoveLabs = false, mergeSelection = null) {
    const items = moveBasket.items || [];
    const previewItem = items.find((item) => item.targetSpaceId === box.space.id) || null;
    const sourceItem = items.find((item) => item.sourceSpaceId === box.space.id) || null;
    const fill = roomFill(box.space, colors, previewItem);
    const labelFill = box.space.lab || previewItem ? "#ffffff" : "#344054";
    const muted = Boolean(box.space.lab?.college && mutedColleges.has(box.space.lab.college));
    if (compact) return `<rect class="room ${muted && box.space.lab ? "is-muted" : ""}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${fill}" rx="3"></rect>`;

    const selected = selectedSpaceId === box.space.id;
    const mergeSource = mergeSelection?.sourceSpaceId === box.space.id;
    const mergeTarget = (mergeSelection?.targetSpaceIds || []).includes(box.space.id);
    const doorLabel = box.space.front_door || box.space.space_code;
    const label = previewItem?.labName || box.space.lab?.lab_name || box.space.front_door || box.space.space_code;
    const subLabel = previewItem
      ? `${previewItem.college || "待落位"} · 落位中`
      : box.space.lab?.college || box.space.network_segment || box.space.current_status;
    const movable = Boolean(canMoveLabs && box.space.assignment && box.space.lab && !sourceItem);
    const tooltip = roomTooltipText(box.space);
    const mergeBadge = mergeSource
      ? `<text class="room-merge-badge" x="${box.x + box.width - 8}" y="${box.y + 18}" text-anchor="end" fill="#ffffff" font-size="11" font-weight="800">当前</text>`
      : mergeTarget
        ? `<text class="room-merge-badge" x="${box.x + box.width - 8}" y="${box.y + 18}" text-anchor="end" fill="#ffffff" font-size="11" font-weight="800">已选</text>`
        : "";
    return `<g class="room ${muted && box.space.lab ? "is-muted" : ""} ${selected ? "is-selected" : ""} ${movable ? "is-move-source" : ""} ${sourceItem ? "is-basket-source" : ""} ${previewItem ? "is-basket-target" : ""} ${mergeSource ? "is-merge-source" : ""} ${mergeTarget ? "is-merge-target" : ""}" tabindex="0" data-space-id="${box.space.id}" data-assignment-id="${box.space.assignment?.id || ""}" data-lab-id="${box.space.lab?.id || ""}" data-room-tooltip="${escapeHtml(tooltip)}" data-room-x="${box.x}" data-room-y="${box.y}" data-room-width="${box.width}" data-room-height="${box.height}">
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${fill}"></rect>
      ${mergeBadge}
      <text class="room-label room-label-door" data-label-role="door" data-label-text="${escapeHtml(doorLabel)}" x="${box.x + 8}" y="${box.y + 18}" fill="${labelFill}" font-size="13" font-weight="700">${escapeHtml(doorLabel)}</text>
      <text class="room-label room-label-name" data-label-role="name" data-label-text="${escapeHtml(label)}" x="${box.x + 8}" y="${box.y + 36}" fill="${labelFill}" font-size="12">${escapeHtml(label)}</text>
      <text class="room-label room-label-meta" data-label-role="meta" data-label-text="${escapeHtml(subLabel)}" x="${box.x + 8}" y="${box.y + 53}" fill="${labelFill}" font-size="12">${escapeHtml(subLabel)}</text>
      <text class="room-label room-label-area" data-label-role="area" data-label-text="${escapeHtml(`${box.space.area_m2.toFixed(1)} m²`)}" x="${box.x + 8}" y="${box.y + 70}" fill="${labelFill}" font-size="12">${escapeHtml(box.space.area_m2.toFixed(1))} m²</text>
    </g>`;
  }

  function roomTooltipText(space) {
    const door = doorRangeLabel(space) || space.space_code || "-";
    if (!space.lab) {
      return [
        "未规划",
        `门牌：${door}`,
        `面积：${space.area_m2.toFixed(1)} m²`,
        `网段：${space.network_segment || "未填写"}`,
      ].join("\n");
    }
    return [
      space.lab.lab_name || "未命名用途单元",
      `学院：${space.lab.college || "未填写"}`,
      `专业：${space.lab.major || "未填写"}`,
      `负责人：${space.lab.director || "未填写"}`,
      `座位：${space.lab.seat_count || 0} · 电脑：${space.lab.computer_count || 0}`,
      `门牌：${door} · 面积：${space.area_m2.toFixed(1)} m²`,
    ].join("\n");
  }

  function floorRenderData(data, buildingCode, floorCode, planId) {
    const segments = data.floor_segments.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
    const assignments = data.plan_assignments.filter((row) => row.plan_id === planId && row.assignment_status === "assigned");
    const labsById = new Map(data.labs.map((row) => [row.id, row]));
    const labsByCode = new Map(data.labs.map((row) => [row.lab_code, row]));
    const assignmentsBySpace = new Map();
    assignments.forEach((assignment) => {
      if (assignment.space_id) assignmentsBySpace.set(assignment.space_id, assignment);
      if (assignment.space_code) assignmentsBySpace.set(`code:${assignment.space_code}`, assignment);
    });
    const spaces = data.spaces
      .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
      .map((space) => {
        const assignment = assignmentsBySpace.get(space.id) || assignmentsBySpace.get(`code:${space.space_code}`) || null;
        const lab = assignment ? labsById.get(assignment.lab_id) || labsByCode.get(assignment.lab_code) || null : null;
        return { ...space, lab, assignment };
      });
    return { segments, spaces };
  }

  function renderFloorplan(params) {
    const { floorplanEl, activePlanBadgeEl, data, building, floorCode, activePlan, colors, selectedSpaceId, mutedColleges = new Set(), moveBasket, canMoveLabs, mergeSelection, onSelectSpace, onRoomPointerDown } = params;
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
      <div class="floorplan-stage" data-layout-width="${layout.width}" data-layout-height="${layout.height}">
        <svg viewBox="0 0 ${layout.width} ${layout.height}">
          <rect width="${layout.width}" height="${layout.height}" fill="#fbfcfe"></rect>
          ${layout.corridors.map((item) => structureSvg(item, false)).join("")}
          ${layout.rooms.map((item) => roomSvg(item, colors, false, selectedSpaceId, mutedColleges, moveBasket, canMoveLabs, mergeSelection)).join("")}
        </svg>
      </div>
      <div class="room-hover-card is-hidden" aria-hidden="true"></div>`;

    const hoverCard = floorplanEl.querySelector?.(".room-hover-card") || null;
    const hideHoverCard = () => {
      hoverCard?.classList.add("is-hidden");
      hoverCard?.setAttribute("aria-hidden", "true");
    };
    const showHoverCard = (node, event) => {
      if (!hoverCard || document.body.classList.contains("is-moving-placement") || floorplanEl.classList.contains("is-panning")) return;
      const text = node.dataset.roomTooltip || "";
      if (!text.trim()) return;
      hoverCard.innerHTML = roomTooltipHtml(text);
      hoverCard.classList.remove("is-hidden");
      hoverCard.setAttribute("aria-hidden", "false");
      positionHoverCard(floorplanEl, hoverCard, event);
    };

    floorplanEl.querySelectorAll(".room").forEach((node) => {
      node.addEventListener("click", () => onSelectSpace(node.dataset.spaceId));
      node.addEventListener("pointerdown", (event) => onRoomPointerDown?.(event, node.dataset.spaceId));
      node.addEventListener("pointerenter", (event) => showHoverCard(node, event));
      node.addEventListener("pointermove", (event) => showHoverCard(node, event));
      node.addEventListener("pointerleave", hideHoverCard);
      node.addEventListener("focus", (event) => showHoverCard(node, event));
      node.addEventListener("blur", hideHoverCard);
    });
  }

  function roomTooltipHtml(text) {
    const [title, ...lines] = text.split("\n");
    return `<strong>${escapeHtml(title || "")}</strong>${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}`;
  }

  function positionHoverCard(container, card, event) {
    const rect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const fallbackX = rect.left + rect.width / 2;
    const fallbackY = rect.top + rect.height / 2;
    const clientX = event?.clientX || fallbackX;
    const clientY = event?.clientY || fallbackY;
    const nextLeft = Math.min(Math.max(clientX - rect.left + 14, 8), rect.width - cardRect.width - 8);
    const nextTop = Math.min(Math.max(clientY - rect.top + 14, 8), rect.height - cardRect.height - 8);
    card.style.transform = `translate(${nextLeft}px, ${nextTop}px)`;
  }

  function renderDetailsPanel(params) {
    const {
      detailsEl,
      context,
      mode,
      moveDraft,
      moveErrors,
      moveDirty,
      moveTargetOptions = [],
      canEdit,
      canAdmin = false,
      canEditDetails = false,
      detailsEdit = { mode: "view", moreOpen: false, errors: {} },
      detailEditOptions = {},
      onFocusRow,
      onOpenMove,
      onDetailAction,
      onSubmitDetailEdit,
      onDetailDraftChange,
      onToggleMergeTarget,
      onCancelDetailEdit,
      onMoveFieldChange,
      onConfirmMove,
      onCancelMove,
      inspectorMode = "details",
      placementDragActive = false,
      onSetInspectorMode,
      moveBasket = { items: [], isOpen: false },
      onToggleBasket,
      onLocateBasketSource,
      onReturnBasketItem,
      onBasketCardPointerDown,
      onOpenBasket,
      onCloseBasket,
      onCreateUnplacedLab,
      onEditBasketLab,
      onSubmitBasketLabEdit,
      onCancelBasketLabEdit,
      onDeleteBasketLab,
    } = params;
    detailsEl.dataset.moveBasketDropzone = "true";

    if (inspectorMode === "placement") {
      renderPlacementPanel(detailsEl, moveBasket, canEdit, placementDragActive, detailEditOptions, {
        onSetInspectorMode,
        onLocateBasketSource,
        onReturnBasketItem,
        onBasketCardPointerDown,
        onCreateUnplacedLab,
        onEditBasketLab,
        onSubmitBasketLabEdit,
        onCancelBasketLabEdit,
        onDeleteBasketLab,
      });
      return;
    }

    if (detailsEdit?.mode === "createSpace") {
      renderDetailEditPanel(detailsEl, context, Boolean(canEditDetails || (canEdit && canAdmin)), detailsEdit, detailEditOptions, moveBasket, {
        onSubmitDetailEdit,
        onDetailDraftChange,
        onCancelDetailEdit,
        onSetInspectorMode,
      });
      return;
    }

    if (!context.space) {
      detailsEl.innerHTML = `<div class="details-empty" data-move-basket-dropzone="true">
        ${inspectorTabsHtml("details", moveBasket.items?.length || 0)}
        <div class="details-scroll">
          <div>
            <h2>当前选中对象</h2>
            <p>点击主图中的空间，在这里查看当前方案下的空间、实验室和分配信息。</p>
          </div>
        </div>
        ${canEditDetails || (canEdit && canAdmin) ? `<div class="detail-action-region">${detailActionBarHtml(false, false, true, false)}</div>` : ""}
      </div>`;
      bindInspectorTabs(detailsEl, onSetInspectorMode);
      bindDetailActionButtons(detailsEl, onDetailAction);
      return;
    }

    if (mode === "move") {
      renderMovePanel(detailsEl, context, moveDraft, moveErrors, moveDirty, moveTargetOptions, onMoveFieldChange, onConfirmMove, onCancelMove, moveBasket, onSetInspectorMode);
      return;
    }

    if (detailsEdit?.mode && detailsEdit.mode !== "view") {
      renderDetailEditPanel(detailsEl, context, Boolean(canEditDetails || (canEdit && canAdmin)), detailsEdit, detailEditOptions, moveBasket, {
        onSubmitDetailEdit,
        onCancelDetailEdit,
        onToggleMergeTarget,
        onDetailDraftChange,
        onSetInspectorMode,
      });
      return;
    }

    renderReadonlyDetails(detailsEl, context, canEdit, Boolean(canEditDetails || (canEdit && canAdmin)), detailsEdit, onFocusRow, onOpenMove, onDetailAction, moveBasket, onSetInspectorMode);
  }

  function inspectorTabsHtml(activeMode, count) {
    return `<div class="inspector-tabs" role="tablist" aria-label="右侧检查器视图">
      <button type="button" data-inspector-mode="details" class="${activeMode === "details" ? "is-active" : ""}">详细信息</button>
      <button type="button" data-inspector-mode="placement" class="${activeMode === "placement" ? "is-active" : ""}">待安置区${count ? `<span>${escapeHtml(String(count))}</span>` : ""}</button>
    </div>`;
  }

  function bindInspectorTabs(root, onSetInspectorMode) {
    root.querySelectorAll("[data-inspector-mode]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onSetInspectorMode?.(button.dataset.inspectorMode);
      });
    });
  }

  function renderReadonlyDetails(detailsEl, context, canEdit, canEditDetails, detailsEdit, onFocusRow, onOpenMove, onDetailAction, moveBasket, onSetInspectorMode) {
    const { building, space, lab, assignment } = context;
    const pageTitle = lab?.lab_name || "未规划";
    const canMove = Boolean(canEdit && assignment && lab);
    const canDetailEdit = Boolean(canEditDetails && space);
    const detailRows = [detailLine("门牌", doorRangeLabel(space) || "未填写")];

    if (lab) {
      detailRows.push(
        detailLine("所属学院", lab.college),
        detailLine("所属专业", lab.major || "未填写"),
        detailLine("负责人", lab.director || "未填写")
      );
    }

    detailRows.push(
      detailLine("房间尺寸", `${space.length_m}m × ${space.width_m}m`),
      detailLine("面积", `${space.area_m2.toFixed(1)} m²`),
      detailLine("网段", space.network_segment || "未填写")
    );

    if (lab) {
      detailRows.push(
        detailLine("座位数", String(lab.seat_count)),
        detailLine("电脑数", String(lab.computer_count))
      );
    }

    detailsEl.innerHTML = `<div class="details-panel is-readonly" data-move-basket-dropzone="true">
      <div class="details-header">
        <div>
          <h2>详细信息</h2>
        </div>
        ${inspectorTabsHtml("details", moveBasket.items?.length || 0)}
      </div>

      <div class="details-scroll">
        <section class="details-card details-card-compact">
          <div class="details-card-head">
            <div>
              <h3>${escapeHtml(pageTitle)}</h3>
              <p>${escapeHtml(`${building?.building_name || building?.building_code || ""} · ${space.floor_code}`)}</p>
            </div>
            ${lab ? "" : `<span class="details-status">未规划</span>`}
          </div>
          ${lab ? "" : `<p class="details-empty-note">当前空间没有已分配实验室，可先规划所属学院，系统会生成默认未规划实验室。</p>`}
          <div class="details-info-list">
            ${detailRows.join("")}
          </div>
        </section>
      </div>
      ${canDetailEdit ? `<div class="detail-action-region">${detailActionBarHtml(Boolean(lab && assignment), detailsEdit?.moreOpen, true, true)}</div>` : ""}

    </div>`;
    bindInspectorTabs(detailsEl, onSetInspectorMode);
    bindDetailActionButtons(detailsEl, onDetailAction);
  }

  function detailActionBarHtml(hasLab, moreOpen, includeCreate, includeMore = true) {
    return `<div class="detail-admin-actions">
      ${hasLab ? `<button type="button" class="secondary-button compact-button" data-detail-action="edit-lab">编辑实验室</button>` : ""}
      ${hasLab ? `<button type="button" class="secondary-button compact-button" data-detail-action="renovate-room">改建房间</button>` : ""}
      ${includeCreate ? `<button type="button" class="secondary-button compact-button" data-detail-action="create-space">新增房间</button>` : ""}
      ${includeMore ? `
      <div class="detail-more-wrap">
        <button type="button" class="secondary-button compact-button" data-detail-action="toggle-more" aria-expanded="${moreOpen ? "true" : "false"}">更多</button>
        ${moreOpen ? `<div class="detail-more-panel">
          <button type="button" class="secondary-button compact-button" data-detail-action="edit-space">编辑房间</button>
          <button type="button" class="secondary-button compact-button" data-detail-action="merge-space">合并房间</button>
          <button type="button" class="secondary-button compact-button" data-detail-action="split-space">拆分房间</button>
          <button type="button" class="secondary-button compact-button is-danger" data-detail-action="delete-space">删除房间</button>
        </div>` : ""}
      </div>` : ""}
    </div>`;
  }

  function bindDetailActionButtons(root, onDetailAction) {
    root.querySelectorAll("[data-detail-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (button.disabled) return;
        onDetailAction?.(button.dataset.detailAction);
      });
    });
  }

  function renderDetailEditPanel(detailsEl, context, canAdminEdit, detailsEdit, options, moveBasket, handlers) {
    const mode = detailsEdit?.mode || "view";
    if (!canAdminEdit) {
      renderReadonlyDetails(detailsEl, context, false, false, { mode: "view" }, null, null, null, moveBasket, handlers.onSetInspectorMode);
      return;
    }
    const title = mode === "createSpace"
      ? "新增房间"
      : mode === "editSpace"
        ? "编辑房间"
        : mode === "mergeSpace"
          ? "合并房间"
          : mode === "splitSpace"
            ? "沿走廊方向拆分房间"
            : mode === "renovateRoom"
              ? "改建房间"
              : "编辑实验室";
    const draft = detailsEdit?.draft || {};
    const formHtml = mode === "createSpace"
      ? spaceEditFormHtml(context, options, detailsEdit.errors || {}, true, draft)
      : mode === "editSpace"
        ? spaceEditFormHtml(context, options, detailsEdit.errors || {}, false, draft)
        : mode === "mergeSpace"
          ? mergeSpaceFormHtml(context, options, detailsEdit.errors || {}, draft)
          : mode === "splitSpace"
            ? splitSpaceFormHtml(context, options, detailsEdit.errors || {}, draft)
            : labEditFormHtml(context, options, detailsEdit.errors || {}, mode === "renovateRoom", draft);
    detailsEl.innerHTML = `<div class="details-panel is-editing" data-move-basket-dropzone="true">
      <div class="details-header">
        <div>
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${inspectorTabsHtml("details", moveBasket.items?.length || 0)}
      </div>
      <div class="details-scroll">
        <section class="details-card detail-edit-card">
          ${formHtml}
        </section>
      </div>
    </div>`;
    bindInspectorTabs(detailsEl, handlers.onSetInspectorMode);
    const form = detailsEl.querySelector("form[data-detail-edit-mode]");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      handlers.onSubmitDetailEdit?.(mode, new FormData(form));
    });
    form?.querySelectorAll("[data-detail-draft-watch]").forEach((input) => {
      input.addEventListener("input", () => handlers.onDetailDraftChange?.(mode, new FormData(form)));
      input.addEventListener("change", () => handlers.onDetailDraftChange?.(mode, new FormData(form)));
    });
    detailsEl.querySelectorAll("[data-merge-target-id]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        handlers.onToggleMergeTarget?.(button.dataset.mergeTargetId);
      });
    });
    const collegeSelect = detailsEl.querySelector('select[name="college"]');
    const majorSelect = detailsEl.querySelector('select[name="major"]');
    collegeSelect?.addEventListener("change", () => {
      if (!majorSelect) return;
      majorSelect.innerHTML = detailMajorOptionsHtml(options, collegeSelect.value, majorSelect.value);
    });
    detailsEl.querySelector("[data-detail-cancel]")?.addEventListener("click", (event) => {
      event.preventDefault();
      handlers.onCancelDetailEdit?.();
    });
  }

  function labEditFormHtml(context, options, errors, isRenovation, draft = {}) {
    const lab = context.lab || {};
    const month = draft.renovationMonth ?? options.renovationMonth ?? "";
    const defaultName = draft.labName ?? (isRenovation ? "待改建房间" : lab.lab_name || "");
    const selectedCollege = draft.college ?? lab.college ?? "";
    const selectedMajor = draft.major ?? (isRenovation ? "" : lab.major || "");
    return `<form id="${isRenovation ? "detailRenovateRoomForm" : "detailEditLabForm"}" class="detail-edit-form" data-detail-edit-mode="${isRenovation ? "renovateRoom" : "editLab"}">
      ${roomContextHtml(context)}
      <div class="detail-form-grid">
        ${detailInput("实验室名称", "labName", defaultName, "text")}
        ${detailSelect("所属学院", "college", detailCollegeOptionsHtml(options, selectedCollege))}
        ${detailSelect("专业", "major", detailMajorOptionsHtml(options, selectedCollege, selectedMajor))}
        ${detailInput("负责人", "director", draft.director ?? (isRenovation ? "" : lab.director || ""), "text")}
        ${detailInput("座位数", "seatCount", draft.seatCount ?? (isRenovation ? "" : lab.seat_count ?? ""), "number", "1")}
        ${detailInput("电脑数", "computerCount", draft.computerCount ?? (isRenovation ? "" : lab.computer_count ?? ""), "number", "1")}
        ${detailInput("改建年月", "renovationMonth", month, "month")}
      </div>
      ${errors.form ? `<p class="detail-form-error">${escapeHtml(errors.form)}</p>` : ""}
      <div class="details-actions">
        <button type="submit" class="primary-button">保存</button>
        <button type="button" data-detail-cancel>取消</button>
      </div>
    </form>`;
  }

  function spaceEditFormHtml(context, options, errors, isCreate = false, draft = {}) {
    const space = isCreate ? (options.createSpaceDraft || {}) : (context.space || {});
    const valueFor = (key, fallback) => draft[key] ?? fallback;
    const segmentOptions = options.segmentOptions || [];
    const selectedSegment = valueFor("segmentCode", space.segment_code || "");
    const segmentHtml = segmentOptions.length
      ? segmentOptions.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selectedSegment || (!selectedSegment && item.selected) ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")
      : `<option value="${escapeHtml(selectedSegment)}">${escapeHtml(selectedSegment || "未设置骨架")}</option>`;
    return `<form id="${isCreate ? "detailCreateSpaceForm" : "detailEditSpaceForm"}" class="detail-edit-form" data-detail-edit-mode="${isCreate ? "createSpace" : "editSpace"}">
      ${isCreate ? "" : roomContextHtml(context)}
      <div class="space-code-preview"><span>空间编码预览</span><strong>${escapeHtml(options.spaceCodePreview || space.space_code || "")}</strong></div>
      <div class="detail-form-grid">
        ${detailInput("前门牌", "frontDoor", valueFor("frontDoor", space.front_door || ""), "text")}
        ${detailInput("后门牌", "rearDoor", valueFor("rearDoor", space.rear_door || ""), "text")}
        <label class="detail-field"><span>骨架</span><select name="segmentCode">${segmentHtml}</select></label>
        <label class="detail-field"><span>所在侧</span><select name="side">
          ${optionHtml("north", "北侧", valueFor("side", space.side))}
          ${optionHtml("south", "南侧", valueFor("side", space.side))}
          ${optionHtml("east", "东侧", valueFor("side", space.side))}
          ${optionHtml("west", "西侧", valueFor("side", space.side))}
        </select></label>
        ${detailInput("偏移", "offsetM", valueFor("offsetM", space.offset_m ?? ""), "number", "0.1")}
        ${detailInput("长度", "lengthM", valueFor("lengthM", space.length_m ?? ""), "number", "0.1")}
        ${detailInput("宽度", "widthM", valueFor("widthM", space.width_m ?? ""), "number", "0.1")}
        ${detailInput("面积", "areaM2", valueFor("areaM2", space.area_m2 ?? ""), "number", "0.1")}
        ${detailInput("网段", "networkSegment", valueFor("networkSegment", space.network_segment || ""), "text")}
        <label class="detail-field"><span>物理状态</span><select name="currentStatus">
          ${optionHtml("active", "可用", valueFor("currentStatus", space.current_status))}
          ${optionHtml("unavailable", "不可用", valueFor("currentStatus", space.current_status))}
        </select></label>
      </div>
      ${errors.form ? `<p class="detail-form-error">${escapeHtml(errors.form)}</p>` : ""}
      <div class="details-actions">
        <button type="submit" class="primary-button">保存</button>
        <button type="button" data-detail-cancel>取消</button>
      </div>
    </form>`;
  }

  function mergeSpaceFormHtml(context, options, errors, draft = {}) {
    const selectedSpaces = options.mergeSelectedSpaces || [];
    const selectedCodes = selectedSpaces.map((space) => space.space_code).filter(Boolean).join(",");
    const currentLabel = doorRangeLabel(context.space) || context.space?.space_code || "当前房间";
    const rangeLabel = [draft.frontDoor ?? options.mergeDefaultFrontDoor, draft.rearDoor ?? options.mergeDefaultRearDoor]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" - ");
    const selectedHtml = selectedSpaces.length
      ? selectedSpaces.map((space) => `<button type="button" class="detail-chip" data-merge-target-id="${escapeHtml(space.id || "")}" title="${escapeHtml(space.space_code || "")}">${escapeHtml(doorRangeLabel(space) || space.space_code)}<small>${escapeHtml(space.space_code || "")}</small></button>`).join("")
      : `<span class="detail-muted">尚未选择目标房间</span>`;
    return `<form id="detailMergeSpaceForm" class="detail-edit-form" data-detail-edit-mode="mergeSpace">
      ${roomContextHtml(context)}
      <input name="targetSpaceCodes" type="hidden" value="${escapeHtml(selectedCodes)}" />
      <div class="space-code-preview"><span>合并方式</span><strong>在主图点击房间加入合并</strong></div>
      <div class="space-code-preview"><span>合并范围</span><strong>${escapeHtml(rangeLabel || currentLabel)}</strong></div>
      <div class="space-code-preview"><span>选择状态</span><strong>当前房间 ${escapeHtml(currentLabel)} · 已选 ${escapeHtml(String(selectedSpaces.length))} 间</strong></div>
      <div class="detail-selection-strip">${selectedHtml}</div>
      <div class="detail-form-grid">
        ${detailInput("合并后前门牌", "frontDoor", draft.frontDoor ?? options.mergeDefaultFrontDoor ?? "", "text")}
        ${detailInput("合并后后门牌", "rearDoor", draft.rearDoor ?? options.mergeDefaultRearDoor ?? "", "text")}
        ${detailInput("实验室名称", "labName", draft.labName ?? options.mergeDefaultLabName ?? "", "text")}
      </div>
      ${errors.form ? `<p class="detail-form-error">${escapeHtml(errors.form)}</p>` : ""}
      <div class="details-actions">
        <button type="submit" class="primary-button" ${selectedSpaces.length ? "" : "disabled"}>保存</button>
        <button type="button" data-detail-cancel>取消</button>
      </div>
    </form>`;
  }

  function splitSpaceFormHtml(context, options, errors, draft = {}) {
    const space = context.space || {};
    const splitCount = Math.min(10, Math.max(2, Number(draft.splitCount || 2) || 2));
    const defaultLength = Number(space.length_m) > 0 ? Number((Number(space.length_m) / splitCount).toFixed(2)) : "";
    const splitDirectionLabel = options.splitDirectionLabel || "沿走廊方向";
    const rows = Array.from({ length: splitCount }, (_, index) => {
      const frontName = `splitFrontDoor${index}`;
      const rearName = `splitRearDoor${index}`;
      const lengthName = `splitLengthM${index}`;
      const frontDefault = index === 0 ? (space.front_door || "") : "";
      return `<div class="detail-split-row">
        ${detailInput(`房间 ${index + 1} 前门牌`, frontName, draft[frontName] ?? frontDefault, "text")}
        ${detailInput(`房间 ${index + 1} 后门牌`, rearName, draft[rearName] ?? "", "text")}
        ${detailInput(`房间 ${index + 1} 长度`, lengthName, draft[lengthName] ?? defaultLength, "number", "0.1")}
      </div>`;
    }).join("");
    return `<form id="detailSplitSpaceForm" class="detail-edit-form" data-detail-edit-mode="splitSpace">
      ${roomContextHtml(context)}
      <input name="splitAxis" type="hidden" value="length" />
      <div class="space-code-preview"><span>拆分方向</span><strong>${escapeHtml(splitDirectionLabel)}</strong></div>
      <div class="space-code-preview"><span>原房间长度</span><strong>${escapeHtml(space.length_m ?? "")}</strong></div>
      <div class="detail-form-grid">
        <label class="detail-field"><span>拆分数量</span><input name="splitCount" type="number" min="2" max="10" step="1" value="${escapeHtml(splitCount)}" data-detail-draft-watch /></label>
      </div>
      ${rows}
      ${errors.form ? `<p class="detail-form-error">${escapeHtml(errors.form)}</p>` : ""}
      <div class="details-actions">
        <button type="submit" class="primary-button">保存</button>
        <button type="button" data-detail-cancel>取消</button>
      </div>
    </form>`;
  }

  function roomContextHtml(context) {
    const space = context.space || {};
    const building = context.building || {};
    return `<div class="detail-room-context">
      <span>当前房间</span>
      <strong>${escapeHtml(doorRangeLabel(space) || space.space_code || "未选中房间")}</strong>
      <small>${escapeHtml(`${building.building_name || building.building_code || ""} · ${space.floor_code || ""} · ${space.space_code || ""}`)}</small>
    </div>`;
  }

  function detailInput(label, name, value, type, step = "") {
    return `<label class="detail-field"><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value ?? "")}" ${step ? `step="${escapeHtml(step)}"` : ""} /></label>`;
  }

  function detailSelect(label, name, optionsHtml) {
    return `<label class="detail-field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">${optionsHtml}</select></label>`;
  }

  function detailCollegeOptionsHtml(options, selectedCollege) {
    const rows = options.collegeOptions || [];
    const values = rows.map((row) => row.value).filter(Boolean);
    if (selectedCollege && !values.includes(selectedCollege)) values.unshift(selectedCollege);
    const optionRows = [`<option value="" ${selectedCollege ? "" : "selected"}>请选择学院</option>`];
    return optionRows.concat(values.map((value) => {
      const label = rows.find((row) => row.value === value)?.label || value;
      return `<option value="${escapeHtml(value)}" ${value === selectedCollege ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })).join("");
  }

  function detailLabTypeOptionsHtml(options, selectedType) {
    const rows = options.labTypeOptions || [];
    const values = rows.map((row) => row.value).filter(Boolean);
    if (selectedType && !values.includes(selectedType)) values.unshift(selectedType);
    const optionRows = [`<option value="" ${selectedType ? "" : "selected"}>请选择类型</option>`];
    return optionRows.concat(values.map((value) => {
      const label = rows.find((row) => row.value === value)?.label || value;
      return `<option value="${escapeHtml(value)}" ${value === selectedType ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })).join("");
  }

  function detailMajorOptionsHtml(options, selectedCollege, selectedMajor) {
    const byCollege = options.majorOptionsByCollege || {};
    const values = (byCollege[selectedCollege] || []).slice();
    if (selectedMajor && !values.includes(selectedMajor)) values.unshift(selectedMajor);
    const optionRows = [`<option value="" ${selectedMajor ? "" : "selected"}>${selectedCollege ? "未选择专业" : "请先选择学院"}</option>`];
    return optionRows.concat(values.map((value) => `<option value="${escapeHtml(value)}" ${value === selectedMajor ? "selected" : ""}>${escapeHtml(value)}</option>`)).join("");
  }

  function optionHtml(value, label, selectedValue) {
    return `<option value="${escapeHtml(value)}" ${String(selectedValue || "active") === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function renderPlacementPanel(detailsEl, moveBasket, canEdit, placementDragActive, options, handlers) {
    const items = moveBasket.items || [];
    const editingItem = items.find((item) => item.id === moveBasket.editingItemId) || null;
    detailsEl.innerHTML = `<div class="details-panel is-placement ${placementDragActive ? "is-drop-active" : ""}" data-move-basket-dropzone="true">
      <div class="details-header">
        <div>
          <h2>待安置区</h2>
        </div>
        <div class="details-header-actions">
          ${canEdit ? `<button type="button" class="secondary-button compact-button" data-action="create-unplaced-lab">新增</button>` : ""}
          ${inspectorTabsHtml("placement", items.length)}
        </div>
      </div>
      ${editingItem ? basketLabEditFormHtml(editingItem, options, moveBasket.editErrors || {}, moveBasket.editDraft || {}) : ""}
      <div class="move-basket-list placement-list" data-move-basket-dropzone="true">
        ${items.length ? items.map((item) => basketItemHtml(item, canEdit)).join("") : `<div class="details-empty-inline">当前没有待安置实验室。</div>`}
      </div>
    </div>`;
    bindInspectorTabs(detailsEl, handlers.onSetInspectorMode);
    detailsEl.querySelector("[data-action='create-unplaced-lab']")?.addEventListener("click", () => handlers.onCreateUnplacedLab?.());
    detailsEl.querySelectorAll("[data-action='locate-basket-source']").forEach((button) => {
      button.addEventListener("click", () => handlers.onLocateBasketSource?.(button.dataset.itemId));
    });
    detailsEl.querySelectorAll("[data-action='return-basket-item']").forEach((button) => {
      button.addEventListener("click", () => handlers.onReturnBasketItem?.(button.dataset.itemId));
    });
    detailsEl.querySelectorAll("[data-action='edit-basket-lab']").forEach((button) => {
      button.addEventListener("click", () => handlers.onEditBasketLab?.(button.dataset.itemId));
    });
    detailsEl.querySelectorAll("[data-action='delete-basket-lab']").forEach((button) => {
      button.addEventListener("click", () => handlers.onDeleteBasketLab?.(button.dataset.itemId));
    });
    detailsEl.querySelector("#basketLabEditForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      handlers.onSubmitBasketLabEdit?.(editingItem?.id, new FormData(event.currentTarget));
    });
    detailsEl.querySelector("[data-basket-edit-cancel]")?.addEventListener("click", (event) => {
      event.preventDefault();
      handlers.onCancelBasketLabEdit?.();
    });
    const collegeSelect = detailsEl.querySelector('#basketLabEditForm select[name="college"]');
    const majorSelect = detailsEl.querySelector('#basketLabEditForm select[name="major"]');
    collegeSelect?.addEventListener("change", () => {
      if (!majorSelect) return;
      majorSelect.innerHTML = detailMajorOptionsHtml(options, collegeSelect.value, majorSelect.value);
    });
    detailsEl.querySelectorAll(".move-basket-item").forEach((node) => {
      node.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button,input,select,textarea,form")) return;
        handlers.onBasketCardPointerDown?.(event, node.dataset.itemId);
      });
    });
  }

  function basketLabEditFormHtml(item, options, errors, draft = {}) {
    const selectedCollege = draft.college ?? item.college ?? "";
    const selectedMajor = draft.major ?? item.major ?? "";
    return `<form id="basketLabEditForm" class="detail-edit-form basket-lab-edit-form">
      <div class="detail-form-grid">
        ${detailInput("实验室名称", "labName", draft.labName ?? item.labName ?? "", "text")}
        ${detailSelect("实验室类型", "labType", detailLabTypeOptionsHtml(options, draft.labType ?? item.labType ?? ""))}
        ${detailSelect("所属学院", "college", detailCollegeOptionsHtml(options, selectedCollege))}
        ${detailSelect("专业", "major", detailMajorOptionsHtml(options, selectedCollege, selectedMajor))}
        ${detailInput("负责人", "director", draft.director ?? item.director ?? "", "text")}
        ${detailInput("座位数", "seatCount", draft.seatCount ?? item.seatCount ?? "", "number", "1")}
        ${detailInput("电脑数", "computerCount", draft.computerCount ?? item.computerCount ?? "", "number", "1")}
      </div>
      ${errors.form ? `<p class="detail-form-error">${escapeHtml(errors.form)}</p>` : ""}
      <div class="details-actions">
        <button type="submit" class="primary-button">保存</button>
        <button type="button" data-basket-edit-cancel>取消</button>
      </div>
    </form>`;
  }

  function basketItemHtml(item, canEdit) {
    const location = splitLocationLabel(item.sourceSpaceLabel || item.sourceSpaceCode || "-");
    const seats = item.seatCount || 0;
    const computers = item.computerCount || 0;
    return `<article class="move-basket-item" data-item-id="${escapeHtml(item.id)}" style="border-left-color:${escapeHtml(item.color || "#64748b")}" title="${escapeHtml(item.sourceSpaceLabel || item.sourceSpaceCode || "")}">
      <div class="move-basket-item-main">
        <strong>${escapeHtml(item.labName)}</strong>
        <span>${escapeHtml(`${item.college || "未填写学院"} · ${location.primary}`)}</span>
        <small>${escapeHtml(location.secondary)}</small>
      </div>
      <div class="move-basket-item-stats">
        <span>${escapeHtml(String(seats))} 座</span>
        ${computers ? `<span>${escapeHtml(String(computers))} 机</span>` : ""}
      </div>
      <div class="move-basket-item-actions">
        <button type="button" data-action="locate-basket-source" data-item-id="${escapeHtml(item.id)}">定位</button>
        ${canEdit ? `<button type="button" data-action="edit-basket-lab" data-item-id="${escapeHtml(item.id)}">编辑</button>` : ""}
        ${canEdit ? `<button type="button" data-action="return-basket-item" data-item-id="${escapeHtml(item.id)}">归位</button>` : ""}
        ${canEdit && item.isSavedUnplaced ? `<button type="button" class="is-danger" data-action="delete-basket-lab" data-item-id="${escapeHtml(item.id)}">删除</button>` : ""}
      </div>
    </article>`;
  }

  function splitLocationLabel(label) {
    const parts = String(label || "-").split("·").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { primary: parts.slice(0, 2).join(" · "), secondary: parts.slice(2).join(" · ") };
    }
    return { primary: parts[0] || "-", secondary: "" };
  }

  function renderMovePanel(detailsEl, context, moveDraft, moveErrors, moveDirty, moveTargetOptions, onMoveFieldChange, onConfirmMove, onCancelMove, moveBasket, onSetInspectorMode) {
    const { activePlan, building, space, lab, assignment } = context;
    const errorText = moveErrors.targetSpaceCode || "";
    const selectedTarget = moveDraft?.targetSpaceId || "";
    const targetOptionsHtml = moveTargetOptions.length
      ? `<option value="">请选择未规划空间</option>${moveTargetOptions.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selectedTarget ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}`
      : `<option value="">当前没有可搬迁的未规划空间</option>`;
    detailsEl.innerHTML = `<div class="details-panel is-move ${moveDirty ? "is-dirty" : ""}" data-move-basket-dropzone="true">
      <div class="details-header">
        <div>
          <h2>搬迁实验室</h2>
          <p>${escapeHtml(`${activePlan?.plan_name || "当前方案"} · ${building?.building_name || building?.building_code || ""} · ${space.floor_code}`)}</p>
        </div>
        ${inspectorTabsHtml("details", moveBasket.items?.length || 0)}
      </div>

      <section class="details-card">
        <div class="details-card-head">
          <div>
            <h3>当前落位</h3>
            <p>确认实验室与原空间后，再选择目标未规划空间。</p>
          </div>
        </div>
        <div class="details-meta-grid">
          ${readonlyField("实验室名称", lab?.lab_name || "未分配实验室")}
          ${readonlyField("当前空间编码", assignment?.space_code || space.space_code)}
          ${readonlyField("搬迁前空间", assignment?.previous_space_code || "未填写")}
        </div>
      </section>

      <section class="details-card">
        <div class="details-card-head">
          <div>
            <h3>目标空间</h3>
            <p>仅显示全校范围内可用且未规划的空间。</p>
          </div>
        </div>
        <label class="detail-field ${errorText ? "has-error" : ""}">
          <span>目标空间</span>
          <select data-move-field="targetSpaceId" ${moveTargetOptions.length ? "" : "disabled"}>
            ${targetOptionsHtml}
          </select>
          <small>${escapeHtml(errorText)}</small>
        </label>
      </section>

      <div class="details-actions">
        <button type="button" class="primary-button" data-action="confirm-move" ${moveTargetOptions.length ? "" : "disabled"}>确认搬迁</button>
        <button type="button" data-action="cancel-move">取消</button>
      </div>
    </div>`;

    detailsEl.querySelector('[data-move-field="targetSpaceId"]')?.addEventListener("change", (event) => {
      const option = moveTargetOptions.find((item) => item.value === event.target.value);
      onMoveFieldChange("targetSpaceId", event.target.value);
      onMoveFieldChange("targetSpaceCode", option?.code || "");
    });
    detailsEl.querySelector('[data-action="confirm-move"]')?.addEventListener("click", onConfirmMove);
    detailsEl.querySelector('[data-action="cancel-move"]')?.addEventListener("click", onCancelMove);
    bindInspectorTabs(detailsEl, onSetInspectorMode);
  }

  function detailLine(label, value) {
    return `<p><strong>${escapeHtml(label)}：</strong>${escapeHtml(value || "未填写")}</p>`;
  }

  function doorRangeLabel(space) {
    const frontDoor = String(space?.front_door || "").trim();
    const rearDoor = String(space?.rear_door || "").trim();
    if (frontDoor && rearDoor && frontDoor !== rearDoor) return `${frontDoor}-${rearDoor}`;
    return frontDoor || rearDoor || "";
  }

  function readonlyField(label, value) {
    return `<div class="detail-meta-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "未填写")}</strong></div>`;
  }

  const renderThumbList = Thumbnails.createRenderThumbList({
    unique,
    compare,
    escapeHtml,
    THUMB_SCALE,
    buildLayout,
    floorRenderData,
    structureSvg,
    roomSvg,
  });

  global.FloorplanRender = {
    colorMap: LegendColors.colorMap,
    renderLegend: LegendColors.renderLegend,
    renderThumbList,
    renderFloorplan,
    renderDetailsPanel,
    floorRenderData,
    buildLayoutForTest: buildLayout,
  };
})(window);
