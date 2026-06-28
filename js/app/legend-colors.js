(function attachFloorplanLegendColors(global) {
  const domain = global.FloorplanDomain || {};
  const COLORS = domain.COLORS || [
    "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f",
    "#b45309", "#0f766e", "#4338ca", "#c026d3", "#16a34a", "#ea580c", "#0284c7", "#e11d48",
    "#65a30d", "#9333ea", "#ca8a04", "#0d9488", "#1d4ed8", "#be185d", "#15803d", "#7c2d12",
  ];
  const unique = domain.unique || ((values) => [...new Set(values.filter(Boolean))]);
  const compare = domain.compare || ((a, b) => String(a).localeCompare(String(b), "zh-CN", { numeric: true }));
  const escapeHtml = domain.escapeHtml || ((value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;"));
  const normalizeColor = domain.normalizeColor || ((value) => {
    const raw = String(value || "").trim();
    const short = raw.match(/^#?([0-9a-f]{3})$/i);
    if (short) return `#${short[1].split("").map((char) => char + char).join("").toLowerCase()}`;
    const full = raw.match(/^#?([0-9a-f]{6})$/i);
    return full ? `#${full[1].toLowerCase()}` : "";
  });

  function colorMap(dataOrLabs, maybeColleges = []) {
    const labs = Array.isArray(dataOrLabs) ? dataOrLabs : dataOrLabs?.labs || [];
    const colleges = Array.isArray(dataOrLabs) ? maybeColleges : dataOrLabs?.colleges || [];
    const colors = {};
    colleges.forEach((college) => {
      const color = normalizeColor(college.color || college.color_hex);
      if (!color) return;
      if (college.college_name) colors[college.college_name] = color;
      if (college.college_code) colors[college.college_code] = color;
    });
    unique(labs.map((row) => row.college)).forEach((value, index) => {
      if (!value || colors[value]) return;
      colors[value] = COLORS[index % COLORS.length];
    });
    return colors;
  }

  function renderLegend(legendEl, data, colors, activePlanId, mutedColleges = new Set()) {
    const assignments = (data.plan_assignments || []).filter((row) => row.plan_id === activePlanId && row.assignment_status === "assigned");
    const labsById = new Map((data.labs || []).map((row) => [row.id, row]));
    const activeColleges = unique(assignments.map((row) => labsById.get(row.lab_id)?.college));
    const colleges = activeColleges.map((college) => `<button type="button" class="legend-item ${mutedColleges.has(college) ? "is-muted" : ""}" data-college="${escapeHtml(college)}" aria-pressed="${mutedColleges.has(college) ? "false" : "true"}"><span class="legend-swatch" style="background:${colors[college] || "#94a3b8"}"></span>${escapeHtml(college)}</button>`);
    const toggleTitle = mutedColleges.size ? "正常显示" : "弱化显示";
    const toggleClass = mutedColleges.size ? "is-vivid" : "is-soft";
    const toggleGradient = legendToggleGradient(activeColleges, colors);
    legendEl.innerHTML = [
      `<button type="button" class="legend-toggle ${toggleClass}" data-action="toggle-all-colleges" title="${toggleTitle}" aria-label="${toggleTitle}" style="background:${toggleGradient}"></button>`,
      ...colleges,
      `<span class="legend-item is-static"><span class="legend-swatch" style="background:#e2e8f0"></span>未分配空间</span>`,
    ].join("");
  }

  function legendToggleGradient(activeColleges, colors) {
    const palette = activeColleges.map((college) => colors[college]).filter(Boolean).slice(0, 5);
    const fallback = palette.length ? palette : ["#0f766e", "#2563eb", "#d97706", "#7c3aed"];
    const step = 100 / fallback.length;
    return `conic-gradient(${fallback.map((color, index) => `${color} ${Math.round(index * step)}% ${Math.round((index + 1) * step)}%`).join(", ")})`;
  }

  const api = {
    colorMap,
    renderLegend,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.LegendColors = api;

  if (global.FloorplanRender) {
    global.FloorplanRender.colorMap = colorMap;
    global.FloorplanRender.renderLegend = renderLegend;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
