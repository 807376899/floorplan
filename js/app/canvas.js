(function attachFloorplanCanvas(global) {
  function changeCanvasZoom(state, els, delta) {
    state.zoom = Math.min(2.5, Math.max(0.4, Number((state.zoom + delta).toFixed(2))));
    applyCanvasMode(state, els);
  }

  function resetCanvasZoom(state, els) {
    state.zoom = 1;
    applyCanvasMode(state, els);
  }

  function bindCanvasPan(state, els) {
    let pan = null;
    els.floorplan.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || state.zoom <= 1) return;
      if (event.target.closest?.(".room")) return;
      pan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: els.floorplan.scrollLeft,
        scrollTop: els.floorplan.scrollTop,
        active: false,
      };
      els.floorplan.setPointerCapture?.(event.pointerId);
    });

    els.floorplan.addEventListener("pointermove", (event) => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (!pan.active && Math.hypot(dx, dy) > 3) {
        pan.active = true;
        els.floorplan.classList.add("is-panning");
      }
      if (!pan.active) return;
      event.preventDefault();
      els.floorplan.scrollLeft = pan.scrollLeft - dx;
      els.floorplan.scrollTop = pan.scrollTop - dy;
    });

    const finishPan = (event) => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      els.floorplan.releasePointerCapture?.(event.pointerId);
      els.floorplan.classList.remove("is-panning");
      pan = null;
    };
    els.floorplan.addEventListener("pointerup", finishPan);
    els.floorplan.addEventListener("pointercancel", finishPan);
    window.addEventListener("blur", () => {
      els.floorplan.classList.remove("is-panning");
      pan = null;
    });
  }

  function applyCanvasMode(state, els) {
    const stage = els.floorplan.querySelector(".floorplan-stage");
    const svg = stage?.querySelector("svg");
    if (!stage || !svg) return;
    const width = Number(stage.dataset.layoutWidth);
    const height = Number(stage.dataset.layoutHeight);
    const bounds = els.floorplan.getBoundingClientRect();
    const style = getComputedStyle(els.floorplan);
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const viewportWidth = Math.max(1, bounds.width - horizontalPadding);
    const viewportHeight = Math.max(1, bounds.height - verticalPadding);
    const stagePadding = 52;
    const fit = Math.max(0.1, Math.min(1, (viewportWidth - stagePadding) / width, (viewportHeight - stagePadding) / height));
    const scale = fit * state.zoom;
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;
    const stageWidth = Math.max(scaledWidth + stagePadding, viewportWidth);
    const stageHeight = Math.max(scaledHeight + stagePadding, viewportHeight);

    els.floorplan.classList.toggle("is-zoomed", state.zoom > 1);
    els.canvasModeText.textContent = state.zoom === 1 ? "适配显示" : `缩放 ${Math.round(state.zoom * 100)}%`;
    stage.style.width = `${stageWidth}px`;
    stage.style.height = `${stageHeight}px`;
    svg.style.width = `${scaledWidth}px`;
    svg.style.height = `${scaledHeight}px`;
    applyRoomLabelSizing(state, svg, scale);

    if (state.zoom > 1) {
      els.floorplan.scrollLeft = Math.max(0, (stageWidth - viewportWidth) / 2);
      els.floorplan.scrollTop = Math.max(0, (stageHeight - viewportHeight) / 2);
    } else {
      els.floorplan.scrollLeft = 0;
      els.floorplan.scrollTop = 0;
    }
  }

  function applyRoomLabelSizing(state, svg, scale) {
    const screenScale = Math.max(scale, 0.01);
    const doorScreenSize = state.zoom > 1 ? Math.min(18, 13 + (state.zoom - 1) * 4) : 13;
    const nameScreenSize = state.zoom > 1 ? Math.min(16, 12 + (state.zoom - 1) * 3) : 12;
    const doorFontSize = doorScreenSize / screenScale;
    const bodyFontSize = nameScreenSize / screenScale;
    const lineGap = Math.max(2 / screenScale, bodyFontSize * 0.24);

    svg.querySelectorAll(".room").forEach((room) => {
      const x = Number(room.dataset.roomX);
      const y = Number(room.dataset.roomY);
      const width = Number(room.dataset.roomWidth);
      const height = Number(room.dataset.roomHeight);
      if (![x, y, width, height].every(Number.isFinite)) return;

      const padding = Math.min(Math.max(5 / screenScale, width * 0.08), Math.max(4, width * 0.18));
      const maxWidth = Math.max(0, width - padding * 2);
      const lines = {
        door: room.querySelector('[data-label-role="door"]'),
        name: room.querySelector('[data-label-role="name"]'),
        meta: room.querySelector('[data-label-role="meta"]'),
        area: room.querySelector('[data-label-role="area"]'),
      };
      const availableHeight = Math.max(0, height - padding * 2);
      const wanted = [
        { node: lines.door, fontSize: doorFontSize, weight: "700" },
        { node: lines.name, fontSize: bodyFontSize, weight: "600" },
        { node: lines.meta, fontSize: bodyFontSize * 0.92, weight: "500", optional: true },
        { node: lines.area, fontSize: bodyFontSize * 0.92, weight: "500", optional: true },
      ].filter((item) => item.node);
      const requiredForPrimary = doorFontSize + bodyFontSize + lineGap;
      const canStackPrimary = availableHeight >= requiredForPrimary;
      const visible = canStackPrimary
        ? wanted.slice(0, Math.max(2, Math.min(wanted.length, Math.floor((availableHeight + lineGap) / (bodyFontSize + lineGap)))))
        : wanted.slice(0, 1);
      const totalHeight = visible.reduce((sum, item) => sum + item.fontSize, 0) + Math.max(0, visible.length - 1) * lineGap;
      let currentY = y + Math.max(padding + visible[0].fontSize, (height - totalHeight) / 2 + visible[0].fontSize);
      const inlineLabel = !canStackPrimary && lines.door && lines.name
        ? `${lines.door.dataset.labelText || lines.door.textContent || ""} ${lines.name.dataset.labelText || lines.name.textContent || ""}`.trim()
        : "";

      // 空间太小时只保留最重要标签；空间足够时再显示学院、面积等辅助信息。
      wanted.forEach((item) => {
        const isVisible = visible.includes(item);
        item.node.style.display = isVisible ? "" : "none";
        if (!isVisible) return;
        item.node.setAttribute("x", String(x + padding));
        item.node.setAttribute("y", String(currentY));
        item.node.setAttribute("font-size", String(item.fontSize));
        item.node.setAttribute("font-weight", item.weight);
        fitRoomLabelText(item.node, maxWidth, item.node === lines.door && inlineLabel ? inlineLabel : null);
        currentY += item.fontSize + lineGap;
      });
    });
  }

  function fitRoomLabelText(node, maxWidth, textOverride = null) {
    const fullText = textOverride ?? node.dataset.labelText ?? node.textContent ?? "";
    if (maxWidth <= 0) {
      node.style.display = "none";
      return;
    }
    node.textContent = fullText;
    if (node.getComputedTextLength() <= maxWidth) return;

    let low = 0;
    let high = fullText.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      node.textContent = `${fullText.slice(0, mid)}…`;
      if (node.getComputedTextLength() <= maxWidth) low = mid;
      else high = mid - 1;
    }
    node.textContent = low > 0 ? `${fullText.slice(0, low)}…` : "";
    if (!node.textContent) node.style.display = "none";
  }

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.Canvas = {
    bindCanvasPan,
    changeCanvasZoom,
    resetCanvasZoom,
    applyCanvasMode,
  };
})(window);
