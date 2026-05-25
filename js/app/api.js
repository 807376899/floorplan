(function attachFloorplanApi(global) {
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || "请求失败");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.Api = { fetchJson };
})(window);
