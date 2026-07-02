const DEFAULT_PORT = 3300;

function suggestPort(failedPort) {
  const port = Number(failedPort);
  if (Number.isFinite(port) && port === DEFAULT_PORT) return DEFAULT_PORT + 1;
  return DEFAULT_PORT;
}

module.exports = {
  DEFAULT_PORT,
  suggestPort,
};
