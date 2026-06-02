const { httpError, nowIso, toBoolean } = require("./http-utils");

function createPlanCopyService(db, datasetService) {
  function visibleWhere(user) {
    if (user) return "(deleted_at IS NULL AND (visibility = 'public' OR owner_user_id = ?))";
    return "(deleted_at IS NULL AND visibility = 'public')";
  }

  function visibleParams(user) {
    return user ? [user.id] : [];
  }

  function listVisibleCopies(user) {
    return db.prepare(`
      SELECT plan_copies.*, users.username AS owner_username
      FROM plan_copies
      JOIN users ON users.id = plan_copies.owner_user_id
      WHERE ${visibleWhere(user)}
      ORDER BY plan_copies.updated_at DESC, plan_copies.id DESC
    `).all(...visibleParams(user)).map(publicCopy);
  }

  function getVisibleCopy(copyId, user) {
    const row = db.prepare(`
      SELECT plan_copies.*, users.username AS owner_username
      FROM plan_copies
      JOIN users ON users.id = plan_copies.owner_user_id
      WHERE plan_copies.id = ? AND ${visibleWhere(user)}
    `).get(copyId, ...visibleParams(user));
    return row || null;
  }

  function getOwnedCopy(copyId, user) {
    const row = db.prepare("SELECT * FROM plan_copies WHERE id = ? AND deleted_at IS NULL").get(copyId);
    if (!row) throw httpError(404, "copy_not_found", "未找到方案副本");
    if (!user || (row.owner_user_id !== user.id && user.role !== "admin")) {
      throw httpError(403, "forbidden", "只能管理自己创建的方案副本");
    }
    return row;
  }

  function buildVisibleDataset(user) {
    const active = datasetService.getActiveDataset();
    const dataset = clone(active.dataset);
    const copies = listVisibleCopies(user);
    for (const copy of copies) {
      dataset.plans.push(copy.plan);
      dataset.plan_assignments.push(...copy.assignments);
    }
    return {
      dataset: datasetService.normalizeIncomingDataset(dataset),
      copies: copies.map((copy) => stripPayload(copy, user)),
      revision: active.revision,
      updatedBy: active.updatedBy,
      updatedAt: active.updatedAt,
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
        plan_json, assignments_json, source_plan_code, source_copy_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'private', 1, ?, ?, ?, ?, ?, ?)
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

    db.prepare(`
      UPDATE plan_copies
      SET plan_code = ?, plan_json = ?, assignments_json = ?
      WHERE id = ?
    `).run(planCode, JSON.stringify(plan), JSON.stringify(assignments), copyId);

    return { copyId };
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
    db.prepare(`
      UPDATE plan_copies
      SET plan_name = ?, description = ?, visibility = ?, plan_json = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, description, nextVisibility, JSON.stringify(nextPlan), now, copyId);
  }

  function saveAssignments(copyId, body, user) {
    const row = getOwnedCopy(copyId, user);
    if (Number(body.expectedRevision) !== row.revision) {
      throw Object.assign(httpError(409, "revision_conflict", "当前方案副本已被更新，请刷新后重试"), {
        payload: { copy: publicCopy(row) },
      });
    }

    const plan = JSON.parse(row.plan_json);
    const active = datasetService.getActiveDataset();
    const base = clone(active.dataset);
    const rawAssignments = Array.isArray(body.assignments) ? body.assignments : [];
    const normalized = datasetService.normalizeIncomingDataset({
      ...base,
      plans: [...base.plans, plan],
      plan_assignments: [
        ...base.plan_assignments,
        ...rawAssignments.map((assignment) => ({ ...assignment, plan_code: row.plan_code })),
      ],
    });
    const assignments = normalized.plan_assignments.filter((assignment) => assignment.plan_code === row.plan_code);
    const now = nowIso();
    const revision = row.revision + 1;

    db.prepare(`
      UPDATE plan_copies
      SET assignments_json = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(assignments), revision, now, copyId);
    return { revision, updatedAt: now };
  }

  function deleteCopy(copyId, user) {
    getOwnedCopy(copyId, user);
    db.prepare("UPDATE plan_copies SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), copyId);
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
        return {
          plan: JSON.parse(row.plan_json),
          assignments: JSON.parse(row.assignments_json),
          copyId,
        };
      }
    }
    throw httpError(404, "source_plan_not_found", "未找到可复制的方案");
  }

  function publicCopy(row) {
    const plan = JSON.parse(row.plan_json);
    const assignments = JSON.parse(row.assignments_json);
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerUsername: row.owner_username || "",
      planCode: row.plan_code,
      planName: row.plan_name,
      description: row.description,
      visibility: row.visibility,
      isPublic: toBoolean(row.visibility === "public"),
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
      },
      assignments: assignments.map((assignment) => ({
        ...assignment,
        id: `${row.plan_code}__${assignment.lab_code}`,
        plan_code: row.plan_code,
        plan_id: row.plan_code,
      })),
    };
  }

  function stripPayload(copy, user) {
    const { plan, assignments, ...rest } = copy;
    if (!user) delete rest.ownerUsername;
    return rest;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  return {
    buildVisibleDataset,
    createCopy,
    updateCopy,
    saveAssignments,
    deleteCopy,
  };
}

module.exports = { createPlanCopyService };
