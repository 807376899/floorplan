(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FloorplanApp = root.FloorplanApp || {};
    root.FloorplanApp.RawEditor = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createRawEditor(deps) {
    const {
      state,
      els,
      DATASETS,
      RAW_EDITOR_DELETE_KEYS,
      ImportExport,
      escapeHtml,
      isoNow,
      normalizeColor,
      nextCollegeColor,
      normalizeNumberingAction,
      generateBuildingCode,
      generateSegmentCode,
      generateUnitCode,
      generateUseTypeCode,
      generatePlanCode,
      normalizeElementType,
      normalizeDataset,
      normalizeBuilding,
      normalizeSegment,
      normalizeSpace,
      normalizeLab,
      normalizeCampus,
      normalizeCollege,
      normalizeMajor,
      normalizeLabType,
      canonicalizeLabTypes,
      normalizePlan,
      normalizeAssignment,
      relationMaps,
      isAssignableSegment,
      canEditEditorKey,
      buildingByCode,
      planById,
      activePlanCopyMeta,
      copyScopeForActivePlan,
      rowVisibleForActivePlan,
      spacesForActivePlan,
      floorSegmentsForActivePlan,
      labsForActivePlan,
      firstAssignableSegmentCode,
      nextGeneratedBuildingDraft,
      nextSegmentCodeForDraft,
      nextUnitCode,
      activeCollegeOptions,
      segmentTypeLabel,
      saveWithRollback,
      savePlanAssignmentsWithRollback,
      saveRawMaintenanceActionToServer,
      cloneDataset,
      refreshStateAndRender,
      updateStatus,
    } = deps;
    const RAW_MAINTENANCE_KEYS = (typeof window !== "undefined" && window.FloorplanApp?.RawMaintenanceActions?.RAW_MAINTENANCE_KEYS)
      || new Set(["buildings", "floor_segments", "colleges", "majors", "lab_types"]);
    const SERVER_READONLY_KEYS = new Set(["plan_assignments", "plans"]);

    function renderEditor() {
      syncEditorActionButtons();
      const definition = DATASETS.find((item) => item.key === state.editorKey);
      const rows = editorRows();
      const highlightRowId = state.editorHighlight?.key === state.editorKey ? state.editorHighlight.rowId : "";
    
      if (!rows.length) {
        const emptyText = state.serverMode && SERVER_READONLY_KEYS.has(state.editorKey)
          ? serverReadonlyMessage(state.editorKey)
          : state.editorKey === "plan_assignments"
            ? "当前方案下暂无分配记录，可点击“新增行”开始录入。"
          : "当前筛选下暂无数据，可点击“新增行”开始录入。";
        els.dataEditor.innerHTML = `${numberingToolbarHtml()}${rawEditorHelperHtml()}${rawEditorNoticeHtml()}<div class="empty">${emptyText}</div>`;
        bindRawEditorTools();
        return;
      }
    
      const inputDisabled = canEditEditorKey(state.editorKey) ? "" : "disabled";
      const canDeleteRows = canDeleteEditorRows(state.editorKey);
      const actionHeader = canDeleteRows ? `<th>操作</th>` : "";
      els.dataEditor.innerHTML = `${numberingToolbarHtml()}${rawEditorNoticeHtml()}<table><thead><tr>${definition.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}${actionHeader}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr data-row-id="${escapeHtml(row.id || "")}" class="${highlightRowId && row.id === highlightRowId ? "is-highlight" : ""}">${definition.columns.map(([key]) => `<td data-key="${key}"><input data-row="${rowIndex}" data-key="${key}" value="${escapeHtml(row[key] ?? "")}" ${inputDisabled}></td>`).join("")}${canDeleteRows ? `<td class="row-actions"><button type="button" class="row-delete-button" data-delete-row="${rowIndex}">删除</button></td>` : ""}</tr>`).join("")}</tbody></table>`;
      enhanceCollegeColorInputs(inputDisabled);
      bindRawEditorTools();
      els.dataEditor.querySelectorAll("[data-delete-row]").forEach((button) => {
        button.addEventListener("click", () => { void deleteEditorRow(Number(button.dataset.deleteRow), button); });
      });
    
      if (highlightRowId) {
        const highlightedRow = [...els.dataEditor.querySelectorAll("tr")].find((row) => row.dataset.rowId === highlightRowId);
        highlightedRow?.scrollIntoView({ block: "nearest" });
      }
    }
    
    function numberingToolbarHtml() {
      if (!state.permissions.canAdmin || !canEditEditorKey(state.editorKey)) return "";
      if (!["buildings", "floor_segments", "labs", "lab_types", "plans"].includes(state.editorKey)) return "";
      if (state.editorKey === "floor_segments") {
        return `<div class="raw-editor-tools raw-editor-tools-stack">
          <div><button type="button" data-regenerate-editor-codes>补全/刷新编号</button><button type="button" data-add-segment-type="stairs">新增楼梯</button><button type="button" data-add-segment-type="elevator">新增电梯</button></div>
          <span>走廊可绑定空间；楼梯和电梯只作为图面结构标识，不能作为空间落位骨架。新增后可调整起止坐标、宽度和备注。</span>
        </div>`;
      }
      return `<div class="raw-editor-tools"><button type="button" data-regenerate-editor-codes>补全/刷新编号</button><span>编号只写入当前表单，点击“应用修改”后保存。</span></div>`;
    }
    
    function enhanceCollegeColorInputs(inputDisabled) {
      if (state.editorKey !== "colleges") return;
      els.dataEditor.querySelectorAll('td[data-key="color"] input[data-key="color"]').forEach((input) => {
        const picker = document.createElement("input");
        picker.type = "color";
        picker.dataset.row = input.dataset.row;
        picker.dataset.key = "color";
        picker.value = normalizeColor(input.value) || nextCollegeColor(Number(input.dataset.row || 0), input.closest("tr")?.dataset.rowId || "", new Set(state.data.colleges.map((college) => college.color)));
        picker.className = "college-color-input";
        picker.disabled = Boolean(inputDisabled);
        input.replaceWith(picker);
      });
    }
    
    function bindRawEditorTools() {
      els.dataEditor.querySelector("[data-regenerate-editor-codes]")?.addEventListener("click", regenerateEditorCodes);
      els.dataEditor.querySelectorAll("[data-add-segment-type]").forEach((button) => {
        button.addEventListener("click", () => addFloorSegmentRow(button.dataset.addSegmentType || "corridor"));
      });
    }
    
    function rawEditorHelperHtml() {
      return "";
    }
    
    function rawEditorNoticeHtml() {
      return `<div class="raw-editor-notice" data-raw-editor-notice aria-live="polite" hidden></div>`;
    }
    
    function setRawEditorNotice(message, type = "error") {
      const notice = els.dataEditor.querySelector("[data-raw-editor-notice]");
      if (!notice) return;
      notice.textContent = message || "";
      notice.hidden = !message;
      notice.classList.toggle("is-error", type === "error");
      notice.classList.toggle("is-info", type !== "error");
    }

    function serverReadonlyMessage(key) {
      if (key === "plans") return "方案原始表在服务器模式下只读，请通过新增方案、公开/私有、删除方案或管理方案入口维护。";
      return "方案分配原始表为只读，请通过主图或待安置区维护分配。";
    }
    
    function regenerateEditorCodes() {
      if (state.serverMode && state.permissions.canAdmin) {
        void normalizeNumberingAction();
        return;
      }
      const rows = collectEditorInputRows();
      if (!rows.length) {
        setRawEditorNotice("当前没有可刷新编号的行。", "info");
        return;
      }
      if (state.editorKey === "buildings") {
        rows.forEach((row, index) => {
          setEditorInputValue(index, "building_code", generateBuildingCode(row));
        });
        setRawEditorNotice("已按校区和楼号刷新教学楼编号，请确认后应用修改。", "info");
        return;
      }
      if (state.editorKey === "floor_segments") {
        const generated = [];
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const building = buildingByCode(row.building_code);
          const nextCode = generateSegmentCode(row, building || { building_code: row.building_code }, [
            ...state.data.floor_segments.filter((segment) => !rows.some((item) => item.__original && segmentKey(item.__original) === segmentKey(segment))),
            ...generated,
          ]);
          if (!nextCode) {
            setRawEditorNotice("当前分组骨架编号超过 99 条，无法继续生成。");
            return;
          }
          const nextRow = { ...row, segment_code: nextCode };
          generated.push(nextRow);
          setEditorInputValue(index, "segment_code", nextCode);
        }
        setRawEditorNotice("已刷新当前楼层骨架编号，请确认后应用修改。", "info");
        return;
      }
      if (state.editorKey === "labs") {
        const prefixRows = state.data.labs.filter((lab) => !rows.some((row) => row.__original?.id === lab.id));
        rows.forEach((row, index) => {
          const nextCode = generateUnitCode([...prefixRows, ...rows.slice(0, index)]);
          row.lab_code = nextCode;
          setEditorInputValue(index, "lab_code", nextCode);
        });
        setRawEditorNotice("已刷新用途单元编号，请确认后应用修改。", "info");
        return;
      }
      if (state.editorKey === "lab_types") {
        const prefixRows = state.data.lab_types.filter((type) => !rows.some((row) => row.__original?.id === type.id));
        rows.forEach((row, index) => {
          const nextCode = generateUseTypeCode([...prefixRows, ...rows.slice(0, index)]);
          row.type_code = nextCode;
          setEditorInputValue(index, "type_code", nextCode);
        });
        setRawEditorNotice("已刷新用途类型编码，请确认后应用修改。", "info");
        return;
      }
      if (state.editorKey === "plans") {
        const prefixRows = state.data.plans.filter((plan) => !rows.some((row) => row.__original?.id === plan.id));
        rows.forEach((row, index) => {
          const nextCode = generatePlanCode([...prefixRows, ...rows.slice(0, index)]);
          row.plan_code = nextCode;
          setEditorInputValue(index, "plan_code", nextCode);
        });
        setRawEditorNotice("已刷新方案编码，请确认后应用修改。", "info");
      }
    }
    
    function setEditorInputValue(rowIndex, key, value) {
      const input = els.dataEditor.querySelector(`input[data-row="${rowIndex}"][data-key="${key}"]`);
      if (input) input.value = value;
    }
    
    function syncEditorActionButtons() {
      els.addRowBtn.textContent = "新增行";
      els.applyTableBtn.textContent = "应用修改";
      els.addRowBtn.hidden = !state.permissions.canEdit;
      els.applyTableBtn.hidden = !state.permissions.canEdit;
      els.addRowBtn.disabled = !canEditEditorKey(state.editorKey);
      els.applyTableBtn.disabled = !canEditEditorKey(state.editorKey);
      els.downloadSheetBtn.hidden = false;
    }

    function editorRows() {
      const buildingCode = els.buildingSelect.value;
      const floorCode = els.floorSelect.value;
      if (state.editorKey === "floor_segments") {
        const rows = typeof floorSegmentsForActivePlan === "function" ? floorSegmentsForActivePlan() : state.data.floor_segments;
        return rows.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
      }
      if (state.editorKey === "spaces") {
        const rows = typeof spacesForActivePlan === "function" ? spacesForActivePlan() : state.data.spaces;
        return rows.filter((row) => row.building_code === buildingCode && row.floor_code === floorCode);
      }
      if (state.editorKey === "labs") return typeof labsForActivePlan === "function" ? labsForActivePlan() : state.data.labs;
      if (state.editorKey === "plan_assignments") return state.data.plan_assignments.filter((row) => row.plan_id === state.activePlanId);
      return state.data[state.editorKey];
    }
    
    function canDeleteEditorRows(key) {
      return Boolean(state.permissions.canAdmin && canEditEditorKey(key) && RAW_EDITOR_DELETE_KEYS.has(key));
    }
    
    function collectEditorInputRows() {
      const rows = editorRows().map((row) => ({ ...row, __original: { ...row } }));
      els.dataEditor.querySelectorAll("input[data-row][data-key]").forEach((input) => {
        rows[Number(input.dataset.row)][input.dataset.key] = input.value;
      });
      return rows;
    }
    
    function normalizeEditorRowsForKey(key, rows) {
      if (key === "campuses") return rows.map((row) => normalizeCampus(row));
      if (key === "buildings") return rows.map((row) => normalizeBuilding(row));
      if (key === "colleges") return rows.map((row) => normalizeCollege(row));
      if (key === "majors") return rows.map((row) => normalizeMajor(row));
      if (key === "lab_types") return rows.map((row) => normalizeLabType(row));
      if (key === "floor_segments") return rows.map((row) => normalizeSegment(row));
      return rows;
    }
    
    function applyBuildingEditorRows(rows) {
      const normalizedRows = rows.map((row) => normalizeBuilding(row));
      const nextCodes = new Set();
      for (const building of normalizedRows) {
        const code = String(building.building_code || "").trim();
        if (!code) return { ok: false, message: "教学楼编码不能为空。" };
        if (nextCodes.has(code)) return { ok: false, message: `教学楼编码“${code}”重复，请修改后再保存。` };
        nextCodes.add(code);
      }
      rows.forEach((row, index) => {
        const originalCode = String(row.__original?.building_code || row.building_code || "").trim();
        const nextCode = String(normalizedRows[index].building_code || "").trim();
        if (!originalCode || originalCode === nextCode) return;
        state.data.floor_segments = state.data.floor_segments.map((segment) =>
          String(segment.building_code || "").trim() === originalCode
            ? normalizeSegment({ ...segment, building_code: nextCode })
            : segment
        );
        state.data.spaces = state.data.spaces.map((space) =>
          String(space.building_code || "").trim() === originalCode
            ? normalizeSpace({ ...space, building_code: nextCode })
            : space
        );
      });
      state.data.buildings = normalizedRows;
      return { ok: true };
    }
    
    function applyPlanEditorRows(rows) {
      const normalizedRows = rows.map((row, index) => {
        const normalized = normalizePlan(row);
        if (!normalized.plan_code) {
          normalized.plan_code = generatePlanCode([
            ...state.data.plans.filter((plan) => !rows.some((item) => item.__original?.id === plan.id)),
            ...rows.slice(0, index),
          ]);
        }
        return normalizePlan(normalized);
      });
      const nextCodes = new Set();
      for (const plan of normalizedRows) {
        const code = String(plan.plan_code || "").trim();
        if (!/^[A-Z][A-Z0-9_-]*$/i.test(code)) return { ok: false, message: "方案编码只能使用英文字母、数字、下划线或短横线。" };
        if (nextCodes.has(code)) return { ok: false, message: `方案编码“${code}”重复，请修改后再保存。` };
        nextCodes.add(code);
      }
      rows.forEach((row, index) => {
        const originalCode = String(row.__original?.plan_code || row.plan_code || "").trim();
        const nextCode = String(normalizedRows[index].plan_code || "").trim();
        if (!originalCode || originalCode === nextCode) return;
        state.data.plans = state.data.plans.map((plan) =>
          String(plan.source_plan_code || "").trim() === originalCode
            ? normalizePlan({ ...plan, source_plan_code: nextCode })
            : plan
        );
        const relation = relationMaps({ ...state.data, plans: normalizedRows });
        state.data.plan_assignments = state.data.plan_assignments.map((assignment) =>
          String(assignment.plan_code || "").trim() === originalCode
            ? normalizeAssignment({ ...assignment, plan_code: nextCode }, relation)
            : assignment
        );
      });
      state.data.plans = normalizedRows;
      return { ok: true };
    }
    
    function normalizeLabTypeEditorRows(rows) {
      const existing = state.data.lab_types.filter((type) => !rows.some((row) => row.__original?.id === type.id));
      const normalizedRows = rows.map((row, index) => {
        const normalized = normalizeLabType(row);
        if (!normalized.type_code) {
          normalized.type_code = generateUseTypeCode([
            ...existing,
            ...rows.slice(0, index),
          ]);
          normalized.id = normalized.id || normalized.type_code;
        }
        return normalizeLabType(normalized);
      });
      return canonicalizeLabTypes([...existing, ...normalizedRows], state.data.labs);
    }
    
    function applyFloorSegmentEditorRows(rows) {
      const normalizedRows = rows.map((row) => normalizeSegment(row));
      const originalKeys = new Set(rows.map((row) => segmentKey(row.__original || row)));
      const nextKeys = new Set();
      for (const segment of normalizedRows) {
        const key = segmentKey(segment);
        if (nextKeys.has(key)) {
          return { ok: false, message: `楼层骨架“${segment.building_code} ${segment.floor_code}层 ${segment.segment_code}”重复，请修改后再保存。` };
        }
        nextKeys.add(key);
        const existing = state.data.floor_segments.find((item) => segmentKey(item) === key);
        if (existing && !originalKeys.has(segmentKey(existing))) {
          return { ok: false, message: `目标楼层骨架“${segment.building_code} ${segment.floor_code}层 ${segment.segment_code}”已存在，不能覆盖。` };
        }
      }
    
      const moveBySpaceId = new Map();
      rows.forEach((row, index) => {
        const original = row.__original || row;
        const next = normalizedRows[index];
        state.data.spaces.forEach((space) => {
          if (!spaceMatchesSegment(space, original)) return;
          if (!isAssignableSegment(next)) {
            moveBySpaceId.set(space.id, { blocked: true, segment: next });
            return;
          }
          moveBySpaceId.set(space.id, {
            building_code: next.building_code,
            floor_code: next.floor_code,
            segment_code: next.segment_code,
          });
        });
      });
      const blockedMove = [...moveBySpaceId.values()].find((move) => move.blocked);
      if (blockedMove) {
        const segment = blockedMove.segment;
        return { ok: false, message: `楼层骨架“${segment.segment_code}”已绑定空间，不能改为${segmentTypeLabel(segment.element_type)}。` };
      }
    
      state.data.floor_segments = [
        ...state.data.floor_segments.filter((segment) => !originalKeys.has(segmentKey(segment))),
        ...normalizedRows,
      ];
      state.data.spaces = state.data.spaces.map((space) => {
        const move = moveBySpaceId.get(space.id);
        return move ? normalizeSpace({ ...space, ...move }) : space;
      });
      return { ok: true, movedSpaces: moveBySpaceId.size };
    }
    
    function editorRowDeleteBlocker(key, row) {
      if (key === "colleges") {
        const code = String(row.college_code || "").trim();
        const name = String(row.college_name || "").trim();
        if (state.data.majors.some((item) => item.college_code === code) || state.data.labs.some((item) => item.college === name || item.college === code)) {
          return "该学院仍被专业或实验室引用，不能删除。";
        }
      }
      if (key === "majors") {
        const code = String(row.major_code || "").trim();
        const name = String(row.major_name || "").trim();
        if (state.data.labs.some((item) => item.major === name || item.major === code)) {
          return "该专业仍被实验室引用，不能删除。";
        }
      }
      if (key === "lab_types") {
        const code = String(row.type_code || "").trim();
        const name = String(row.type_name || "").trim();
        const hasSameType = state.data.lab_types.some((item) =>
          item.id !== row.id && String(item.type_name || "").trim() === name
        );
        if (hasSameType) return "";
        if (state.data.labs.some((item) => item.lab_type === name || item.lab_type === code)) {
          return "该实验室类型仍被实验室引用，不能删除。";
        }
      }
      return "";
    }
    
    function segmentKey(row) {
      return [row?.building_code, row?.floor_code, row?.segment_code].map((value) => String(value || "").trim()).join("__");
    }
    
    function spaceMatchesSegment(space, segment) {
      return String(space.building_code || "").trim() === String(segment.building_code || "").trim()
        && String(space.floor_code || "").trim() === String(segment.floor_code || "").trim()
        && String(space.segment_code || "").trim() === String(segment.segment_code || "").trim();
    }
    
    function spacesForBuilding(buildingCode) {
      return state.data.spaces.filter((space) => String(space.building_code || "").trim() === String(buildingCode || "").trim());
    }
    
    function spacesForSegment(segment) {
      return state.data.spaces.filter((space) => spaceMatchesSegment(space, segment));
    }
    
    function invalidateAssignmentsForSpaces(spaceIds, spaceCodes) {
      const ids = new Set(spaceIds);
      const codes = new Set(spaceCodes);
      const relation = relationMaps(state.data);
      state.data.plan_assignments = state.data.plan_assignments.map((row) => {
        if (!ids.has(row.space_id) && !codes.has(row.space_code)) return row;
        return normalizeAssignment({
          ...row,
          previous_space_code: row.space_code || row.previous_space_code,
          space_code: "",
          assignment_status: "Invalid",
        }, relation);
      });
    }
    
    function cascadeDeleteBuilding(row) {
      const buildingCode = String(row.__original?.building_code || row.building_code || "").trim();
      const spaces = spacesForBuilding(buildingCode);
      const spaceIds = spaces.map((space) => space.id).filter(Boolean);
      const spaceCodes = spaces.map((space) => space.space_code).filter(Boolean);
      const segmentsCount = state.data.floor_segments.filter((segment) => String(segment.building_code || "").trim() === buildingCode).length;
      const assignmentCount = state.data.plan_assignments.filter((assignment) => spaceIds.includes(assignment.space_id) || spaceCodes.includes(assignment.space_code)).length;
      const label = row.__original?.building_name || row.building_name || buildingCode;
      const message = `确认删除教学楼“${label}”？将同时删除 ${segmentsCount} 条楼层骨架、${spaces.length} 个空间，并将 ${assignmentCount} 条相关分配标记为无效；实验室资料会保留。`;
      if (!window.confirm(message)) return false;
      state.data.buildings = state.data.buildings.filter((building) => String(building.building_code || "").trim() !== buildingCode);
      state.data.floor_segments = state.data.floor_segments.filter((segment) => String(segment.building_code || "").trim() !== buildingCode);
      state.data.spaces = state.data.spaces.filter((space) => String(space.building_code || "").trim() !== buildingCode);
      state.data.deleted_space_ids = [...new Set([...(state.data.deleted_space_ids || []), ...spaceIds])];
      invalidateAssignmentsForSpaces(spaceIds, spaceCodes);
      return `已删除教学楼 ${label}，并清理其骨架与空间。`;
    }
    
    function cascadeDeleteFloorSegment(row) {
      const original = row.__original || row;
      const spaces = spacesForSegment(original);
      const spaceIds = spaces.map((space) => space.id).filter(Boolean);
      const spaceCodes = spaces.map((space) => space.space_code).filter(Boolean);
      const assignmentCount = state.data.plan_assignments.filter((assignment) => spaceIds.includes(assignment.space_id) || spaceCodes.includes(assignment.space_code)).length;
      const label = `${original.building_code || "-"} ${original.floor_code || "-"}层 ${original.segment_code || "-"}`;
      const message = `确认删除楼层骨架“${label}”？将同时删除 ${spaces.length} 个绑定空间，并将 ${assignmentCount} 条相关分配标记为无效；实验室资料会保留。`;
      if (!window.confirm(message)) return false;
      const originalKey = segmentKey(original);
      state.data.floor_segments = state.data.floor_segments.filter((segment) => segmentKey(segment) !== originalKey);
      state.data.spaces = state.data.spaces.filter((space) => !spaceMatchesSegment(space, original));
      state.data.deleted_space_ids = [...new Set([...(state.data.deleted_space_ids || []), ...spaceIds])];
      invalidateAssignmentsForSpaces(spaceIds, spaceCodes);
      return `已删除楼层骨架 ${label}，并清理绑定空间。`;
    }
    
    async function deleteEditorRow(rowIndex, button = null) {
      setRawEditorNotice("");
      if (!canDeleteEditorRows(state.editorKey)) {
        setRawEditorNotice("只有管理员可以删除基础表行。");
        updateStatus("只有管理员可以删除基础表行。");
        return;
      }
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const rows = collectEditorInputRows();
      const row = rows[rowIndex];
      if (!row) return;
      const blocker = editorRowDeleteBlocker(state.editorKey, row);
      if (blocker) {
        setRawEditorNotice(blocker);
        updateStatus(blocker);
        return;
      }
      let successMessage = "已删除当前行。";
      if (state.editorKey === "buildings") {
        const result = cascadeDeleteBuilding(row);
        if (!result) return;
        successMessage = result;
      } else if (state.editorKey === "floor_segments") {
        const result = cascadeDeleteFloorSegment(row);
        if (!result) return;
        successMessage = result;
      } else {
        if (!window.confirm("确认删除当前行？删除后会立即保存。")) return;
        const nextRows = normalizeEditorRowsForKey(state.editorKey, rows.filter((_, index) => index !== rowIndex));
        state.data[state.editorKey] = nextRows;
      }
      if (button) {
        button.disabled = true;
        button.textContent = "删除中";
      }
      state.data = normalizeDataset(state.data);
      const saveOk = state.serverMode && RAW_MAINTENANCE_KEYS.has(state.editorKey) && typeof saveRawMaintenanceActionToServer === "function"
        ? await saveRawMaintenanceWithRollback(previousData, previousRevision, "deleteRow", { row })
        : await saveWithRollback(previousData, previousRevision, `删除 ${state.editorKey} 行`, "删除行失败");
      if (saveOk) {
        refreshStateAndRender(successMessage, { stamp: false, forceMoveReset: true });
      } else if (button) {
        button.disabled = false;
        button.textContent = "删除";
      }
    }
    
    function addFloorSegmentRow(elementType = "corridor") {
      if (state.editorKey !== "floor_segments" || !canEditEditorKey("floor_segments")) return;
      const now = isoNow();
      const buildingCode = els.buildingSelect.value || "B01";
      const floorCode = els.floorSelect.value || "1";
      const type = normalizeElementType(elementType);
      const isVertical = type === "stairs" || type === "elevator";
      const width = type === "corridor" ? 2.4 : 4;
      const defaultName = type === "stairs" ? "新楼梯" : (type === "elevator" ? "新电梯" : "新走廊");
      const draft = {
        building_code: buildingCode,
        floor_code: floorCode,
        start_x_m: isVertical ? 4 : 0,
        start_y_m: isVertical ? 2 : 0,
        end_x_m: isVertical ? 4 : 18,
        end_y_m: isVertical ? 8 : 0,
        width_m: width,
        element_type: type,
        segment_name: defaultName,
        notes: "",
        created_at: now,
      };
      const segment = normalizeSegment({ ...(typeof copyScopeForActivePlan === "function" ? copyScopeForActivePlan() : {}), ...draft, segment_code: nextSegmentCodeForDraft(draft) || `segment-${Date.now()}` });
      state.data.floor_segments.push(segment);
      state.data = normalizeDataset(state.data);
      state.editorHighlight = { key: "floor_segments", rowId: segment.id };
      refreshStateAndRender(`已新增${segmentTypeLabel(type)}骨架，请调整起止坐标后应用修改。`, { stamp: false, forceMoveReset: true });
    }
    
    function addEditorRow() {
      if (!canEditEditorKey(state.editorKey)) {
        updateStatus(state.serverMode && SERVER_READONLY_KEYS.has(state.editorKey) ? serverReadonlyMessage(state.editorKey) : "当前账号没有编辑权限。");
        return;
      }
      const now = isoNow();
      const buildingCode = els.buildingSelect.value || "B01";
      const floorCode = els.floorSelect.value || "1";
      if (state.editorKey === "buildings") {
        state.data.buildings.push(normalizeBuilding({ ...nextGeneratedBuildingDraft(), created_at: now }));
      } else if (state.editorKey === "campuses") {
        state.data.campuses.push(normalizeCampus({ campus_code: "", campus_name: "新增校区", sort_order: state.data.campuses.length + 1, status: "active", notes: "", created_at: now }));
      } else if (state.editorKey === "floor_segments") {
        addFloorSegmentRow("corridor");
        return;
      } else if (state.editorKey === "spaces") {
        const segmentCode = firstAssignableSegmentCode(buildingCode, floorCode);
        if (!segmentCode) {
          updateStatus("当前楼层没有可绑定空间的走廊段，请先新增走廊骨架。");
          return;
        }
        const draft = { building_code: buildingCode, floor_code: floorCode, front_door: "000", rear_door: "" };
        state.data.spaces.push(normalizeSpace({ ...(typeof copyScopeForActivePlan === "function" ? copyScopeForActivePlan() : {}), space_code: generateSpaceCode(draft, buildingByCode(buildingCode)) || `PENDING-${Date.now()}`, building_code: buildingCode, floor_code: floorCode, segment_code: segmentCode, offset_m: 0, side: "north", front_door: "000", rear_door: "", length_m: 8, width_m: 6, network_segment: "", current_status: "active", created_at: now }));
      } else if (state.editorKey === "labs") {
        state.data.labs.push(normalizeLab({ ...(typeof copyScopeForActivePlan === "function" ? copyScopeForActivePlan() : {}), lab_code: nextUnitCode(), lab_name: "新增用途单元", college: "未设置学院", major: "", lab_type: "教学实验室", director: "", seat_count: 0, computer_count: 0, status: "planning", notes: "", created_at: now }));
      } else if (state.editorKey === "colleges") {
        state.data.colleges.push(normalizeCollege({ college_code: `学院-${Date.now()}`, college_name: "新增学院", sort_order: state.data.colleges.length + 1, status: "active", notes: "", created_at: now }));
        state.data.colleges[state.data.colleges.length - 1].color ||= nextCollegeColor(state.data.colleges.length - 1, "new-college", new Set(state.data.colleges.slice(0, -1).map((college) => college.color)));
      } else if (state.editorKey === "majors") {
        const college = activeCollegeOptions()[0] || state.data.colleges[0] || normalizeCollege({ college_code: "未设置学院", college_name: "未设置学院" });
        if (!state.data.colleges.length) state.data.colleges.push(college);
        state.data.majors.push(normalizeMajor({ major_code: `${college.college_code}-专业-${Date.now()}`, major_name: "新增专业", college_code: college.college_code, sort_order: state.data.majors.length + 1, status: "active", notes: "", created_at: now }));
      } else if (state.editorKey === "lab_types") {
        state.data.lab_types.push(normalizeLabType({ type_code: generateUseTypeCode(state.data.lab_types), type_name: "新增类型", sort_order: state.data.lab_types.length + 1, status: "active", notes: "", created_at: now }));
      } else if (state.editorKey === "plans") {
        state.data.plans.push(normalizePlan({ plan_code: generatePlanCode(state.data.plans), plan_name: "新增方案", plan_type: "draft", source_plan_code: "", description: "", is_locked: false, is_default_compare_before: false, is_default_compare_after: false, created_at: now }));
      } else if (state.editorKey === "plan_assignments") {
        const relation = relationMaps(state.data);
        state.data.plan_assignments.push(normalizeAssignment({
          plan_code: planById(state.activePlanId)?.plan_code || state.data.plans[0]?.plan_code || "baseline",
          lab_code: state.data.labs[0]?.lab_code || "",
          space_code: state.data.spaces.find((row) => row.building_code === buildingCode && row.floor_code === floorCode)?.space_code || "",
          previous_space_code: "",
          assignment_status: "assigned",
          move_note: "",
          effective_from: "",
          created_at: now,
        }, relation));
      }
      state.data = normalizeDataset(state.data);
      refreshStateAndRender("已新增一行。", { stamp: false, forceMoveReset: true });
    }
    
    async function applyEditorRows() {
      if (!canEditEditorKey(state.editorKey)) {
        updateStatus("当前账号没有编辑权限。");
        return;
      }
      if (state.serverMode && SERVER_READONLY_KEYS.has(state.editorKey)) {
        const message = serverReadonlyMessage(state.editorKey);
        setRawEditorNotice(message);
        updateStatus(message);
        return;
      }
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const rows = collectEditorInputRows();
    
      if (state.editorKey === "buildings") {
        const result = applyBuildingEditorRows(rows);
        if (!result.ok) {
          setRawEditorNotice(result.message);
          updateStatus(result.message);
          return;
        }
      }
      if (state.editorKey === "campuses") state.data.campuses = rows.map((row) => normalizeCampus(row));
      if (state.editorKey === "labs") state.data.labs = rows.map((row) => normalizeLab(row));
      if (state.editorKey === "colleges") state.data.colleges = rows.map((row) => normalizeCollege(row));
      if (state.editorKey === "majors") state.data.majors = rows.map((row) => normalizeMajor(row));
      if (state.editorKey === "lab_types") state.data.lab_types = normalizeLabTypeEditorRows(rows);
      if (state.editorKey === "plans") {
        const result = applyPlanEditorRows(rows);
        if (!result.ok) {
          setRawEditorNotice(result.message);
          updateStatus(result.message);
          return;
        }
      }
      if (state.editorKey === "floor_segments") {
        const result = applyFloorSegmentEditorRows(rows);
        if (!result.ok) {
          setRawEditorNotice(result.message);
          updateStatus(result.message);
          return;
        }
      }
      if (state.editorKey === "spaces") replaceFilteredRows("spaces", rows.map((row) => normalizeSpace(row)));
      if (state.editorKey === "plan_assignments") replaceFilteredAssignments(rows.map((row) => normalizeAssignment(row, relationMaps(state.data))));
    
      state.data = normalizeDataset(state.data);
      const saveOk = state.serverMode && RAW_MAINTENANCE_KEYS.has(state.editorKey) && typeof saveRawMaintenanceActionToServer === "function"
        ? await saveRawMaintenanceWithRollback(previousData, previousRevision, "replaceRows", { rows })
        : await saveWithRollback(previousData, previousRevision, `编辑 ${state.editorKey}`, "表格保存失败");
      if (saveOk) {
        refreshStateAndRender("已应用表格修改。", { stamp: false, forceMoveReset: true });
      }
    }

    async function saveRawMaintenanceWithRollback(previousData, previousRevision, action, payload) {
      try {
        await saveRawMaintenanceActionToServer(state.editorKey, action, payload);
        return true;
      } catch (error) {
        state.data = normalizeDataset(previousData);
        state.serverRevision = previousRevision;
        setRawEditorNotice(error.message || "基础表保存失败。");
        refreshStateAndRender(`基础表保存失败：${error.message}`, { stamp: false, forceMoveReset: true });
        return false;
      }
    }
    
    function downloadEditorData() {
      ImportExport.downloadCurrentSheet(state, editorRows, updateStatus);
    }
    
    function replaceFilteredRows(key, replacement) {
      const buildingCode = els.buildingSelect.value;
      const floorCode = els.floorSelect.value;
      state.data[key] = [
        ...state.data[key].filter((row) =>
          row.building_code !== buildingCode ||
          row.floor_code !== floorCode ||
          (typeof rowVisibleForActivePlan === "function" && !rowVisibleForActivePlan(row))
        ),
        ...replacement,
      ];
    }
    
    function replaceFilteredAssignments(replacement) {
      state.data.plan_assignments = [
        ...state.data.plan_assignments.filter((row) => row.plan_id !== state.activePlanId),
        ...replacement,
      ];
    }


    return {
      renderEditor,
      numberingToolbarHtml,
      enhanceCollegeColorInputs,
      bindRawEditorTools,
      rawEditorHelperHtml,
      rawEditorNoticeHtml,
      setRawEditorNotice,
      regenerateEditorCodes,
      setEditorInputValue,
      syncEditorActionButtons,
      editorRows,
      canDeleteEditorRows,
      collectEditorInputRows,
      normalizeEditorRowsForKey,
      applyBuildingEditorRows,
      applyPlanEditorRows,
      normalizeLabTypeEditorRows,
      applyFloorSegmentEditorRows,
      editorRowDeleteBlocker,
      segmentKey,
      spaceMatchesSegment,
      spacesForBuilding,
      spacesForSegment,
      invalidateAssignmentsForSpaces,
      cascadeDeleteBuilding,
      cascadeDeleteFloorSegment,
      deleteEditorRow,
      addFloorSegmentRow,
      addEditorRow,
      applyEditorRows,
      downloadEditorData,
      replaceFilteredRows,
      replaceFilteredAssignments,
    };
  }

  return {
    createRawEditor,
  };
});
