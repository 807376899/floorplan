const path = require("path");
const { DEFAULT_PORT } = require("./ports");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const uploadsDir = path.join(dataDir, "uploads");
const backupsDir = path.join(dataDir, "backups");

module.exports = {
  root,
  port: Number(process.env.PORT || DEFAULT_PORT),
  dataDir,
  uploadsDir,
  backupsDir,
  dbPath: path.join(dataDir, "app.db"),
  sessionCookieName: "floorplan_session",
  datasetKeys: ["buildings", "floor_segments", "spaces", "labs", "colleges", "majors", "lab_types", "plans", "plan_assignments", "file_assets", "imports", "deleted_space_ids"],
  contentTypes: {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
  },
};
