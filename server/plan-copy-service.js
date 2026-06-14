const { httpError, nowIso, toBoolean } = require("./http-utils");

function createPlanCopyService(db, datasetService) {
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
    return db.prepare(`
      SELECT plan_copies.*, users.username AS owner_username, users.role AS owner_role
      FROM plan_copies
      JOIN users ON users.id = plan_copies.owner_user_id
      WHERE plan_copies.deleted_at IS NULL
        AND (plan_copies.is_baseline = 1 OR plan_copies.visibility = 'public' OR users.role = 'admin')
      ORDER BY plan_copies.is_baseline DESC, plan_copies.updated_at DESC, plan_copies.id DESC
    `).all().map((row) => stripPayload(publicCopy(row), user));
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
    const dataset = clone(active.dataset);
    const copies = listVisibleCopies(user);
    const latestBaselineCode = copies.find((copy) => copy.isBaseline)?.planCode || "";
    for (const copy of copies.slice().reverse()) mergeCopyDataset(dataset, copy, latestBaselineCode);
    return {
      dataset: datasetService.normalizeIncomingDataset(dataset),
      copies: copies.map((copy) => stripPayload(copy, user)),
      revision: active.revision,
      updatedBy: active.updatedBy,
      updatedAt: active.updatedAt,
    };
  }

  function mergeCopyDataset(dataset, copy, latestBaselineCode) {
    if (copy.dataset) {
      const deletedSpaceIds = new Set(copy.dataset.deleted_space_ids || []);
      if (deletedSpaceIds.size) {
        dataset.deleted_space_ids = [...new Set([...(dataset.deleted_space_ids || []), ...deletedSpaceIds])];
        dataset.spaces = (dataset.spaces || []).filter((space) => !deletedSpaceIds.has(space.id));
        dataset.plan_assignments = (dataset.plan_assignments || []).map((assignment) => {
          if (!deletedSpaceIds.has(assignment.space_id)) return assignment;
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
      for (const key of ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "file_assets"]) {
        dataset[key].push(...(copy.dataset[key] || []));
      }
    }
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

    db.prepare("UPDATE plan_copies SET plan_code = ?, plan_json = ?, assignments_json = ? WHERE id = ?")
      .run(planCode, JSON.stringify(plan), JSON.stringify(assignments), copyId);

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

  function setManagedPlanBaseline(copyId, user) {
    requireAdmin(user);
    const row = getOwnedCopy(copyId, user);
    const now = nowIso();
    const plan = JSON.parse(row.plan_json);
    const nextPlan = {
      ...plan,
      plan_type: "baseline",
      is_locked: true,
      is_default_compare_before: true,
      is_default_compare_after: false,
      updated_at: now,
    };
    const nextDatasetJson = updateDatasetPlanName(row.dataset_json, row.plan_code, row.plan_name, row.description, nextPlan);
    db.prepare(`
      UPDATE plan_copies
      SET is_baseline = 1, baselined_at = ?, baselined_by = ?, plan_json = ?, dataset_json = ?, updated_at = ?
      WHERE id = ?
    `).run(now, user.username, JSON.stringify(nextPlan), nextDatasetJson, now, copyId);
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
    const nextDatasetJson = row.dataset_json ? JSON.stringify({
      ...normalized,
      plans: normalized.plans.filter((item) => item.plan_code === row.plan_code),
      plan_assignments: assignments,
    }) : row.dataset_json;

    db.prepare(`
      UPDATE plan_copies
      SET assignments_json = ?, dataset_json = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(assignments), nextDatasetJson, revision, now, copyId);
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
    const nextDataset = datasetService.normalizeIncomingDataset({
      ...normalized,
      plans: [nextPlan],
      plan_assignments: nextAssignments,
    });
    db.prepare(`
      UPDATE plan_copies
      SET plan_json = ?, assignments_json = ?, dataset_json = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(nextPlan), JSON.stringify(nextAssignments), JSON.stringify(nextDataset), revision, now, copyId);
    return { revision, updatedAt: now };
  }

  function deleteCopy(copyId, user) {
    getOwnedCopy(copyId, user);
    db.prepare("UPDATE plan_copies SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), copyId);
  }

  function deleteManagedPlan(copyId, user) {
    requireAdmin(user);
    deleteCopy(copyId, user);
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

  function buildSingleCopyDataset(copy) {
    const base = copy.dataset ? clone(copy.dataset) : clone(datasetService.getActiveDataset().dataset);
    const withoutCurrent = {
      ...base,
      plans: (base.plans || []).filter((plan) => plan.plan_code !== copy.planCode && plan.id !== copy.planCode),
      plan_assignments: (base.plan_assignments || []).filter((assignment) => assignment.plan_code !== copy.planCode),
    };
    withoutCurrent.plans.push(copy.plan);
    withoutCurrent.plan_assignments.push(...copy.assignments);
    return datasetService.normalizeIncomingDataset(withoutCurrent);
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
    createCopy,
    createImportedPlans,
    updateCopy,
    updateManagedPlan,
    setManagedPlanBaseline,
    saveAssignments,
    saveCopyDataset,
    deleteCopy,
    deleteManagedPlan,
    listManageablePlans,
    getManagedPlan,
  };
}

module.exports = { createPlanCopyService };
