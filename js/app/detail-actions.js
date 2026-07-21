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

  function canDeleteSpaceForActivePlan(options) {
    const { serverMode, permissions = {}, activePlan = null, copy = null, canEditCopy = false } = options || {};
    if (!serverMode) return Boolean(permissions.canEdit);
    if (copy) return Boolean(canEditCopy && (!copy.isBaseline || permissions.canAdmin));
    return Boolean(permissions.canAdmin && activePlan);
  }

  function clearDeletedSpaceRefs(dataset, space, extraRefs = [], copyId = null) {
    if (!dataset || !Array.isArray(dataset.deleted_space_ids)) return;
    const baseRefs = [
      space?.id,
      space?.space_code,
      ...extraRefs,
    ].filter(Boolean).map((value) => String(value));
    const refs = new Set(baseRefs);
    if (copyId) {
      baseRefs.forEach((value) => refs.add(`copy:${copyId}::${value}`));
    }
    dataset.deleted_space_ids = dataset.deleted_space_ids.filter((value) => !refs.has(String(value)));
  }

  function applyDetailLabEdit(dataset, context, rawDraft, deps = {}) {
    const draft = formDataToDraft(rawDraft);
    const labIndex = matchingRowIndex(dataset.labs || [], context.lab, ["id", "lab_code"], deps);
    if (labIndex < 0) return { ok: false, message: "未找到要编辑的实验室。" };
    const currentLab = dataset.labs[labIndex];
    const nextLab = {
      ...currentLab,
      lab_name: stringValue(draft.labName) || currentLab.lab_name,
      lab_type: stringValue(draft.labType) || currentLab.lab_type,
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

  function sameMergeScope(a, b) {
    return stringValue(a?.building_code) === stringValue(b?.building_code) &&
      stringValue(a?.floor_code) === stringValue(b?.floor_code) &&
      stringValue(a?.segment_code) === stringValue(b?.segment_code) &&
      stringValue(a?.side) === stringValue(b?.side);
  }

  function effectiveSpace(dataset, space) {
    if (!space || !rowCopyId(space)) return space;
    const code = stringValue(space.space_code);
    const id = stringValue(space.id).replace(/^copy:\d+::/, "");
    const base = (dataset.spaces || []).find((row) =>
      !rowCopyId(row) &&
      ((code && stringValue(row.space_code) === code) || (id && stringValue(row.id) === id))
    );
    if (!base) return space;
    const merged = { ...base };
    for (const [key, value] of Object.entries(space)) {
      if (value === "" || value === null || value === undefined) continue;
      if (["length_m", "width_m", "area_m2"].includes(key) && Number(value) <= 0 && Number(base[key]) > 0) continue;
      merged[key] = value;
    }
    return merged;
  }

  function findSpaceByDraft(dataset, draft, currentSpace, deps = {}) {
    const targetRefs = new Set([
      draft.targetSpaceId,
      draft.targetSpaceCode,
      draft.targetSpace,
    ].filter(Boolean).map((value) => String(value).trim()));
    if (!targetRefs.size) return null;
    const copyId = copyIdFromDeps(deps);
    const matches = (dataset.spaces || []).filter((row) => {
      if (copyId && rowCopyId(row) && rowCopyId(row) !== copyId) return false;
      if (String(row.id || "") === String(currentSpace?.id || "")) return false;
      if (String(row.space_code || "") === String(currentSpace?.space_code || "")) return false;
      return targetRefs.has(String(row.id || "")) || targetRefs.has(String(row.space_code || ""));
    });
    return matches.find((row) => copyId && rowCopyId(row) === copyId) || matches[0] || null;
  }

  function targetSpaceRefsFromDraft(draft) {
    const rawList = Array.isArray(draft.targetSpaceCodes)
      ? draft.targetSpaceCodes
      : stringValue(draft.targetSpaceCodes).split(",");
    return [
      ...rawList,
      draft.targetSpaceId,
      draft.targetSpaceCode,
      draft.targetSpace,
    ].filter(Boolean).map((value) => String(value).trim()).filter(Boolean);
  }

  function findSpacesByRefs(dataset, refs, currentSpace, deps = {}) {
    const targetRefs = new Set(refs);
    if (!targetRefs.size) return [];
    const copyId = copyIdFromDeps(deps);
    const byKey = new Map();
    for (const row of dataset.spaces || []) {
      if (copyId && rowCopyId(row) && rowCopyId(row) !== copyId) continue;
      if (String(row.id || "") === String(currentSpace?.id || "")) continue;
      if (String(row.space_code || "") === String(currentSpace?.space_code || "")) continue;
      if (!targetRefs.has(String(row.id || "")) && !targetRefs.has(String(row.space_code || ""))) continue;
      const key = String(row.space_code || row.id || "");
      if (!byKey.has(key) || (copyId && rowCopyId(row) === copyId)) byKey.set(key, row);
    }
    return [...byKey.values()];
  }

  function assignmentPlanRefs(activePlan) {
    return new Set([activePlan?.id, activePlan?.plan_code].filter(Boolean).map((value) => String(value)));
  }

  function assignmentsForSpaces(dataset, activePlan, spaces) {
    const planRefs = assignmentPlanRefs(activePlan);
    const spaceRefs = new Set(spaces.flatMap((space) => [space?.id, space?.space_code]).filter(Boolean).map((value) => String(value)));
    return (dataset.plan_assignments || []).filter((row) => {
      const rowPlan = String(row.plan_id || row.plan_code || "");
      if (!planRefs.has(rowPlan)) return false;
      if (row.assignment_status !== "assigned") return false;
      return spaceRefs.has(String(row.space_id || "")) || spaceRefs.has(String(row.space_code || ""));
    });
  }

  function mergeSortValue(space) {
    const offset = Number(space?.offset_m);
    if (Number.isFinite(offset)) return { offset, label: stringValue(space.front_door || space.space_code) };
    return { offset: Number.POSITIVE_INFINITY, label: stringValue(space?.front_door || space?.space_code || space?.id) };
  }

  function sortedMergeScopeSpaces(dataset, currentSpace, deps = {}) {
    const copyId = copyIdFromDeps(deps);
    const byKey = new Map();
    for (const row of dataset.spaces || []) {
      if (copyId && rowCopyId(row) && rowCopyId(row) !== copyId) continue;
      const effective = effectiveSpace(dataset, row);
      if (!sameMergeScope(currentSpace, effective)) continue;
      if (String(effective.current_status || "active") !== "active") continue;
      const key = stringValue(effective.space_code || row.space_code || effective.id || row.id);
      if (!key) continue;
      if (!byKey.has(key) || (copyId && rowCopyId(row) === copyId)) byKey.set(key, effective);
    }
    return [...byKey.values()].sort((a, b) => {
      const aSort = mergeSortValue(a);
      const bSort = mergeSortValue(b);
      return aSort.offset - bSort.offset || aSort.label.localeCompare(bSort.label, "zh-CN", { numeric: true });
    });
  }

  function validateMergeSelectionContinuity(dataset, currentSpace, selectedSpaces, deps = {}) {
    const sorted = sortedMergeScopeSpaces(dataset, currentSpace, deps);
    const selectedRefs = new Set(selectedSpaces.flatMap((space) => [space?.id, space?.space_code]).filter(Boolean).map((value) => String(value)));
    const selectedIndexes = sorted
      .map((space, index) => selectedRefs.has(String(space.id || "")) || selectedRefs.has(String(space.space_code || "")) ? index : -1)
      .filter((index) => index >= 0);
    if (selectedIndexes.length !== selectedSpaces.length) return { ok: false, message: "未找到完整的合并房间范围。" };
    const first = Math.min(...selectedIndexes);
    const last = Math.max(...selectedIndexes);
    const missing = sorted.slice(first, last + 1).filter((space) =>
      !selectedRefs.has(String(space.id || "")) && !selectedRefs.has(String(space.space_code || ""))
    );
    if (!missing.length) return { ok: true };
    const labels = missing.map((space) => stringValue(space.front_door || space.space_code)).filter(Boolean);
    return { ok: false, message: `请把中间房间${labels.length ? `（${labels.join("、")}）` : ""}一起选中后再合并。` };
  }

  function labForAssignment(dataset, assignment) {
    if (!assignment) return null;
    return (dataset.labs || []).find((lab) =>
      (assignment.lab_id && String(lab.id || "") === String(assignment.lab_id)) ||
      (assignment.lab_code && String(lab.lab_code || "") === String(assignment.lab_code))
    ) || null;
  }

  function nextUnitCode(dataset, deps) {
    return deps.generateUnitCode
      ? deps.generateUnitCode(dataset.labs || [])
      : `UNIT${String((dataset.labs || []).length + 1).padStart(6, "0")}`;
  }

  function createScopedLab(dataset, sourceLab, draft, deps, fallbackName) {
    const labCode = nextUnitCode(dataset, deps);
    const nextLab = {
      ...(deps.copyScope || {}),
      id: labCode,
      lab_code: labCode,
      lab_name: stringValue(draft.labName) || fallbackName || sourceLab?.lab_name || "新用途单元",
      college: stringValue(draft.college) || sourceLab?.college || "未设置学院",
      major: stringValue(draft.major) || sourceLab?.major || "",
      lab_type: stringValue(draft.labType) || sourceLab?.lab_type || "实验室",
      director: stringValue(draft.director) || "",
      seat_count: integerOrZero(draft.seatCount ?? sourceLab?.seat_count),
      computer_count: integerOrZero(draft.computerCount ?? sourceLab?.computer_count),
      status: "active",
      created_at: deps.isoNow?.() || "",
    };
    const normalized = deps.normalizeLab ? deps.normalizeLab(nextLab) : nextLab;
    dataset.labs = [...(dataset.labs || []), normalized];
    return normalized;
  }

  function createAssignedAssignment(dataset, activePlan, lab, space, deps = {}) {
    const nextAssignment = {
      ...(deps.copyScope || {}),
      id: `${activePlan.plan_code || activePlan.id}__${lab.lab_code}`,
      plan_code: activePlan.plan_code,
      plan_id: activePlan.id,
      lab_code: lab.lab_code,
      lab_id: lab.id,
      space_code: space.space_code,
      space_id: space.id,
      previous_space_code: "",
      assignment_status: "assigned",
      move_note: "",
      effective_from: "",
      created_at: deps.isoNow?.() || "",
    };
    return deps.normalizeAssignment ? deps.normalizeAssignment(nextAssignment) : nextAssignment;
  }

  function spanLength(a, b) {
    const aOffset = Number(a?.offset_m);
    const bOffset = Number(b?.offset_m);
    const aLength = Number(a?.length_m);
    const bLength = Number(b?.length_m);
    if (![aOffset, bOffset, aLength, bLength].every(Number.isFinite)) {
      return Number(a?.length_m) + Number(b?.length_m);
    }
    const start = Math.min(aOffset, bOffset);
    const end = Math.max(aOffset + aLength, bOffset + bLength);
    return Number((end - start).toFixed(2));
  }

  function invalidateAssignmentsForSpace(dataset, activePlan, space, deps = {}) {
    const activePlanRefs = new Set([activePlan?.id, activePlan?.plan_code].filter(Boolean).map((value) => String(value)));
    const refs = new Set([space?.id, space?.space_code].filter(Boolean).map((value) => String(value)));
    dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
      const rowPlan = String(row.plan_id || row.plan_code || "");
      if (!activePlanRefs.has(rowPlan)) return row;
      if (!refs.has(String(row.space_id || "")) && !refs.has(String(row.space_code || ""))) return row;
      const invalidated = {
        ...row,
        previous_space_code: row.space_code || row.previous_space_code,
        space_code: "",
        space_id: "",
        assignment_status: "Invalid",
      };
      return deps.normalizeAssignment ? deps.normalizeAssignment(invalidated) : invalidated;
    });
  }

  function removeSpaceForCurrentScope(dataset, space, deps = {}) {
    const copyId = copyIdFromDeps(deps);
    const refs = [space?.id, space?.space_code].filter(Boolean).map((value) => String(value));
    if (copyId) {
      const deletedRefs = refs.map((ref) => `copy:${copyId}::${ref}`);
      dataset.deleted_space_ids = [...new Set([...(dataset.deleted_space_ids || []), ...deletedRefs])];
    }
    const hasScopedSpace = copyId && (dataset.spaces || []).some((row) =>
      rowCopyId(row) === copyId &&
      (refs.includes(String(row.id || "")) || refs.includes(String(row.space_code || "")))
    );
    dataset.spaces = (dataset.spaces || []).filter((row) => {
      if (copyId) {
        const rowCopy = rowCopyId(row);
        if (rowCopy && rowCopy !== copyId) return true;
        if (!rowCopy && hasScopedSpace) return true;
      }
      return !refs.includes(String(row.id || "")) && !refs.includes(String(row.space_code || ""));
    });
  }

  function applyDetailMergeSpace(dataset, context, rawDraft, deps = {}) {
    const draft = formDataToDraft(rawDraft);
    const activePlan = context.activePlan;
    const space = context.space;
    if (!activePlan || !space) return { ok: false, message: "请先选择要合并的房间。" };
    const targetRefs = targetSpaceRefsFromDraft(draft);
    const targetSpaces = targetRefs.length
      ? findSpacesByRefs(dataset, targetRefs, space, deps)
      : [findSpaceByDraft(dataset, draft, space, deps)].filter(Boolean);
    if (!targetSpaces.length) return { ok: false, message: "请选择要合并的目标房间。" };
    const currentEffective = effectiveSpace(dataset, space);
    const effectiveTargets = targetSpaces.map((target) => effectiveSpace(dataset, target));
    const allEffectiveSpaces = [currentEffective, ...effectiveTargets];
    if (allEffectiveSpaces.some((item) => String(item.current_status || "active") !== "active")) {
      return { ok: false, message: "只能合并可用状态的房间。" };
    }
    if (effectiveTargets.some((target) => !sameMergeScope(currentEffective, target))) {
      return { ok: false, message: "只能合并同一楼栋、楼层、走廊和侧向的房间。" };
    }
    const continuity = validateMergeSelectionContinuity(dataset, currentEffective, allEffectiveSpaces, deps);
    if (!continuity.ok) return continuity;
    const spaceIndex = matchingRowIndex(dataset.spaces || [], space, ["id", "space_code"], deps);
    if (spaceIndex < 0) return { ok: false, message: "未找到要合并的当前房间。" };
    const currentStored = dataset.spaces[spaceIndex];
    const starts = allEffectiveSpaces.map((item) => Number(item.offset_m)).filter(Number.isFinite);
    const ends = allEffectiveSpaces.map((item) => Number(item.offset_m) + Number(item.length_m)).filter(Number.isFinite);
    const lengthM = starts.length === allEffectiveSpaces.length && ends.length === allEffectiveSpaces.length
      ? Number((Math.max(...ends) - Math.min(...starts)).toFixed(2))
      : allEffectiveSpaces.slice(1).reduce((length, target) => spanLength({ offset_m: 0, length_m: length }, { offset_m: length, length_m: target.length_m }), Number(currentEffective.length_m) || 0);
    const widthM = Math.max(...allEffectiveSpaces.map((item) => Number(item.width_m) || 0));
    const areaM2 = Number.isFinite(lengthM) && widthM
      ? Number((lengthM * widthM).toFixed(2))
      : Number(allEffectiveSpaces.reduce((sum, item) => sum + Number(item.area_m2 || 0), 0).toFixed(2));
    const doorValues = allEffectiveSpaces.flatMap((item) => [stringValue(item.front_door), stringValue(item.rear_door)]).filter(Boolean);
    const frontDoor = stringValue(draft.frontDoor) || doorValues.slice().sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))[0] || currentEffective.front_door;
    const rearDoor = stringValue(draft.rearDoor) || doorValues.slice().sort((a, b) => Number(b) - Number(a) || b.localeCompare(a))[0] || currentEffective.rear_door;
    const merged = {
      ...currentEffective,
      ...currentStored,
      front_door: frontDoor,
      rear_door: rearDoor,
      offset_m: starts.length ? Math.min(...starts) : currentEffective.offset_m,
      length_m: lengthM,
      width_m: widthM || currentEffective.width_m,
      area_m2: areaM2,
      network_segment: allEffectiveSpaces.every((item) => stringValue(item.network_segment) === stringValue(currentEffective.network_segment))
        ? currentEffective.network_segment
        : currentEffective.network_segment || "",
    };
    const nextCode = deps.generateSpaceCode ? deps.generateSpaceCode(merged, context.building) : stringValue(draft.spaceCode) || merged.space_code;
    if (!nextCode) return { ok: false, message: "合并后前门牌不能为空，无法生成空间编码。" };
    const oldCurrentCode = currentStored.space_code;
    merged.space_code = nextCode;
    dataset.spaces[spaceIndex] = deps.normalizeSpace ? deps.normalizeSpace(merged) : merged;
    const mergedStored = dataset.spaces[spaceIndex];
    const assignmentSpaces = [space, ...targetSpaces];
    const oldAssignments = assignmentsForSpaces(dataset, activePlan, assignmentSpaces);
    for (const targetSpace of targetSpaces) {
      invalidateAssignmentsForSpace(dataset, activePlan, targetSpace, deps);
      removeSpaceForCurrentScope(dataset, targetSpace, deps);
    }
    invalidateAssignmentsForSpace(dataset, activePlan, space, deps);
    const sourceLab = labForAssignment(dataset, oldAssignments.find((row) => row.space_code === oldCurrentCode) || oldAssignments[0]) || context.lab;
    const nextLab = createScopedLab(dataset, sourceLab, draft, deps, stringValue(draft.labName) || `${sourceLab?.lab_name || "合并用途"}（合并）`);
    dataset.plan_assignments = [
      ...(dataset.plan_assignments || []),
      createAssignedAssignment(dataset, activePlan, nextLab, mergedStored, deps),
    ];
    return { ok: true, space: mergedStored, mergedSpaces: targetSpaces, lab: nextLab };
  }

  function applyDetailSplitSpace(dataset, context, rawDraft, deps = {}) {
    const draft = formDataToDraft(rawDraft);
    const activePlan = context.activePlan;
    const space = context.space;
    if (!activePlan || !space) return { ok: false, message: "请先选择要拆分的房间。" };
    const splitAxis = stringValue(draft.splitAxis) || "length";
    if (splitAxis !== "length") {
      return { ok: false, message: "当前版本仅支持沿走廊方向拆分。" };
    }
    const currentEffective = effectiveSpace(dataset, space);
    const originalLength = Number(currentEffective.length_m);
    const explicitCount = Number(draft.splitCount);
    const splitCount = Number.isFinite(explicitCount) && explicitCount > 0 ? Math.trunc(explicitCount) : 2;
    if (splitCount < 2 || splitCount > 10) return { ok: false, message: "拆分房间数必须在 2 到 10 之间。" };
    const legacyDraft = !stringValue(draft.splitFrontDoor0) && !stringValue(draft.splitFrontDoor1);
    const parts = [];
    if (legacyDraft) {
      const firstLength = numberOrBlank(draft.firstLengthM);
      const secondFrontDoor = stringValue(draft.secondFrontDoor);
      if (firstLength === "" || !Number.isFinite(originalLength) || firstLength <= 0 || firstLength >= originalLength) {
        return { ok: false, message: "拆分后第一房间长度必须大于 0 且小于原房间长度。" };
      }
      if (!secondFrontDoor) return { ok: false, message: "拆分后第二房间前门牌不能为空。" };
      parts.push(
        { frontDoor: stringValue(currentEffective.front_door), rearDoor: stringValue(currentEffective.rear_door), lengthM: firstLength },
        { frontDoor: secondFrontDoor, rearDoor: stringValue(draft.secondRearDoor), lengthM: Number((originalLength - firstLength).toFixed(2)) }
      );
    } else {
      for (let index = 0; index < splitCount; index += 1) {
        const frontDoor = stringValue(draft[`splitFrontDoor${index}`]);
        const rearDoor = stringValue(draft[`splitRearDoor${index}`]);
        const lengthM = numberOrBlank(draft[`splitLengthM${index}`]);
        if (!frontDoor) return { ok: false, message: `第 ${index + 1} 个房间前门牌不能为空。` };
        if (lengthM === "" || lengthM <= 0) return { ok: false, message: `第 ${index + 1} 个房间长度必须大于 0。` };
        parts.push({ frontDoor, rearDoor, lengthM });
      }
      const totalLength = Number(parts.reduce((sum, part) => sum + Number(part.lengthM || 0), 0).toFixed(2));
      if (!Number.isFinite(originalLength) || Math.abs(totalLength - originalLength) > 0.01) {
        return { ok: false, message: "拆分后房间长度合计必须等于原房间长度。" };
      }
    }
    const spaceIndex = matchingRowIndex(dataset.spaces || [], space, ["id", "space_code"], deps);
    if (spaceIndex < 0) return { ok: false, message: "未找到要拆分的当前房间。" };
    const original = { ...currentEffective, ...dataset.spaces[spaceIndex] };
    const width = Number(original.width_m) || 0;
    const copyId = copyIdFromDeps(deps);
    const nextSpaces = [];
    let nextOffset = Number(original.offset_m || 0);
    const generatedCodes = new Set();
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const lengthM = Number(part.lengthM);
      const nextSpace = {
        ...(index === 0 ? original : (deps.copyScope || {})),
        id: index === 0 ? original.id : `${stringValue(original.id || original.space_code)}__split_${part.frontDoor}`,
        building_code: original.building_code,
        floor_code: original.floor_code,
        segment_code: original.segment_code,
        front_door: part.frontDoor,
        rear_door: part.rearDoor,
        side: original.side,
        offset_m: Number(nextOffset.toFixed(2)),
        length_m: lengthM,
        width_m: original.width_m,
        area_m2: width ? Number((lengthM * width).toFixed(2)) : 0,
        network_segment: original.network_segment || "",
        current_status: "active",
        created_at: index === 0 ? original.created_at : deps.isoNow?.() || "",
      };
      const nextCode = deps.generateSpaceCode ? deps.generateSpaceCode(nextSpace, context.building) : (index === 0 ? original.space_code : stringValue(draft[`splitSpaceCode${index}`]));
      if (!nextCode) return { ok: false, message: `第 ${index + 1} 个房间门牌不能为空，无法生成空间编码。` };
      if (generatedCodes.has(nextCode)) return { ok: false, message: `空间编码 ${nextCode} 重复，请检查门牌。` };
      const duplicate = (dataset.spaces || []).find((row) => {
        if (String(row.id || "") === String(original.id || "")) return false;
        if (index === 0 && String(row.space_code || "") === String(original.space_code || "")) return false;
        if (copyId && rowCopyId(row) && rowCopyId(row) !== copyId) return false;
        return String(row.space_code || "") === nextCode;
      });
      if (duplicate) return { ok: false, message: `空间编码 ${nextCode} 已存在，请检查门牌。` };
      generatedCodes.add(nextCode);
      nextSpace.space_code = nextCode;
      nextSpaces.push(nextSpace);
      nextOffset += lengthM;
    }
    const oldAssignment = assignmentsForSpaces(dataset, activePlan, [space])[0] || context.assignment || null;
    const sourceLab = labForAssignment(dataset, oldAssignment) || context.lab || null;
    dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
      if (!oldAssignment || row.id !== oldAssignment.id) return row;
      const invalidated = {
        ...row,
        previous_space_code: row.space_code || row.previous_space_code,
        assignment_status: "Invalid",
      };
      return deps.normalizeAssignment ? deps.normalizeAssignment(invalidated) : invalidated;
    });
    const normalizedSpaces = nextSpaces.map((item) => deps.normalizeSpace ? deps.normalizeSpace(item) : item);
    dataset.spaces[spaceIndex] = normalizedSpaces[0];
    dataset.spaces = [...(dataset.spaces || []), ...normalizedSpaces.slice(1)];
    const createdLabs = normalizedSpaces.map((nextSpace, index) => {
      const partName = stringValue(draft[`splitLabName${index}`]) || `${sourceLab?.lab_name || "拆分用途"}${partNameDoorSuffix(nextSpace)}`;
      const lab = createScopedLab(dataset, sourceLab, { labName: partName }, deps, partName);
      dataset.plan_assignments = [
        ...(dataset.plan_assignments || []),
        createAssignedAssignment(dataset, activePlan, lab, nextSpace, deps),
      ];
      return lab;
    });
    for (const createdSpace of normalizedSpaces.slice(1)) {
      deps.clearDeletedSpaceRefs?.(dataset, createdSpace, [], copyId || null);
    }
    return { ok: true, space: dataset.spaces[spaceIndex], createdSpaces: normalizedSpaces.slice(1), labs: createdLabs };
  }

  function partNameDoorSuffix(space) {
    const door = stringValue(space?.front_door);
    return door ? ` ${door}` : "";
  }

  const api = {
    monthToEffectiveDate,
    effectiveDateToMonth,
    formDataToDraft,
    canDeleteSpaceForActivePlan,
    clearDeletedSpaceRefs,
    applyDetailLabEdit,
    applyDetailRenovation,
    applyDetailSpaceEdit,
    applyDetailCreateSpace,
    applyDetailDeleteSpace,
    applyDetailMergeSpace,
    applyDetailSplitSpace,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.DetailActions = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
