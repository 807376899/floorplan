const ROOM_COLUMNS = [
  ["building", "教学楼"], ["floor", "楼层"], ["segment_id", "走廊段ID"], ["offset_m", "沿段位置"],
  ["side", "段侧"], ["room_name", "实验室名称"], ["front_door", "前门牌"], ["rear_door", "后门牌"],
  ["length_m", "长"], ["width_m", "宽"], ["college", "所属学院"], ["lab_type", "实验室类型"], ["capacity", "容量"], ["notes", "备注"],
];
const FLOOR_COLUMNS = [
  ["building", "教学楼"], ["floor", "楼层"], ["segment_id", "走廊段ID"], ["start_x_m", "起点X"], ["start_y_m", "起点Y"],
  ["end_x_m", "终点X"], ["end_y_m", "终点Y"], ["width_m", "走廊宽"], ["notes", "备注"],
];
const ALL_COLLEGES = "全部学院";
const ROOM_GAP_M = 0.7;
const DETAIL_SCALE = 28;
const THUMB_SCALE = 6;
const COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f"];
const state = { rooms: [], floors: [], selectedRoomId: null, editorMode: "rooms" };
const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));

els.roomFileInput.addEventListener("change", (event) => handleImport(event, "rooms"));
els.floorFileInput.addEventListener("change", (event) => handleImport(event, "floors"));
els.loadSampleBtn.addEventListener("click", loadSampleData);
els.downloadRoomTemplateBtn.addEventListener("click", downloadRoomTemplate);
els.downloadFloorTemplateBtn.addEventListener("click", downloadFloorTemplate);
els.fitCanvasBtn.addEventListener("click", () => setCanvasMode("fit"));
els.actualCanvasBtn.addEventListener("click", () => setCanvasMode("actual"));
els.showRoomsBtn.addEventListener("click", () => setEditorMode("rooms"));
els.showFloorsBtn.addEventListener("click", () => setEditorMode("floors"));
els.addRowBtn.addEventListener("click", addEditorRow);
els.applyTableBtn.addEventListener("click", applyEditorRows);
els.downloadCsvBtn.addEventListener("click", downloadCurrentCsv);
els.buildingSelect.addEventListener("change", () => { populateFloorOptions(); render(); });
els.floorSelect.addEventListener("change", render);
els.collegeSelect.addEventListener("change", render);
window.addEventListener("resize", () => els.floorplan.classList.contains("is-fit") && applyCanvasMode());
loadSampleData();

async function loadSampleData() {
  const [roomCsv, floorCsv] = await Promise.all([fetch("./sample-rooms.csv").then((r) => r.text()), fetch("./sample-floors.csv").then((r) => r.text())]);
  state.rooms = normalizeRooms(parseCsv(roomCsv));
  state.floors = normalizeFloors(parseCsv(floorCsv));
  hydrate("已载入测试数据");
}

async function handleImport(event, kind) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const rows = await readTabularFile(file);
    if (kind === "rooms") state.rooms = normalizeRooms(rows);
    else state.floors = normalizeFloors(rows);
    hydrate(`已导入${kind === "rooms" ? "房间表" : "楼层表"} ${file.name}`);
  } catch (error) {
    updateStatus(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

async function readTabularFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(await file.text());
  if ((name.endsWith(".xlsx") || name.endsWith(".xls")) && window.XLSX) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  }
  throw new Error("请导入 CSV、XLSX 或 XLS 文件。");
}

function hydrate(message) {
  populateBuildingOptions();
  populateFloorOptions();
  populateCollegeOptions();
  renderEditor();
  render();
  updateStatus(`${message}：${state.rooms.length} 间房，${state.floors.length} 条走廊段。`);
}

function normalizeRooms(rows) {
  return rows.map((row, index) => ({
    building: read(row, ["building", "教学楼"]),
    floor: read(row, ["floor", "楼层"]),
    segment_id: read(row, ["segment_id", "走廊段ID"]),
    offset_m: number(read(row, ["offset_m", "沿段位置"]), 0),
    side: normalizeSide(read(row, ["side", "段侧", "房间位置"])),
    room_name: read(row, ["room_name", "实验室名称"]),
    front_door: read(row, ["front_door", "前门牌"]),
    rear_door: read(row, ["rear_door", "后门牌"]) || read(row, ["front_door", "前门牌"]),
    length_m: number(read(row, ["length_m", "长"]), 8),
    width_m: number(read(row, ["width_m", "宽"]), 6),
    college: read(row, ["college", "所属学院"]),
    lab_type: read(row, ["lab_type", "实验室类型"]),
    capacity: number(read(row, ["capacity", "容量"]), 0),
    notes: read(row, ["notes", "备注"]),
    id: `room-${index}-${read(row, ["front_door", "前门牌"])}`,
  })).filter((row) => row.building && row.floor && row.segment_id && row.room_name && row.college);
}

function normalizeFloors(rows) {
  return rows.map((row) => ({
    building: read(row, ["building", "教学楼"]),
    floor: read(row, ["floor", "楼层"]),
    segment_id: read(row, ["segment_id", "走廊段ID"]),
    start_x_m: number(read(row, ["start_x_m", "起点X"]), 0),
    start_y_m: number(read(row, ["start_y_m", "起点Y"]), 0),
    end_x_m: number(read(row, ["end_x_m", "终点X"]), 0),
    end_y_m: number(read(row, ["end_y_m", "终点Y"]), 0),
    width_m: number(read(row, ["width_m", "走廊宽"]), 2.4),
    notes: read(row, ["notes", "备注"]),
  })).filter((row) => row.building && row.floor && row.segment_id);
}

function populateBuildingOptions() { fillSelect(els.buildingSelect, unique(state.floors.map((row) => row.building))); }
function populateFloorOptions() { fillSelect(els.floorSelect, unique(state.floors.filter((row) => row.building === els.buildingSelect.value).map((row) => row.floor)).sort(compare)); }
function populateCollegeOptions() { fillSelect(els.collegeSelect, [ALL_COLLEGES, ...unique(state.rooms.map((row) => row.college))]); }
function fillSelect(select, values) { const previous = select.value; select.innerHTML = values.map((v) => `<option>${escapeHtml(v)}</option>`).join(""); if (values.includes(previous)) select.value = previous; }

function render() {
  const building = els.buildingSelect.value, floor = els.floorSelect.value;
  const floorSegments = state.floors.filter((row) => row.building === building && row.floor === floor);
  const rooms = state.rooms.filter((row) => row.building === building && row.floor === floor);
  const colors = colorMap();
  renderLegend(colors);
  renderThumbs(building, colors);
  renderJson({ floorSegments, rooms });
  renderFloorplan(floorSegments, rooms, colors);
}

function buildLayout(segments, rooms, scale, titleHeight = 96) {
  const margin = 34;
  const segmentMap = new Map(segments.map((segment) => [segment.segment_id, makeSegment(segment, scale, margin, titleHeight)]));
  const corridors = [...segmentMap.values()];
  const roomBoxes = rooms.map((room) => placeRoom(room, segmentMap.get(room.segment_id), scale)).filter(Boolean);
  const xs = [...corridors.flatMap((c) => [c.x1, c.x2]), ...roomBoxes.flatMap((r) => [r.x, r.x + r.width])];
  const ys = [...corridors.flatMap((c) => [c.y1, c.y2]), ...roomBoxes.flatMap((r) => [r.y, r.y + r.height])];
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const shiftX = margin - minX, shiftY = titleHeight + 8 - minY;
  corridors.forEach((c) => { c.x1 += shiftX; c.x2 += shiftX; c.y1 += shiftY; c.y2 += shiftY; });
  roomBoxes.forEach((r) => { r.x += shiftX; r.y += shiftY; });
  return { corridors, rooms: roomBoxes, width: Math.max(620, maxX - minX + margin * 2), height: Math.max(260, maxY - minY + titleHeight + margin) };
}

function makeSegment(segment, scale, margin, titleHeight) {
  return { ...segment, x1: margin + segment.start_x_m * scale, y1: titleHeight + segment.start_y_m * scale, x2: margin + segment.end_x_m * scale, y2: titleHeight + segment.end_y_m * scale, width: segment.width_m * scale };
}

function placeRoom(room, segment, scale) {
  if (!segment) return null;
  const dx = segment.x2 - segment.x1, dy = segment.y2 - segment.y1, length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
  const centerX = segment.x1 + ux * room.offset_m * scale, centerY = segment.y1 + uy * room.offset_m * scale;
  const sideSign = room.side === "左" ? -1 : room.side === "右" ? 1 : room.side === "起点" ? -1 : 1;
  const width = room.length_m * scale, height = room.width_m * scale;
  if (room.side === "起点" || room.side === "终点") {
    const sign = room.side === "起点" ? -1 : 1;
    return { room, x: centerX + ux * sign * (segment.width / 2 + ROOM_GAP_M * scale) - width / 2, y: centerY + uy * sign * (segment.width / 2 + ROOM_GAP_M * scale) - height / 2, width, height };
  }
  return { room, x: centerX + nx * sideSign * (segment.width / 2 + ROOM_GAP_M * scale + height / 2) - width / 2, y: centerY + ny * sideSign * (segment.width / 2 + ROOM_GAP_M * scale + height / 2) - height / 2, width, height };
}

function renderFloorplan(segments, rooms, colors) {
  if (!segments.length) { els.floorplan.innerHTML = `<div class="empty">当前楼层没有布局数据。</div>`; return; }
  const layout = buildLayout(segments, rooms, DETAIL_SCALE);
  const corridorMarkup = layout.corridors.map((c) => `<line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" stroke="#e8edf3" stroke-width="${c.width}" stroke-linecap="square"/>`).join("");
  const roomMarkup = layout.rooms.map((r) => roomSvg(r, colors, false)).join("");
  els.floorplan.innerHTML = `<svg viewBox="0 0 ${layout.width} ${layout.height}" data-layout-width="${layout.width}" data-layout-height="${layout.height}">
    <rect width="${layout.width}" height="${layout.height}" fill="#fbfcfe"/>
    <text x="34" y="42" font-size="24" font-weight="700">${escapeHtml(els.buildingSelect.value)} ${escapeHtml(els.floorSelect.value)}层</text>
    ${corridorMarkup}${roomMarkup}</svg>`;
  els.floorplan.querySelectorAll(".room").forEach((node) => node.addEventListener("click", () => { state.selectedRoomId = node.dataset.id; render(); }));
  showDetails(rooms.find((room) => room.id === state.selectedRoomId));
  applyCanvasMode();
}

function renderThumbs(building, colors) {
  const floors = unique(state.floors.filter((row) => row.building === building).map((row) => row.floor)).sort(compare);
  els.floorThumbs.innerHTML = floors.map((floor) => {
    const segments = state.floors.filter((row) => row.building === building && row.floor === floor);
    const rooms = state.rooms.filter((row) => row.building === building && row.floor === floor);
    const layout = buildLayout(segments, rooms, THUMB_SCALE, 0);
    return `<button class="floor-thumb ${floor === els.floorSelect.value ? "is-active" : ""}" data-floor="${floor}"><span>${floor}层</span>
      <svg viewBox="0 0 ${layout.width} ${layout.height}">${layout.corridors.map((c) => `<line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" stroke="#e8edf3" stroke-width="${c.width}"/>`).join("")}${layout.rooms.map((r) => roomSvg(r, colors, true)).join("")}</svg></button>`;
  }).join("");
  els.floorThumbs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { els.floorSelect.value = button.dataset.floor; render(); }));
}

function roomSvg(box, colors, compact) {
  if (compact) return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${colors[box.room.college]}" />`;
  const muted = els.collegeSelect.value !== ALL_COLLEGES && els.collegeSelect.value !== box.room.college;
  return `<g class="room ${muted ? "is-muted" : ""}" data-id="${box.room.id}">
    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${colors[box.room.college]}" />
    <text x="${box.x + 8}" y="${box.y + 20}" fill="#fff" font-size="13">${escapeHtml(box.room.front_door)}</text>
  </g>`;
}

function setEditorMode(mode) { state.editorMode = mode; els.showRoomsBtn.classList.toggle("is-active", mode === "rooms"); els.showFloorsBtn.classList.toggle("is-active", mode === "floors"); renderEditor(); }
function editorColumns() { return state.editorMode === "rooms" ? ROOM_COLUMNS : FLOOR_COLUMNS; }
function editorRows() { return state.editorMode === "rooms" ? state.rooms : state.floors; }
function renderEditor() {
  const columns = editorColumns(), rows = editorRows();
  els.dataEditor.innerHTML = `<table><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => `<tr>${columns.map(([key]) => `<td><input data-row="${i}" data-key="${key}" value="${escapeHtml(row[key] ?? "")}"></td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function addEditorRow() {
  if (state.editorMode === "rooms") state.rooms.push(normalizeRooms([{ 教学楼: els.buildingSelect.value, 楼层: els.floorSelect.value, 走廊段ID: "main", 沿段位置: 0, 段侧: "右", 实验室名称: "新增实验室", 前门牌: "000", 后门牌: "000", 长: 8, 宽: 6, 所属学院: "未设置学院" }])[0]);
  else state.floors.push(normalizeFloors([{ 教学楼: els.buildingSelect.value, 楼层: els.floorSelect.value, 走廊段ID: "new-segment", 起点X: 0, 起点Y: 0, 终点X: 10, 终点Y: 0, 走廊宽: 2.4 }])[0]);
  renderEditor();
}
function applyEditorRows() {
  const columns = editorColumns(), data = editorRows().map(() => ({}));
  els.dataEditor.querySelectorAll("input").forEach((input) => data[+input.dataset.row][input.dataset.key] = input.value);
  if (state.editorMode === "rooms") state.rooms = normalizeRooms(data); else state.floors = normalizeFloors(data);
  hydrate("已应用修改");
}

function renderLegend(colors) { els.legend.innerHTML = Object.entries(colors).map(([k, v]) => `<span class="legend-item"><span class="legend-swatch" style="background:${v}"></span>${k}</span>`).join(""); }
function renderJson(data) { els.jsonPreview.textContent = JSON.stringify(data, null, 2); }
function showDetails(room) { els.roomDetails.innerHTML = room ? `<strong>${room.room_name}</strong><br>走廊段：${room.segment_id}<br>段侧：${room.side}<br>门牌：${room.front_door}/${room.rear_door}<br>尺寸：${room.length_m}m x ${room.width_m}m<br>学院：${room.college}` : "点击图中的房间查看详情。"; }
function colorMap() { return Object.fromEntries(unique(state.rooms.map((r) => r.college)).map((v, i) => [v, COLORS[i % COLORS.length]])); }

function downloadRoomTemplate() { exportCsv("room-template.csv", ROOM_COLUMNS, [["示例楼","1","main","4","右","示例实验室","101","101","8","6","示例学院","实验室","40",""]]); }
function downloadFloorTemplate() { exportCsv("floor-template.csv", FLOOR_COLUMNS, [["示例楼","1","main","0","0","30","0","2.4","主走廊"],["示例楼","1","branch","15","0","15","18","2.4","支走廊"]]); }
function downloadCurrentCsv() { exportCsv(state.editorMode === "rooms" ? "rooms.csv" : "floors.csv", editorColumns(), editorRows().map((row) => editorColumns().map(([key]) => row[key] ?? ""))); }
function exportCsv(name, columns, rows) { download(name, `\uFEFF${[columns.map(([, label]) => label), ...rows].map((row) => row.map(csv).join(",")).join("\n")}`, "text/csv;charset=utf-8"); }
function download(name, text, type) { const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type })); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function setCanvasMode(mode) { els.floorplan.classList.toggle("is-fit", mode === "fit"); els.floorplan.classList.toggle("is-actual", mode === "actual"); els.canvasModeText.textContent = mode === "fit" ? "适配显示" : "原始大小"; applyCanvasMode(); }
function applyCanvasMode() { const svg = els.floorplan.querySelector("svg"); if (!svg) return; const w = +svg.dataset.layoutWidth, h = +svg.dataset.layoutHeight; if (els.floorplan.classList.contains("is-actual")) { svg.style.width = `${w}px`; svg.style.height = `${h}px`; } else { const b = els.floorplan.getBoundingClientRect(), s = Math.min(1, (b.width - 24) / w, (b.height - 24) / h); svg.style.width = `${w * s}px`; svg.style.height = `${h * s}px`; } }

function parseCsv(text) { const [header, ...rows] = text.trim().split(/\r?\n/).map((line) => line.split(",")); return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h.replace(/^\uFEFF/, ""), cells[i] ?? ""]))); }
function read(row, keys) { return keys.find((key) => row[key] !== undefined) ? String(row[keys.find((key) => row[key] !== undefined)]).trim() : ""; }
function normalizeSide(v) { return ["左","右","起点","终点"].includes(v) ? v : ["北","西"].includes(v) ? "左" : ["南","东"].includes(v) ? "右" : "右"; }
function number(v, fallback) { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; }
function unique(v) { return [...new Set(v.filter(Boolean))]; }
function compare(a, b) { return String(a).localeCompare(String(b), "zh-CN", { numeric: true }); }
function csv(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }
function escapeHtml(v) { return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }
function updateStatus(text) { els.statusText.textContent = text; }
