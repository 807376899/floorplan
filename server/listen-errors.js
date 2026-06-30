function formatListenError(error) {
  const port = error?.port || process.env.PORT || "unknown";
  const address = error?.address || "0.0.0.0";
  if (error?.code === "EACCES") {
    return [
      `Cannot listen on ${address}:${port}.`,
      "The port may be reserved by Windows or blocked for this user.",
      "Start the app on an available port, for example: $env:PORT=3000; npm start",
    ].join(" ");
  }
  if (error?.code === "EADDRINUSE") {
    return [
      `Cannot listen on ${address}:${port}; the port is already in use.`,
      "Stop the other process or choose another port, for example: $env:PORT=3000; npm start",
    ].join(" ");
  }
  return error?.message || "Server listen failed.";
}

module.exports = {
  formatListenError,
};
