const REQUIRED_COLUMNS = [
  "building",
  "floor",
  "room_name",
  "side",
  "front_door",
  "rear_door",
  "east_to_west_order",
  "length_m",
  "width_m",
  "college",
];

const COLOR_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4d7c0f",
  "#9333ea",
  "#0f766e",
];

const sampleCsvPath = "./sample-labs.csv";
const state = {
  rooms: [],
  selectedRoomId: null,
};

const els = {
  fileInput: document.querySelector("#fileInput"),
  loadSampleBtn: document.querySelector("#loadSampleBtn"),
  downloadJsonBtn: document.querySelector("#downloadJsonBtn"),
  buildingSelect: document.querySelector("#buildingSelect"),
  floorSelect: document.querySelector("#floorSelect"),
  collegeSelect: document.querySelector("#collegeSelect"),
  statusText: document.querySelector("#statusText"),
  legend: document.querySelector("#legend"),
  floorplan: document.querySelector("#floorplan"),
  roomDetails: document.querySelector("#roomDetails"),
  jsonPreview: document.querySelector("#jsonPreview"),
};

els.fileInput.addEventListener("change", handleFileImport);
els.loadSampleBtn.addEventListener("click", loadSampleData);
els.downloadJsonBtn.addEventListener("click", downloadJson);
els.buildingSelect.addEventListener("change", () => {
  populateFloorOptions();
  render();
});
els.floorSelect.addEventListener("change", render);
els.collegeSelect.addEventListener("change", render);

loadSampleData();

async function loadSampleData() {
  const response = await fetch(sampleCsvPath);
  const csvText = await response.text();
  setRooms(parseCsv(csvText), "已载入测试 CSV 数据");
}

async function handleFileImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".csv")) {
      const text = await file.text();
      setRooms(parseCsv(text), `已导入 ${file.name}`);
      return;
    }

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (!window.XLSX) {
        throw new Error("Excel 解析库未加载成功。可以先把 Excel 另存为 CSV 后导入，或联网后刷新页面。");
      }
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
      setRooms(normalizeRows(rows), `已导入 ${file.name} 的第一个工作表`);
      return;
    }

    throw new Error("请导入 .csv、.xlsx 或 .xls 文件。");
  } catch (error) {
    showError(error.message);
  } finally {
    event.target.value = "";
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  return normalizeRows(rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))));
}

function normalizeRows(rows) {
  const aliases = {
    building: ["building", "教学楼", "楼栋"],
    floor: ["floor", "楼层"],
    room_name: ["room_name", "实验室名称", "教室名称", "房间名称"],
    side: ["side", "南北", "南北侧", "教室南北", "所在侧"],
    front_door: ["front_door", "前门牌", "前门门牌", "门牌号"],
    rear_door: ["rear_door", "后门牌", "后门门牌"],
    east_to_west_order: ["east_to_west_order", "东到西门牌分布", "从东到西门牌大小", "东西方向"],
    length_m: ["length_m", "长", "长度", "长m"],
    width_m: ["width_m", "宽", "宽度", "宽m"],
    college: ["college", "所属学院", "学院"],
    lab_type: ["lab_type", "实验室类型", "类型"],
    capacity: ["capacity", "容量", "人数"],
    notes: ["notes", "备注"],
  };

  const normalized = rows.map((row, index) => {
    const item = {};
    for (const [key, candidates] of Object.entries(aliases)) {
      const found = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(row, candidate));
      item[key] = found ? String(row[found]).trim() : "";
    }

    item.id = `${item.building}-${item.floor}-${item.front_door}-${item.rear_door}-${index}`;
    item.floor = String(item.floor).trim();
    item.side = normalizeSide(item.side);
    item.front_door = String(item.front_door || item.rear_door).trim();
    item.rear_door = String(item.rear_door || item.front_door).trim();
    item.length_m = toNumber(item.length_m, 8);
    item.width_m = toNumber(item.width_m, 6);
    item.capacity = toNumber(item.capacity, 0);
    item.room_name = item.room_name || `${item.front_door} 实验室`;
    item.east_to_west_order = item.east_to_west_order || "东到西递增";
    return item;
  });

  const missing = REQUIRED_COLUMNS.filter((column) => normalized.some((room) => !room[column] && column !== "rear_door"));
  if (missing.length) {
    throw new Error(`缺少必要字段或存在空值：${missing.join(", ")}`);
  }

  return normalized;
}

function normalizeSide(value) {
  if (String(value).includes("南")) return "南";
  if (String(value).includes("北")) return "北";
  return String(value).trim();
}

function toNumber(value, fallback) {
  const num = Number.parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : fallback;
}

function setRooms(rooms, message) {
  state.rooms = rooms;
  state.selectedRoomId = null;
  populateBuildingOptions();
  populateFloorOptions();
  populateCollegeOptions();
  updateStatus(`${message}，共 ${rooms.length} 间房。`);
  render();
}

function populateBuildingOptions() {
  const buildings = unique(state.rooms.map((room) => room.building));
  fillSelect(els.buildingSelect, buildings);
}

function populateFloorOptions() {
  const building = els.buildingSelect.value;
  const floors = unique(state.rooms.filter((room) => room.building === building).map((room) => room.floor)).sort(compareDoor);
  fillSelect(els.floorSelect, floors);
}

function populateCollegeOptions() {
  const colleges = unique(state.rooms.map((room) => room.college));
  fillSelect(els.collegeSelect, ["全部学院", ...colleges]);
}

function fillSelect(select, values) {
  const previous = select.value;
  select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (values.includes(previous)) select.value = previous;
}

function render() {
  const building = els.buildingSelect.value;
  const floor = els.floorSelect.value;
  const selectedCollege = els.collegeSelect.value;
  const rooms = state.rooms.filter((room) => room.building === building && room.floor === floor);
  const colors = makeCollegeColors(state.rooms);

  renderLegend(colors);
  renderJsonPreview(rooms);
  renderFloorplan(rooms, colors, selectedCollege);
}

function renderLegend(colors) {
  els.legend.innerHTML = Object.entries(colors)
    .map(([college, color]) => `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${escapeHtml(college)}</span>`)
    .join("");
}

function renderJsonPreview(rooms) {
  els.jsonPreview.textContent = JSON.stringify(rooms, null, 2);
}

function renderFloorplan(rooms, colors, selectedCollege) {
  if (!rooms.length) {
    els.floorplan.innerHTML = `<div class="empty">当前筛选没有房间数据。</div>`;
    return;
  }

  const northRooms = orderRooms(rooms.filter((room) => room.side === "北"));
  const southRooms = orderRooms(rooms.filter((room) => room.side === "南"));
  const maxWidth = Math.max(totalFrontage(northRooms), totalFrontage(southRooms), 36);
  const scale = Math.min(38, Math.max(20, 980 / maxWidth));
  const svgWidth = Math.max(1080, maxWidth * scale + 180);
  const margin = 72;
  const originX = margin + 28;
  const northY = 120;
  const corridorY = 310;
  const southY = 390;
  const svgHeight = 620;

  const roomMarkup = [
    ...roomsToSvg(northRooms, colors, originX, northY, scale, true, selectedCollege),
    ...roomsToSvg(southRooms, colors, originX, southY, scale, false, selectedCollege),
  ].join("");

  els.floorplan.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" role="img" aria-label="实验室 SVG 分布图">
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e8edf3" stroke-width="1"/>
        </pattern>
      </defs>
      <rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="url(#grid)"/>
      <text x="${margin}" y="42" font-size="24" font-weight="700" fill="#18212f">${escapeSvg(els.buildingSelect.value)} ${escapeSvg(els.floorSelect.value)}层</text>
      <text x="${margin}" y="72" font-size="13" fill="#667085">左侧为西，右侧为东；房间按“东到西门牌分布”字段确定东西顺序。</text>
      <text x="${margin}" y="104" font-size="16" font-weight="700" fill="#344054">西</text>
      <text x="${svgWidth - margin}" y="104" text-anchor="end" font-size="16" font-weight="700" fill="#344054">东</text>
      <line x1="${originX}" y1="98" x2="${svgWidth - margin}" y2="98" stroke="#98a2b3" stroke-width="2"/>
      <text x="${margin}" y="${northY + 72}" font-size="15" font-weight="700" fill="#344054">北侧</text>
      <rect x="${originX}" y="${corridorY}" width="${svgWidth - margin - originX}" height="48" rx="4" fill="var(--corridor)" stroke="#cbd5e1"/>
      <text x="${svgWidth / 2}" y="${corridorY + 31}" text-anchor="middle" font-size="15" font-weight="700" fill="#667085">走廊</text>
      <text x="${margin}" y="${southY + 72}" font-size="15" font-weight="700" fill="#344054">南侧</text>
      ${roomMarkup}
    </svg>
  `;

  els.floorplan.querySelectorAll(".room").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedRoomId = node.dataset.id;
      render();
      showRoomDetails(rooms.find((room) => room.id === state.selectedRoomId));
    });
  });

  const selected = rooms.find((room) => room.id === state.selectedRoomId);
  showRoomDetails(selected);
}

function roomsToSvg(rooms, colors, startX, y, scale, northSide, selectedCollege) {
  let x = startX;
  return rooms.map((room) => {
    const width = Math.max(90, room.length_m * scale);
    const height = Math.max(68, room.width_m * 9);
    const selected = room.id === state.selectedRoomId;
    const muted = selectedCollege !== "全部学院" && room.college !== selectedCollege;
    const doorText = room.front_door === room.rear_door ? `门牌 ${room.front_door}` : `前 ${room.front_door} / 后 ${room.rear_door}`;
    const doorY = northSide ? y + height + 19 : y - 10;
    const doorLineY = northSide ? y + height : y;
    const markup = `
      <g class="room ${selected ? "is-selected" : ""} ${muted ? "is-muted" : ""}" data-id="${escapeHtml(room.id)}">
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${colors[room.college]}" stroke="#ffffff" stroke-width="1.5"/>
        <text x="${x + 12}" y="${y + 24}" font-size="15" font-weight="700" fill="#ffffff">${escapeSvg(room.front_door)}${room.front_door !== room.rear_door ? `-${escapeSvg(room.rear_door)}` : ""}</text>
        <text x="${x + 12}" y="${y + 47}" font-size="12" fill="#ffffff">${truncateSvg(room.room_name, 12)}</text>
        <text x="${x + 12}" y="${y + 65}" font-size="12" fill="#ffffff">${truncateSvg(room.college, 12)}</text>
        <line x1="${x + width / 2}" y1="${doorLineY}" x2="${x + width / 2}" y2="${northSide ? doorLineY + 12 : doorLineY - 12}" stroke="#344054" stroke-width="1.5"/>
        <text x="${x + width / 2}" y="${doorY}" text-anchor="middle" font-size="11" fill="#344054">${escapeSvg(doorText)}</text>
      </g>
    `;
    x += width + 12;
    return markup;
  });
}

function orderRooms(rooms) {
  if (!rooms.length) return [];
  const order = rooms[0].east_to_west_order;
  const eastToWestAscending = order.includes("递增") || order.toLowerCase().includes("asc");
  return [...rooms].sort((a, b) => {
    const result = compareDoor(a.front_door, b.front_door);
    return eastToWestAscending ? -result : result;
  });
}

function totalFrontage(rooms) {
  return rooms.reduce((sum, room) => sum + Math.max(room.length_m, 4), 0) + Math.max(0, rooms.length - 1) * 0.5;
}

function showRoomDetails(room) {
  if (!room) {
    els.roomDetails.textContent = "点击图中的房间查看详情。";
    return;
  }

  els.roomDetails.innerHTML = `
    <strong>${escapeHtml(room.room_name)}</strong><br>
    教学楼：${escapeHtml(room.building)} ${escapeHtml(room.floor)}层<br>
    南北侧：${escapeHtml(room.side)}侧<br>
    门牌：${escapeHtml(room.front_door === room.rear_door ? room.front_door : `${room.front_door} / ${room.rear_door}`)}<br>
    东西规则：${escapeHtml(room.east_to_west_order)}<br>
    尺寸：${room.length_m}m × ${room.width_m}m<br>
    学院：${escapeHtml(room.college)}<br>
    类型：${escapeHtml(room.lab_type || "未填写")}<br>
    容量：${room.capacity || "未填写"}<br>
    备注：${escapeHtml(room.notes || "无")}
  `;
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(state.rooms, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "floorplan-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

function makeCollegeColors(rooms) {
  const colleges = unique(rooms.map((room) => room.college));
  return Object.fromEntries(colleges.map((college, index) => [college, COLOR_PALETTE[index % COLOR_PALETTE.length]]));
}

function compareDoor(a, b) {
  const aNumber = Number.parseInt(String(a).match(/\d+/)?.[0] ?? "0", 10);
  const bNumber = Number.parseInt(String(b).match(/\d+/)?.[0] ?? "0", 10);
  if (aNumber !== bNumber) return aNumber - bNumber;
  return String(a).localeCompare(String(b), "zh-CN");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function updateStatus(message) {
  els.statusText.textContent = message;
}

function showError(message) {
  updateStatus(`导入失败：${message}`);
}

function truncateSvg(text, maxLength) {
  const value = String(text);
  return escapeSvg(value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeSvg(value) {
  return escapeHtml(value);
}
