(function attachFloorplanMoveBasket(global) {
  function addBasketItem(items, input) {
    const assignment = input.assignment;
    const lab = input.lab || {};
    const sourceSpace = input.sourceSpace || {};
    if (!assignment || !sourceSpace?.id) return items.slice();
    if (items.some((item) => item.assignmentId === assignment.id)) return items.slice();

    return [
      ...items,
      {
        id: `${assignment.id}__${Date.now()}__${Math.random().toString(16).slice(2)}`,
        assignmentId: assignment.id,
        planId: assignment.plan_id,
        labId: assignment.lab_id,
        labCode: assignment.lab_code,
        labName: lab.lab_name || assignment.lab_code || "未命名用途单元",
        college: lab.college || "",
        seatCount: lab.seat_count || "",
        computerCount: lab.computer_count || "",
        sourceSpaceId: sourceSpace.id,
        sourceSpaceCode: assignment.space_code || sourceSpace.space_code || "",
        sourceSpaceLabel: input.sourceSpaceLabel || sourceSpace.space_code || "",
        targetSpaceId: "",
        targetSpaceCode: "",
        targetSpaceLabel: "",
        color: input.color || "#64748b",
      },
    ];
  }

  function applyTemporaryUnbind(assignments, item, normalizeAssignment) {
    return assignments.map((row) => {
      if (row.id !== item.assignmentId) return row;
      return normalizeAssignment({
        ...row,
        previous_space_code: row.space_code || item.sourceSpaceCode || row.previous_space_code || "",
        space_code: "",
        assignment_status: "Invalid",
      });
    });
  }

  function restoreBasketItem(assignments, item, normalizeAssignment) {
    return assignments.map((row) => {
      if (row.id !== item.assignmentId) return row;
      return normalizeAssignment({
        ...row,
        previous_space_code: item.sourceSpaceCode || row.previous_space_code || row.space_code || "",
        space_code: item.sourceSpaceCode || row.previous_space_code || "",
        assignment_status: "assigned",
      });
    });
  }

  function applyBasketTargets(assignments, items, normalizeAssignment) {
    const byAssignmentId = new Map(items.map((item) => [item.assignmentId, item]));
    return assignments.map((row) => {
      const item = byAssignmentId.get(row.id);
      if (!item) return row;
      if (item.targetSpaceCode) {
        return normalizeAssignment({
          ...row,
          previous_space_code: item.sourceSpaceCode || row.previous_space_code || row.space_code || "",
          space_code: item.targetSpaceCode,
          assignment_status: "assigned",
        });
      }
      return normalizeAssignment({
        ...row,
        previous_space_code: item.sourceSpaceCode || row.previous_space_code || row.space_code || "",
        space_code: "",
        assignment_status: "Invalid",
      });
    });
  }

  function removeBasketItem(items, itemId) {
    return items.filter((item) => item.id !== itemId);
  }

  function updateBasketTarget(items, itemId, targetSpace) {
    return items.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        targetSpaceId: targetSpace?.id || "",
        targetSpaceCode: targetSpace?.space_code || "",
        targetSpaceLabel: targetSpace?.label || "",
      };
    });
  }

  function basketItemsFromUnplacedAssignments(assignments, options = {}) {
    const {
      planId = "",
      labsById = new Map(),
      existingItems = [],
      colorForCollege = () => "#64748b",
      sourceSpaceLabelForCode = (code) => code || "未落位",
    } = options;
    const existingAssignmentIds = new Set(existingItems.map((item) => item.assignmentId));
    return assignments
      .filter((row) => row.plan_id === planId)
      .filter((row) => row.assignment_status === "Invalid" && row.lab_id && !row.space_id && !row.space_code)
      .filter((row) => !existingAssignmentIds.has(row.id))
      .map((assignment) => {
        const lab = labsById.get(assignment.lab_id) || {};
        const sourceSpaceCode = assignment.previous_space_code || "";
        return {
          id: `${assignment.id}__saved-unplaced`,
          assignmentId: assignment.id,
          planId: assignment.plan_id,
          labId: assignment.lab_id,
          labCode: assignment.lab_code,
          labName: lab.lab_name || assignment.lab_code || "未命名用途单元",
          college: lab.college || "",
          seatCount: lab.seat_count || "",
          computerCount: lab.computer_count || "",
          sourceSpaceId: "",
          sourceSpaceCode,
          sourceSpaceLabel: sourceSpaceLabelForCode(sourceSpaceCode),
          targetSpaceId: "",
          targetSpaceCode: "",
          targetSpaceLabel: "",
          color: colorForCollege(lab.college || ""),
          isSavedUnplaced: true,
        };
      });
  }

  function canReturnBasketItem(item, spaces = [], assignments = []) {
    const sourceCode = item?.sourceSpaceCode || "";
    const space = spaces.find((row) => row.space_code === sourceCode || row.id === item?.sourceSpaceId) || null;
    if (!item || !sourceCode || !space) return { ok: false, reason: "找不到原空间。", space };
    if (space.current_status === "unavailable") return { ok: false, reason: "原空间不可用。", space };
    const occupied = assignments.some((row) =>
      row.plan_id === item.planId
      && row.assignment_status === "assigned"
      && row.id !== item.assignmentId
      && (row.space_code === sourceCode || (space.id && row.space_id === space.id))
    );
    if (occupied) return { ok: false, reason: "原空间已被其他实验室占用。", space };
    return { ok: true, reason: "", space };
  }

  function resolveBasketDrop(item, space, spaces = [], assignments = []) {
    if (!item || !space) return { ok: false, action: "", reason: "未找到投放目标。" };
    const isSource = Boolean(item.sourceSpaceCode && space.space_code === item.sourceSpaceCode)
      || Boolean(item.sourceSpaceId && space.id === item.sourceSpaceId);
    if (isSource) {
      const result = canReturnBasketItem(item, spaces, assignments);
      return { ok: result.ok, action: result.ok ? "return" : "", reason: result.reason };
    }
    if (space.current_status !== "active") return { ok: false, action: "", reason: "只能落位到可用空间。" };
    const occupied = assignments.some((row) =>
      row.plan_id === item.planId
      && row.assignment_status === "assigned"
      && row.id !== item.assignmentId
      && (row.space_code === space.space_code || (space.id && row.space_id === space.id))
    );
    if (occupied) return { ok: false, action: "", reason: "目标空间已有实验室占用。" };
    return { ok: true, action: "place", reason: "" };
  }

  const api = {
    addBasketItem,
    applyBasketTargets,
    applyTemporaryUnbind,
    basketItemsFromUnplacedAssignments,
    canReturnBasketItem,
    removeBasketItem,
    resolveBasketDrop,
    restoreBasketItem,
    updateBasketTarget,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.MoveBasket = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
