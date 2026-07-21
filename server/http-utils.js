const fs = require("fs");
const path = require("path");

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Floorplan-Payload-Bytes": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function toBoolean(value) {
  return ["true", "1", "yes", "y", "是"].includes(String(value ?? "").trim().toLowerCase());
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      // 限制单次导入/保存体积，避免误上传大文件拖垮内存。
      if (size > 25 * 1024 * 1024) {
        reject(httpError(413, "payload_too_large", "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(httpError(400, "invalid_json", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader.split(";").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const index = pair.indexOf("=");
    if (index === -1) return [pair, ""];
    return [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
  }));
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function createStaticHandler(config) {
  return function serveStatic(req, res, pathname) {
    const resolvedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const target = path.normalize(path.join(config.root, resolvedPath));
    // 静态服务只暴露项目资源，明确禁止浏览数据库、上传包和备份目录。
    if (!target.startsWith(config.root) || target.startsWith(config.dataDir)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    fs.stat(target, (error, stats) => {
      if (error) {
        res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }
      const ext = path.extname(target).toLowerCase();
      const etag = staticEtag(stats);
      const headers = {
        "Content-Type": config.contentTypes[ext] || "application/octet-stream",
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600, must-revalidate",
        ETag: etag,
      };
      if (req.headers?.["if-none-match"] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      const stream = fs.createReadStream(target);
      stream.on("error", (readError) => {
        if (res.headersSent) {
          res.destroy(readError);
          return;
        }
        res.writeHead(readError.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(readError.code === "ENOENT" ? "Not found" : "Server error");
      });
      res.writeHead(200, headers);
      stream.pipe(res);
    });
  };
}

function staticEtag(stats) {
  return `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
}

module.exports = {
  sendJson,
  httpError,
  nowIso,
  toBoolean,
  readJsonBody,
  parseCookies,
  serializeCookie,
  createStaticHandler,
};
