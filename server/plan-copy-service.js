const { httpError, nowIso, toBoolean } = require("./http-utils");
const RelationalStore = require("./relational-store");

function createPlanCopyService(db, datasetService) {
  const COPY_SCOPED_KEYS = ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "file_assets"];
  RelationalStore.ensureRelationalSchema(db);

  function visibleWhere(user) {
    if (user?.role === "admin") return "deleted_at IS NULL";
    if (user) return "(deleted_at IS NULL AND (is_baseline = 1 OR visibility = 'public' OR owner_user_id = ?))";
    return "(deleted_at IS NULL AND (is_baseline = 1 OR visibility = 'public'))";
  }

  function visibleParams(user) {
    if (user?.role === "admin") return [];
    return user ? [user.id] : [];
  }

  function listVisibleCopies(user) {
    return db.prepare(`
      SELECT plan_copies.*, users.username AS owner_username, users.role AS owner_role
      FROM plan_copies
      JOIN users ON users.id = plan_copies.owner_user_id
      WHERE ${visibleWhere(user)}
      ORDER BY plan_copies.is_baseline DESC, plan_copies.updated_at DESC, plan_copies.id DESC
    `).all(...visibleParams(user)).map(publicCopy);
  }

  function listManageablePlans(user) {
    requireAdmin(user);
    const activePlans = listActiveManagedPlans(user);
    const copyPlans = listManagedCopyPlans(user);
    return [...activePlans, ...copyPlans].sort((a, b) =>
      Number(b.isBaseline) - Number(a.isBaseline)
      || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
      || String(a.id).localeCompare(String(b.id))
    );
  }

  function listManagedCopyPlans(user) {
    return db.prepare(`
      SELECT plan_copies.*, users.username AS owner_username, users.role AS owner_role
      FROM plan_copies
      JOIN users ON users.id = plan_copies.owner_user_id
      WHERE plan_copies.deleted_at IS NULL
      ORDER BY plan_copies.is_baseline DESC, plan_copies.updated_at DESC, plan_copies.id DESC
    `).all().map((row) => ({
      ...stripPayload(publicCopy(row), user),
      kind: "copy",
      copyId: row.id,
      canDelete: manageablePlanCount() > 1,
    }));
  }

  function listActiveManagedPlans(user) {
    const active = datasetService.getActiveDataset();
    const dataset = datasetService.normalizeIncomingDataset(active.dataset);
    return (dataset.plans || []).map((plan) => stripActivePlanPayload(publicActivePlan(plan, active), user));
  }

  function publicActivePlan(plan, active) {
    const isBaseline = String(plan.plan_type || "") === "baseline" || toBoolean(plan.is_locked);
    return {
      id: `active:${plan.plan_code || plan.id}`,
      kind: "active",
      planCode: plan.plan_code || plan.id,
      planName: plan.plan_name || plan.plan_code || plan.id,
      description: plan.description || "",
      visibility: "active",
      isPublic: true,
      isBaseline,
      sourceType: "active",
      importDraftId: null,
      ownerUserId: null,
      ownerUsername: "active dataset",
      ownerRole: "system",
      isMine: true,
      canDelete: manageablePlanCount() > 1,
      revision: active.revision,
      sourcePlanCode: plan.source_plan_code || "",
      createdAt: plan.created_at || active.updatedAt,
      updatedAt: plan.updated_at || active.updatedAt,
      plan: {
        ...plan,
        id: plan.id || plan.plan_code,
        plan_code: plan.plan_code || plan.id,
        plan_name: plan.plan_name || plan.plan_code || plan.id,
        plan_type: isBaseline ? "baseline" : plan.plan_type,
        is_locked: isBaseline ? true : toBoolean(plan.is_locked),
      },
    };
  }

  function stripActivePlanPayload(plan, _user) {
    const { plan: _plan, ...rest } = plan;
    return rest;
  }

  function manageablePlanCount() {
    const active = datasetService.normalizeIncomingDataset(datasetService.getActiveDataset().dataset);
    const activeCount = (active.plans || []).length;
    const copyCount = db.prepare("SELECT COUNT(*) AS count FROM plan_copies WHERE deleted_at IS NULL").get().count;
    return activeCount + copyCount;
  }

  function listBackupRows() {
    return db.prepare("SELECT * FROM plan_copies ORDER BY id ASC").all();
  }

  function copyPayloadIndex() {
    const rows = db.prepare("SELECT * FROM plan_copies WHERE deleted_at IS NULL").all();
    const index = {
      buildingIds: new Set(),
      floorSegmentIds: new Set(),
      spaceIds: new Set(),
      labIds: new Set(),
      labTypeIds: new Set(),
      collegeIds: new Set(),
      majorIds: new Set(),
      fileAssetIds: new Set(),
      planCodes: new Set(),
      planIds: new Set(),
    };
    for (const row of rows) {
      const copy = publicCopy(row);
      index.planCodes.add(copy.planCode);
      index.planIds.add(copy.planCode);
      index.planIds.add(String(copy.id));
      for (const plan of copy.dataset?.plans || []) {
        if (plan.plan_code) index.planCodes.add(String(plan.plan_code));
        if (plan.id) index.planIds.add(String(plan.id));
      }
      collectIds(index.buildingIds, copy.dataset?.buildings);
      collectIds(index.floorSegmentIds, copy.dataset?.floor_segments);
      collectIds(index.spaceIds, copy.dataset?.spaces);
      collectIds(index.labIds, copy.dataset?.labs);
      collectIds(index.labTypeIds, copy.dataset?.lab_types);
      collectIds(index.collegeIds, copy.dataset?.colleges);
      collectIds(index.majorIds, copy.dataset?.majors);
      collectIds(index.fileAssetIds, copy.dataset?.file_assets);
    }
    return index;
  }

  function collectIds(target, rows = []) {
    for (const row of rows || []) {
      if (row?.id) target.add(String(row.id));
    }
  }

  function getVisibleCopy(copyId, user) {
    const row = db.prepare(`
      SELECT plan_copies.*, users.username AS owner_username, users.role AS owner_role
      FROM plan_copies
      JOIN users ON users.id = plan_copies.owner_user_id
      WHERE plan_copies.id = ? AND ${visibleWhere(user)}
    `).get(copyId, ...visibleParams(user));
    return row || null;
  }

  function getOwnedCopy(copyId, user) {
    const row = db.prepare("SELECT * FROM plan_copies WHERE id = ? AND deleted_at IS NULL").get(copyId);
    if (!row) throw httpError(404, "copy_not_found", "未找到方案");
    if (!user || (row.owner_user_id !== user.id && user.role !== "admin")) {
      throw httpError(403, "forbidden", "只能管理自己创建的方案");
    }
    if (toBoolean(row.is_baseline) && user.role !== "admin") {
      throw httpError(403, "baseline_locked", "基线方案只能由管理员管理");
    }
    return row;
  }

  function buildVisibleDataset(user) {
    const active = datasetService.getActiveDataset();
    const dataset = datasetService.normalizeIncomingDataset(active.dataset);
    const copies = listVisibleCopies(user);
    const latestBaselineCode = copies.find((copy) => copy.isBaseline)?.planCode || "";
    for (const copy of copies.slice().reverse()) mergeCopyDataset(dataset, copy, latestBaselineCode);
    const visibleDataset = compactVisibleDataset(datasetService.normalizeIncomingDataset(dataset));
    RelationalStore.syncFromVisibleDataset(db, visibleDataset, copies);
    const projectedDataset = RelationalStore.projectGlobalReferenceRows(db, visibleDataset);
    return {
      dataset: datasetService.normalizeIncomingDataset(projectedDataset),
      copies: copies.map((copy) => stripPayload(copy, user)),
      revision: active.revision,
      updatedBy: active.updatedBy,
      updatedAt: active.updatedAt,
    };
  }

  function normalizeAllNumbering(user) {
    requireAdmin(user);
    const now = nowIso();
    db.exec("BEGIN");
    try {
      const active = datasetService.getActiveDataset();
      const nextActive = datasetService.normalizeNumberingDataset(active.dataset);
      const activePlanAlias = new Map();
      (active.dataset.plans || []).forEach((plan, index) => {
        const nextPlan = (nextActive.plans || []).find((item) =>
          String(item.plan_name || "").trim() === String(plan.plan_name || "").trim() &&
          String(item.source_plan_code || "").trim() === String(plan.source_plan_code || "").trim()
        ) || nextActive.plans?.[index] || nextActive.plans?.[0];
        const nextCode = nextPlan?.plan_code || "";
        for (const key of [plan.plan_code, plan.plan_id, plan.id, plan.source_plan_code]) {
          if (key && nextCode) activePlanAlias.set(String(key).trim(), nextCode);
        }
      });
      const usedPlanCodes = new Set((nextActive.plans || []).map((plan) => plan.plan_code).filter(Boolean));
      const nextRevision = active.revision + 1;
      db.prepare("UPDATE active_dataset SET revision = ?, dataset_json = ?, updated_by = ?, updated_at = ? WHERE id = 1")
        .run(nextRevision, JSON.stringify(nextActive), user.username, now);

      const rows = db.prepare("SELECT * FROM plan_copies WHERE deleted_at IS NULL ORDER BY id ASC").all();
      for (const row of rows) {
        const sourceDataset = row.dataset_json ? JSON.parse(row.dataset_json) : {
          ...nextActive,
          plans: [JSON.parse(row.plan_json)],
          plan_assignments: JSON.parse(row.assignments_json || "[]"),
        };
        const nextDataset = datasetService.normalizeNumberingDataset(sourceDataset);
        const preferredPlan = nextDataset.plans.find((plan) => plan.id === row.plan_code || plan.plan_code === row.plan_code) || nextDataset.plans[0] || JSON.parse(row.plan_json);
        const preferredPlanCode = preferredPlan.plan_code;
        let nextPlanCode = preferredPlan.plan_code;
        if (!nextPlanCode || usedPlanCodes.has(nextPlanCode)) {
          nextPlanCode = nextAvailablePlanCode(usedPlanCodes);
        }
        usedPlanCodes.add(nextPlanCode);
        const nextSourcePlanCode = activePlanAlias.get(preferredPlan.source_plan_code)
          || activePlanAlias.get(row.source_plan_code)
          || preferredPlan.source_plan_code
          || "";
        const nextPlan = {
          ...preferredPlan,
          id: preferredPlan.id || nextPlanCode,
          plan_code: nextPlanCode,
          source_plan_code: nextSourcePlanCode,
          plan_name: row.plan_name || preferredPlan.plan_name || nextPlanCode,
          plan_type: toBoolean(row.is_baseline) ? "baseline" : preferredPlan.plan_type,
          is_locked: toBoolean(row.is_baseline) ? true : toBoolean(preferredPlan.is_locked),
          updated_at: now,
        };
        const nextAssignments = (nextDataset.plan_assignments || [])
          .filter((assignment) => assignment.plan_code === preferredPlanCode || assignment.plan_code === nextPlanCode || assignment.plan_id === nextPlan.id)
          .map((assignment) => ({
            ...assignment,
            id: `${nextPlanCode}__${assignment.lab_code}`,
            plan_code: nextPlanCode,
            plan_id: nextPlan.id,
          }));
        const storedDataset = datasetService.normalizeIncomingDataset({
          ...nextDataset,
          plans: [nextPlan],
          plan_assignments: nextAssignments,
        });
        db.prepare(`
          UPDATE plan_copies
          SET plan_code = ?, plan_json = ?, assignments_json = ?, dataset_json = ?, source_plan_code = ?, revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(nextPlanCode, JSON.stringify(nextPlan), JSON.stringify(nextAssignments), JSON.stringify(storedDataset), nextSourcePlanCode, now, row.id);
      }
      db.exec("COMMIT");
      return { revision: nextRevision, updatedAt: now };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function nextAvailablePlanCode(used) {
    let index = 1;
    while (used.has(`PLAN${String(index).padStart(6, "0")}`)) index += 1;
    return `PLAN${String(index).padStart(6, "0")}`;
  }

  function mergeCopyDataset(dataset, copy, latestBaselineCode) {
    if (copy.dataset) {
      const copyDataset = datasetService.normalizeIncomingDataset(copy.dataset);
      const deletedSpaceIds = deletedSpaceRefValuesForCopy(copyDataset.deleted_space_ids || [], copy.id);
      if (deletedSpaceIds.size) {
        dataset.deleted_space_ids = [...new Set([...(dataset.deleted_space_ids || []), ...scopedDeletedSpaceRefs(copyDataset.deleted_space_ids || [], copy.id)])];
        copyDataset.spaces = (copyDataset.spaces || []).filter((space) => !deletedSpaceIds.has(space.id) && !deletedSpaceIds.has(space.space_code));
        copyDataset.plan_assignments = (copyDataset.plan_assignments || []).map((assignment) => {
          if (!deletedSpaceIds.has(assignment.space_id) && !deletedSpaceIds.has(assignment.space_code)) return assignment;
          return {
            ...assignment,
            previous_space_code: assignment.previous_space_code || assignment.space_code || "",
            previous_space_id: assignment.previous_space_id || assignment.space_id || "",
            space_code: "",
            space_id: "",
            assignment_status: "Invalid",
          };
        });
      }
      const activeDataset = datasetService.normalizeIncomingDataset(datasetService.getActiveDataset().dataset);
      for (const key of COPY_SCOPED_KEYS) {
        if (!Array.isArray(dataset[key])) dataset[key] = [];
        dataset[key].push(...copyScopedRows(key, copyDataset[key] || [], activeDataset[key] || [], copy.id));
      }
    }
    if (!Array.isArray(dataset.plans)) dataset.plans = [];
    if (!Array.isArray(dataset.plan_assignments)) dataset.plan_assignments = [];
    dataset.plans.push(asVisiblePlan(copy.plan, copy, latestBaselineCode));
    dataset.plan_assignments.push(...copy.assignments);
  }

  function asVisiblePlan(plan, copy, latestBaselineCode) {
    return {
      ...plan,
      plan_type: copy.isBaseline ? "baseline" : plan.plan_type,
      is_locked: copy.isBaseline ? true : toBoolean(plan.is_locked),
      is_default_compare_before: copy.isBaseline && copy.planCode === latestBaselineCode,
      is_default_compare_after: false,
    };
  }

  function createCopy(body, user) {
    if (!user) throw httpError(401, "login_required", "请先登录");
    const source = findSourcePlan(body.sourcePlanCode, user);
    const now = nowIso();
    const name = String(body.planName || `${source.plan.plan_name || source.plan.plan_code} 副本`).trim();
    if (!name) throw httpError(400, "invalid_plan_name", "请输入方案名称");

    const result = db.prepare(`
      INSERT INTO plan_copies (
        owner_user_id, plan_code, plan_name, description, visibility, revision,
        plan_json, assignments_json, source_plan_code, source_copy_id, created_at, updated_at, source_type
      ) VALUES (?, ?, ?, ?, 'private', 1, ?, ?, ?, ?, ?, ?, 'copy')
    `).run(
      user.id,
      `pending-${Date.now()}`,
      name,
      String(body.description || "").trim(),
      "{}",
      "[]",
      source.plan.plan_code || "",
      source.copyId || null,
      now,
      now
    );

    const copyId = Number(result.lastInsertRowid);
    const planCode = `copy-${copyId}`;
    const plan = {
      ...source.plan,
      id: planCode,
      plan_code: planCode,
      plan_name: name,
      plan_type: "copy",
      source_plan_code: source.plan.plan_code || "",
      description: String(body.description || source.plan.description || "").trim(),
      is_locked: false,
      is_default_compare_before: false,
      is_default_compare_after: false,
      created_at: now,
      updated_at: now,
    };
    const assignments = source.assignments.map((row) => ({
      ...row,
      id: `${planCode}__${row.lab_code}`,
      plan_code: planCode,
      plan_id: planCode,
      created_at: now,
      updated_at: now,
    }));

    const copyDataset = datasetService.normalizeIncomingDataset({
      ...clone(source.dataset),
      plans: [plan],
      plan_assignments: assignments,
    });
    db.prepare("UPDATE plan_copies SET plan_code = ?, plan_json = ?, assignments_json = ?, dataset_json = ? WHERE id = ?")
      .run(planCode, JSON.stringify(plan), JSON.stringify(assignments), JSON.stringify(copyDataset), copyId);

    return { copyId };
  }

  function createImportedPlans(draftId, fileName, dataset, user) {
    requireAdmin(user);
    const normalized = datasetService.normalizeIncomingDataset(dataset);
    return normalized.plans.map((sourcePlan) => createDatasetBackedCopy({
      sourceType: "import",
      importDraftId: draftId,
      planName: sourcePlan.plan_name || `${fileName} ${sourcePlan.plan_code}`,
      description: sourcePlan.description || `Imported from ${fileName}`,
      sourcePlan,
      sourceAssignments: normalized.plan_assignments.filter((row) => row.plan_code === sourcePlan.plan_code),
      sourceDataset: normalized,
    }, user));
  }

  function createDatasetBackedCopy(options, user) {
    const now = nowIso();
    const result = db.prepare(`
      INSERT INTO plan_copies (
        owner_user_id, plan_code, plan_name, description, visibility, revision,
        plan_json, assignments_json, source_plan_code, source_copy_id, created_at, updated_at,
        source_type, dataset_json, import_draft_id, is_baseline
      ) VALUES (?, ?, ?, ?, 'private', 1, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)
    `).run(
      user.id,
      `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      String(options.planName || "").trim(),
      String(options.description || "").trim(),
      "{}",
      "[]",
      options.sourcePlan.plan_code || "",
      now,
      now,
      options.sourceType || "copy",
      null,
      options.importDraftId || null
    );
    const copyId = Number(result.lastInsertRowid);
    const planCode = `copy-${copyId}`;
    const plan = {
      ...options.sourcePlan,
      id: planCode,
      plan_code: planCode,
      plan_name: String(options.planName || options.sourcePlan.plan_name || planCode).trim(),
      plan_type: "copy",
      source_plan_code: options.sourcePlan.plan_code || "",
      description: String(options.description || options.sourcePlan.description || "").trim(),
      is_locked: false,
      is_default_compare_before: false,
      is_default_compare_after: false,
      created_at: now,
      updated_at: now,
    };
    const assignments = options.sourceAssignments.map((row) => ({
      ...row,
      id: `${planCode}__${row.lab_code}`,
      plan_code: planCode,
      plan_id: planCode,
      created_at: now,
      updated_at: now,
    }));
    const copyDataset = datasetService.normalizeIncomingDataset({
      ...clone(options.sourceDataset),
      plans: [plan],
      plan_assignments: assignments,
    });
    db.prepare("UPDATE plan_copies SET plan_code = ?, plan_json = ?, assignments_json = ?, dataset_json = ? WHERE id = ?")
      .run(planCode, JSON.stringify(plan), JSON.stringify(assignments), JSON.stringify(copyDataset), copyId);
    return { copyId, planCode };
  }

  function updateCopy(copyId, body, user) {
    const row = getOwnedCopy(copyId, user);
    const now = nowIso();
    const plan = JSON.parse(row.plan_json);
    const nextVisibility = body.visibility === undefined ? row.visibility : (body.visibility === "public" ? "public" : "private");
    const nextName = body.planName === undefined ? row.plan_name : String(body.planName || "").trim();
    if (!nextName) throw httpError(400, "invalid_plan_name", "请输入方案名称");
    const description = body.description === undefined ? row.description : String(body.description || "").trim();

    const nextPlan = {
      ...plan,
      plan_name: nextName,
      description,
      updated_at: now,
    };
    const nextDatasetJson = updateDatasetPlanName(row.dataset_json, row.plan_code, nextName, description, nextPlan);
    db.prepare(`
      UPDATE plan_copies
      SET plan_name = ?, description = ?, visibility = ?, plan_json = ?, dataset_json = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, description, nextVisibility, JSON.stringify(nextPlan), nextDatasetJson, now, copyId);
  }

  function updateManagedPlan(copyId, body, user) {
    requireAdmin(user);
    updateCopy(copyId, body, user);
  }

  function updateActiveManagedPlan(planCode, body, user) {
    requireAdmin(user);
    const active = datasetService.getActiveDataset();
    const dataset = datasetService.normalizeIncomingDataset(active.dataset);
    const code = String(planCode || "").trim();
    const plan = (dataset.plans || []).find((item) => item.plan_code === code || item.id === code);
    if (!plan) throw httpError(404, "plan_not_found", "未找到方案");
    const nextName = body.planName === undefined ? plan.plan_name : String(body.planName || "").trim();
    if (!nextName) throw httpError(400, "invalid_plan_name", "请输入方案名称");
    const description = body.description === undefined ? plan.description || "" : String(body.description || "").trim();
    const now = nowIso();
    const nextDataset = {
      ...dataset,
      plans: dataset.plans.map((item) => {
        if (item !== plan) return item;
        return { ...item, plan_name: nextName, description, updated_at: now };
      }),
    };
    return datasetService.saveActiveDataset(datasetService.normalizeIncomingDataset(nextDataset), user.username);
  }

  function setManagedPlanBaseline(copyId, user, isBaseline = true) {
    requireAdmin(user);
    const row = getOwnedCopy(copyId, user);
    const now = nowIso();
    const plan = JSON.parse(row.plan_json);
    const baseline = isBaseline !== false;
    const nextPlan = {
      ...plan,
      plan_type: baseline ? "baseline" : "copy",
      is_locked: baseline,
      is_default_compare_before: baseline,
      is_default_compare_after: false,
      updated_at: now,
    };
    const nextDatasetJson = updateDatasetPlanName(row.dataset_json, row.plan_code, row.plan_name, row.description, nextPlan);
    db.prepare(`
      UPDATE plan_copies
      SET is_baseline = ?, baselined_at = ?, baselined_by = ?, plan_json = ?, dataset_json = ?, updated_at = ?
      WHERE id = ?
    `).run(baseline ? 1 : 0, baseline ? now : null, baseline ? user.username : null, JSON.stringify(nextPlan), nextDatasetJson, now, copyId);
  }

  function setActiveManagedPlanBaseline(planCode, user, isBaseline = true) {
    requireAdmin(user);
    const active = datasetService.getActiveDataset();
    const dataset = datasetService.normalizeIncomingDataset(active.dataset);
    const code = String(planCode || "").trim();
    let found = false;
    const now = nowIso();
    const baseline = isBaseline !== false;
    const nextDataset = {
      ...dataset,
      plans: (dataset.plans || []).map((plan) => {
        if (plan.plan_code !== code && plan.id !== code) return plan;
        found = true;
        return {
          ...plan,
          plan_type: baseline ? "baseline" : "draft",
          is_locked: baseline,
          is_default_compare_before: baseline,
          is_default_compare_after: false,
          updated_at: now,
        };
      }),
    };
    if (!found) throw httpError(404, "plan_not_found", "未找到方案");
    return datasetService.saveActiveDataset(datasetService.normalizeIncomingDataset(nextDataset), user.username);
  }

  function saveAssignments(copyId, body, user) {
    const row = getOwnedCopy(copyId, user);
    if (Number(body.expectedRevision) !== row.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前方案已被更新，请刷新后重试"), {
        payload: { copy: publicCopy(row) },
      });
    }

    const plan = JSON.parse(row.plan_json);
    const base = row.dataset_json ? JSON.parse(row.dataset_json) : clone(datasetService.getActiveDataset().dataset);
    const rawAssignments = Array.isArray(body.assignments) ? body.assignments : [];
    const normalized = datasetService.normalizeIncomingDataset({
      ...base,
      plans: [...(base.plans || []).filter((item) => item.plan_code !== row.plan_code), plan],
      plan_assignments: [
        ...(base.plan_assignments || []).filter((assignment) => assignment.plan_code !== row.plan_code),
        ...rawAssignments.map((assignment) => ({ ...assignment, plan_code: row.plan_code })),
      ],
    });
    const assignments = normalized.plan_assignments.filter((assignment) => assignment.plan_code === row.plan_code);
    const now = nowIso();
    const revision = row.revision + 1;
    const copyDatasetPayload = copyScopedDataset(normalized, copyId);
    const nextDatasetJson = row.dataset_json ? JSON.stringify(datasetService.normalizeIncomingDataset({
      ...normalized,
      ...copyDatasetPayload,
      plans: normalized.plans.filter((item) => item.plan_code === row.plan_code),
      plan_assignments: assignments,
    })) : row.dataset_json;

    db.prepare(`
      UPDATE plan_copies
      SET assignments_json = ?, dataset_json = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(assignments), nextDatasetJson, revision, now, copyId);
    const relationDataset = nextDatasetJson
      ? JSON.parse(nextDatasetJson)
      : datasetService.normalizeIncomingDataset({ ...normalized, plans: [plan], plan_assignments: assignments });
    syncSavedCopyDataset(row, plan, assignments, relationDataset, revision, now);
    return { revision, updatedAt: now };
  }

  function saveCopyDataset(copyId, body, user) {
    const row = getOwnedCopy(copyId, user);
    if (Number(body.expectedRevision) !== row.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前方案已被更新，请刷新后重试"), {
        payload: { copy: publicCopy(row) },
      });
    }
    const normalized = datasetService.normalizeIncomingDataset(body.dataset);
    const plan = normalized.plans.find((item) => item.plan_code === row.plan_code || item.id === row.plan_code) || JSON.parse(row.plan_json);
    const assignments = normalized.plan_assignments.filter((item) => item.plan_code === row.plan_code || item.plan_id === row.plan_code);
    const now = nowIso();
    const revision = row.revision + 1;
    const nextPlan = {
      ...plan,
      id: row.plan_code,
      plan_code: row.plan_code,
      plan_name: row.plan_name,
      plan_type: toBoolean(row.is_baseline) ? "baseline" : plan.plan_type,
      is_locked: toBoolean(row.is_baseline) ? true : toBoolean(plan.is_locked),
      updated_at: now,
    };
    const nextAssignments = assignments.map((assignment) => ({
      ...assignment,
      id: `${row.plan_code}__${assignment.lab_code}`,
      plan_code: row.plan_code,
      plan_id: row.plan_code,
    }));
    const copyDatasetPayload = copyScopedDataset(normalized, copyId);
    const nextDataset = datasetService.normalizeIncomingDataset({
      ...normalized,
      ...copyDatasetPayload,
      plans: [nextPlan],
      plan_assignments: nextAssignments,
    });
    db.prepare(`
      UPDATE plan_copies
      SET plan_json = ?, assignments_json = ?, dataset_json = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(nextPlan), JSON.stringify(nextAssignments), JSON.stringify(nextDataset), revision, now, copyId);
    syncSavedCopyDataset(row, nextPlan, nextAssignments, nextDataset, revision, now);
    return { revision, updatedAt: now };
  }

  function syncSavedCopyDataset(row, plan, assignments, dataset, revision, updatedAt) {
    const copy = publicCopy({
      ...row,
      revision,
      updated_at: updatedAt,
      plan_json: JSON.stringify(plan),
      assignments_json: JSON.stringify(assignments),
      dataset_json: JSON.stringify(dataset),
    });
    RelationalStore.syncFromVisibleDataset(db, datasetService.normalizeIncomingDataset(dataset), [copy]);
  }

  function copyScopedDataset(normalized, copyId) {
    const active = datasetService.normalizeIncomingDataset(datasetService.getActiveDataset().dataset);
    const next = {};
    for (const key of COPY_SCOPED_KEYS) {
      next[key] = copyScopedRows(key, normalized[key] || [], active[key] || [], copyId);
    }
    next.deleted_space_ids = scopedDeletedSpaceRefs(normalized.deleted_space_ids || [], copyId);
    next.imports = normalized.imports || [];
    return next;
  }

  function copyScopedRows(key, rows, activeRows, copyId) {
    const activeById = new Map((activeRows || []).map((row) => [text(row.id), row]));
    const activeByKey = new Map((activeRows || []).map((row) => [copyScopedCompareKey(key, row), row]).filter(([rowKey]) => rowKey));
    return (rows || [])
      .filter((row) => {
        const rowCopyId = Number(row?.copy_id || row?.copyId || 0);
        if (rowCopyId && rowCopyId !== copyId) return false;
        if (rowCopyId === copyId) return true;
        const activeRow = activeById.get(text(row.id)) || activeByKey.get(copyScopedCompareKey(key, row));
        return !activeRow || !rowsEquivalentForCopy(activeRow, row);
      })
      .map((row) => markRowForCopy(row, copyId));
  }

  function copyScopedCompareKey(key, row) {
    if (!row) return "";
    if (key === "buildings") return buildingKey(row);
    if (key === "floor_segments") return floorSegmentKey(row);
    if (key === "spaces") return spacePhysicalKey(row);
    if (key === "labs") return labKey(row);
    if (key === "colleges") return collegeKey(row);
    if (key === "majors") return majorKey(row);
    if (key === "lab_types") return labTypeKey(row);
    if (key === "file_assets") return rowIdKey(row);
    return rowIdKey(row);
  }

  function rowsEquivalentForCopy(left, right) {
    return JSON.stringify(unscopedRow(left)) === JSON.stringify(unscopedRow(right));
  }

  function unscopedRow(row) {
    const { copy_id: _copyId, copyId: _copyIdCamel, ...rest } = row || {};
    return Object.fromEntries(Object.entries(rest).sort(([left], [right]) => left.localeCompare(right)));
  }

  function markRowsForCopy(rows, copyId) {
    return (rows || []).map((row) => markRowForCopy(row, copyId));
  }

  function markRowForCopy(row, copyId) {
    const current = Number(row?.copy_id || row?.copyId || 0);
    return current === copyId ? row : { ...row, copy_id: copyId };
  }

  function deleteCopy(copyId, user) {
    getOwnedCopy(copyId, user);
    db.prepare("UPDATE plan_copies SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), copyId);
  }

  function deleteManagedPlan(copyId, user) {
    requireAdmin(user);
    if (manageablePlanCount() <= 1) {
      throw httpError(400, "last_plan_required", "至少需要保留一个方案");
    }
    deleteCopy(copyId, user);
  }

  function deleteActiveManagedPlan(planCode, user) {
    requireAdmin(user);
    if (manageablePlanCount() <= 1) {
      throw httpError(400, "last_plan_required", "至少需要保留一个方案");
    }
    const active = datasetService.getActiveDataset();
    const dataset = datasetService.normalizeIncomingDataset(active.dataset);
    const code = String(planCode || "").trim();
    const plans = (dataset.plans || []).filter((plan) => plan.plan_code !== code && plan.id !== code);
    if (plans.length === (dataset.plans || []).length) throw httpError(404, "plan_not_found", "未找到方案");
    const removedCodes = new Set((dataset.plans || [])
      .filter((plan) => plan.plan_code === code || plan.id === code)
      .flatMap((plan) => [plan.plan_code, plan.id].filter(Boolean)));
    const nextDataset = {
      ...dataset,
      plans,
      plan_assignments: (dataset.plan_assignments || []).filter((assignment) =>
        !removedCodes.has(assignment.plan_code) && !removedCodes.has(assignment.plan_id)
      ),
    };
    return datasetService.saveActiveDataset(datasetService.normalizeIncomingDataset(nextDataset), user.username);
  }

  function findSourcePlan(sourcePlanCode, user) {
    const code = String(sourcePlanCode || "").trim();
    const active = datasetService.getActiveDataset();
    const base = datasetService.normalizeIncomingDataset(active.dataset);
    const basePlan = base.plans.find((plan) => plan.plan_code === code || plan.id === code) || base.plans[0];
    if (basePlan) {
      return {
        plan: basePlan,
        assignments: base.plan_assignments.filter((row) => row.plan_code === basePlan.plan_code),
        copyId: null,
        dataset: base,
      };
    }

    const copyId = Number(String(code).replace(/^copy-/, ""));
    if (copyId) {
      const row = getVisibleCopy(copyId, user);
      if (row) {
        const copy = publicCopy(row);
        return {
          plan: copy.plan,
          assignments: copy.assignments,
          copyId,
          dataset: buildSingleCopyDataset(copy),
        };
      }
    }
    throw httpError(404, "source_plan_not_found", "未找到可复制的方案");
  }

  function getManagedPlan(copyId, user) {
    requireAdmin(user);
    const row = db.prepare(`
      SELECT plan_copies.*, users.username AS owner_username, users.role AS owner_role
      FROM plan_copies
      JOIN users ON users.id = plan_copies.owner_user_id
      WHERE plan_copies.id = ? AND plan_copies.deleted_at IS NULL
    `).get(copyId);
    if (!row) throw httpError(404, "copy_not_found", "未找到方案");
    const copy = publicCopy(row);
    return {
      plan: stripPayload(copy, user),
      dataset: buildSingleCopyDataset(copy),
    };
  }

  function getActiveManagedPlan(planCode, user) {
    requireAdmin(user);
    const active = datasetService.getActiveDataset();
    const dataset = datasetService.normalizeIncomingDataset(active.dataset);
    const code = String(planCode || "").trim();
    const plan = (dataset.plans || []).find((item) => item.plan_code === code || item.id === code);
    if (!plan) throw httpError(404, "plan_not_found", "未找到方案");
    return {
      plan: stripActivePlanPayload(publicActivePlan(plan, active), user),
      dataset,
    };
  }

  function buildSingleCopyDataset(copy) {
    const base = baseDatasetForCopy(copy);
    return datasetService.normalizeIncomingDataset({
      ...base,
      plans: [copy.plan],
      plan_assignments: copy.assignments,
    });
  }

  function baseDatasetForCopy(copy, seen = new Set()) {
    if (copy.dataset) return clone(copy.dataset);
    if (copy.sourceCopyId && !seen.has(copy.sourceCopyId)) {
      seen.add(copy.sourceCopyId);
      const row = db.prepare(`
        SELECT plan_copies.*, users.username AS owner_username, users.role AS owner_role
        FROM plan_copies
        JOIN users ON users.id = plan_copies.owner_user_id
        WHERE plan_copies.id = ? AND plan_copies.deleted_at IS NULL
      `).get(copy.sourceCopyId);
      if (row) {
        const source = publicCopy(row);
        return baseDatasetForCopy(source, seen);
      }
    }
    return clone(datasetService.getActiveDataset().dataset);
  }

  function publicCopy(row) {
    const plan = JSON.parse(row.plan_json);
    const assignments = JSON.parse(row.assignments_json);
    const dataset = row.dataset_json ? JSON.parse(row.dataset_json) : null;
    const isBaseline = toBoolean(row.is_baseline);
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerUsername: row.owner_username || "",
      ownerRole: row.owner_role || "",
      planCode: row.plan_code,
      planName: row.plan_name,
      description: row.description,
      visibility: row.visibility,
      isPublic: toBoolean(row.visibility === "public"),
      isBaseline,
      sourceType: row.source_type || "copy",
      importDraftId: row.import_draft_id || null,
      baselinedAt: row.baselined_at || "",
      baselinedBy: row.baselined_by || "",
      hasDataset: Boolean(dataset),
      revision: row.revision,
      sourcePlanCode: row.source_plan_code,
      sourceCopyId: row.source_copy_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      plan: {
        ...plan,
        id: row.plan_code,
        copy_id: row.id,
        plan_code: row.plan_code,
        plan_name: row.plan_name,
        description: row.description,
        plan_type: isBaseline ? "baseline" : plan.plan_type,
        is_locked: isBaseline ? true : toBoolean(plan.is_locked),
      },
      assignments: assignments.map((assignment) => ({
        ...assignment,
        id: `${row.plan_code}__${assignment.lab_code}`,
        plan_code: row.plan_code,
        plan_id: row.plan_code,
      })),
      dataset,
    };
  }

  function stripPayload(copy, user) {
    const { plan, assignments, dataset, ...rest } = copy;
    const canSeeOwner = user && (user.role === "admin" || user.id === copy.ownerUserId);
    if (!canSeeOwner) delete rest.ownerUsername;
    rest.isMine = Boolean(user && user.id === copy.ownerUserId);
    return rest;
  }

  function updateDatasetPlanName(datasetJson, planCode, planName, description, planOverride = null) {
    if (!datasetJson) return datasetJson;
    const dataset = JSON.parse(datasetJson);
    dataset.plans = (dataset.plans || []).map((plan) => {
      if (plan.plan_code !== planCode && plan.id !== planCode) return plan;
      return {
        ...plan,
        ...(planOverride || {}),
        id: planCode,
        plan_code: planCode,
        plan_name: planName,
        description,
      };
    });
    return JSON.stringify(dataset);
  }

  function requireAdmin(user) {
    if (!user || user.role !== "admin") throw httpError(403, "forbidden", "Only admin can manage plans");
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  return {
    buildVisibleDataset,
    normalizeAllNumbering,
    listBackupRows,
    copyPayloadIndex,
    createCopy,
    createImportedPlans,
    updateCopy,
    updateManagedPlan,
    updateActiveManagedPlan,
    setManagedPlanBaseline,
    setActiveManagedPlanBaseline,
    saveAssignments,
    saveCopyDataset,
    deleteCopy,
    deleteManagedPlan,
    deleteActiveManagedPlan,
    listManageablePlans,
    getManagedPlan,
    getActiveManagedPlan,
  };
}

function compactVisibleDataset(raw) {
  const dataset = { ...(raw || {}) };
  const deletedSpaceRefs = (dataset.deleted_space_ids || []).map(parseDeletedSpaceRef).filter((ref) => ref.ref);
  if (deletedSpaceRefs.length) {
    dataset.spaces = (dataset.spaces || []).filter((space) => !deletedSpaceRefMatchesRow(deletedSpaceRefs, space));
    dataset.plan_assignments = (dataset.plan_assignments || []).map((assignment) => {
      if (!deletedSpaceRefMatchesAssignment(deletedSpaceRefs, assignment)) return assignment;
      return {
        ...assignment,
        previous_space_code: assignment.previous_space_code || assignment.space_code || "",
        previous_space_id: assignment.previous_space_id || assignment.space_id || "",
        space_code: "",
        space_id: "",
        assignment_status: "Invalid",
      };
    });
  }
  const buildings = compactRows(dataset.buildings, buildingKey, buildingScore);
  const floorSegments = compactRows(dataset.floor_segments, floorSegmentKey, floorSegmentScore);
  const spaces = compactRows(dataset.spaces, spacePhysicalKey, spaceScore, ["space_code"]);
  const labs = compactRows(dataset.labs, labKey, labScore, ["lab_code"]);
  const colleges = compactRows(dataset.colleges, collegeKey, defaultScore, ["college_code", "college_name"]);
  const majors = compactRows(dataset.majors, majorKey, defaultScore, ["major_code", "major_name"]);
  const labTypes = compactRows(dataset.lab_types, labTypeKey, defaultScore, ["type_code", "type_name"]);
  const fileAssets = compactRows(dataset.file_assets, rowIdKey, defaultScore);

  dataset.buildings = buildings.rows;
  dataset.floor_segments = floorSegments.rows;
  dataset.spaces = spaces.rows;
  dataset.labs = labs.rows;
  dataset.colleges = colleges.rows;
  dataset.majors = majors.rows;
  dataset.lab_types = labTypes.rows;
  dataset.file_assets = fileAssets.rows;

  const spacesById = new Map(dataset.spaces.map((row) => [text(row.id), row]));
  const labsById = new Map(dataset.labs.map((row) => [text(row.id), row]));
  dataset.plan_assignments = (dataset.plan_assignments || []).map((assignment) => {
    const nextSpaceId = aliasValue(spaces.idAliases, assignment.space_id);
    const nextSpace = spacesById.get(nextSpaceId);
    const nextLabId = aliasValue(labs.idAliases, assignment.lab_id);
    const nextLab = labsById.get(nextLabId);
    return {
      ...assignment,
      lab_id: nextLabId,
      lab_code: nextLab?.lab_code || aliasValue(labs.fieldAliases.lab_code, assignment.lab_code),
      space_id: nextSpaceId,
      space_code: nextSpace?.space_code || aliasValue(spaces.fieldAliases.space_code, assignment.space_code),
    };
  });

  return dataset;
}

function compactRows(rows = [], keyFn, scoreFn, aliasFields = []) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const keptRows = [];
  const idAliases = new Map();
  const fieldAliases = Object.fromEntries(aliasFields.map((field) => [field, new Map()]));
  for (const group of groups.values()) {
    const kept = chooseVisibleRow(group, scoreFn);
    keptRows.push(kept);
    for (const row of group) {
      recordAlias(idAliases, row.id, kept.id);
      for (const field of aliasFields) {
        recordAlias(fieldAliases[field], row[field], kept[field]);
      }
    }
  }
  return { rows: keptRows, idAliases, fieldAliases };
}

function chooseVisibleRow(rows, scoreFn) {
  return rows.reduce((best, row) => {
    const bestScore = scoreFn(best);
    const rowScore = scoreFn(row);
    return rowScore >= bestScore ? row : best;
  }, rows[0]);
}

function recordAlias(map, fromValue, toValue) {
  const from = text(fromValue);
  const to = text(toValue);
  if (!from || !to || from === to) return;
  if (map.has(from) && map.get(from) !== to) {
    map.set(from, "");
    return;
  }
  map.set(from, to);
}

function aliasValue(map, value) {
  const raw = text(value);
  if (!raw) return raw;
  return map.get(raw) || raw;
}

function defaultScore(_row) {
  return 0;
}

function buildingScore(row) {
  return text(row.id) === text(row.building_code) ? 1 : 0;
}

function floorSegmentScore(row) {
  const expected = `${text(row.building_code)}__${text(row.floor_code)}__${text(row.segment_code)}`;
  return text(row.id) === expected ? 1 : 0;
}

function labScore(row) {
  return text(row.id) === text(row.lab_code) ? 1 : 0;
}

function spaceScore(row) {
  const id = text(row.id);
  const expected = `${text(row.building_code)}__${text(row.floor_code)}__${text(row.space_code)}`;
  let score = id === expected ? 4 : 0;
  if (id.startsWith(`${text(row.building_code)}__${text(row.floor_code)}__`)) score += 2;
  if (/^\d{11}$/.test(text(row.space_code))) score += 1;
  return score;
}

function rowIdKey(row) {
  return scopedRowKey(row, text(row.id));
}

function buildingKey(row) {
  return scopedRowKey(row, text(row.building_code) || text(row.id));
}

function floorSegmentKey(row) {
  return scopedRowKey(row, joinKey([row.building_code, row.floor_code, row.segment_code]));
}

function labKey(row) {
  return scopedRowKey(row, text(row.lab_code) || text(row.id));
}

function collegeKey(row) {
  return scopedRowKey(row, text(row.college_code) || text(row.college_name) || text(row.id));
}

function majorKey(row) {
  return scopedRowKey(row, text(row.major_code) || joinKey([row.college_code, row.major_name]) || text(row.id));
}

function labTypeKey(row) {
  return scopedRowKey(row, text(row.type_code) || text(row.type_name) || text(row.id));
}

function spacePhysicalKey(row) {
  const frontDoor = text(row.front_door) || text(row.space_code);
  const rawRearDoor = text(row.rear_door);
  const rearDoor = rawRearDoor === frontDoor ? "" : rawRearDoor;
  return scopedRowKey(row, joinKey([row.building_code, row.floor_code, frontDoor, rearDoor]));
}

function scopedRowKey(row, key) {
  if (!key) return "";
  const copyId = text(row.copy_id) || text(row.copyId);
  return copyId ? `copy:${copyId}::${key}` : key;
}

function joinKey(values) {
  const parts = values.map(text);
  return parts.some(Boolean) ? parts.join("::") : "";
}

function text(value) {
  return String(value || "").trim();
}

function parseDeletedSpaceRef(value) {
  const raw = text(value);
  const match = raw.match(/^copy:(\d+)::(.+)$/);
  if (!match) return { copyId: null, ref: raw };
  return { copyId: Number(match[1]), ref: text(match[2]) };
}

function scopedDeletedSpaceRefs(refs, copyId) {
  const values = new Set();
  for (const value of refs || []) {
    const parsed = parseDeletedSpaceRef(value);
    if (!parsed.ref) continue;
    if (parsed.copyId && parsed.copyId !== Number(copyId)) continue;
    values.add(`copy:${Number(copyId)}::${parsed.ref}`);
  }
  return [...values];
}

function deletedSpaceRefValuesForCopy(refs, copyId) {
  const values = new Set();
  for (const value of refs || []) {
    const parsed = parseDeletedSpaceRef(value);
    if (!parsed.ref) continue;
    if (parsed.copyId && parsed.copyId !== Number(copyId)) continue;
    values.add(parsed.ref);
  }
  return values;
}

function rowCopyId(row) {
  return Number(row?.copy_id || row?.copyId || 0);
}

function assignmentCopyId(row) {
  const raw = text(row?.plan_id) || text(row?.plan_code);
  const match = raw.match(/^copy-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function deletedSpaceRefMatchesRow(refs, row) {
  const copyId = rowCopyId(row);
  for (const ref of refs || []) {
    if (!ref.ref) continue;
    if (ref.copyId) {
      if (copyId !== ref.copyId) continue;
    } else if (copyId) {
      continue;
    }
    if (text(row?.id) === ref.ref || text(row?.space_code) === ref.ref) return true;
  }
  return false;
}

function deletedSpaceRefMatchesAssignment(refs, row) {
  const copyId = assignmentCopyId(row);
  for (const ref of refs || []) {
    if (!ref.ref) continue;
    if (ref.copyId) {
      if (copyId !== ref.copyId) continue;
    }
    if (text(row?.space_id) === ref.ref || text(row?.space_code) === ref.ref) return true;
  }
  return false;
}

module.exports = { createPlanCopyService, compactVisibleDataset };
