const fs = require("fs");
const path = require("path");
const { nowIso, httpError } = require("./http-utils");

function createImportService(db, config, audit, datasetService, snapshotService) {
  function createImportDraft(body, context) {
    const dataset = datasetService.normalizeIncomingDataset(body.dataset);
    const validation = datasetService.validateDataset(dataset);
    if (!validation.ok) {
      return { statusCode: 400, payload: { error: "invalid_dataset", message: validation.errors.join("；"), errors: validation.errors } };
    }
    const corruption = datasetService.detectTextCorruption(dataset);
    if (corruption.detected) {
      audit.writeAudit("suspected_text_corruption_rejected", context.user.username, context.ip, {
        source: "create_import_draft",
        summary: corruption,
        fileName: String(body.fileName || "").trim(),
      });
      return {
        statusCode: 422,
        payload: {
          error: "suspected_text_corruption",
          message: "检测到导入包内存在异常的问号化文本，已阻止创建草稿，请先修复原始文件编码。",
          details: corruption,
        },
      };
    }

    const fileName = String(body.fileName || "未命名数据包").trim();
    const sourceType = String(body.sourceType || "json").trim();
    const active = datasetService.getActiveDataset();
    const summary = datasetService.buildImportSummary(active.dataset, dataset);
    const uploadedAt = nowIso();

    const result = db.prepare(`
      INSERT INTO import_drafts (file_name, source_type, uploaded_by, uploaded_at, dataset_json, summary_json, status)
      VALUES (?, ?, ?, ?, ?, ?, 'draft')
    `).run(fileName, sourceType, context.user.username, uploadedAt, JSON.stringify(dataset), JSON.stringify(summary));

    fs.writeFileSync(path.join(config.uploadsDir, `draft-${result.lastInsertRowid}.json`), JSON.stringify({
      fileName,
      sourceType,
      uploadedBy: context.user.username,
      uploadedAt,
      dataset,
    }, null, 2));

    audit.writeAudit("import_draft_created", context.user.username, context.ip, {
      draftId: Number(result.lastInsertRowid),
      fileName,
      summary,
    });

    return { statusCode: 200, payload: { ok: true, draftId: Number(result.lastInsertRowid), summary } };
  }

  function publishImportDraft(draftId, actor, ip) {
    const draft = db.prepare("SELECT * FROM import_drafts WHERE id = ?").get(draftId);
    if (!draft || draft.status !== "draft") {
      throw httpError(404, "draft_not_found", "未找到可发布的导入草稿");
    }

    const active = datasetService.getActiveDataset();
    snapshotService.createSnapshot("pre_import_publish", `导入发布前快照 #${active.revision}`, active.dataset, active.revision, actor, 0);

    const nextDataset = JSON.parse(draft.dataset_json);
    const result = datasetService.saveActiveDataset(nextDataset, actor);
    db.prepare("UPDATE import_drafts SET status = 'published', published_at = ? WHERE id = ?").run(result.updatedAt, draftId);
    audit.writeAudit("import_draft_published", actor, ip, {
      draftId,
      revision: result.revision,
      summary: JSON.parse(draft.summary_json),
    });
    return { ok: true, ...result };
  }

  function discardImportDraft(draftId, actor, ip) {
    const draft = db.prepare("SELECT * FROM import_drafts WHERE id = ?").get(draftId);
    if (!draft || draft.status !== "draft") {
      throw httpError(404, "draft_not_found", "未找到可丢弃的导入草稿");
    }
    db.prepare("UPDATE import_drafts SET status = 'discarded', discarded_at = ? WHERE id = ?").run(nowIso(), draftId);
    audit.writeAudit("import_draft_discarded", actor, ip, { draftId, fileName: draft.file_name });
  }

  function listImportDrafts() {
    return db.prepare("SELECT id, file_name, source_type, uploaded_by, uploaded_at, summary_json, status, published_at, discarded_at FROM import_drafts ORDER BY id DESC")
      .all()
      .map((row) => ({
        ...row,
        summary: JSON.parse(row.summary_json),
      }));
  }

  return {
    createImportDraft,
    publishImportDraft,
    discardImportDraft,
    listImportDrafts,
  };
}

module.exports = { createImportService };
