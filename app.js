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
const CORRIDOR_WIDTH_M = 2.4;
const ROOM_GAP_M = 0.7;
const SEGMENT_GAP_M = 4;
const DETAIL_SCALE = 30;
const THUMB_SCALE = 7;

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
  floorThumbs: document.querySelector("#floorThumbs"),
  floorplan: document.querySelector("#floorplan"),
  roomDetails: document.querySelector("#roomDetails"),
  jsonPreview: document.querySelector("#jsonPreview"),
};

els.fileInput.addEventListener("change", handleFileImport);
els.loadSampleBtn.addEventListener("click", loadSampleData);
els.downloadJsonBtn.addEventListener("click", downloadJson);
els.buildingSelect.addEventListener("change", () => {
  populateFloorOptions();
  state.selectedRoomId = null;
  render();
});
els.floorSelect.addEventListener("change", () => {
  state.selectedRoomId = null;
  render();
});
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

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  const body = rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
  return normalizeRows(body);
}

function normalizeRows(rows) {
  const aliases = {
    building: ["building", "教学楼", "楼栋"],
    floor: ["floor", "楼层"],
    room_name: ["room_name", "实验室名称", "教室名称", "房间名称"],
    side: ["side", "南北侧", "南北", "房间位置", "教室南北", "所在侧"],
    front_door: ["front_door", "前门牌", "前门门牌", "门牌号"],
    rear_door: ["rear_door", "后门牌", "后门门牌"],
    east_to_west_order: ["east_to_west_order", "东到西门牌分布", "从东到西门牌大小", "东西方向"],
    length_m: ["length_m", "长", "长度", "长m"],
    width_m: ["width_m", "宽", "宽度", "宽m"],
    college: ["college", "所属学院", "学院"],
    lab_type: ["lab_type", "实验室类型", "类型"],
    capacity: ["capacity", "容量", "人数"],
    notes: ["notes", "备注"],
    corridor_segment: ["corridor_segment", "走廊段", "分段", "布局分段"],
    corridor_axis: ["corridor_axis", "走廊方向", "分段方向"],
    corridor_offset_m: ["corridor_offset_m", "沿走廊位置", "位置", "排序位置"],
    segment_x_m: ["segment_x_m", "分段X", "走廊段X", "段起点X"],
    segment_y_m: ["segment_y_m", "分段Y", "走廊段Y", "段起点Y"],
  };

  const normalized = rows.map((row, index) => {
    const item = {};
    for (const [key, candidates] of Object.entries(aliases)) {
      const found = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(row, candidate));
      item[key] = found ? String(row[found]).trim() : "";
    }

    item.floor = String(item.floor).trim();
    item.side = normalizeSide(item.side);
    item.front_door = String(item.front_door || item.rear_door).trim();
    item.rear_door = String(item.rear_door || item.front_door).trim();
    item.length_m = toNumber(item.length_m, 8);
    item.width_m = toNumber(item.width_m, 6);
    item.capacity = toNumber(item.capacity, 0);
    item.corridor_segment = item.corridor_segment || "主走廊";
    item.corridor_axis = normalizeAxis(item.corridor_axis || "东西");
    item.corridor_offset_m = item.corridor_offset_m ? toNumber(item.corridor_offset_m, index * 10) : null;
    item.segment_x_m = item.segment_x_m ? toNumber(item.segment_x_m, 0) : null;
    item.segment_y_m = item.segment_y_m ? toNumber(item.segment_y_m, 0) : null;
    item.room_name = item.room_name || `${item.front_door} 实验室`;
    item.east_to_west_order = item.east_to_west_order || "东到西递增";
    item.id = `${item.building}-${item.floor}-${item.corridor_segment}-${item.front_door}-${item.rear_door}-${index}`;
    return item;
  });

  const missing = REQUIRED_COLUMNS.filter((column) => normalized.some((room) => !room[column] && column !== "rear_door"));
  if (missing.length) {
    throw new Error(`缺少必要字段或存在空值：${missing.join(", ")}`);
  }

  return assignOffsets(normalized);
}

function assignOffsets(rooms) {
  const groups = new Map();
  for (const room of rooms) {
    const key = `${room.building}|${room.floor}|${room.corridor_segment}|${room.corridor_axis}|${room.side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(room);
  }

  for (const group of groups.values()) {
    const needsOffset = group.some((room) => room.corridor_offset_m === null);
    if (!needsOffset) continue;
    const ordered = orderRooms(group);
    let cursor = 0;
    for (const room of ordered) {
      const along = room.corridor_axis === "东西" ? room.length_m : room.width_m;
      if (room.corridor_offset_m === null) room.corridor_offset_m = cursor;
      cursor += along + ROOM_GAP_M;
    }
  }

  return rooms;
}

function normalizeSide(value) {
  const text = String(value).trim();
  if (text.includes("东端")) return "东端";
  if (text.includes("西端")) return "西端";
  if (text.includes("北端")) return "北端";
  if (text.includes("南端")) return "南端";
  if (text.includes("北")) return "北";
  if (text.includes("南")) return "南";
  if (text.includes("东")) return "东";
  if (text.includes("西")) return "西";
  return text || "北";
}

function normalizeAxis(value) {
  const text = String(value).trim();
  if (text.includes("南北") || text.toLowerCase().includes("vertical")) return "南北";
  return "东西";
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
  fillSelect(els.buildingSelect, unique(state.rooms.map((room) => room.building)));
}

function populateFloorOptions() {
  const building = els.buildingSelect.value;
  const floors = unique(state.rooms.filter((room) => room.building === building).map((room) => room.floor)).sort(compareDoor);
  fillSelect(els.floorSelect, floors);
}

function populateCollegeOptions() {
  fillSelect(els.collegeSelect, ["全部学院", ...unique(state.rooms.map((room) => room.college))]);
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
  const buildingRooms = state.rooms.filter((room) => room.building === building);
  const rooms = buildingRooms.filter((room) => room.floor === floor);
  const colors = makeCollegeColors(state.rooms);

  renderLegend(colors);
  renderFloorThumbs(buildingRooms, colors);
  renderJsonPreview(rooms);
  renderFloorplan(rooms, colors, selectedCollege);
}

function renderLegend(colors) {
  els.legend.innerHTML = Object.entries(colors)
    .map(([college, color]) => `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${escapeHtml(college)}</span>`)
    .join("");
}

function renderFloorThumbs(buildingRooms, colors) {
  const floors = unique(buildingRooms.map((room) => room.floor)).sort(compareDoor);
  els.floorThumbs.innerHTML = floors
    .map((floor) => {
      const rooms = buildingRooms.filter((room) => room.floor === floor);
      const selected = floor === els.floorSelect.value;
      return `
        <button class="floor-thumb ${selected ? "is-active" : ""}" type="button" data-floor="${escapeHtml(floor)}">
          <span>${escapeHtml(floor)}层</span>
          ${makeMiniSvg(rooms, colors)}
        </button>
      `;
    })
    .join("");

  els.floorThumbs.querySelectorAll(".floor-thumb").forEach((button) => {
    button.addEventListener("click", () => {
      els.floorSelect.value = button.dataset.floor;
      state.selectedRoomId = null;
      render();
    });
  });
}

function renderJsonPreview(rooms) {
  els.jsonPreview.textContent = JSON.stringify(rooms, null, 2);
}

function renderFloorplan(rooms, colors, selectedCollege) {
  if (!rooms.length) {
    els.floorplan.innerHTML = `<div class="empty">当前筛选没有房间数据。</div>`;
    return;
  }

  const layout = buildLayout(rooms, DETAIL_SCALE);
  const selectedFloor = `${escapeSvg(els.buildingSelect.value)} ${escapeSvg(els.floorSelect.value)}层`;
  const corridorMarkup = layout.corridors
    .map((corridor) => `<rect x="${corridor.x}" y="${corridor.y}" width="${corridor.width}" height="${corridor.height}" rx="3" fill="#e8edf3" stroke="#cbd5e1"/>`)
    .join("");
  const roomMarkup = layout.rooms.map((roomBox) => roomToSvg(roomBox, colors, selectedCollege, false)).join("");

  els.floorplan.innerHTML = `
    <svg viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="实验室 SVG 分布图">
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e8edf3" stroke-width="1"/>
        </pattern>
      </defs>
      <rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="url(#grid)"/>
      <text x="34" y="42" font-size="24" font-weight="700" fill="#18212f">${selectedFloor}</text>
      <text x="34" y="70" font-size="13" fill="#667085">矩形按长宽等比绘制；房间到对应走廊边缘的间距统一为 ${ROOM_GAP_M}m；端头房间由“房间位置”字段标记。</text>
      <text x="34" y="104" font-size="15" font-weight="700" fill="#344054">西</text>
      <text x="${layout.width - 34}" y="104" text-anchor="end" font-size="15" font-weight="700" fill="#344054">东</text>
      ${corridorMarkup}
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

  showRoomDetails(rooms.find((room) => room.id === state.selectedRoomId));
}

function makeMiniSvg(rooms, colors) {
  const layout = buildLayout(rooms, THUMB_SCALE, { margin: 8, titleHeight: 0 });
  const corridors = layout.corridors
    .map((corridor) => `<rect x="${corridor.x}" y="${corridor.y}" width="${corridor.width}" height="${corridor.height}" rx="1.5" fill="#e8edf3"/>`)
    .join("");
  const blocks = layout.rooms.map((roomBox) => roomToSvg(roomBox, colors, "全部学院", true)).join("");
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">${corridors}${blocks}</svg>`;
}

function buildLayout(rooms, scale, options = {}) {
  const margin = options.margin ?? 34;
  const titleHeight = options.titleHeight ?? 96;
  const segmentRooms = groupBy(rooms, (room) => room.corridor_segment);
  const segmentLayouts = [];
  const hasExplicitSegmentPosition = rooms.some((room) => room.segment_x_m !== null || room.segment_y_m !== null);
  let segmentCursorY = titleHeight + margin;

  for (const [segmentName, segment] of segmentRooms.entries()) {
    const axis = segment[0]?.corridor_axis || "东西";
    const first = segment[0];
    const segmentX = hasExplicitSegmentPosition ? margin + (first.segment_x_m ?? 0) * scale : margin;
    const segmentY = hasExplicitSegmentPosition ? titleHeight + margin + (first.segment_y_m ?? 0) * scale : segmentCursorY;
    const boxes = makeSegmentBoxes(segment, axis, segmentX, segmentY, scale);
    segmentLayouts.push({ segmentName, axis, ...boxes });
    if (!hasExplicitSegmentPosition) segmentCursorY += boxes.height + SEGMENT_GAP_M * scale;
  }

  const minX = Math.min(...segmentLayouts.flatMap((layout) => [layout.corridor.x, ...layout.rooms.map((room) => room.x)]));
  const minY = Math.min(...segmentLayouts.flatMap((layout) => [layout.corridor.y, ...layout.rooms.map((room) => room.y)]));
  if (minX < margin || minY < titleHeight + 8) {
    const shift = margin - minX;
    const shiftY = titleHeight + 8 - minY;
    for (const layout of segmentLayouts) {
      if (minX < margin) {
        layout.corridor.x += shift;
        layout.rooms.forEach((room) => (room.x += shift));
      }
      if (minY < titleHeight + 8) {
        layout.corridor.y += shiftY;
        layout.rooms.forEach((room) => (room.y += shiftY));
      }
    }
  }

  const allRooms = segmentLayouts.flatMap((layout) => layout.rooms);
  const allCorridors = segmentLayouts.map((layout) => layout.corridor);
  const width = Math.max(620, Math.ceil(Math.max(...allRooms.map((room) => room.x + room.width + margin), ...allCorridors.map((corridor) => corridor.x + corridor.width + margin))));
  const height = Math.max(260, Math.ceil(Math.max(...allRooms.map((room) => room.y + room.height + margin), ...allCorridors.map((corridor) => corridor.y + corridor.height + margin))));

  return { width, height, rooms: allRooms, corridors: allCorridors };
}

function makeSegmentBoxes(segment, axis, startX, startY, scale) {
  const alongKey = axis === "东西" ? "length_m" : "width_m";
  const acrossKey = axis === "东西" ? "width_m" : "length_m";
  const corridorLengthM = getCorridorLength(segment, alongKey);
  const corridorWidth = axis === "东西" ? corridorLengthM * scale : CORRIDOR_WIDTH_M * scale;
  const corridorHeight = axis === "东西" ? CORRIDOR_WIDTH_M * scale : corridorLengthM * scale;
  const corridor = { x: startX + 90, y: startY + 90, width: corridorWidth, height: corridorHeight };

  const rooms = segment.map((room) => {
    const roomWidth = (axis === "东西" ? room.length_m : room.width_m) * scale;
    const roomHeight = (axis === "东西" ? room.width_m : room.length_m) * scale;
    const along = (room.corridor_offset_m ?? 0) * scale;
    let x = corridor.x + along;
    let y = corridor.y;

    if (axis === "东西") {
      if (room.side === "北") y = corridor.y - ROOM_GAP_M * scale - roomHeight;
      else if (room.side === "南") y = corridor.y + corridor.height + ROOM_GAP_M * scale;
      else if (room.side === "西端") {
        x = corridor.x - ROOM_GAP_M * scale - roomWidth;
        y = corridor.y + (corridor.height - roomHeight) / 2;
      } else if (room.side === "东端") {
        x = corridor.x + corridor.width + ROOM_GAP_M * scale;
        y = corridor.y + (corridor.height - roomHeight) / 2;
      }
      else y = corridor.y + corridor.height + ROOM_GAP_M * scale;
    } else {
      if (room.side === "西") x = corridor.x - ROOM_GAP_M * scale - roomWidth;
      else if (room.side === "东") x = corridor.x + corridor.width + ROOM_GAP_M * scale;
      else if (room.side === "北端") {
        x = corridor.x + (corridor.width - roomWidth) / 2;
        y = corridor.y - ROOM_GAP_M * scale - roomHeight;
      } else if (room.side === "南端") {
        x = corridor.x + (corridor.width - roomWidth) / 2;
        y = corridor.y + corridor.height + ROOM_GAP_M * scale;
      }
      else x = corridor.x + corridor.width + ROOM_GAP_M * scale;
      if (room.side === "西" || room.side === "东") y = corridor.y + along;
    }

    return { room, x, y, width: roomWidth, height: roomHeight, axis };
  });

  const minX = Math.min(corridor.x, ...rooms.map((room) => room.x));
  const maxX = Math.max(corridor.x + corridor.width, ...rooms.map((room) => room.x + room.width));
  const minY = Math.min(corridor.y, ...rooms.map((room) => room.y));
  const maxY = Math.max(corridor.y + corridor.height, ...rooms.map((room) => room.y + room.height));
  return {
    corridor,
    rooms,
    minX,
    maxX,
    width: maxX - minX,
    height: maxY - minY + 16,
  };
}

function roomToSvg(roomBox, colors, selectedCollege, compact) {
  const { room, x, y, width, height } = roomBox;
  const selected = room.id === state.selectedRoomId;
  const muted = selectedCollege !== "全部学院" && room.college !== selectedCollege;
  const doorText = room.front_door === room.rear_door ? `门牌 ${room.front_door}` : `前 ${room.front_door} / 后 ${room.rear_door}`;
  const label = room.front_door === room.rear_door ? room.front_door : `${room.front_door}-${room.rear_door}`;

  if (compact) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="1.5" fill="${colors[room.college]}" opacity="0.92"/>`;
  }

  return `
    <g class="room ${selected ? "is-selected" : ""} ${muted ? "is-muted" : ""}" data-id="${escapeHtml(room.id)}">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="${colors[room.college]}" stroke="#ffffff" stroke-width="1.5"/>
      <text x="${x + 8}" y="${y + 20}" font-size="14" font-weight="700" fill="#ffffff">${escapeSvg(label)}</text>
      ${width >= 110 && height >= 54 ? `<text x="${x + 8}" y="${y + 40}" font-size="12" fill="#ffffff">${truncateSvg(room.room_name, Math.floor(width / 11))}</text>` : ""}
      ${width >= 130 && height >= 74 ? `<text x="${x + 8}" y="${y + 58}" font-size="12" fill="#ffffff">${truncateSvg(room.college, Math.floor(width / 11))}</text>` : ""}
      <title>${escapeSvg(`${room.room_name}｜${room.college}｜${doorText}｜${room.length_m}m x ${room.width_m}m`)}</title>
    </g>
  `;
}

function getCorridorLength(segment, alongKey) {
  return Math.max(
    18,
    ...segment.map((room) => {
      const offset = room.corridor_offset_m ?? 0;
      return offset + room[alongKey] + ROOM_GAP_M;
    })
  );
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

function showRoomDetails(room) {
  if (!room) {
    els.roomDetails.textContent = "点击图中的房间查看详情。";
    return;
  }

  els.roomDetails.innerHTML = `
    <strong>${escapeHtml(room.room_name)}</strong><br>
    教学楼：${escapeHtml(room.building)} ${escapeHtml(room.floor)}层<br>
    走廊段：${escapeHtml(room.corridor_segment)}（${escapeHtml(room.corridor_axis)}）<br>
    房间位置：${escapeHtml(room.side)}<br>
    沿走廊位置：${room.corridor_offset_m}m<br>
    门牌：${escapeHtml(room.front_door === room.rear_door ? room.front_door : `${room.front_door} / ${room.rear_door}`)}<br>
    东西规则：${escapeHtml(room.east_to_west_order)}<br>
    尺寸：${room.length_m}m x ${room.width_m}m<br>
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

function groupBy(values, getKey) {
  const groups = new Map();
  for (const value of values) {
    const key = getKey(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function updateStatus(message) {
  els.statusText.textContent = message;
}

function showError(message) {
  updateStatus(`导入失败：${message}`);
}

function truncateSvg(text, maxLength) {
  const value = String(text);
  return escapeSvg(value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}…` : value);
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
