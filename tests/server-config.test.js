const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const test = require("node:test");

test("server default port avoids Windows excluded development ranges", () => {
  const previousPort = process.env.PORT;
  delete process.env.PORT;
  delete require.cache[require.resolve("../server/config")];

  const config = require("../server/config");

  assert.equal(config.port, 3300);

  delete require.cache[require.resolve("../server/config")];
  if (previousPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = previousPort;
  }
});

test("server listen errors explain reserved or occupied ports", () => {
  const { formatListenError } = require("../server/listen-errors");

  assert.match(
    formatListenError({ code: "EACCES", address: "0.0.0.0", port: 3000 }),
    /PORT=3300/
  );
  assert.doesNotMatch(
    formatListenError({ code: "EACCES", address: "0.0.0.0", port: 3000 }),
    /PORT=3000/
  );
  assert.match(
    formatListenError({ code: "EACCES", address: "0.0.0.0", port: 3300 }),
    /PORT=3301/
  );
  assert.match(
    formatListenError({ code: "EADDRINUSE", address: "::", port: 3000 }),
    /already in use/
  );
});

test("json responses expose payload size for performance baselines", () => {
  const { sendJson } = require("../server/http-utils");
  const writes = [];
  let endedBody = "";
  const res = {
    writeHead(statusCode, headers) {
      writes.push({ statusCode, headers });
    },
    end(body) {
      endedBody = body;
    },
  };

  sendJson(res, 200, { ok: true, dataset: { spaces: [{ id: "space-1" }] } });

  assert.equal(writes[0].statusCode, 200);
  assert.equal(writes[0].headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(Number(writes[0].headers["X-Floorplan-Payload-Bytes"]), Buffer.byteLength(endedBody));
});

test("static assets send cache headers and support etag revalidation", async () => {
  const { createStaticHandler } = require("../server/http-utils");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-static-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>floorplan</title>");
  fs.writeFileSync(path.join(root, "app.js"), "window.floorplan = true;");
  const config = {
    root,
    dataDir: path.join(root, "data"),
    contentTypes: {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
    },
  };
  const serveStatic = createStaticHandler(config);

  const originalReadFile = fs.readFile;
  let firstReadCount = 0;
  fs.readFile = function patchedReadFile(...args) {
    firstReadCount += 1;
    return originalReadFile.apply(this, args);
  };
  let scriptResponse;
  try {
    scriptResponse = await captureStatic(serveStatic, "/app.js");
  } finally {
    fs.readFile = originalReadFile;
  }
  assert.equal(scriptResponse.statusCode, 200);
  assert.equal(scriptResponse.headers["Cache-Control"], "public, max-age=3600, must-revalidate");
  assert.match(scriptResponse.headers.ETag, /^W\/"/);
  assert.equal(scriptResponse.body, "window.floorplan = true;");
  assert.equal(firstReadCount, 0);

  let revalidationReadCount = 0;
  fs.readFile = function patchedReadFile(...args) {
    revalidationReadCount += 1;
    return originalReadFile.apply(this, args);
  };
  try {
    const revalidated = await captureStatic(serveStatic, "/app.js", { "if-none-match": scriptResponse.headers.ETag });
    assert.equal(revalidated.statusCode, 304);
    assert.equal(revalidated.body, "");
    assert.equal(revalidationReadCount, 0);
  } finally {
    fs.readFile = originalReadFile;
  }

  const htmlResponse = await captureStatic(serveStatic, "/");
  assert.equal(htmlResponse.statusCode, 200);
  assert.equal(htmlResponse.headers["Cache-Control"], "no-cache");
});

function captureStatic(serveStatic, pathname, headers = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    Object.assign(response, {
      statusCode: null,
      headers: null,
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders;
      },
      end(body = "") {
        if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
        this.body = Buffer.concat(chunks).toString("utf8");
        Writable.prototype.end.call(this);
        resolve(this);
      },
    });
    serveStatic({ headers }, response, pathname);
  });
}
