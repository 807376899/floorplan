"use strict";

const RelationalStore = require("./relational-store");

function parseJsonObject(value) {
  if (!value || typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function stripEmpty(row) {
  const output = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    output[key] = value;
  });
  return output;
}

function booleanFlag(value) {
  return value === true || value === 1 || value === "1";
}

function visiblePlanSql(user, options = {}) {
  const planCodes = Array.isArray(options.planCodes)
    ? options.planCodes.map((code) => String(code || "").trim()).filter(Boolean)
    : [];
  if (planCodes.length) {
    return {
      sql: `SELECT * FROM plans WHERE deleted_at IS NULL AND plan_code IN (${planCodes.map(() => "?").join(", ")}) ORDER BY is_baseline DESC, updated_at DESC, id DESC`,
      params: planCodes
    };
  }
  const copyIds = Array.isArray(options.copyIds)
    ? options.copyIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  if (copyIds.length) {
    return {
      sql: `SELECT * FROM plans WHERE deleted_at IS NULL AND copy_id IN (${copyIds.map(() => "?").join(", ")}) ORDER BY is_baseline DESC, updated_at DESC, id DESC`,
      params: copyIds
    };
  }
  if (options.activeOnly) {
    return {
      sql: "SELECT * FROM plans WHERE deleted_at IS NULL AND copy_id IS NULL ORDER BY is_baseline DESC, updated_at DESC, id DESC",
      params: []
    };
  }
  if (user && user.role === "admin") {
    return {
      sql: "SELECT * FROM plans WHERE deleted_at IS NULL ORDER BY is_baseline DESC, updated_at DESC, id DESC",
      params: []
    };
  }
  if (user && user.id) {
    return {
      sql: `
        SELECT *
        FROM plans
        WHERE deleted_at IS NULL
          AND (is_baseline = 1 OR visibility = 'public' OR owner_user_id = ?)
        ORDER BY is_baseline DESC, updated_at DESC, id DESC
      `,
      params: [user.id]
    };
  }
  return {
    sql: `
      SELECT *
      FROM plans
      WHERE deleted_at IS NULL
        AND (is_baseline = 1 OR visibility = 'public')
      ORDER BY is_baseline DESC, updated_at DESC, id DESC
    `,
    params: []
  };
}

function loadVisiblePlans(db, user, options = {}) {
  const query = visiblePlanSql(user, options);
  return db.prepare(query.sql).all(...query.params);
}

function projectPlan(row, baselineCode) {
  const copyId = Number(row.copy_id);
  const isBaseline = booleanFlag(row.is_baseline);
  return stripEmpty({
    id: row.plan_code,
    copy_id: Number.isFinite(copyId) && copyId > 0 ? copyId : undefined,
    plan_code: row.plan_code,
    plan_name: row.plan_name,
    description: row.description,
    source_plan_code: row.source_plan_id,
    plan_type: isBaseline ? "baseline" : (row.plan_type || "copy"),
    visibility: row.visibility,
    owner_user_id: row.owner_user_id,
    is_locked: booleanFlag(row.is_locked) || isBaseline,
    is_default_compare_before: row.plan_code === baselineCode,
    is_default_compare_after: false,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}

function rowWithPayload(row, forced = {}) {
  const payload = parseJsonObject(row.payload_json);
  const definedForced = Object.fromEntries(
    Object.entries(forced).filter(([, value]) => value !== undefined)
  );
  return stripEmpty({
    ...payload,
    space_code: payload.space_code || row.space_code,
    lab_code: payload.lab_code || row.lab_code,
    created_at: payload.created_at || row.created_at,
    updated_at: payload.updated_at || row.updated_at,
    ...definedForced
  });
}

function planParamList(plans) {
  const codes = plans.map((plan) => plan.plan_code).filter(Boolean);
  if (!codes.length) {
    return null;
  }
  return {
    codes,
    placeholders: codes.map(() => "?").join(", ")
  };
}

function loadGlobalRows(db) {
  return {
    campuses: db.prepare(`
      SELECT campus_code, campus_name, sort_order, status, notes, created_at, updated_at
      FROM campuses
      ORDER BY sort_order ASC, campus_code ASC
    `).all().map(stripEmpty),
    buildings: db.prepare(`
      SELECT building_code, building_name, campus_code, building_number, sort_order, notes, created_at, updated_at
      FROM buildings
      ORDER BY sort_order ASC, building_code ASC
    `).all().map(stripEmpty),
    floor_segments: db.prepare(`
      SELECT
        id, building_code, floor_code, segment_code,
        segment_name, start_x_m, start_y_m, end_x_m, end_y_m, width_m, element_type, notes, created_at, updated_at
      FROM floor_segments
      ORDER BY building_code ASC, floor_code ASC, segment_code ASC
    `).all().map((row) => stripEmpty({
      floor_segment_code: row.id,
      ...row
    })),
    colleges: db.prepare(`
      SELECT college_code, college_name, color, sort_order, notes, created_at, updated_at
      FROM colleges
      ORDER BY sort_order ASC, college_code ASC, college_name ASC
    `).all().map(stripEmpty),
    majors: db.prepare(`
      SELECT major_code, major_name, college_code, sort_order, notes, created_at, updated_at
      FROM majors
      ORDER BY sort_order ASC, college_code ASC, major_code ASC, major_name ASC
    `).all().map(stripEmpty),
    lab_types: db.prepare(`
      SELECT type_code, type_name, sort_order, notes, created_at, updated_at
      FROM lab_types
      ORDER BY sort_order ASC, type_code ASC, type_name ASC
    `).all().map(stripEmpty)
  };
}

function loadSpaces(db, plans) {
  const baseRows = db.prepare(`
    SELECT
      space_code, building_code, floor_code, segment_code, front_door, rear_door, side,
      offset_m, length_m, width_m, area_m2, network_segment, current_status,
      notes, created_at, updated_at
    FROM spaces
    ORDER BY building_code ASC, floor_code ASC, space_code ASC
  `).all().map((row) => stripEmpty({
    ...row,
    door_number: row.front_door,
    skeleton_code: row.segment_code,
    area_sqm: row.area_m2,
    physical_status: row.current_status
  }));
  const paramList = planParamList(plans);
  if (!paramList) {
    return baseRows;
  }
  const planByCode = new Map(plans.map((plan) => [plan.plan_code, plan]));
  const overrideRows = db.prepare(`
    SELECT *
    FROM plan_space_overrides
    WHERE plan_id IN (${paramList.placeholders})
      AND COALESCE(operation, 'upsert') <> 'deleted'
    ORDER BY plan_id ASC, space_code ASC
  `).all(...paramList.codes).map((row) => {
    const plan = planByCode.get(row.plan_id);
    return rowWithPayload(row, {
      copy_id: plan && plan.copy_id ? plan.copy_id : undefined,
      plan_id: row.plan_id,
      plan_code: row.plan_id
    });
  });
  return [...baseRows, ...overrideRows];
}

function loadLabs(db, plans) {
  const baseRows = db.prepare(`
    SELECT
      lab_code, lab_name, college_code, college, major_code, major, lab_type_code,
      lab_type, director, seat_count, computer_count, status, notes, created_at, updated_at
    FROM labs
    ORDER BY lab_code ASC
  `).all().map((row) => stripEmpty({
    ...row,
    college_name: row.college,
    major_name: row.major,
    lab_type_name: row.lab_type,
    seats: row.seat_count,
    computers: row.computer_count
  }));
  const paramList = planParamList(plans);
  if (!paramList) {
    return baseRows;
  }
  const planByCode = new Map(plans.map((plan) => [plan.plan_code, plan]));
  const overrideRows = db.prepare(`
    SELECT *
    FROM plan_lab_overrides
    WHERE plan_id IN (${paramList.placeholders})
      AND COALESCE(operation, 'upsert') <> 'deleted'
    ORDER BY plan_id ASC, lab_code ASC
  `).all(...paramList.codes).map((row) => {
    const plan = planByCode.get(row.plan_id);
    return rowWithPayload(row, {
      copy_id: plan && plan.copy_id ? plan.copy_id : undefined,
      plan_id: row.plan_id,
      plan_code: row.plan_id
    });
  });
  return [...baseRows, ...overrideRows];
}

function loadAssignments(db, plans) {
  const paramList = planParamList(plans);
  if (!paramList) {
    return [];
  }
  return db.prepare(`
    SELECT
      id, plan_id, lab_code, space_code, previous_space_code,
      assignment_status, effective_from, move_note, created_at, updated_at
    FROM plan_assignments
    WHERE plan_id IN (${paramList.placeholders})
    ORDER BY plan_id ASC, id ASC
  `).all(...paramList.codes).map((row) => ({
    id: row.id,
    plan_id: row.plan_id,
    plan_code: row.plan_id,
    lab_code: row.lab_code,
    space_code: row.space_code,
    previous_space_code: row.previous_space_code,
    assignment_status: row.assignment_status,
    effective_from: row.effective_from,
    move_note: row.move_note,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

function loadDeletedSpaceIds(db, plans) {
  const paramList = planParamList(plans);
  if (!paramList) {
    return [];
  }
  const planByCode = new Map(plans.map((plan) => [plan.plan_code, plan]));
  return db.prepare(`
    SELECT plan_id, space_code
    FROM plan_deleted_spaces
    WHERE plan_id IN (${paramList.placeholders})
    ORDER BY plan_id ASC, space_code ASC
  `).all(...paramList.codes).map((row) => {
    const plan = planByCode.get(row.plan_id);
    if (plan && plan.copy_id) {
      return `copy:${plan.copy_id}::${row.space_code}`;
    }
    return row.space_code;
  });
}

function projectVisibleDataset(db, user, options = {}) {
  RelationalStore.ensureRelationalSchema(db);
  const plans = loadVisiblePlans(db, user, options);
  if (!plans.length && options.fallbackDataset) {
    return RelationalStore.projectGlobalReferenceRows(db, options.fallbackDataset);
  }
  const globals = loadGlobalRows(db);
  const baseline = plans.find((plan) => booleanFlag(plan.is_baseline));
  return {
    buildings: globals.buildings,
    campuses: globals.campuses,
    floor_segments: globals.floor_segments,
    spaces: loadSpaces(db, plans),
    labs: loadLabs(db, plans),
    colleges: globals.colleges,
    majors: globals.majors,
    lab_types: globals.lab_types,
    plans: plans.map((plan) => projectPlan(plan, baseline && baseline.plan_code)),
    plan_assignments: loadAssignments(db, plans),
    deleted_space_ids: loadDeletedSpaceIds(db, plans),
    file_assets: Array.isArray(options.fallbackDataset && options.fallbackDataset.file_assets)
      ? options.fallbackDataset.file_assets
      : [],
    imports: Array.isArray(options.fallbackDataset && options.fallbackDataset.imports)
      ? options.fallbackDataset.imports
      : []
  };
}

module.exports = {
  projectVisibleDataset
};
