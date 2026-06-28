(function attachFloorplanPlanDiff(global) {
  function buildPlanDiff(data, beforePlan, afterPlan, options = {}) {
    const compare = options.compare || defaultCompare;
    const spaceLabel = options.spaceDisplayName || defaultSpaceDisplayName;
    const beforeRows = assignedPlanRows(data, beforePlan);
    const afterRows = assignedPlanRows(data, afterPlan);
    const beforeByLab = beforeRows.byLab;
    const afterByLab = afterRows.byLab;
    const beforeBySpace = beforeRows.bySpace;
    const afterBySpace = afterRows.bySpace;
    const labCodes = [...new Set([...beforeByLab.keys(), ...afterByLab.keys()])].sort(compare);
    const spaceIds = [...new Set([...beforeBySpace.keys(), ...afterBySpace.keys()])].sort(compare);
    const beforeCollegeTotals = buildCollegeTotals(data, beforePlan);
    const afterCollegeTotals = buildCollegeTotals(data, afterPlan);
    const collegeSummary = new Map();
    const labChanges = [];
    const spaceChanges = [];

    for (const labCode of labCodes) {
      const before = beforeByLab.get(labCode) || null;
      const after = afterByLab.get(labCode) || null;
      const beforeText = before ? diffSpaceLabel(before.space, spaceLabel) : "未落位";
      const afterText = after ? diffSpaceLabel(after.space, spaceLabel) : "未落位";
      const areaDelta = (after?.space?.area_m2 || 0) - (before?.space?.area_m2 || 0);
      const type = diffLabChangeType(before, after);
      const labName = after?.lab?.lab_name || before?.lab?.lab_name || labCode;
      if (type === "无变化" && areaDelta === 0) continue;
      labChanges.push({ type, labName, beforeText, afterText, areaDelta });
      const college = after?.lab?.college || before?.lab?.college || "未设置学院";
      const summary = ensureCollegeSummary(collegeSummary, college);
      if (type === "新增落位") summary.added += 1;
      if (type === "取消落位") summary.removed += 1;
      if (type === "空间变更") summary.moved += 1;
      summary.areaDelta += areaDelta;
    }

    for (const spaceId of spaceIds) {
      const before = beforeBySpace.get(spaceId) || null;
      const after = afterBySpace.get(spaceId) || null;
      const beforeLab = before?.lab?.lab_name || "未规划";
      const afterLab = after?.lab?.lab_name || "未规划";
      if ((before?.lab?.lab_code || "") === (after?.lab?.lab_code || "")) continue;
      const space = after?.space || before?.space;
      const areaDelta = (after?.space?.area_m2 || 0) - (before?.space?.area_m2 || 0);
      const type = before && after ? "实验室变更" : (after ? "新增落位" : "取消落位");
      spaceChanges.push({ type, spaceText: diffSpaceLabel(space, spaceLabel), beforeLab, afterLab, areaDelta });
    }

    const collegeRows = [...new Set([...beforeCollegeTotals.keys(), ...afterCollegeTotals.keys(), ...collegeSummary.keys()])]
      .map((college) => {
        const before = beforeCollegeTotals.get(college) || { count: 0, area: 0 };
        const after = afterCollegeTotals.get(college) || { count: 0, area: 0 };
        const summary = ensureCollegeSummary(collegeSummary, college);
        return {
          ...summary,
          beforeCount: before.count,
          beforeArea: before.area,
          afterCount: after.count,
          afterArea: after.area,
          countDelta: after.count - before.count,
          areaDelta: after.area - before.area,
        };
      })
      .filter((row) => row.beforeCount || row.afterCount || row.countDelta || row.areaDelta)
      .sort((a, b) => compare(a.college, b.college));

    return {
      labChanges,
      spaceChanges,
      collegeRows,
      totalAreaDelta: labChanges.reduce((sum, row) => sum + row.areaDelta, 0),
    };
  }

  function buildCollegeTotals(data, plan) {
    const totals = new Map();
    for (const item of assignedPlanRows(data, plan).bySpace.values()) {
      const college = item.lab?.college || "未设置学院";
      const total = totals.get(college) || { count: 0, area: 0 };
      total.count += 1;
      total.area += Number(item.space?.area_m2 || 0);
      totals.set(college, total);
    }
    return totals;
  }

  function assignedPlanRows(data, plan) {
    const spacesById = new Map((data.spaces || []).map((row) => [row.id, row]));
    const labsByCode = new Map((data.labs || []).map((row) => [row.lab_code, row]));
    const byLab = new Map();
    const bySpace = new Map();
    for (const assignment of (data.plan_assignments || []).filter((row) => row.plan_id === plan?.id && row.assignment_status === "assigned")) {
      const lab = labsByCode.get(assignment.lab_code) || null;
      const space = spacesById.get(assignment.space_id) || null;
      if (!lab || !space) continue;
      const item = { assignment, lab, space };
      byLab.set(assignment.lab_code, item);
      bySpace.set(assignment.space_id, item);
    }
    return { byLab, bySpace };
  }

  function diffLabChangeType(before, after) {
    if (!before && after) return "新增落位";
    if (before && !after) return "取消落位";
    if (before?.space?.id !== after?.space?.id) return "空间变更";
    if ((before?.lab?.college || "") !== (after?.lab?.college || "") || (before?.lab?.lab_name || "") !== (after?.lab?.lab_name || "")) return "实验室信息变更";
    if ((before?.space?.area_m2 || 0) !== (after?.space?.area_m2 || 0)) return "面积变化";
    return "无变化";
  }

  function diffSpaceLabel(space, spaceLabel) {
    if (!space) return "未填写";
    return `${spaceLabel(space)} · ${space.space_code}`;
  }

  function ensureCollegeSummary(summary, college) {
    if (!summary.has(college)) {
      summary.set(college, { college, added: 0, removed: 0, moved: 0, areaDelta: 0 });
    }
    return summary.get(college);
  }

  function defaultSpaceDisplayName(space) {
    return space?.front_door || space?.space_code || "";
  }

  function defaultCompare(a, b) {
    return String(a).localeCompare(String(b), "zh-CN", { numeric: true });
  }

  const api = {
    assignedPlanRows,
    buildCollegeTotals,
    buildPlanDiff,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.PlanDiff = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
