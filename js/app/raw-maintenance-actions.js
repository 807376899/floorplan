(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FloorplanApp = root.FloorplanApp || {};
    root.FloorplanApp.RawMaintenanceActions = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const RAW_MAINTENANCE_KEYS = new Set(["buildings", "floor_segments", "colleges", "majors", "lab_types"]);

  function text(value) {
    return String(value ?? "").trim();
  }

  function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function booleanValue(value) {
    return value === true || value === 1 || ["true", "1", "yes", "y", "是"].includes(text(value).toLowerCase());
  }

  function compare(a, b) {
    return String(a ?? "").localeCompare(String(b ?? ""), "zh-CN", { numeric: true });
  }

  function normalizeBuilding(row = {}) {
    const code = text(row.building_code || row.id);
    return {
      id: text(row.id) || code,
      building_code: code,
      building_name: text(row.building_name) || code,
      campus_zone: text(row.campus_zone),
      building_number: numberValue(row.building_number, 0),
      sort_order: numberValue(row.sort_order, 0),
      notes: text(row.notes),
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
    };
  }

  function normalizeSegment(row = {}) {
    const buildingCode = text(row.building_code);
    const floorCode = text(row.floor_code);
    const segmentCode = text(row.segment_code || row.floor_segment_code || row.id);
    return {
      id: text(row.id) || `${buildingCode}__${floorCode}__${segmentCode}`,
      building_code: buildingCode,
      floor_code: floorCode,
      segment_code: segmentCode,
      start_x_m: numberValue(row.start_x_m, 0),
      start_y_m: numberValue(row.start_y_m, 0),
      end_x_m: numberValue(row.end_x_m, 0),
      end_y_m: numberValue(row.end_y_m, 0),
      width_m: numberValue(row.width_m, 0),
      element_type: text(row.element_type) || "corridor",
      notes: text(row.notes),
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
    };
  }

  function normalizeCollege(row = {}) {
    const code = text(row.college_code || row.id || row.college_name);
    return {
      id: text(row.id) || code,
      college_code: code,
      college_name: text(row.college_name) || code,
      color: text(row.color),
      sort_order: numberValue(row.sort_order, 0),
      status: text(row.status) || "active",
      notes: text(row.notes),
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
    };
  }

  function normalizeMajor(row = {}) {
    const code = text(row.major_code || row.id || row.major_name);
    return {
      id: text(row.id) || code,
      major_code: code,
      major_name: text(row.major_name) || code,
      college_code: text(row.college_code),
      sort_order: numberValue(row.sort_order, 0),
      status: text(row.status) || "active",
      notes: text(row.notes),
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
    };
  }

  function normalizeLabType(row = {}) {
    const code = text(row.type_code || row.id || row.type_name);
    return {
      id: text(row.id) || code,
      type_code: code,
      type_name: text(row.type_name) || code,
      sort_order: numberValue(row.sort_order, 0),
      status: text(row.status) || "active",
      notes: text(row.notes),
      created_at: text(row.created_at),
      updated_at: text(row.updated_at),
    };
  }

  function normalizeRows(key, rows) {
    if (key === "buildings") return (rows || []).map(normalizeBuilding);
    if (key === "floor_segments") return (rows || []).map(normalizeSegment);
    if (key === "colleges") return (rows || []).map(normalizeCollege);
    if (key === "majors") return (rows || []).map(normalizeMajor);
    if (key === "lab_types") return (rows || []).map(normalizeLabType);
    return [];
  }

  function segmentKey(row) {
    return [row?.building_code, row?.floor_code, row?.segment_code].map(text).join("__");
  }

  function isAssignableSegment(segment) {
    return text(segment?.element_type || "corridor").toLowerCase() === "corridor";
  }

  function segmentTypeLabel(type) {
    const value = text(type).toLowerCase();
    if (value === "stairs") return "楼梯";
    if (value === "elevator") return "电梯";
    if (value === "corridor") return "走廊";
    return "非走廊结构";
  }

  function spaceMatchesSegment(space, segment) {
    return text(space.building_code) === text(segment.building_code)
      && text(space.floor_code) === text(segment.floor_code)
      && text(space.segment_code) === text(segment.segment_code);
  }

  function validateUnique(rows, keyField, label) {
    const seen = new Set();
    for (const row of rows) {
      const code = text(row[keyField]);
      if (!code) return `${label}不能为空。`;
      if (seen.has(code)) return `${label}“${code}”重复，请修改后再保存。`;
      seen.add(code);
    }
    return "";
  }

  function invalidateAssignmentsForSpaces(dataset, spaceRefs) {
    const ids = new Set((spaceRefs || []).map((space) => text(space.id)).filter(Boolean));
    const codes = new Set((spaceRefs || []).map((space) => text(space.space_code)).filter(Boolean));
    dataset.plan_assignments = (dataset.plan_assignments || []).map((row) => {
      if (!ids.has(text(row.space_id)) && !codes.has(text(row.space_code))) return row;
      return {
        ...row,
        previous_space_code: text(row.space_code) || text(row.previous_space_code),
        previous_space_id: text(row.space_id) || text(row.previous_space_id),
        space_code: "",
        space_id: "",
        assignment_status: "Invalid",
      };
    });
  }

  function applyBuildingRows(dataset, rows) {
    const normalizedRows = normalizeRows("buildings", rows);
    const duplicate = validateUnique(normalizedRows, "building_code", "教学楼编码");
    if (duplicate) return { ok: false, message: duplicate };
    rows.forEach((row, index) => {
      const originalCode = text(row.__original?.building_code || row.building_code);
      const nextCode = text(normalizedRows[index].building_code);
      if (!originalCode || originalCode === nextCode) return;
      dataset.floor_segments = (dataset.floor_segments || []).map((segment) =>
        text(segment.building_code) === originalCode ? { ...segment, building_code: nextCode } : segment
      );
      dataset.spaces = (dataset.spaces || []).map((space) =>
        text(space.building_code) === originalCode ? { ...space, building_code: nextCode } : space
      );
    });
    dataset.buildings = normalizedRows;
    return { ok: true };
  }

  function applyFloorSegmentRows(dataset, rows) {
    const normalizedRows = normalizeRows("floor_segments", rows);
    const originalKeys = new Set(rows.map((row) => segmentKey(row.__original || row)));
    const nextKeys = new Set();
    for (const segment of normalizedRows) {
      const key = segmentKey(segment);
      if (nextKeys.has(key)) {
        return { ok: false, message: `楼层骨架“${segment.building_code} ${segment.floor_code}层 ${segment.segment_code}”重复，请修改后再保存。` };
      }
      nextKeys.add(key);
      const existing = (dataset.floor_segments || []).find((item) => segmentKey(item) === key);
      if (existing && !originalKeys.has(segmentKey(existing))) {
        return { ok: false, message: `目标楼层骨架“${segment.building_code} ${segment.floor_code}层 ${segment.segment_code}”已存在，不能覆盖。` };
      }
    }
    const moveBySpaceId = new Map();
    rows.forEach((row, index) => {
      const original = row.__original || row;
      const next = normalizedRows[index];
      (dataset.spaces || []).forEach((space) => {
        if (!spaceMatchesSegment(space, original)) return;
        if (!isAssignableSegment(next)) {
          moveBySpaceId.set(text(space.id) || text(space.space_code), { blocked: true, segment: next });
          return;
        }
        moveBySpaceId.set(text(space.id) || text(space.space_code), {
          building_code: next.building_code,
          floor_code: next.floor_code,
          segment_code: next.segment_code,
        });
      });
    });
    const blockedMove = [...moveBySpaceId.values()].find((move) => move.blocked);
    if (blockedMove) {
      const segment = blockedMove.segment;
      return { ok: false, message: `楼层骨架“${segment.segment_code}”已绑定空间，不能改为${segmentTypeLabel(segment.element_type)}。` };
    }
    dataset.floor_segments = [
      ...(dataset.floor_segments || []).filter((segment) => !originalKeys.has(segmentKey(segment))),
      ...normalizedRows,
    ];
    dataset.spaces = (dataset.spaces || []).map((space) => {
      const move = moveBySpaceId.get(text(space.id) || text(space.space_code));
      return move ? { ...space, ...move } : space;
    });
    return { ok: true };
  }

  function applySimpleRows(dataset, key, rows) {
    dataset[key] = normalizeRows(key, rows);
    return { ok: true };
  }

  function deleteBlocker(dataset, key, row) {
    if (key === "colleges") {
      const code = text(row.college_code);
      const name = text(row.college_name);
      if ((dataset.majors || []).some((item) => text(item.college_code) === code) ||
        (dataset.labs || []).some((item) => text(item.college) === name || text(item.college) === code)) {
        return "该学院仍被专业或用途单元引用，不能删除。";
      }
    }
    if (key === "majors") {
      const code = text(row.major_code);
      const name = text(row.major_name);
      if ((dataset.labs || []).some((item) => text(item.major) === name || text(item.major) === code)) {
        return "该专业仍被用途单元引用，不能删除。";
      }
    }
    if (key === "lab_types") {
      const code = text(row.type_code);
      const name = text(row.type_name);
      const hasSameType = (dataset.lab_types || []).some((item) =>
        text(item.id) !== text(row.id) && text(item.type_name) === name
      );
      if (hasSameType) return "";
      if ((dataset.labs || []).some((item) => text(item.lab_type) === name || text(item.lab_type) === code)) {
        return "该实验室类型仍被用途单元引用，不能删除。";
      }
    }
    return "";
  }

  function deleteBuilding(dataset, row) {
    const code = text(row.__original?.building_code || row.building_code);
    const spaces = (dataset.spaces || []).filter((space) => text(space.building_code) === code);
    dataset.buildings = (dataset.buildings || []).filter((building) => text(building.building_code) !== code);
    dataset.floor_segments = (dataset.floor_segments || []).filter((segment) => text(segment.building_code) !== code);
    dataset.spaces = (dataset.spaces || []).filter((space) => text(space.building_code) !== code);
    invalidateAssignmentsForSpaces(dataset, spaces);
    dataset.deleted_space_ids = [...new Set([...(dataset.deleted_space_ids || []), ...spaces.map((space) => text(space.id)).filter(Boolean)])];
    return { ok: true };
  }

  function deleteFloorSegment(dataset, row) {
    const original = row.__original || row;
    const spaces = (dataset.spaces || []).filter((space) => spaceMatchesSegment(space, original));
    const originalKey = segmentKey(original);
    dataset.floor_segments = (dataset.floor_segments || []).filter((segment) => segmentKey(segment) !== originalKey);
    dataset.spaces = (dataset.spaces || []).filter((space) => !spaceMatchesSegment(space, original));
    invalidateAssignmentsForSpaces(dataset, spaces);
    dataset.deleted_space_ids = [...new Set([...(dataset.deleted_space_ids || []), ...spaces.map((space) => text(space.id)).filter(Boolean)])];
    return { ok: true };
  }

  function deleteSimpleRow(dataset, key, row) {
    const blocker = deleteBlocker(dataset, key, row);
    if (blocker) return { ok: false, message: blocker };
    const codeKey = key === "colleges" ? "college_code" : key === "majors" ? "major_code" : "type_code";
    const id = text(row.id);
    const code = text(row[codeKey]);
    dataset[key] = (dataset[key] || []).filter((item) => text(item.id) !== id && text(item[codeKey]) !== code);
    return { ok: true };
  }

  function applyAction(dataset, key, body) {
    if (!RAW_MAINTENANCE_KEYS.has(key)) return { ok: false, message: "未知维护表。" };
    if (body.action === "replaceRows") {
      if (key === "buildings") return applyBuildingRows(dataset, body.rows || []);
      if (key === "floor_segments") return applyFloorSegmentRows(dataset, body.rows || []);
      return applySimpleRows(dataset, key, body.rows || []);
    }
    if (body.action === "deleteRow") {
      if (key === "buildings") return deleteBuilding(dataset, body.row || {});
      if (key === "floor_segments") return deleteFloorSegment(dataset, body.row || {});
      return deleteSimpleRow(dataset, key, body.row || {});
    }
    return { ok: false, message: "未知维护操作。" };
  }

  return {
    RAW_MAINTENANCE_KEYS,
    applyAction,
    deleteBlocker,
    normalizeRows,
    segmentKey,
    isAssignableSegment,
    segmentTypeLabel,
    booleanValue,
    compare,
  };
});
