(function attachFloorplanDetailActions(global) {
  function stringValue(value) {
    return String(value ?? "").trim();
  }

  function numberOrBlank(value) {
    const raw = stringValue(value);
    if (!raw) return "";
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : "";
  }

  function integerOrZero(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }

  function monthToEffectiveDate(monthValue, fallbackIso = "") {
    const raw = stringValue(monthValue);
    const fallback = stringValue(fallbackIso);
    const source = raw || fallback;
    const match = source.match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-01`;
    return "";
  }

  function effectiveDateToMonth(value, fallbackIso = "") {
    const source = stringValue(value) || stringValue(fallbackIso);
    const match = source.match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
    return "";
  }

  function formDataToDraft(formData) {
    if (!formData) return {};
    if (typeof formData.get === "function") {
      const draft = {};
      for (const [key, value] of formData.entries()) draft[key] = value;
      return draft;
    }
    return { ...formData };
  }

  function copyIdFromDeps(deps = {}) {
    return Number(deps.copyScope?.copy_id || deps.copyScope?.copyId || deps.copyId || 0);
  }

  function rowCopyId(row) {
    return Number(row?.copy_id || row?.copyId || 0);
  }

  function matchingRowIndex(rows, target, keys, deps = {}) {
    const copyId = copyIdFromDeps(deps);
    const matchesIdentity = (row) => keys.some((key) => {
      const value = String(target?.[key] || "").trim();
      return value && String(row?.[key] || "").trim() === value;
    });
    if (copyId) {
      const scopedIndex = (rows || []).findIndex((row) => rowCopyId(row) === copyId && matchesIdentity(row));
      if (scopedIndex >= 0) return scopedIndex;
      const baseIndex = (rows || []).findIndex((row) => !rowCopyId(row) && matchesIdentity(row));
      if (baseIndex >= 0) return baseIndex;
    }
    return (rows || []).findIndex(matchesIdentity);
  }

  function applyDetailLabEdit(dataset, context, rawDraft, deps = {}) {
    const draft = formDataToDraft(rawDraft);
    const labIndex = matchingRowIndex(dataset.labs || [], context.lab, ["id", "lab_code"], deps);
    if (labIndex < 0) return { ok: false, message: "未找到要编辑的实验室。" };
    const currentLab = dataset.labs[labIndex];
    const nextLab = {
      ...currentLab,
      lab_name: stringValue(draft.labName) || currentLab.lab_name,
      college: stringValue(draft.college),
      major: stringValue(draft.major),
      director: stringValue(draft.director),
      seat_count: integerOrZero(draft.seatCount),
      computer_count: integerOrZero(draft.computerCount),
    };
    dataset.labs[labIndex] = deps.normalizeLab ? deps.normalizeLab(nextLab) : nextLab;

    const assignmentId = context.assignment?.id;
    if (assignmentId) {
      dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
        if (row.id !== assignmentId) return row;
        const nextAssignment = {
          ...row,
          effective_from: monthToEffectiveDate(draft.renovationMonth, row.effective_from),
        };
        return deps.normalizeAssignment ? deps.normalizeAssignment(nextAssignment) : nextAssignment;
      });
    }
    return { ok: true };
  }

  function applyDetailRenovation(dataset, context, rawDraft, deps = {}) {
    const draft = formDataToDraft(rawDraft);
    const activePlan = context.activePlan;
    const space = context.space;
    if (!activePlan || !space) return { ok: false, message: "请选择当前方案和房间后再改建。" };
    const labCode = deps.generateUnitCode ? deps.generateUnitCode(dataset.labs || []) : `UNIT${String((dataset.labs || []).length + 1).padStart(6, "0")}`;
    const copyScope = deps.copyScope || {};
    const labName = stringValue(draft.labName) || "待改建房间";
    const nextLab = {
      ...copyScope,
      id: labCode,
      lab_code: labCode,
      lab_name: labName,
      college: stringValue(draft.college) || context.lab?.college || "未设置学院",
      major: stringValue(draft.major),
      lab_type: context.lab?.lab_type || "实验室",
      director: stringValue(draft.director),
      seat_count: integerOrZero(draft.seatCount),
      computer_count: integerOrZero(draft.computerCount),
      status: "active",
    };
    const normalizedLab = deps.normalizeLab ? deps.normalizeLab(nextLab) : nextLab;
    dataset.labs = [...(dataset.labs || []), normalizedLab];

    const invalidId = context.assignment?.id;
    dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
      if (!invalidId || row.id !== invalidId) return row;
      const invalidated = {
        ...row,
        previous_space_code: row.space_code || row.previous_space_code,
        space_code: "",
        space_id: "",
        assignment_status: "Invalid",
      };
      return deps.normalizeAssignment ? deps.normalizeAssignment(invalidated) : invalidated;
    });

    const nextAssignment = {
      ...copyScope,
      plan_code: activePlan.plan_code,
      plan_id: activePlan.id,
      lab_code: normalizedLab.lab_code,
      lab_id: normalizedLab.id,
      space_code: space.space_code,
      space_id: space.id,
      previous_space_code: "",
      assignment_status: "assigned",
      move_note: "",
      effective_from: monthToEffectiveDate(draft.renovationMonth, deps.isoNow?.() || ""),
      created_at: deps.isoNow?.() || "",
    };
    dataset.plan_assignments = [
      ...(dataset.plan_assignments || []).filter((row) =>
        !(row.plan_id === activePlan.id && row.space_id === space.id && row.assignment_status === "assigned")
      ),
      deps.normalizeAssignment ? deps.normalizeAssignment(nextAssignment) : nextAssignment,
    ];
    return { ok: true, lab: normalizedLab };
  }

  function applyDetailSpaceEdit(dataset, context, rawDraft, deps = {}) {
    const draft = formDataToDraft(rawDraft);
    const space = context.space;
    const spaceIndex = matchingRowIndex(dataset.spaces || [], space, ["id", "space_code"], deps);
    if (spaceIndex < 0) return { ok: false, message: "未找到要编辑的房间。" };
    if (space.length_m !== "" && space.length_m !== undefined && !stringValue(draft.lengthM)) {
      return { ok: false, message: "已有房间的长宽不能清空。" };
    }
    if (space.width_m !== "" && space.width_m !== undefined && !stringValue(draft.widthM)) {
      return { ok: false, message: "已有房间的长宽不能清空。" };
    }
    const lengthM = numberOrBlank(draft.lengthM);
    const widthM = numberOrBlank(draft.widthM);
    if (stringValue(draft.lengthM) && lengthM === "") return { ok: false, message: "房间长度必须是数字。" };
    if (stringValue(draft.widthM) && widthM === "") return { ok: false, message: "房间宽度必须是数字。" };
    const manualArea = numberOrBlank(draft.areaM2);
    const areaM2 = lengthM !== "" && widthM !== "" ? Number((lengthM * widthM).toFixed(2)) : manualArea;
    const oldCode = space.space_code;
    const nextSpace = {
      ...dataset.spaces[spaceIndex],
      front_door: stringValue(draft.frontDoor),
      rear_door: stringValue(draft.rearDoor),
      segment_code: stringValue(draft.segmentCode) || space.segment_code,
      side: stringValue(draft.side) || space.side,
      offset_m: numberOrBlank(draft.offsetM),
      length_m: lengthM,
      width_m: widthM,
      area_m2: areaM2 === "" ? 0 : areaM2,
      network_segment: stringValue(draft.networkSegment),
      current_status: stringValue(draft.currentStatus) || "active",
    };
    const nextCode = deps.generateSpaceCode ? deps.generateSpaceCode(nextSpace, context.building) : oldCode;
    if (!nextCode) return { ok: false, message: "前门牌不能为空，无法生成空间编码。" };
    nextSpace.space_code = nextCode;
    dataset.spaces[spaceIndex] = deps.normalizeSpace ? deps.normalizeSpace(nextSpace) : nextSpace;

    if (nextCode !== oldCode) {
      dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
        if (row.space_id !== space.id && row.space_code !== oldCode) return row;
        const migrated = { ...row, space_code: nextCode, space_id: space.id };
        return deps.normalizeAssignment ? deps.normalizeAssignment(migrated) : migrated;
      });
    }
    return { ok: true, space: dataset.spaces[spaceIndex], oldCode, nextCode };
  }

  function applyDetailCreateSpace(dataset, context, rawDraft, deps = {}) {
    const draft = formDataToDraft(rawDraft);
    const buildingCode = stringValue(context.buildingCode || context.building?.building_code);
    const floorCode = stringValue(context.floorCode);
    const segmentCode = stringValue(draft.segmentCode);
    if (!buildingCode || !floorCode) return { ok: false, message: "请先选择教学楼和楼层。" };
    if (!segmentCode) return { ok: false, message: "新增房间必须选择可绑定的走廊骨架。" };
    const segment = (dataset.floor_segments || []).find((row) =>
      row.building_code === buildingCode &&
      row.floor_code === floorCode &&
      row.segment_code === segmentCode
    );
    const assignable = deps.isAssignableSegment ? deps.isAssignableSegment(segment) : Boolean(segment && !["stairs", "elevator", "other"].includes(String(segment.element_type || "corridor")));
    if (!assignable) return { ok: false, message: "新增房间必须绑定到走廊骨架。" };
    const lengthM = numberOrBlank(draft.lengthM);
    const widthM = numberOrBlank(draft.widthM);
    if (stringValue(draft.lengthM) && lengthM === "") return { ok: false, message: "房间长度必须是数字。" };
    if (stringValue(draft.widthM) && widthM === "") return { ok: false, message: "房间宽度必须是数字。" };
    const manualArea = numberOrBlank(draft.areaM2);
    const areaM2 = lengthM !== "" && widthM !== "" ? Number((lengthM * widthM).toFixed(2)) : manualArea;
    const nextSpace = {
      ...(deps.copyScope || {}),
      building_code: buildingCode,
      floor_code: floorCode,
      segment_code: segmentCode,
      front_door: stringValue(draft.frontDoor),
      rear_door: stringValue(draft.rearDoor),
      side: stringValue(draft.side) || "south",
      offset_m: numberOrBlank(draft.offsetM) || 0,
      length_m: lengthM === "" ? 8 : lengthM,
      width_m: widthM === "" ? 6 : widthM,
      area_m2: areaM2 === "" ? 48 : areaM2,
      network_segment: stringValue(draft.networkSegment),
      current_status: stringValue(draft.currentStatus) || "active",
      created_at: deps.isoNow?.() || "",
    };
    const nextCode = deps.generateSpaceCode ? deps.generateSpaceCode(nextSpace, context.building) : "";
    if (!nextCode) return { ok: false, message: "前门牌不能为空，无法生成空间编码。" };
    const duplicate = (dataset.spaces || []).find((row) => row.space_code === nextCode);
    if (duplicate) return { ok: false, message: `空间编码 ${nextCode} 已存在，请检查门牌。` };
    nextSpace.space_code = nextCode;
    const normalized = deps.normalizeSpace ? deps.normalizeSpace(nextSpace) : nextSpace;
    dataset.spaces = [...(dataset.spaces || []), normalized];
    deps.clearDeletedSpaceRefs?.(dataset, normalized, [], deps.copyScope?.copy_id || null);
    return { ok: true, space: normalized };
  }

  function applyDetailDeleteSpace(dataset, context, deps = {}) {
    const activePlan = context.activePlan;
    const space = context.space;
    if (!activePlan || !space) return { ok: false, message: "请先选择要删除的房间。" };
    const spaceRefs = [space.id, space.space_code].filter(Boolean).map((value) => String(value));
    if (!spaceRefs.length) return { ok: false, message: "当前房间缺少可删除的稳定标识。" };
    const copyId = copyIdFromDeps(deps);
    const deletedRefs = copyId ? spaceRefs.map((ref) => `copy:${copyId}::${ref}`) : spaceRefs;
    dataset.deleted_space_ids = [...new Set([...(dataset.deleted_space_ids || []), ...deletedRefs])];
    const hasScopedSpace = copyId && (dataset.spaces || []).some((row) =>
      rowCopyId(row) === copyId &&
      (spaceRefs.includes(String(row.id || "")) || spaceRefs.includes(String(row.space_code || "")))
    );
    dataset.spaces = (dataset.spaces || []).filter((row) => {
      if (copyId) {
        const rowCopy = rowCopyId(row);
        if (rowCopy && rowCopy !== copyId) return true;
        if (!rowCopy && hasScopedSpace) return true;
      }
      return !spaceRefs.includes(String(row.id || "")) &&
        !spaceRefs.includes(String(row.space_code || ""));
    });
    dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
      if (
        row.plan_id !== activePlan.id &&
        row.plan_code !== activePlan.plan_code
      ) return row;
      if (!spaceRefs.includes(String(row.space_id || "")) && !spaceRefs.includes(String(row.space_code || ""))) return row;
      const invalidated = {
        ...row,
        previous_space_code: row.space_code || row.previous_space_code,
        space_code: "",
        space_id: "",
        assignment_status: "Invalid",
      };
      return deps.normalizeAssignment ? deps.normalizeAssignment(invalidated) : invalidated;
    });
    return { ok: true, space };
  }

  const api = {
    monthToEffectiveDate,
    effectiveDateToMonth,
    formDataToDraft,
    applyDetailLabEdit,
    applyDetailRenovation,
    applyDetailSpaceEdit,
    applyDetailCreateSpace,
    applyDetailDeleteSpace,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.DetailActions = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
