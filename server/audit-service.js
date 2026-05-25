const { nowIso } = require("./http-utils");

function createAuditService(db) {
  function writeAudit(action, actor, ip, details) {
    db.prepare("INSERT INTO audit_logs (action, actor, ip, details_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(action, actor, ip, JSON.stringify(details || {}), nowIso());
  }

  return { writeAudit };
}

module.exports = { createAuditService };
