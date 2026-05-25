const fs = require("fs");
const path = require("path");
const { nowIso, httpError } = require("./http-utils");

function createSnapshotService(db, config, audit, datasetService) {
  function createSnapshot(kind, label, dataset, sourceRevision, createdBy, isProtected) {
    db.prepare(`
      INSERT INTO snapshots (kind, label, dataset_json, source_revision, created_by, created_at, is_protected)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(kind, label, JSON.stringify(dataset), sourceRevision, createdBy, nowIso(), isProtected ? 1 : 0);
  }

  function listSnapshots() {
    return db.prepare("SELECT id, kind, label, source_revision, created_by, created_at, is_protected FROM snapshots ORDER BY id DESC LIMIT 50").all();
  }

  function restoreSnapshot(snapshotId, actor, ip) {
    const snapshot = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId);
    if (!snapshot) throw httpError(404, "snapshot_not_found", "未找到可恢复的快照");

    const active = datasetService.getActiveDataset();
    // 恢复是覆盖性操作，先留一份恢复前快照给管理员兜底。
    createSnapshot("pre_restore", `恢复前快照 #${active.revision}`, active.dataset, active.revision, actor, 0);
    const dataset = JSON.parse(snapshot.dataset_json);
    const result = datasetService.saveActiveDataset(dataset, actor);
    audit.writeAudit("snapshot_restored", actor, ip, { snapshotId, revision: result.revision, label: snapshot.label });
    return { ok: true, ...result };
  }

  function ensureScheduledBackup() {
    setInterval(() => {
      try {
        const active = datasetService.getActiveDataset();
        createSnapshot("scheduled_backup", `每日备份 #${active.revision}`, active.dataset, active.revision, "system", 0);
        const target = path.join(config.backupsDir, `app-${Date.now()}.sqlite`);
        if (fs.existsSync(target)) fs.unlinkSync(target);
        const safeTarget = target.replace(/'/g, "''");
        db.exec(`VACUUM INTO '${safeTarget}'`);
      } catch (error) {
        console.error("scheduled backup failed", error);
      }
    }, 24 * 60 * 60 * 1000);
  }

  return {
    createSnapshot,
    listSnapshots,
    restoreSnapshot,
    ensureScheduledBackup,
  };
}

module.exports = { createSnapshotService };
