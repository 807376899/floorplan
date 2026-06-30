function ensureRelationalSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS buildings (
      id TEXT PRIMARY KEY,
      building_code TEXT NOT NULL UNIQUE,
      building_name TEXT NOT NULL DEFAULT '',
      campus_zone TEXT NOT NULL DEFAULT '',
      building_number INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS floor_segments (
      id TEXT PRIMARY KEY,
      building_code TEXT NOT NULL,
      floor_code TEXT NOT NULL,
      segment_code TEXT NOT NULL,
      start_x_m REAL,
      start_y_m REAL,
      end_x_m REAL,
      end_y_m REAL,
      width_m REAL,
      element_type TEXT NOT NULL DEFAULT 'corridor',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE(building_code, floor_code, segment_code),
      FOREIGN KEY(building_code) REFERENCES buildings(building_code)
    );
    CREATE TABLE IF NOT EXISTS colleges (
      id TEXT PRIMARY KEY,
      college_code TEXT NOT NULL UNIQUE,
      college_name TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS majors (
      id TEXT PRIMARY KEY,
      major_code TEXT NOT NULL UNIQUE,
      major_name TEXT NOT NULL DEFAULT '',
      college_code TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS lab_types (
      id TEXT PRIMARY KEY,
      type_code TEXT NOT NULL UNIQUE,
      type_name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      space_code TEXT NOT NULL UNIQUE,
      building_code TEXT NOT NULL DEFAULT '',
      floor_code TEXT NOT NULL DEFAULT '',
      segment_code TEXT NOT NULL DEFAULT '',
      front_door TEXT NOT NULL DEFAULT '',
      rear_door TEXT NOT NULL DEFAULT '',
      side TEXT NOT NULL DEFAULT '',
      offset_m REAL,
      length_m REAL,
      width_m REAL,
      area_m2 REAL,
      network_segment TEXT NOT NULL DEFAULT '',
      current_status TEXT NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS labs (
      id TEXT PRIMARY KEY,
      lab_code TEXT NOT NULL UNIQUE,
      lab_name TEXT NOT NULL DEFAULT '',
      college_code TEXT NOT NULL DEFAULT '',
      college TEXT NOT NULL DEFAULT '',
      major_code TEXT NOT NULL DEFAULT '',
      major TEXT NOT NULL DEFAULT '',
      lab_type_code TEXT NOT NULL DEFAULT '',
      lab_type TEXT NOT NULL DEFAULT '',
      director TEXT NOT NULL DEFAULT '',
      seat_count INTEGER,
      computer_count INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      copy_id INTEGER UNIQUE,
      plan_code TEXT NOT NULL UNIQUE,
      plan_name TEXT NOT NULL DEFAULT '',
      owner_user_id INTEGER,
      visibility TEXT NOT NULL DEFAULT 'private',
      is_baseline INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      source_plan_id TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      plan_type TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plan_space_overrides (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      base_space_id TEXT NOT NULL DEFAULT '',
      space_code TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE(plan_id, space_code),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );
    CREATE TABLE IF NOT EXISTS plan_lab_overrides (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      base_lab_id TEXT NOT NULL DEFAULT '',
      lab_code TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE(plan_id, lab_code),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );
    CREATE TABLE IF NOT EXISTS plan_assignments (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      plan_code TEXT NOT NULL DEFAULT '',
      lab_code TEXT NOT NULL DEFAULT '',
      space_code TEXT NOT NULL DEFAULT '',
      previous_space_code TEXT NOT NULL DEFAULT '',
      assignment_status TEXT NOT NULL DEFAULT 'assigned',
      effective_from TEXT NOT NULL DEFAULT '',
      move_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE(plan_id, lab_code),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );
    CREATE TABLE IF NOT EXISTS plan_deleted_spaces (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      base_space_id TEXT NOT NULL DEFAULT '',
      space_code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      UNIQUE(plan_id, space_code),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );
    CREATE INDEX IF NOT EXISTS idx_floor_segments_building_floor ON floor_segments(building_code, floor_code);
    CREATE INDEX IF NOT EXISTS idx_spaces_building_floor ON spaces(building_code, floor_code);
    CREATE INDEX IF NOT EXISTS idx_plans_visibility ON plans(visibility, is_baseline, owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_plan_assignments_plan ON plan_assignments(plan_id, assignment_status);
    CREATE INDEX IF NOT EXISTS idx_plan_space_overrides_plan ON plan_space_overrides(plan_id);
    CREATE INDEX IF NOT EXISTS idx_plan_lab_overrides_plan ON plan_lab_overrides(plan_id);
  `);
}

function syncFromVisibleDataset(db, dataset, copies = []) {
  ensureRelationalSchema(db);
  const now = new Date().toISOString();
  const copyByPlanCode = new Map((copies || []).map((copy) => [text(copy.planCode), copy]));
  const planCodeByCopyId = new Map((copies || []).map((copy) => [String(copy.id), text(copy.planCode)]));

  for (const row of dataset.buildings || []) upsertBuilding(db, row, now);
  for (const row of dataset.floor_segments || []) upsertFloorSegment(db, row, now);
  for (const row of dataset.colleges || []) upsertCollege(db, row, now);
  for (const row of dataset.majors || []) upsertMajor(db, row, now);
  for (const row of dataset.lab_types || []) upsertLabType(db, row, now);
  for (const row of dataset.plans || []) {
    upsertPlan(db, row, copyByPlanCode.get(text(row.plan_code) || text(row.id)), now);
  }
  for (const copy of copies || []) {
    upsertPlan(db, copy.plan || {}, copy, now);
  }
  for (const row of dataset.spaces || []) {
    upsertSpace(db, row, now);
    const planCode = planCodeForScopedRow(row, planCodeByCopyId);
    if (planCode) upsertSpaceOverride(db, planCode, row, now);
  }
  for (const row of dataset.labs || []) {
    upsertLab(db, row, now);
    const planCode = planCodeForScopedRow(row, planCodeByCopyId);
    if (planCode) upsertLabOverride(db, planCode, row, now);
  }
  for (const row of dataset.plan_assignments || []) upsertAssignment(db, row, now);
  clearDeletedSpacesForPlans(db, [...planCodeByCopyId.values()]);
  for (const ref of dataset.deleted_space_ids || []) upsertDeletedSpace(db, ref, planCodeByCopyId, now);
}

function projectGlobalReferenceRows(db, dataset) {
  ensureRelationalSchema(db);
  const next = { ...(dataset || {}) };
  const buildings = selectRows(db, "buildings", "sort_order ASC, building_code ASC");
  const floorSegments = selectRows(db, "floor_segments", "building_code ASC, floor_code ASC, segment_code ASC");
  const colleges = selectRows(db, "colleges", "sort_order ASC, college_code ASC");
  const majors = selectRows(db, "majors", "sort_order ASC, major_code ASC");
  const labTypes = selectRows(db, "lab_types", "sort_order ASC, type_code ASC");
  if (buildings.length) next.buildings = buildings.map(stripRelationalNulls);
  if (floorSegments.length) next.floor_segments = floorSegments.map(stripRelationalNulls);
  if (colleges.length) next.colleges = colleges.map(stripRelationalNulls);
  if (majors.length) next.majors = majors.map(stripRelationalNulls);
  if (labTypes.length) next.lab_types = labTypes.map(stripRelationalNulls);
  return next;
}

function selectRows(db, table, orderBy) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

function upsertBuilding(db, row, now) {
  const code = text(row.building_code) || text(row.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO buildings (id, building_code, building_name, campus_zone, building_number, sort_order, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(building_code) DO UPDATE SET
      building_name = excluded.building_name,
      campus_zone = excluded.campus_zone,
      building_number = excluded.building_number,
      sort_order = excluded.sort_order,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    code,
    code,
    text(row.building_name),
    text(row.campus_zone),
    integer(row.building_number),
    integer(row.sort_order),
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertFloorSegment(db, row, now) {
  const buildingCode = text(row.building_code);
  const floorCode = text(row.floor_code);
  const segmentCode = text(row.segment_code);
  if (!buildingCode || !floorCode || !segmentCode) return;
  db.prepare(`
    INSERT INTO floor_segments (
      id, building_code, floor_code, segment_code, start_x_m, start_y_m, end_x_m, end_y_m,
      width_m, element_type, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(building_code, floor_code, segment_code) DO UPDATE SET
      start_x_m = excluded.start_x_m,
      start_y_m = excluded.start_y_m,
      end_x_m = excluded.end_x_m,
      end_y_m = excluded.end_y_m,
      width_m = excluded.width_m,
      element_type = excluded.element_type,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    `${buildingCode}__${floorCode}__${segmentCode}`,
    buildingCode,
    floorCode,
    segmentCode,
    numeric(row.start_x_m),
    numeric(row.start_y_m),
    numeric(row.end_x_m),
    numeric(row.end_y_m),
    numeric(row.width_m),
    text(row.element_type) || "corridor",
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertCollege(db, row, now) {
  const code = text(row.college_code) || text(row.college_name) || text(row.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO colleges (id, college_code, college_name, color, sort_order, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(college_code) DO UPDATE SET
      college_name = excluded.college_name,
      color = CASE WHEN colleges.color <> '' THEN colleges.color ELSE excluded.color END,
      sort_order = excluded.sort_order,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    code,
    code,
    text(row.college_name) || code,
    text(row.color),
    integer(row.sort_order),
    text(row.status) || "active",
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertMajor(db, row, now) {
  const code = text(row.major_code) || text(row.major_name) || text(row.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO majors (id, major_code, major_name, college_code, sort_order, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(major_code) DO UPDATE SET
      major_name = excluded.major_name,
      college_code = excluded.college_code,
      sort_order = excluded.sort_order,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    code,
    code,
    text(row.major_name) || code,
    text(row.college_code),
    integer(row.sort_order),
    text(row.status) || "active",
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertLabType(db, row, now) {
  const code = text(row.type_code) || text(row.type_name) || text(row.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO lab_types (id, type_code, type_name, sort_order, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(type_code) DO UPDATE SET
      type_name = excluded.type_name,
      sort_order = excluded.sort_order,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    code,
    code,
    text(row.type_name) || code,
    integer(row.sort_order),
    text(row.status) || "active",
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertSpace(db, row, now) {
  const code = text(row.space_code) || text(row.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO spaces (
      id, space_code, building_code, floor_code, segment_code, front_door, rear_door, side,
      offset_m, length_m, width_m, area_m2, network_segment, current_status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(space_code) DO UPDATE SET
      building_code = excluded.building_code,
      floor_code = excluded.floor_code,
      segment_code = excluded.segment_code,
      front_door = excluded.front_door,
      rear_door = excluded.rear_door,
      side = excluded.side,
      offset_m = excluded.offset_m,
      length_m = excluded.length_m,
      width_m = excluded.width_m,
      area_m2 = excluded.area_m2,
      network_segment = excluded.network_segment,
      current_status = excluded.current_status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    code,
    code,
    text(row.building_code),
    text(row.floor_code),
    text(row.segment_code),
    text(row.front_door),
    text(row.rear_door),
    text(row.side),
    numeric(row.offset_m),
    numeric(row.length_m),
    numeric(row.width_m),
    numeric(row.area_m2),
    text(row.network_segment),
    text(row.current_status) || "active",
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertLab(db, row, now) {
  const code = text(row.lab_code) || text(row.id);
  if (!code) return;
  db.prepare(`
    INSERT INTO labs (
      id, lab_code, lab_name, college_code, college, major_code, major, lab_type_code,
      lab_type, director, seat_count, computer_count, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lab_code) DO UPDATE SET
      lab_name = excluded.lab_name,
      college_code = excluded.college_code,
      college = excluded.college,
      major_code = excluded.major_code,
      major = excluded.major,
      lab_type_code = excluded.lab_type_code,
      lab_type = excluded.lab_type,
      director = excluded.director,
      seat_count = excluded.seat_count,
      computer_count = excluded.computer_count,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(
    code,
    code,
    text(row.lab_name) || code,
    text(row.college_code),
    text(row.college),
    text(row.major_code),
    text(row.major),
    text(row.lab_type_code),
    text(row.lab_type),
    text(row.director),
    integerOrNull(row.seat_count),
    integerOrNull(row.computer_count),
    text(row.status) || "active",
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertPlan(db, row, copy, now) {
  const planCode = text(copy?.planCode) || text(row.plan_code) || text(row.id);
  if (!planCode) return;
  const isBaseline = copy ? Boolean(copy.isBaseline) : text(row.plan_type) === "baseline" || Boolean(row.is_locked);
  db.prepare(`
    INSERT INTO plans (
      id, copy_id, plan_code, plan_name, owner_user_id, visibility, is_baseline, is_locked,
      source_plan_id, revision, plan_type, source_type, description, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_code) DO UPDATE SET
      copy_id = excluded.copy_id,
      plan_name = excluded.plan_name,
      owner_user_id = excluded.owner_user_id,
      visibility = excluded.visibility,
      is_baseline = excluded.is_baseline,
      is_locked = excluded.is_locked,
      source_plan_id = excluded.source_plan_id,
      revision = excluded.revision,
      plan_type = excluded.plan_type,
      source_type = excluded.source_type,
      description = excluded.description,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `).run(
    planCode,
    copy?.id || null,
    planCode,
    text(copy?.planName) || text(row.plan_name) || planCode,
    copy?.ownerUserId || null,
    text(copy?.visibility) || text(row.visibility) || "active",
    isBaseline ? 1 : 0,
    isBaseline || Boolean(row.is_locked) ? 1 : 0,
    text(copy?.sourcePlanCode) || text(row.source_plan_code),
    integer(copy?.revision || row.revision || 1),
    isBaseline ? "baseline" : (text(row.plan_type) || "copy"),
    text(copy?.sourceType) || text(row.source_type),
    text(copy?.description) || text(row.description),
    text(copy?.createdAt) || text(row.created_at) || now,
    text(copy?.updatedAt) || text(row.updated_at) || now,
    copy?.deletedAt || null
  );
}

function upsertSpaceOverride(db, planCode, row, now) {
  const spaceCode = text(row.space_code) || text(row.id);
  if (!spaceCode) return;
  db.prepare(`
    INSERT INTO plan_space_overrides (id, plan_id, base_space_id, space_code, operation, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'upsert', ?, ?, ?)
    ON CONFLICT(plan_id, space_code) DO UPDATE SET
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(`${planCode}__${spaceCode}`, planCode, text(row.id), spaceCode, JSON.stringify(row), now, now);
}

function upsertLabOverride(db, planCode, row, now) {
  const labCode = text(row.lab_code) || text(row.id);
  if (!labCode) return;
  db.prepare(`
    INSERT INTO plan_lab_overrides (id, plan_id, base_lab_id, lab_code, operation, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'upsert', ?, ?, ?)
    ON CONFLICT(plan_id, lab_code) DO UPDATE SET
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(`${planCode}__${labCode}`, planCode, text(row.id), labCode, JSON.stringify(row), now, now);
}

function upsertAssignment(db, row, now) {
  const planCode = text(row.plan_id) || text(row.plan_code);
  const labCode = text(row.lab_code) || text(row.lab_id);
  if (!planCode || !labCode) return;
  db.prepare(`
    INSERT INTO plan_assignments (
      id, plan_id, plan_code, lab_code, space_code, previous_space_code, assignment_status,
      effective_from, move_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, lab_code) DO UPDATE SET
      plan_code = excluded.plan_code,
      space_code = excluded.space_code,
      previous_space_code = excluded.previous_space_code,
      assignment_status = excluded.assignment_status,
      effective_from = excluded.effective_from,
      move_note = excluded.move_note,
      updated_at = excluded.updated_at
  `).run(
    text(row.id) || `${planCode}__${labCode}`,
    planCode,
    text(row.plan_code) || planCode,
    labCode,
    text(row.space_code) || text(row.space_id),
    text(row.previous_space_code) || text(row.previous_space_id),
    text(row.assignment_status) || "assigned",
    text(row.effective_from),
    text(row.move_note),
    text(row.created_at) || now,
    now
  );
}

function upsertDeletedSpace(db, ref, planCodeByCopyId, now) {
  const parsed = parseScopedRef(ref);
  const planCode = parsed.copyId ? planCodeByCopyId.get(String(parsed.copyId)) : "";
  if (!planCode || !parsed.ref) return;
  db.prepare(`
    INSERT INTO plan_deleted_spaces (id, plan_id, base_space_id, space_code, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, space_code) DO NOTHING
  `).run(`${planCode}__${parsed.ref}`, planCode, parsed.ref, parsed.ref, now);
}

function clearDeletedSpacesForPlans(db, planCodes) {
  for (const planCode of new Set((planCodes || []).map(text).filter(Boolean))) {
    db.prepare("DELETE FROM plan_deleted_spaces WHERE plan_id = ?").run(planCode);
  }
}

function planCodeForScopedRow(row, planCodeByCopyId) {
  const copyId = text(row.copy_id) || text(row.copyId);
  return copyId ? planCodeByCopyId.get(copyId) || "" : "";
}

function parseScopedRef(value) {
  const raw = text(value);
  const match = raw.match(/^copy:(\d+)::(.+)$/);
  if (!match) return { copyId: null, ref: raw };
  return { copyId: Number(match[1]), ref: text(match[2]) };
}

function unscopedId(id, fallback) {
  const parsed = parseScopedRef(id);
  return parsed.ref || text(fallback);
}

function stripRelationalNulls(row) {
  const next = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    if (["created_at", "updated_at"].includes(key) && value === "") continue;
    next[key] = value;
  }
  return next;
}

function text(value) {
  return String(value ?? "").trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerOrNull(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  ensureRelationalSchema,
  syncFromVisibleDataset,
  projectGlobalReferenceRows,
};
