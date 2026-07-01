"use strict";

const { httpError, nowIso } = require("./http-utils");
const DatasetProjection = require("./dataset-projection-service");
const RawMaintenanceActions = require("../js/app/raw-maintenance-actions");

function text(value) {
  return String(value ?? "").trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function activeOnlySnapshot(dataset) {
  const unscoped = (rows) => (rows || []).filter((row) => !row.copy_id && !row.copyId);
  return {
    buildings: dataset.buildings || [],
    floor_segments: dataset.floor_segments || [],
    spaces: unscoped(dataset.spaces),
    labs: unscoped(dataset.labs),
    colleges: dataset.colleges || [],
    majors: dataset.majors || [],
    lab_types: dataset.lab_types || [],
    plans: unscoped(dataset.plans),
    plan_assignments: (dataset.plan_assignments || []).filter((row) => !String(row.plan_code || "").startsWith("copy-")),
    file_assets: dataset.file_assets || [],
    imports: dataset.imports || [],
    deleted_space_ids: (dataset.deleted_space_ids || []).filter((ref) => !String(ref || "").startsWith("copy:")),
  };
}

function upsertBuilding(db, row, now) {
  const code = text(row.building_code || row.id);
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
    text(row.building_name) || code,
    text(row.campus_zone),
    numberValue(row.building_number, 0),
    numberValue(row.sort_order, 0),
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
    numberValue(row.start_x_m, 0),
    numberValue(row.start_y_m, 0),
    numberValue(row.end_x_m, 0),
    numberValue(row.end_y_m, 0),
    numberValue(row.width_m, 0),
    text(row.element_type) || "corridor",
    text(row.notes),
    text(row.created_at) || now,
    now
  );
}

function upsertCollege(db, row, now) {
  const code = text(row.college_code || row.id || row.college_name);
  if (!code) return;
  db.prepare(`
    INSERT INTO colleges (id, college_code, college_name, color, sort_order, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(college_code) DO UPDATE SET
      college_name = excluded.college_name,
      color = excluded.color,
      sort_order = excluded.sort_order,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(code, code, text(row.college_name) || code, text(row.color), numberValue(row.sort_order, 0), text(row.status) || "active", text(row.notes), text(row.created_at) || now, now);
}

function upsertMajor(db, row, now) {
  const code = text(row.major_code || row.id || row.major_name);
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
  `).run(code, code, text(row.major_name) || code, text(row.college_code), numberValue(row.sort_order, 0), text(row.status) || "active", text(row.notes), text(row.created_at) || now, now);
}

function upsertLabType(db, row, now) {
  const code = text(row.type_code || row.id || row.type_name);
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
  `).run(code, code, text(row.type_name) || code, numberValue(row.sort_order, 0), text(row.status) || "active", text(row.notes), text(row.created_at) || now, now);
}

function invalidateAssignmentsForSpaceCodes(db, codes) {
  const uniqueCodes = [...new Set((codes || []).map(text).filter(Boolean))];
  if (!uniqueCodes.length) return;
  const stmt = db.prepare(`
    UPDATE plan_assignments
    SET previous_space_code = CASE WHEN space_code <> '' THEN space_code ELSE previous_space_code END,
        space_code = '',
        assignment_status = 'Invalid',
        updated_at = ?
    WHERE space_code = ?
  `);
  const now = nowIso();
  for (const code of uniqueCodes) stmt.run(now, code);
}

function applyBuildingReplace(db, rows, now) {
  for (const row of rows || []) {
    const original = text(row.__original?.building_code || row.building_code);
    const next = text(row.building_code);
    if (original && next && original !== next) {
      db.prepare("UPDATE floor_segments SET building_code = ?, updated_at = ? WHERE building_code = ?").run(next, now, original);
      db.prepare("UPDATE spaces SET building_code = ?, updated_at = ? WHERE building_code = ?").run(next, now, original);
    }
    upsertBuilding(db, row, now);
  }
  const keep = new Set((rows || []).map((row) => text(row.building_code)).filter(Boolean));
  for (const row of db.prepare("SELECT building_code FROM buildings").all()) {
    if (!keep.has(row.building_code)) deleteBuilding(db, { building_code: row.building_code });
  }
}

function deleteBuilding(db, row) {
  const code = text(row.__original?.building_code || row.building_code);
  if (!code) return;
  const spaces = db.prepare("SELECT space_code FROM spaces WHERE building_code = ?").all(code).map((item) => item.space_code);
  invalidateAssignmentsForSpaceCodes(db, spaces);
  db.prepare("DELETE FROM spaces WHERE building_code = ?").run(code);
  db.prepare("DELETE FROM floor_segments WHERE building_code = ?").run(code);
  db.prepare("DELETE FROM buildings WHERE building_code = ?").run(code);
}

function applyFloorSegmentReplace(db, rows, now) {
  for (const row of rows || []) {
    const original = row.__original || row;
    const originalKey = RawMaintenanceActions.segmentKey(original);
    const nextKey = RawMaintenanceActions.segmentKey(row);
    if (originalKey && originalKey !== nextKey) {
      db.prepare("DELETE FROM floor_segments WHERE building_code = ? AND floor_code = ? AND segment_code = ?")
        .run(text(original.building_code), text(original.floor_code), text(original.segment_code));
      db.prepare(`
        UPDATE spaces
        SET building_code = ?, floor_code = ?, segment_code = ?, updated_at = ?
        WHERE building_code = ? AND floor_code = ? AND segment_code = ?
      `).run(text(row.building_code), text(row.floor_code), text(row.segment_code), now, text(original.building_code), text(original.floor_code), text(original.segment_code));
    }
    upsertFloorSegment(db, row, now);
  }
}

function deleteFloorSegment(db, row) {
  const original = row.__original || row;
  const spaces = db.prepare("SELECT space_code FROM spaces WHERE building_code = ? AND floor_code = ? AND segment_code = ?")
    .all(text(original.building_code), text(original.floor_code), text(original.segment_code))
    .map((item) => item.space_code);
  invalidateAssignmentsForSpaceCodes(db, spaces);
  db.prepare("DELETE FROM spaces WHERE building_code = ? AND floor_code = ? AND segment_code = ?")
    .run(text(original.building_code), text(original.floor_code), text(original.segment_code));
  db.prepare("DELETE FROM floor_segments WHERE building_code = ? AND floor_code = ? AND segment_code = ?")
    .run(text(original.building_code), text(original.floor_code), text(original.segment_code));
}

function replaceDictionary(db, key, rows, now) {
  const table = key === "colleges" ? "colleges" : key === "majors" ? "majors" : "lab_types";
  const codeField = key === "colleges" ? "college_code" : key === "majors" ? "major_code" : "type_code";
  const keep = new Set((rows || []).map((row) => text(row[codeField])).filter(Boolean));
  for (const row of db.prepare(`SELECT ${codeField} AS code FROM ${table}`).all()) {
    if (!keep.has(row.code)) db.prepare(`DELETE FROM ${table} WHERE ${codeField} = ?`).run(row.code);
  }
  for (const row of rows || []) {
    if (key === "colleges") upsertCollege(db, row, now);
    if (key === "majors") upsertMajor(db, row, now);
    if (key === "lab_types") upsertLabType(db, row, now);
  }
}

function deleteDictionaryRow(db, key, row) {
  if (key === "colleges") db.prepare("DELETE FROM colleges WHERE college_code = ?").run(text(row.college_code));
  if (key === "majors") db.prepare("DELETE FROM majors WHERE major_code = ?").run(text(row.major_code));
  if (key === "lab_types") db.prepare("DELETE FROM lab_types WHERE type_code = ?").run(text(row.type_code));
}

function applyRelationWrite(db, key, body, now) {
  if (body.action === "replaceRows") {
    const rows = RawMaintenanceActions.normalizeRows(key, body.rows || []);
    if (key === "buildings") return applyBuildingReplace(db, rows.map((row, index) => ({ ...row, __original: body.rows?.[index]?.__original })), now);
    if (key === "floor_segments") return applyFloorSegmentReplace(db, rows.map((row, index) => ({ ...row, __original: body.rows?.[index]?.__original })), now);
    return replaceDictionary(db, key, rows, now);
  }
  if (body.action === "deleteRow") {
    if (key === "buildings") return deleteBuilding(db, body.row || {});
    if (key === "floor_segments") return deleteFloorSegment(db, body.row || {});
    return deleteDictionaryRow(db, key, body.row || {});
  }
}

function updateLegacySnapshot(db, datasetService, user, nextRevision, actor) {
  const projected = datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user));
  const snapshot = datasetService.normalizeIncomingDataset(activeOnlySnapshot(projected));
  db.prepare("UPDATE active_dataset SET revision = ?, dataset_json = ?, updated_by = ?, updated_at = ? WHERE id = 1")
    .run(nextRevision, JSON.stringify(snapshot), actor, nowIso());
  return datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user, { fallbackDataset: snapshot }));
}

function createRawMaintenanceService(db, datasetService) {
  function submitActiveRawMaintenanceAction(key, body, user) {
    if (!user || user.role !== "admin") throw httpError(403, "forbidden", "只有管理员可以维护基础表");
    if (!RawMaintenanceActions.RAW_MAINTENANCE_KEYS.has(key)) throw httpError(404, "raw_key_not_found", "未知维护表");
    const active = datasetService.getActiveDataset();
    if (Number(body.expectedRevision) !== active.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前数据已被其他人更新，请刷新后重试"), {
        payload: { revision: active.revision, dataset: active.dataset },
      });
    }
    const dataset = datasetService.normalizeIncomingDataset(DatasetProjection.projectVisibleDataset(db, user, { fallbackDataset: active.dataset }));
    const actionResult = RawMaintenanceActions.applyAction(dataset, key, body || {});
    if (!actionResult.ok) throw httpError(400, "invalid_raw_maintenance_action", actionResult.message || "基础表保存失败");
    const now = nowIso();
    const nextRevision = active.revision + 1;
    db.exec("BEGIN");
    try {
      applyRelationWrite(db, key, body || {}, now);
      const projected = updateLegacySnapshot(db, datasetService, user, nextRevision, user.username);
      db.exec("COMMIT");
      return {
        ok: true,
        revision: nextRevision,
        dataset: projected,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    submitActiveRawMaintenanceAction,
  };
}

module.exports = {
  createRawMaintenanceService,
};
