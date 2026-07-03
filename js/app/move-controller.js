(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FloorplanApp = root.FloorplanApp || {};
    root.FloorplanApp.MoveController = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createMoveController(deps) {
    const {
      state,
      els,
      MoveBasket,
      compare,
      colorMap,
      normalizeAssignment,
      relationMaps,
      normalizeDataset,
      cloneDataset,
      planById,
      copyMetaForPlan,
      spacesForPlan,
      canManageCopy,
      canEditActivePlan,
      getSelectedContext,
      moveTargetKey,
      buildMoveDraft,
      spaceDisplayName,
      syncSelectedSpace,
      renderEditor,
      renderApp,
      refreshStateAndRender,
      updateStatus,
      populateFloorOptions,
      saveAssignmentActionToServer,
    } = deps;

    function moveBasketNormalizeAssignment(row) {
      return normalizeAssignment(row, relationMaps(state.data));
    }

    function planSpacesForMove(plan) {
      return typeof spacesForPlan === "function" ? spacesForPlan(plan) : state.data.spaces;
    }

    function syncSavedUnplacedMoveBasketItems() {
      const activePlan = planById(state.activePlanId);
      if (!activePlan) return;
      const colors = colorMap(state.data);
      const labsById = new Map(state.data.labs.map((lab) => [lab.id, lab]));
      const planSpaces = planSpacesForMove(activePlan);
      const spacesByCode = new Map(planSpaces.map((space) => [space.space_code, space]));
      const activeAssignmentKeys = new Set(state.data.plan_assignments
        .filter((row) => row.plan_id === activePlan.id && row.assignment_status === "Invalid" && row.lab_id && !row.space_id && !row.space_code)
        .map((row) => MoveBasket.basketItemKey({
          planId: row.plan_id,
          planCode: row.plan_code,
          labId: row.lab_id,
          labCode: row.lab_code,
          assignmentId: row.id,
      })));
      const retainedItems = state.moveBasket.items
        .filter((item) => activeAssignmentKeys.has(MoveBasket.basketItemKey(item)))
        .map((item) => {
          const lab = labsById.get(item.labId) || {};
          return {
            ...item,
            labName: lab.lab_name || item.labName,
            labType: lab.lab_type || item.labType || "",
            college: lab.college || "",
            major: lab.major || "",
            director: lab.director || "",
            seatCount: lab.seat_count || "",
            computerCount: lab.computer_count || "",
            color: colors[lab.college || ""] || item.color || "#64748b",
          };
        });
      const savedItems = MoveBasket.basketItemsFromUnplacedAssignments(state.data.plan_assignments, {
        planId: activePlan.id,
        labsById,
        existingItems: retainedItems,
        colorForCollege: (college) => colors[college] || "#64748b",
        sourceSpaceLabelForCode: (code) => {
          const space = spacesByCode.get(code);
          return space ? spaceDisplayName(space) : (code || "已保存未落位");
        },
      });
      if (!savedItems.length && retainedItems.length === state.moveBasket.items.length) return;
      state.moveBasket = {
        ...state.moveBasket,
        items: [...retainedItems, ...savedItems],
      };
    }

    function targetSpaceOptionsForBasketItem(item) {
      if (!item?.planId) return [];
      const plan = planById(item.planId);
      const planSpaces = planSpacesForMove(plan);
      const reservedSpaceIds = new Set(state.moveBasket.items
        .filter((row) => row.id !== item.id && row.targetSpaceId)
        .map((row) => row.targetSpaceId));
      return planSpaces
        .filter((space) => MoveBasket.resolveBasketDrop(item, space, planSpaces, state.data.plan_assignments).ok)
        .filter((space) => !reservedSpaceIds.has(space.id))
        .slice()
        .sort((a, b) => compare(spaceDisplayName(a), spaceDisplayName(b)));
    }

    function canDropBasketItemOnSpace(item, space) {
      if (!item || !space) return false;
      return targetSpaceOptionsForBasketItem(item).some((row) => row.id === space.id);
    }

    function syncMoveDraft(force = false) {
      const context = getSelectedContext();
      const targetKey = moveTargetKey(context);
      if (state.detailsMode !== "move") {
        state.moveDirty = false;
        state.moveErrors = {};
        state.moveTargetKey = targetKey;
        if (!targetKey) state.moveDraft = null;
        return;
      }
      if (!targetKey) {
        state.detailsMode = "view";
        state.moveDraft = null;
        state.moveDirty = false;
        state.moveErrors = {};
        state.moveTargetKey = null;
        return;
      }
      if (force || !state.moveDirty || state.moveTargetKey !== targetKey || !state.moveDraft) {
        state.moveDraft = buildMoveDraft(context);
        state.moveDirty = false;
        state.moveErrors = {};
        state.moveTargetKey = targetKey;
      }
    }

    function openMoveMode() {
      if (!canEditActivePlan()) {
        updateStatus("请先选择自己创建的方案副本后再执行搬迁。");
        return;
      }
      const context = getSelectedContext();
      if (!context.assignment || !context.lab) {
        updateStatus("当前空间在此方案下没有已绑定实验室，无法直接搬迁。");
        return;
      }
      void addContextToMoveBasket(context);
    }

    async function addContextToMoveBasket(context) {
      if (!context.assignment || !context.lab || !context.space) return false;
      const contextKey = MoveBasket.basketItemKey({
        planId: context.assignment.plan_id,
        planCode: context.assignment.plan_code,
        labId: context.assignment.lab_id,
        labCode: context.assignment.lab_code,
        assignmentId: context.assignment.id,
      });
      if (state.moveBasket.items.some((item) => MoveBasket.basketItemKey(item) === contextKey)) {
        state.moveBasket.isOpen = true;
        state.inspectorMode = "placement";
        renderApp();
        updateStatus("该实验室已在待安置区中。");
        return false;
      }
      const colors = colorMap(state.data);
      const nextItems = MoveBasket.addBasketItem(state.moveBasket.items, {
        assignment: context.assignment,
        lab: context.lab,
        sourceSpace: context.space,
        sourceSpaceLabel: spaceDisplayName(context.space),
        color: colors[context.lab.college] || "#64748b",
      });
      const item = nextItems[nextItems.length - 1];
      const savedItem = { ...item, isSavedUnplaced: true };
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
      const previousBasket = JSON.parse(JSON.stringify(state.moveBasket));
      state.data.plan_assignments = MoveBasket.applyTemporaryUnbind(state.data.plan_assignments, item, moveBasketNormalizeAssignment);
      state.data = normalizeDataset(state.data);
      state.moveBasket = { ...state.moveBasket, items: [...state.moveBasket.items, savedItem], isOpen: true };
      state.detailsMode = "view";
      state.inspectorMode = "placement";
      syncSelectedSpace();
      renderEditor();
      renderApp();
      updateStatus(`正在将 ${context.lab.lab_name} 加入待安置区...`);
      try {
        await saveMoveBasketAssignmentsToServer("moveToBasket", assignmentPayloadFromContext(context));
      } catch (error) {
        state.data = normalizeDataset(previousData);
        state.serverRevision = previousRevision;
        state.planCopies = previousCopies;
        state.moveBasket = previousBasket;
        refreshStateAndRender(`加入待安置区失败：${error.message}`, { stamp: false, forceMoveReset: true });
        return false;
      }
      refreshStateAndRender(`已将 ${context.lab.lab_name} 加入待安置区，原空间已保存为未规划。`, { stamp: false, forceMoveReset: true });
      return true;
    }

    function toggleMoveBasket() {
      state.moveBasket.isOpen = !state.moveBasket.isOpen;
      renderApp();
    }

    function openMoveBasket() {
      if (!state.moveBasket.items.length || state.moveBasket.isOpen) return;
      state.moveBasket.isOpen = true;
      renderApp();
    }

    function closeMoveBasket() {
      if (!state.moveBasket.isOpen) return;
      state.moveBasket.isOpen = false;
      renderApp();
    }

    function assignmentPayloadFromItem(item, extras = {}) {
      return {
        lab: { id: item?.labId || "", lab_code: item?.labCode || "" },
        sourceSpace: { id: item?.sourceSpaceId || "", space_code: item?.sourceSpaceCode || "" },
        ...extras,
      };
    }

    function assignmentPayloadFromContext(context, extras = {}) {
      return {
        lab: { id: context?.lab?.id || context?.assignment?.lab_id || "", lab_code: context?.lab?.lab_code || context?.assignment?.lab_code || "" },
        sourceSpace: { id: context?.space?.id || context?.assignment?.space_id || "", space_code: context?.space?.space_code || context?.assignment?.space_code || "" },
        ...extras,
      };
    }

    async function saveMoveBasketAssignmentsToServer(action, payload = {}) {
      if (!state.serverMode) return true;
      const activePlan = planById(state.activePlanId);
      const copy = copyMetaForPlan(activePlan);
      if (typeof saveAssignmentActionToServer === "function" && action) {
        await saveAssignmentActionToServer(action, payload);
        return true;
      }
      if (canManageCopy(copy) || (state.permissions.canAdmin && activePlan && (activePlan.is_locked || activePlan.plan_type === "baseline"))) {
        throw new Error("缺少分配动作，无法保存待安置区安排");
      }
      throw new Error("只能保存自己创建的方案副本");
    }

    function locateMoveBasketSource(itemId) {
      const item = state.moveBasket.items.find((row) => row.id === itemId);
      const plan = item ? planById(item.planId) : null;
      const space = item ? planSpacesForMove(plan).find((row) => row.id === item.sourceSpaceId || row.space_code === item.sourceSpaceCode) : null;
      if (!space) return;
      els.buildingSelect.value = space.building_code;
      populateFloorOptions();
      els.floorSelect.value = space.floor_code;
      state.selectedSpaceId = space.id;
      state.zoom = 1;
      renderEditor();
      renderApp();
    }

    async function returnMoveBasketItemAction(itemId) {
      const item = state.moveBasket.items.find((row) => row.id === itemId);
      if (!item) return false;
      if (!canEditActivePlan()) {
        updateStatus("当前账号没有编辑此方案的权限。");
        return false;
      }
      const result = MoveBasket.canReturnBasketItem(item, planSpacesForMove(planById(item.planId)), state.data.plan_assignments);
      if (!result.ok) {
        updateStatus(`无法归位 ${item.labName}：${result.reason}`);
        return false;
      }
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
      const previousBasket = JSON.parse(JSON.stringify(state.moveBasket));
      state.data.plan_assignments = MoveBasket.restoreBasketItem(state.data.plan_assignments, item, moveBasketNormalizeAssignment);
      state.data = normalizeDataset(state.data);
      const itemKey = MoveBasket.basketItemKey(item);
      state.moveBasket = {
        ...state.moveBasket,
        items: MoveBasket.removeBasketItemsByKey(state.moveBasket.items, itemKey),
      };
      if (!state.moveBasket.items.length) state.moveBasket.isOpen = false;
      renderEditor();
      renderApp();
      updateStatus(`正在将 ${item.labName} 归位...`);
      try {
        await saveMoveBasketAssignmentsToServer("returnFromBasket", assignmentPayloadFromItem(item, {
          targetSpace: { space_code: item.sourceSpaceCode || "" },
        }));
      } catch (error) {
        state.data = normalizeDataset(previousData);
        state.serverRevision = previousRevision;
        state.planCopies = previousCopies;
        state.moveBasket = previousBasket;
        refreshStateAndRender(`归位失败：${error.message}`, { stamp: false, forceMoveReset: true });
        return false;
      }
      refreshStateAndRender(`已将 ${item.labName} 归位到 ${result.space ? spaceDisplayName(result.space) : item.sourceSpaceCode}。`, { stamp: false, forceMoveReset: true });
      return true;
    }

    function contextForSpace(spaceId) {
      const activePlan = planById(state.activePlanId);
      const space = planSpacesForMove(activePlan).find((row) => row.id === spaceId) || null;
      const assignment = activePlan && space
        ? state.data.plan_assignments.find((row) => row.plan_id === activePlan.id && row.space_id === space.id && row.assignment_status === "assigned") || null
        : null;
      const lab = assignment ? state.data.labs.find((row) => row.id === assignment.lab_id) || null : null;
      return { activePlan, space, assignment, lab };
    }

    function beginRoomMoveDrag(event, spaceId) {
      if (event.button !== 0 || !canEditActivePlan()) return;
      const context = contextForSpace(spaceId);
      if (!context.assignment || !context.lab) return;
      const contextKey = MoveBasket.basketItemKey({
        planId: context.assignment.plan_id,
        planCode: context.assignment.plan_code,
        labId: context.assignment.lab_id,
        labCode: context.assignment.lab_code,
        assignmentId: context.assignment.id,
      });
      if (state.moveBasket.items.some((item) => MoveBasket.basketItemKey(item) === contextKey)) return;
      beginPointerMoveDrag(event, {
        kind: "room",
        label: context.lab.lab_name || context.assignment.lab_code,
        color: colorMap(state.data)[context.lab.college] || "#64748b",
        context,
      });
    }

    function beginBasketItemDrag(event, itemId) {
      if (event.button !== 0 || !canEditActivePlan()) return;
      if (event.target.closest?.("button")) return;
      const item = state.moveBasket.items.find((row) => row.id === itemId);
      if (!item) return;
      beginPointerMoveDrag(event, {
        kind: "basket",
        label: item.labName,
        color: item.color,
        itemId,
      });
    }

    function beginPointerMoveDrag(event, drag) {
      event.preventDefault();
      state.moveDrag = {
        ...drag,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      window.addEventListener("pointermove", handleMoveDragPointerMove);
      window.addEventListener("pointerup", handleMoveDragPointerUp, { once: true });
      window.addEventListener("pointercancel", cancelMoveDrag, { once: true });
    }

    function handleMoveDragPointerMove(event) {
      const drag = state.moveDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.active && distance > 6) {
        drag.active = true;
        state.suppressNextSpaceClick = true;
        createMoveDragGhost(drag);
        if (drag.kind === "basket") markMoveDropTargets(drag.itemId);
        if (drag.kind === "room") markRoomDirectDropTargets(drag.context);
      }
      if (!drag.active) return;
      if (drag.kind === "room") maybeOpenPlacementInspectorForDrag(event);
      moveDragGhost(event.clientX, event.clientY);
    }

    function maybeOpenPlacementInspectorForDrag(event) {
      if (!els.roomDetails) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || !els.roomDetails.contains(target) || state.inspectorMode === "placement") return;
      state.inspectorMode = "placement";
      state.moveBasket.isOpen = true;
      renderApp();
    }

    function handleMoveDragPointerUp(event) {
      const drag = state.moveDrag;
      cleanupMoveDrag();
      if (!drag || event.pointerId !== drag.pointerId || !drag.active) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (drag.kind === "room") {
        const room = target?.closest(".room[data-space-id]");
        const space = room ? planSpacesForMove(drag.context?.activePlan).find((row) => row.id === room.dataset.spaceId) : null;
        if (space) {
          void setRoomDirectTarget(drag.context, space);
          return;
        }
        if (target?.closest("[data-move-basket-dropzone='true']") || (target && els.roomDetails.contains(target))) {
          void addContextToMoveBasket(drag.context);
        }
        return;
      }
      if (drag.kind === "basket") {
        const room = target?.closest(".room[data-space-id]");
        const item = state.moveBasket.items.find((row) => row.id === drag.itemId);
        const space = room ? planSpacesForMove(item ? planById(item.planId) : null).find((row) => row.id === room.dataset.spaceId) : null;
        if (space) void setMoveBasketTarget(drag.itemId, space);
      }
    }

    function cancelMoveDrag() {
      cleanupMoveDrag();
    }

    function createMoveDragGhost(drag) {
      const ghost = document.createElement("div");
      ghost.className = "move-drag-ghost";
      ghost.style.borderLeftColor = drag.color || "#64748b";
      ghost.textContent = drag.label || "搬迁实验室";
      document.body.appendChild(ghost);
      document.body.classList.add("is-moving-placement");
      state.moveDrag.ghost = ghost;
    }

    function moveDragGhost(x, y) {
      const ghost = state.moveDrag?.ghost;
      if (!ghost) return;
      ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    }

    function cleanupMoveDrag() {
      window.removeEventListener("pointermove", handleMoveDragPointerMove);
      document.querySelectorAll(".room.is-drop-candidate, .room.is-drop-return, .room.is-drop-blocked").forEach((node) => {
        node.classList.remove("is-drop-candidate", "is-drop-return", "is-drop-blocked");
      });
      state.moveDrag?.ghost?.remove();
      document.body.classList.remove("is-moving-placement");
      state.moveDrag = null;
    }

    function markMoveDropTargets(itemId) {
      const item = state.moveBasket.items.find((row) => row.id === itemId);
      const planSpaces = planSpacesForMove(item ? planById(item.planId) : null);
      const candidates = new Map(targetSpaceOptionsForBasketItem(item).map((space) => {
        const result = MoveBasket.resolveBasketDrop(item, space, planSpaces, state.data.plan_assignments);
        return [space.id, result.action];
      }));
      els.floorplan.querySelectorAll(".room[data-space-id]").forEach((node) => {
        const action = candidates.get(node.dataset.spaceId);
        if (action === "return") {
          node.classList.add("is-drop-return");
        } else {
          node.classList.add(action === "place" ? "is-drop-candidate" : "is-drop-blocked");
        }
      });
    }

    function buildMoveBasketItemFromContext(context) {
      const colors = colorMap(state.data);
      return MoveBasket.addBasketItem([], {
        assignment: context.assignment,
        lab: context.lab,
        sourceSpace: context.space,
        sourceSpaceLabel: spaceDisplayName(context.space),
        color: colors[context.lab?.college] || "#64748b",
      })[0] || null;
    }

    function markRoomDirectDropTargets(context) {
      const item = buildMoveBasketItemFromContext(context);
      if (!item) return;
      const planSpaces = planSpacesForMove(context.activePlan);
      els.floorplan.querySelectorAll(".room[data-space-id]").forEach((node) => {
        const space = planSpaces.find((row) => row.id === node.dataset.spaceId);
        const result = MoveBasket.resolveRoomDirectDrop(item, space, planSpaces, state.data.plan_assignments);
        if (result.action === "source") {
          node.classList.add("is-drop-return");
        } else {
          node.classList.add(result.ok && result.action === "place" ? "is-drop-candidate" : "is-drop-blocked");
        }
      });
    }

    async function setRoomDirectTarget(context, space) {
      const item = buildMoveBasketItemFromContext(context);
      const planSpaces = planSpacesForMove(context.activePlan);
      const drop = MoveBasket.resolveRoomDirectDrop(item, space, planSpaces, state.data.plan_assignments);
      if (!drop.ok) {
        updateStatus(drop.reason || "该空间不可作为当前实验室的安置目标。");
        return false;
      }
      if (drop.action === "source") {
        updateStatus(`${item.labName} 保持在原空间。`);
        return true;
      }
      const targetItem = {
        ...item,
        targetSpaceId: space.id,
        targetSpaceCode: space.space_code,
        targetSpaceLabel: spaceDisplayName(space),
      };
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
      state.data.plan_assignments = MoveBasket.applyBasketTargets(state.data.plan_assignments, [targetItem], moveBasketNormalizeAssignment);
      state.data = normalizeDataset(state.data);
      state.selectedSpaceId = space.id;
      state.detailsMode = "view";
      state.inspectorMode = "details";
      renderEditor();
      renderApp();
      updateStatus(`正在将 ${item.labName} 直接落位到 ${spaceDisplayName(space)}...`);
      try {
        await saveMoveBasketAssignmentsToServer("directMove", assignmentPayloadFromContext(context, {
          targetSpace: { id: space.id, space_code: space.space_code },
        }));
      } catch (error) {
        state.data = normalizeDataset(previousData);
        state.serverRevision = previousRevision;
        state.planCopies = previousCopies;
        refreshStateAndRender(`直接落位失败：${error.message}`, { stamp: false, forceMoveReset: true });
        return false;
      }
      refreshStateAndRender(`已将 ${item.labName} 直接落位到 ${spaceDisplayName(space)}。`, { stamp: false, forceMoveReset: true });
      return true;
    }

    async function setMoveBasketTarget(itemId, space) {
      const item = state.moveBasket.items.find((row) => row.id === itemId);
      const drop = MoveBasket.resolveBasketDrop(item, space, planSpacesForMove(item ? planById(item.planId) : null), state.data.plan_assignments);
      if (!drop.ok) {
        updateStatus(drop.reason || "该空间不可作为当前实验室的安置目标。");
        return false;
      }
      if (drop.action === "return") return returnMoveBasketItemAction(itemId);
      const targetItem = {
        ...item,
        targetSpaceId: space.id,
        targetSpaceCode: space.space_code,
        targetSpaceLabel: spaceDisplayName(space),
      };
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
      const previousBasket = JSON.parse(JSON.stringify(state.moveBasket));
      state.data.plan_assignments = MoveBasket.applyBasketTargets(state.data.plan_assignments, [targetItem], moveBasketNormalizeAssignment);
      state.data = normalizeDataset(state.data);
      const itemKey = MoveBasket.basketItemKey(item);
      state.moveBasket = {
        ...state.moveBasket,
        items: MoveBasket.removeBasketItemsByKey(state.moveBasket.items, itemKey),
      };
      if (!state.moveBasket.items.length) state.moveBasket.isOpen = false;
      state.selectedSpaceId = space.id;
      renderEditor();
      renderApp();
      updateStatus(`正在将 ${item.labName} 落位到 ${spaceDisplayName(space)}...`);
      try {
        await saveMoveBasketAssignmentsToServer("placeBasketItem", assignmentPayloadFromItem(item, {
          targetSpace: { id: space.id, space_code: space.space_code },
        }));
      } catch (error) {
        state.data = normalizeDataset(previousData);
        state.serverRevision = previousRevision;
        state.planCopies = previousCopies;
        state.moveBasket = previousBasket;
        refreshStateAndRender(`落位失败：${error.message}`, { stamp: false, forceMoveReset: true });
        return false;
      }
      refreshStateAndRender(`已将 ${item.labName} 落位到 ${spaceDisplayName(space)}。`, { stamp: false, forceMoveReset: true });
      return true;
    }


    return {
      moveBasketNormalizeAssignment,
      syncSavedUnplacedMoveBasketItems,
      targetSpaceOptionsForBasketItem,
      canDropBasketItemOnSpace,
      syncMoveDraft,
      openMoveMode,
      addContextToMoveBasket,
      toggleMoveBasket,
      openMoveBasket,
      closeMoveBasket,
      saveMoveBasketAssignmentsToServer,
      locateMoveBasketSource,
      returnMoveBasketItemAction,
      contextForSpace,
      beginRoomMoveDrag,
      beginBasketItemDrag,
      beginPointerMoveDrag,
      handleMoveDragPointerMove,
      maybeOpenPlacementInspectorForDrag,
      handleMoveDragPointerUp,
      cancelMoveDrag,
      createMoveDragGhost,
      moveDragGhost,
      cleanupMoveDrag,
      markMoveDropTargets,
      buildMoveBasketItemFromContext,
      markRoomDirectDropTargets,
      setRoomDirectTarget,
      setMoveBasketTarget,
    };
  }

  return {
    createMoveController,
  };
});
