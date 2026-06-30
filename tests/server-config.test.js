const assert = require("node:assert/strict");
const test = require("node:test");

test("server default port avoids Windows excluded development ranges", () => {
  const previousPort = process.env.PORT;
  delete process.env.PORT;
  delete require.cache[require.resolve("../server/config")];

  const config = require("../server/config");

  assert.equal(config.port, 3000);

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
    formatListenError({ code: "EACCES", address: "0.0.0.0", port: 5173 }),
    /PORT=3000/
  );
  assert.match(
    formatListenError({ code: "EADDRINUSE", address: "::", port: 3000 }),
    /already in use/
  );
});
