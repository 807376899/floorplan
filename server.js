const http = require("http");
const config = require("./server/config");
const { openDatabase } = require("./server/db");
const { sendJson, createStaticHandler } = require("./server/http-utils");
const { createAuditService } = require("./server/audit-service");
const { createAuthService } = require("./server/auth-service");
const { createDatasetService } = require("./server/dataset-service");
const { createSnapshotService } = require("./server/snapshot-service");
const { createImportService } = require("./server/import-service");
const { createRouteApi } = require("./server/routes");

// server.js 只负责装配依赖和启动 HTTP 服务；业务逻辑放在 server/*-service.js 中。
const db = openDatabase(config);
const audit = createAuditService(db);
const auth = createAuthService(db, config, audit);
const dataset = createDatasetService(db, config, audit);
const snapshots = createSnapshotService(db, config, audit, dataset);
const imports = createImportService(db, config, audit, dataset, snapshots);
const services = { audit, auth, dataset, snapshots, imports };
const routeApi = createRouteApi(services);
const serveStatic = createStaticHandler(config);

auth.seedUsers();
dataset.seedDataset(snapshots);
snapshots.ensureScheduledBackup();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = decodeURIComponent(url.pathname);
    const requestContext = auth.buildRequestContext(req);

    if (pathname.startsWith("/api/")) {
      await routeApi(req, res, url, pathname, requestContext);
      return;
    }

    serveStatic(res, pathname);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error);
    sendJson(res, statusCode, {
      error: error.code || "server_error",
      message: error.message || "Server error",
    });
  }
}).listen(config.port, () => {
  console.log(`floorplan server running at http://127.0.0.1:${config.port}`);
});

process.on("uncaughtException", (error) => {
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  console.error(error);
});
