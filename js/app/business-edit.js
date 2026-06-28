(function attachFloorplanBusinessEdit(global) {
  function readBusinessFormDraft(formData, selectedSpace = null, wasNewSpace = false) {
    const labCode = textValue(formData, "labCode");
    return {
      selectedSpaceId: textValue(formData, "selectedSpaceId"),
      labCode,
      assignmentStatus: labCode ? "assigned" : "Invalid",
      moveNote: textValue(formData, "moveNote"),
      effectiveFrom: textValue(formData, "effectiveFrom"),
      replaceConflict: formData.get("replaceConflict") === "on",
      shouldRefreshSpaceCode: formData.get("spaceCodeCorrection") === "on" || wasNewSpace,
      space: {
        segment_code: textValue(formData, "segmentCode") || selectedSpace?.segment_code || "",
        front_door: textValue(formData, "frontDoor") || selectedSpace?.front_door || "",
        rear_door: textValue(formData, "rearDoor"),
        current_status: textValue(formData, "spaceStatus") || selectedSpace?.current_status || "",
        side: textValue(formData, "spaceSide") || selectedSpace?.side || "",
        offset_m: rawValue(formData, "offsetM") || selectedSpace?.offset_m || "",
        length_m: rawValue(formData, "lengthM") || selectedSpace?.length_m || "",
        width_m: rawValue(formData, "widthM") || selectedSpace?.width_m || "",
        network_segment: textValue(formData, "networkSegment"),
        notes: textValue(formData, "spaceNotes"),
      },
      lab: {
        lab_name: textValue(formData, "labName"),
        college: textValue(formData, "college"),
        major: textValue(formData, "major"),
        lab_type: textValue(formData, "labType"),
        director: textValue(formData, "director"),
        status: textValue(formData, "labStatus"),
        seat_count: rawValue(formData, "seatCount"),
        computer_count: rawValue(formData, "computerCount"),
      },
    };
  }

  function textValue(formData, key) {
    return String(formData.get(key) || "").trim();
  }

  function rawValue(formData, key) {
    const value = formData.get(key);
    return value === null || value === undefined ? "" : value;
  }

  function canDeleteSpaceForActivePlan(options) {
    const { serverMode, permissions = {}, activePlan = null, copy = null, canEditCopy = false } = options || {};
    if (!serverMode) return Boolean(permissions.canEdit);
    if (copy) return Boolean(canEditCopy && (!copy.isBaseline || permissions.canAdmin));
    return Boolean(permissions.canAdmin && activePlan);
  }

  function clearDeletedSpaceRefs(dataset, space, extraRefs = [], copyId = null) {
    if (!dataset || !Array.isArray(dataset.deleted_space_ids)) return;
    const baseRefs = [
      space?.id,
      space?.space_code,
      ...extraRefs,
    ].filter(Boolean).map((value) => String(value));
    const refs = new Set(baseRefs);
    if (copyId) {
      baseRefs.forEach((value) => refs.add(`copy:${copyId}::${value}`));
    }
    dataset.deleted_space_ids = dataset.deleted_space_ids.filter((value) => !refs.has(String(value)));
  }

  function createBusinessEditor(deps) {
    const { state, els, compare, normalizeBuilding, normalizeSegment, normalizeSpace, normalizeLab, normalizeAssignment, relationMaps, generateBuildingCode, generateSpaceCode, generateSegmentCode, generateUnitCode, isAssignableSegment, unique, escapeHtml, isoNow, segmentTypeLabel, spaceStatusLabel, sideLabel, buildingByCode, planById, activePlanCopyMeta, spacesForActivePlan, floorSegmentsForActivePlan, canEditPlanDataset, canEditActivePlan, canEditBusinessBaseData, canDeleteSpaceInActivePlan, assignmentRowsForPlan, renderEditor, renderApp, refreshStateAndRender, updateStatus, planSelectedSpaceAction, renovateSelectedLabAction, syncSelectedSpace, saveWithRollback, savePlanAssignmentsWithRollback, cloneDataset, normalizeDataset } = deps;

    function renderBusinessAssignmentEditor() {
      const activePlan = planById(state.activePlanId);
      if (!activePlan) {
        els.dataEditor.innerHTML = `<div class="empty">请先选择一个方案。</div>`;
        return;
      }
      const assignments = assignmentRowsForPlan(activePlan.id);
      const floorSpaces = currentFloorSpaces();
      const floorSpaceIds = new Set(floorSpaces.map((space) => space.id));
      const floorAssignments = assignments.filter((assignment) => floorSpaceIds.has(assignment.space_id) && assignment.assignment_status === "assigned");
      const selectedSpace = ensureBusinessSpaceSelection(floorSpaces);
      const selected = selectedSpace ? assignedAssignmentForSpace(assignments, selectedSpace) : null;
      const selectedLabCode = selected?.lab_code || "";
      const selectedLab = selected ? state.data.labs.find((row) => row.lab_code === selected.lab_code) || null : null;
      const isNewSpace = Boolean(selectedSpace && state.businessEditor.newSpaceId === selectedSpace.id);
      const building = buildingByCode(els.buildingSelect.value);
      const segments = currentFloorSegments();
      const assignableSegments = currentAssignableSegments();
      const segmentOptions = selectedSpace && !assignableSegments.some((row) => row.segment_code === selectedSpace.segment_code)
        ? [...assignableSegments, segments.find((row) => row.segment_code === selectedSpace.segment_code)].filter(Boolean)
        : assignableSegments;
      const segment = selectedSpace
        ? segments.find((row) => row.segment_code === selectedSpace.segment_code) || segments[0] || null
        : segments[0] || null;
      const canEditAssignment = canEditActivePlan();
      const canEditBase = canEditBusinessBaseData();
      const canViewCollegeMajor = state.permissions.canAdmin;
      const isCorrectingSpaceCode = Boolean(selectedSpace && state.businessEditor.spaceCorrectionId === selectedSpace.id);
      const canCorrectSpaceCode = Boolean(canEditBase && state.permissions.canAdmin && selectedSpace && !isNewSpace);
      const previewSpaceCode = selectedSpace ? generateSpaceCode(selectedSpace, building || buildingByCode(selectedSpace.building_code)) : "";
      const conflict = selectedSpace && selectedLabCode
        ? assignments.find((row) => row.space_id === selectedSpace.id && row.assignment_status === "assigned" && row.lab_code !== selectedLabCode)
        : null;
      const canSaveAnything = canEditAssignment || canEditBase;
      const labSection = selectedLab ? `
            <div class="business-form-section business-form-section-lab">
              <strong>用途信息</strong>
              <label>落位用途
                <select name="labCode" ${canEditAssignment && selectedSpace ? "" : "disabled"}>
                  <option value="" ${!selectedLabCode ? "selected" : ""}>未分配用途</option>
                  ${businessLabOptions(selectedLabCode, selectedSpace?.id || "")}
                </select>
              </label>
              <label>用途名称
                <input name="labName" type="text" value="${escapeHtml(selectedLab.lab_name || "")}" ${canEditBase ? "" : "disabled"} />
              </label>
              ${canViewCollegeMajor ? `<label>学院
                <select name="college" ${canEditBase ? "" : "disabled"}>
                  ${selectOptionsWithBlank(activeCollegeOptions().map((row) => row.college_name), selectedLab.college || "", "未选择学院")}
                </select>
              </label>
              <label>专业
                <select name="major" ${canEditBase ? "" : "disabled"}>
                  ${majorOptionsForCollege(selectedLab.college || "", selectedLab.major || "")}
                </select>
              </label>` : `<input name="college" type="hidden" value="${escapeHtml(selectedLab.college || "")}" />
              <input name="major" type="hidden" value="${escapeHtml(selectedLab.major || "")}" />`}
              <label>负责人
                <input name="director" type="text" value="${escapeHtml(selectedLab.director || "")}" ${canEditBase ? "" : "disabled"} />
              </label>
              <label>座位数
                <input name="seatCount" type="number" step="1" min="0" value="${escapeHtml(selectedLab.seat_count ?? "")}" ${canEditBase ? "" : "disabled"} />
              </label>
              <label>电脑数
                <input name="computerCount" type="number" step="1" min="0" value="${escapeHtml(selectedLab.computer_count ?? "")}" ${canEditBase ? "" : "disabled"} />
              </label>
               <label>类型
                <select name="labType" ${canEditBase ? "" : "disabled"}>
                  ${selectOptionsWithBlank(activeLabTypeOptions().map((row) => row.type_name), selectedLab.lab_type || "", "未选择类型")}
                </select>
              </label>
              <label>用途状态
                <select name="labStatus" ${canEditBase ? "" : "disabled"}>
                  ${["active", "planning", "inactive"].map((status) => `<option value="${status}" ${status === selectedLab.status ? "selected" : ""}>${labStatusLabel(status)}</option>`).join("")}
                </select>
              </label>
              
              <label>生效时间
                <input name="effectiveFrom" type="date" value="${escapeHtml(selected?.effective_from || "")}" ${canEditAssignment && selectedSpace ? "" : "disabled"} />
              </label>
              <label>备注
                <input name="moveNote" type="text" value="${escapeHtml(selected?.move_note || "")}" ${canEditAssignment && selectedSpace ? "" : "disabled"} />
              </label>
              ${conflict ? `<div class="business-conflict">当前空间已被 ${escapeHtml(labNameByCode(conflict.lab_code))} 占用。勾选后保存会将原分配改为无效。</div>
              <label class="business-checkbox"><input name="replaceConflict" type="checkbox" ${canEditAssignment ? "" : "disabled"} /> 替换当前占用</label>` : ""}
              ${canEditAssignment ? `<div class="business-inline-actions"><button id="businessRenovateLabBtn" type="button">改建</button><span>解绑当前用途单元，并为该空间生成同学院的未规划用途。</span></div>` : ""}
            </div>` : `
            <div class="business-form-section business-form-section-lab">
              <strong>用途信息</strong>
              <div class="business-preview business-unplanned-card">
                <strong>未规划</strong>
                <span>当前空间未规划建设。</span>
                ${canEditAssignment && state.permissions.canAdmin && selectedSpace ? `<button id="businessPlanSpaceBtn" type="button" class="primary-button">规划</button>` : ""}
              </div>
            </div>`;
      const legacySpaceSection = `
            <div class="business-form-section business-form-section-space">
              <strong>空间信息</strong>
              ${isNewSpace ? `<label>前门牌
                <input name="frontDoor" type="text" value="${escapeHtml(selectedSpace?.front_door || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>后门牌
                <input name="rearDoor" type="text" value="${escapeHtml(selectedSpace?.rear_door || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>骨架段
                <select name="segmentCode" ${canEditBase && selectedSpace ? "" : "disabled"}>
                  ${segmentOptions.map((item) => `<option value="${escapeHtml(item.segment_code)}" ${item.segment_code === selectedSpace?.segment_code ? "selected" : ""}>${escapeHtml(item.segment_code)} · ${segmentTypeLabel(item.element_type)}</option>`).join("")}
                </select>
              </label>` : `<input name="frontDoor" type="hidden" value="${escapeHtml(selectedSpace?.front_door || "")}" />
              <input name="rearDoor" type="hidden" value="${escapeHtml(selectedSpace?.rear_door || "")}" />
              <input name="segmentCode" type="hidden" value="${escapeHtml(selectedSpace?.segment_code || "")}" />`}
              ${canEditBase && selectedSpace ? `<label class="business-checkbox business-code-refresh"><input name="refreshSpaceCode" type="checkbox" ${isNewSpace ? "checked disabled" : ""} /> ${isNewSpace ? "保存时生成空间编号" : "保存时刷新空间编号"}</label>` : ""}
              <label>所在侧
                <select name="spaceSide" ${canEditBase && selectedSpace ? "" : "disabled"}>
                  ${["north", "south", "east", "west"].map((side) => `<option value="${side}" ${side === selectedSpace?.side ? "selected" : ""}>${sideLabel(side)}</option>`).join("")}
                </select>
              </label>
              <label>沿段偏移
                <input name="offsetM" type="number" step="0.1" min="0" value="${escapeHtml(selectedSpace?.offset_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>长度
                <input name="lengthM" type="number" step="0.1" min="0.1" value="${escapeHtml(selectedSpace?.length_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>宽度
                <input name="widthM" type="number" step="0.1" min="0.1" value="${escapeHtml(selectedSpace?.width_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>物理状态
                <select name="spaceStatus" ${canEditBase && selectedSpace ? "" : "disabled"}>
                  ${["active", "unavailable"].map((status) => `<option value="${status}" ${status === selectedSpace?.current_status ? "selected" : ""}>${spaceStatusLabel(status)}</option>`).join("")}
                </select>
              </label>
              <label>网段
                <input name="networkSegment" type="text" value="${escapeHtml(selectedSpace?.network_segment || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>空间备注
                <input name="spaceNotes" type="text" value="${escapeHtml(selectedSpace?.notes || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
            </div>`;
    
      const improvedSpaceSection = businessSpaceSectionHtml({
        selectedSpace,
        segmentOptions,
        canEditBase,
        isNewSpace,
        isCorrectingSpaceCode,
        canCorrectSpaceCode,
        previewSpaceCode,
      });
    
      els.dataEditor.innerHTML = `
        <div class="business-editor">
          <div class="business-editor-list">
            <div class="business-editor-heading">
              <strong>${escapeHtml(building?.building_name || building?.building_code || "当前楼栋")} ${escapeHtml(els.floorSelect.value || "")}层</strong>
              <span>${floorAssignments.length}/${floorSpaces.length} 已分配</span>
            </div>
            ${floorSpaces.length ? floorSpaces.map((space) => businessSpaceCard(space, assignments, selectedSpace?.id || "")).join("") : `<div class="empty">当前楼层还没有空间资料。</div>`}
          </div>
          <form id="businessAssignmentForm" class="business-assignment-form">
            <div class="business-editor-heading">
              <strong>${selectedSpace ? `编辑 ${businessDoorRangeLabel(selectedSpace) || selectedSpace.space_code}` : "当前楼层业务编辑"}</strong>
              <span>${escapeHtml(activePlan.plan_name)}</span>
            </div>
            ${labSection}
            ${improvedSpaceSection}
            <div class="business-preview">
              <strong>系统自动维护</strong>
              <span>${selectedSpace ? escapeHtml(`${spaceDisplayName(selectedSpace)} · ${selectedLab?.lab_name || "未分配用途"}`) : "请先在当前楼层选择一个空间"}</span>
            </div>
            ${canDeleteSpaceInActivePlan() && selectedSpace && !isNewSpace ? `<div class="business-danger-row"><button id="businessDeleteSpaceBtn" type="button">删除空间</button><span>从当前非基线方案中删除该空间，并将相关分配标记为无效。</span></div>` : ""}
            ${canDeleteLabInActivePlan(selectedLab, selectedSpace) ? `<div class="business-danger-row"><button id="businessDeleteLabBtn" type="button">删除用途单元</button><span>仅删除当前方案中未被其他空间占用的用途单元，并同步解绑当前空间。</span></div>` : ""}
            ${canSaveAnything ? "" : `<div class="business-readonly">当前账号只能查看业务信息，不能保存修改。</div>`}
            <input name="selectedSpaceId" type="hidden" value="${escapeHtml(selectedSpace?.id || "")}" />
            <input name="currentAssignmentId" type="hidden" value="${escapeHtml(selected?.id || "")}" />
          </form>
        </div>
      `;
      els.dataEditor.querySelectorAll("[data-business-space-id]").forEach((button) => {
        button.addEventListener("click", () => {
          state.businessEditor.selectedSpaceId = button.dataset.businessSpaceId;
          state.selectedSpaceId = button.dataset.businessSpaceId;
          const assignment = assignments.find((row) => row.space_id === button.dataset.businessSpaceId && row.assignment_status === "assigned") || null;
          state.businessEditor.selectedAssignmentId = assignment?.id || "";
          renderEditor();
          renderApp();
        });
      });
      els.dataEditor.querySelector("[data-business-space-id].is-active")?.scrollIntoView({ block: "nearest" });
      els.dataEditor.querySelector('select[name="labCode"]')?.addEventListener("change", renderBusinessLabPreview);
      els.dataEditor.querySelector('select[name="college"]')?.addEventListener("change", renderBusinessMajorOptions);
      els.dataEditor.querySelector("#spaceCodeCorrectionToggle")?.addEventListener("click", () => {
        state.businessEditor.spaceCorrectionId = isCorrectingSpaceCode ? "" : (selectedSpace?.id || "");
        renderEditor();
      });
      els.dataEditor.querySelectorAll('input[name="frontDoor"], input[name="rearDoor"]').forEach((input) => {
        input.addEventListener("input", updateSpaceCodePreview);
      });
      els.dataEditor.querySelector("#businessPlanSpaceBtn")?.addEventListener("click", () => { void planSelectedSpaceAction(); });
      els.dataEditor.querySelector("#businessRenovateLabBtn")?.addEventListener("click", () => { void renovateSelectedLabAction(); });
      els.dataEditor.querySelector("#businessDeleteSpaceBtn")?.addEventListener("click", () => { void markSelectedBusinessSpaceUnavailable(); });
      els.dataEditor.querySelector("#businessDeleteLabBtn")?.addEventListener("click", () => { void deleteSelectedBusinessLab(); });
    }
    
    function businessSpaceSectionHtml(options) {
      const {
        selectedSpace,
        segmentOptions,
        canEditBase,
        isNewSpace,
        isCorrectingSpaceCode,
        canCorrectSpaceCode,
        previewSpaceCode,
      } = options;
      const editDoors = isNewSpace || isCorrectingSpaceCode;
      return `
            <div class="business-form-section business-form-section-space">
              <div class="business-section-title">
                <strong>空间信息</strong>
                ${canCorrectSpaceCode ? `<button id="spaceCodeCorrectionToggle" type="button">${isCorrectingSpaceCode ? "取消修正" : "修正门牌/编号"}</button>` : ""}
              </div>
              ${selectedSpace ? `<div class="space-code-summary">
                <div><span>前门牌</span><strong>${escapeHtml(selectedSpace.front_door || "-")}</strong></div>
                <div><span>后门牌</span><strong>${escapeHtml(selectedSpace.rear_door || selectedSpace.front_door || "-")}</strong></div>
                <div><span>空间编号</span><strong>${escapeHtml(selectedSpace.space_code || "-")}</strong></div>
                <div><span>骨架段</span><strong>${escapeHtml(selectedSpace.segment_code || "-")}</strong></div>
              </div>` : ""}
              ${editDoors ? `<label>前门牌
                <input name="frontDoor" type="text" value="${escapeHtml(selectedSpace?.front_door || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>后门牌
                <input name="rearDoor" type="text" value="${escapeHtml(selectedSpace?.rear_door || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <input name="spaceCodeCorrection" type="hidden" value="on" />
              <div class="space-code-preview" data-space-code-preview>
                <span>${isNewSpace ? "保存时生成空间编号" : "保存后编号"}</span>
                <strong>${isNewSpace ? escapeHtml(previewSpaceCode || "填写门牌后生成") : `${escapeHtml(selectedSpace?.space_code || "-")} -> ${escapeHtml(previewSpaceCode || "无法生成")}`}</strong>
                <small>编号由校区、楼号、楼层和门牌末两位生成；单门空间后门牌可留空。</small>
              </div>` : `<input name="frontDoor" type="hidden" value="${escapeHtml(selectedSpace?.front_door || "")}" />
              <input name="rearDoor" type="hidden" value="${escapeHtml(selectedSpace?.rear_door || "")}" />`}
              <label>骨架段
                <select name="segmentCode" ${canEditBase && selectedSpace ? "" : "disabled"}>
                  ${segmentOptions.map((item) => `<option value="${escapeHtml(item.segment_code)}" ${item.segment_code === selectedSpace?.segment_code ? "selected" : ""}>${escapeHtml(item.segment_code)} · ${segmentTypeLabel(item.element_type)}</option>`).join("")}
                </select>
              </label>
              <label>所在侧
                <select name="spaceSide" ${canEditBase && selectedSpace ? "" : "disabled"}>
                  ${["north", "south", "east", "west"].map((side) => `<option value="${side}" ${side === selectedSpace?.side ? "selected" : ""}>${sideLabel(side)}</option>`).join("")}
                </select>
              </label>
              <label>沿段偏移
                <input name="offsetM" type="number" step="0.1" min="0" value="${escapeHtml(selectedSpace?.offset_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>长度
                <input name="lengthM" type="number" step="0.1" min="0.1" value="${escapeHtml(selectedSpace?.length_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>宽度
                <input name="widthM" type="number" step="0.1" min="0.1" value="${escapeHtml(selectedSpace?.width_m ?? "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>物理状态
                <select name="spaceStatus" ${canEditBase && selectedSpace ? "" : "disabled"}>
                  ${["active", "unavailable"].map((status) => `<option value="${status}" ${status === selectedSpace?.current_status ? "selected" : ""}>${spaceStatusLabel(status)}</option>`).join("")}
                </select>
              </label>
              <label>网段
                <input name="networkSegment" type="text" value="${escapeHtml(selectedSpace?.network_segment || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
              <label>空间备注
                <input name="spaceNotes" type="text" value="${escapeHtml(selectedSpace?.notes || "")}" ${canEditBase && selectedSpace ? "" : "disabled"} />
              </label>
            </div>`;
    }
    
    function updateSpaceCodePreview() {
      const form = els.dataEditor.querySelector("#businessAssignmentForm");
      const selectedSpace = activeSpaces().find((row) => row.id === state.businessEditor.selectedSpaceId) || null;
      const preview = form?.querySelector("[data-space-code-preview]");
      if (!form || !selectedSpace || !preview) return;
      const next = {
        ...selectedSpace,
        front_door: String(form.querySelector('input[name="frontDoor"]')?.value || "").trim(),
        rear_door: String(form.querySelector('input[name="rearDoor"]')?.value || "").trim(),
      };
      const nextCode = generateSpaceCode(next, buildingByCode(next.building_code));
      const title = preview.querySelector("strong");
      if (!title) return;
      title.textContent = state.businessEditor.newSpaceId === selectedSpace.id
        ? (nextCode || "填写门牌后生成")
        : `${selectedSpace.space_code || "-"} -> ${nextCode || "无法生成"}`;
    }

    function activeSpaces() {
      return typeof spacesForActivePlan === "function" ? spacesForActivePlan() : state.data.spaces;
    }

    function activeFloorSegments() {
      return typeof floorSegmentsForActivePlan === "function" ? floorSegmentsForActivePlan() : state.data.floor_segments;
    }
    
    function currentFloorSpaces() {
      const buildingCode = els.buildingSelect.value;
      const floorCode = els.floorSelect.value;
      const planSpaces = activeSpaces();
      return planSpaces
        .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
        .slice()
        .sort((a, b) => compare(spaceDisplayName(a), spaceDisplayName(b)));
    }
    
    function currentFloorSegments() {
      const buildingCode = els.buildingSelect.value;
      const floorCode = els.floorSelect.value;
      const planSegments = activeFloorSegments();
      return planSegments
        .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
        .slice()
        .sort((a, b) => compare(a.segment_code, b.segment_code));
    }
    
    function currentAssignableSegments() {
      return currentFloorSegments().filter((segment) => isAssignableSegment(segment));
    }
    
    function firstAssignableSegmentCode(buildingCode, floorCode) {
      const planSegments = activeFloorSegments();
      return planSegments.find((row) =>
        row.building_code === buildingCode &&
        row.floor_code === floorCode &&
        isAssignableSegment(row)
      )?.segment_code || "";
    }
    
    function nextBuildingNumber() {
      return state.data.buildings.reduce((max, building) => Math.max(max, Number(building.building_number) || 0), 0) + 1;
    }
    
    function nextGeneratedBuildingDraft() {
      const buildingNumber = nextBuildingNumber();
      const draft = {
        building_code: "",
        building_name: "新增教学楼",
        campus_zone: "下沙校区",
        building_number: buildingNumber,
        notes: "",
      };
      draft.building_code = generateBuildingCode(draft);
      return draft;
    }
    
    function nextSegmentCodeForDraft(draft, building = buildingByCode(draft.building_code)) {
      return generateSegmentCode(draft, building || { building_code: draft.building_code }, state.data.floor_segments);
    }
    
    function nextUnitCode() {
      return generateUnitCode(state.data.labs);
    }
    
    function applySpaceCodeRefresh(space, nextCode) {
      const oldId = space.id;
      const oldCode = space.space_code;
      Object.assign(space, normalizeSpace({ ...space, space_code: nextCode }));
      const relation = relationMaps(state.data);
      state.data.plan_assignments = state.data.plan_assignments.map((assignment) => {
        if (assignment.space_id !== oldId && assignment.space_code !== oldCode) return assignment;
        return normalizeAssignment({ ...assignment, space_code: nextCode }, relation);
      });
    }
    
    function refreshSpaceCode(space) {
      const building = buildingByCode(space.building_code);
      const nextCode = generateSpaceCode(space, building);
      if (!nextCode) return { ok: false, message: "无法生成空间编号：请先填写有效前门牌。" };
      const planSpaces = activeSpaces();
      const duplicate = planSpaces.find((row) => row.id !== space.id && row.space_code === nextCode);
      if (duplicate) return { ok: false, message: `空间编号 ${nextCode} 已存在，请检查门牌或楼层。` };
      applySpaceCodeRefresh(space, nextCode);
      return { ok: true, code: nextCode };
    }
    
    function ensureBusinessSpaceSelection(floorSpaces) {
      if (!floorSpaces.length) {
        state.businessEditor.selectedSpaceId = "";
        state.businessEditor.selectedAssignmentId = "";
        return null;
      }
      const preferredId = state.businessEditor.selectedSpaceId || state.selectedSpaceId;
      const selected = floorSpaces.find((space) => space.id === preferredId) || floorSpaces[0];
      state.businessEditor.selectedSpaceId = selected.id;
      state.selectedSpaceId = selected.id;
      const activePlan = planById(state.activePlanId);
      const assignment = activePlan ? assignedAssignmentForSpace(assignmentRowsForPlan(activePlan.id), selected) : null;
      state.businessEditor.selectedAssignmentId = assignment?.id || "";
      return selected;
    }
    
    function businessSpaceCard(space, assignments, selectedSpaceId) {
      const assignment = assignedAssignmentForSpace(assignments, space);
      const lab = assignment ? state.data.labs.find((row) => row.lab_code === assignment.lab_code) || null : null;
      const status = deriveBusinessSpaceStatus(space, assignment);
      return `<button type="button" class="business-assignment-card ${space.id === selectedSpaceId ? "is-active" : ""}" data-business-space-id="${escapeHtml(space.id)}">
        <strong>${escapeHtml(businessDoorRangeLabel(space) || space.space_code)}</strong>
        <span><b class="business-status-pill is-${status.key}">${status.label}</b>${escapeHtml(lab?.lab_name || "未分配用途")}</span>
        <small>${escapeHtml(sideLabel(space.side))}侧 · ${escapeHtml((space.area_m2 || 0).toFixed(1))} m²</small>
      </button>`;
    }
    
    function businessLabOptions(selectedLabCode, selectedSpaceId = "") {
      const hidden = assignedLabCodesForOtherSpaces(assignmentRowsForPlan(state.activePlanId), selectedSpaceId);
      return state.data.labs
        .filter((lab) => lab.lab_code === selectedLabCode || !hidden.has(lab.lab_code))
        .slice()
        .sort((a, b) => compare(a.lab_name, b.lab_name))
        .map((lab) => {
          const label = state.permissions.canAdmin
            ? `${lab.lab_name || lab.lab_code} · ${lab.college || "-"}`
            : `${lab.lab_name || lab.lab_code}`;
          return `<option value="${escapeHtml(lab.lab_code)}" ${lab.lab_code === selectedLabCode ? "selected" : ""}>${escapeHtml(label)}</option>`;
        })
        .join("");
    }
    
    function assignedLabCodesForOtherSpaces(assignments, selectedSpaceId) {
      return new Set(assignments
        .filter((row) => row.assignment_status === "assigned" && row.space_id && row.space_id !== selectedSpaceId)
        .map((row) => row.lab_code)
        .filter(Boolean));
    }
    
    function activeCollegeOptions() {
      return (state.data.colleges || [])
        .filter((row) => row.status !== "inactive")
        .slice()
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || compare(a.college_name, b.college_name));
    }
    
    function activeMajorOptions(collegeName = "") {
      const college = activeCollegeOptions().find((row) => row.college_name === collegeName || row.college_code === collegeName) || null;
      const collegeCode = college?.college_code || collegeName;
      return (state.data.majors || [])
        .filter((row) => row.status !== "inactive")
        .filter((row) => !collegeCode || row.college_code === collegeCode)
        .slice()
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || compare(a.major_name, b.major_name));
    }
    
    function activeLabTypeOptions() {
      return (state.data.lab_types || [])
        .filter((row) => row.status !== "inactive")
        .slice()
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || compare(a.type_name, b.type_name));
    }
    
    function selectOptionsWithBlank(values, selectedValue, blankLabel) {
      const uniqueValues = unique(values);
      const options = [`<option value="" ${selectedValue ? "" : "selected"}>${escapeHtml(blankLabel)}</option>`];
      if (selectedValue && !uniqueValues.includes(selectedValue)) uniqueValues.unshift(selectedValue);
      return options.concat(uniqueValues.map((value) => `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(value)}</option>`)).join("");
    }
    
    function majorOptionsForCollege(collegeName, selectedMajor) {
      return selectOptionsWithBlank(activeMajorOptions(collegeName).map((row) => row.major_name), selectedMajor, collegeName ? "未选择专业" : "请先选择学院");
    }
    
    function businessDoorRangeLabel(space) {
      const frontDoor = String(space?.front_door || "").trim();
      const rearDoor = String(space?.rear_door || "").trim();
      if (frontDoor && rearDoor && frontDoor !== rearDoor) return `${frontDoor}-${rearDoor}`;
      return frontDoor || rearDoor || "";
    }
    
    function renderBusinessLabPreview() {
      const form = els.dataEditor.querySelector("#businessAssignmentForm");
      if (!form) return;
      const lab = state.data.labs.find((row) => row.lab_code === form.labCode?.value) || null;
      const canEditLab = canEditBusinessBaseData() && Boolean(lab);
      [
        ["labName", lab?.lab_name || ""],
        ["college", lab?.college || ""],
        ["major", lab?.major || ""],
        ["labType", lab?.lab_type || ""],
        ["director", lab?.director || ""],
        ["labStatus", lab?.status || "active"],
        ["seatCount", lab?.seat_count ?? ""],
        ["computerCount", lab?.computer_count ?? ""],
      ].forEach(([name, value]) => {
        if (form[name]) {
          form[name].value = value;
          if (["labName", "college", "major", "labType", "director", "labStatus", "seatCount", "computerCount"].includes(name)) {
            form[name].disabled = !canEditLab;
          }
        }
      });
      renderBusinessMajorOptions();
    }
    
    function renderBusinessMajorOptions() {
      const form = els.dataEditor.querySelector("#businessAssignmentForm");
      if (!form?.major || !form?.college) return;
      const previous = form.major.value;
      form.major.innerHTML = majorOptionsForCollege(form.college.value, previous);
      if (!activeMajorOptions(form.college.value).some((row) => row.major_name === previous)) form.major.value = "";
    }
    
    function spaceDisplayName(space) {
      const building = state.data.buildings.find((row) => row.building_code === space.building_code);
      return `${building?.building_name || space.building_code} ${space.floor_code}层 ${businessDoorRangeLabel(space) || space.space_code}`;
    }
    
    function labNameByCode(labCode) {
      return state.data.labs.find((row) => row.lab_code === labCode)?.lab_name || labCode || "-";
    }
    
    function businessStatusLabel(status) {
      return {
        assigned: "已分配",
        Invalid: "无效",
      }[status] || status || "-";
    }
    
    function labStatusLabel(status) {
      return {
        active: "启用",
        planning: "规划中",
        inactive: "停用",
      }[status] || status || "-";
    }
    
    function normalizeBusinessAssignmentStatus(status, hasSpace = false) {
      const raw = String(status || "").trim().toLowerCase();
      if (["assigned", "pending_move", "已分配", "已落位", "待搬迁"].includes(raw)) return "assigned";
      if (["invalid", "unplaced", "无效", "未落位", "未分配"].includes(raw)) return "Invalid";
      return hasSpace ? "assigned" : "Invalid";
    }
    
    function assignedAssignmentForSpace(assignments, space) {
      return assignments.find((row) => row.space_id === space.id && row.assignment_status === "assigned") || null;
    }
    
    function deriveBusinessSpaceStatus(space, assignment) {
      if (space?.current_status === "unavailable") return { key: "unavailable", label: "不可用" };
      if (assignment?.assignment_status === "assigned" && assignment.lab_code) {
        return assignment.effective_from
          ? { key: "built", label: "已建设" }
          : { key: "planned", label: "已规划" };
      }
      return { key: "unplanned", label: "未规划" };
    }
    
    
    async function applyBusinessAssignmentForm() {
      const canEditAssignment = canEditActivePlan();
      const canEditBase = canEditBusinessBaseData();
      if (!canEditAssignment && !canEditBase) {
        updateStatus("当前账号没有保存业务编辑的权限。");
        return;
      }
      const activePlan = planById(state.activePlanId);
      const form = els.dataEditor.querySelector("#businessAssignmentForm");
      if (!activePlan || !form) return;
      const formData = new FormData(form);
      const selectedSpaceId = String(formData.get("selectedSpaceId") || "").trim();
      const selectedSpace = activeSpaces().find((row) => row.id === selectedSpaceId) || null;
      if (!selectedSpace) {
        updateStatus("请先在当前楼层选择一个空间。");
        return;
      }
      const wasNewSpace = state.businessEditor.newSpaceId === selectedSpace.id;
      const draft = readBusinessFormDraft(formData, selectedSpace, wasNewSpace);
      const labCode = draft.labCode;
      const assignmentStatus = draft.assignmentStatus;
      const moveNote = draft.moveNote;
      const effectiveFrom = draft.effectiveFrom;
      const replaceConflict = draft.replaceConflict;
      const shouldRefreshSpaceCode = draft.shouldRefreshSpaceCode;
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
      const relation = relationMaps(state.data);
      const currentAssignments = assignmentRowsForPlan(activePlan.id);
    
      if (canEditBase) {
        const building = buildingByCode(selectedSpace.building_code);
        if (building) {
          Object.assign(building, normalizeBuilding({
            ...building,
            building_name: String(formData.get("buildingName") || building.building_name).trim(),
            campus_zone: String(formData.get("campusZone") || building.campus_zone).trim(),
            updated_at: isoNow(),
          }));
        }
        const nextSegmentCode = String(formData.get("segmentCode") || selectedSpace.segment_code).trim();
        const segment = activeFloorSegments().find((row) =>
          row.building_code === selectedSpace.building_code &&
          row.floor_code === selectedSpace.floor_code &&
          row.segment_code === nextSegmentCode
        );
        if (!segment || !isAssignableSegment(segment)) {
          state.data = normalizeDataset(previousData);
          state.serverRevision = previousRevision;
          state.planCopies = previousCopies;
          updateStatus("空间只能绑定到走廊骨架，不能绑定楼梯、电梯或其他骨架。");
          return;
        }
        if (segment) {
          Object.assign(segment, normalizeSegment({
            ...segment,
            width_m: formData.get("segmentWidth") || segment.width_m,
          }));
        }
        Object.assign(selectedSpace, normalizeSpace({
          ...selectedSpace,
          segment_code: draft.space.segment_code || selectedSpace.segment_code,
          front_door: draft.space.front_door,
          rear_door: draft.space.rear_door,
          current_status: draft.space.current_status,
          side: draft.space.side,
          offset_m: draft.space.offset_m,
          length_m: draft.space.length_m,
          width_m: draft.space.width_m,
          network_segment: draft.space.network_segment,
          notes: draft.space.notes,
        }));
        if (shouldRefreshSpaceCode) {
          const previousSpaceRefs = [selectedSpace.id, selectedSpace.space_code].filter(Boolean);
          const refreshResult = refreshSpaceCode(selectedSpace);
          if (!refreshResult.ok) {
            state.data = normalizeDataset(previousData);
            state.serverRevision = previousRevision;
            state.planCopies = previousCopies;
            updateStatus(refreshResult.message);
            return;
          }
          if (wasNewSpace) clearDeletedSpaceRefs(state.data, selectedSpace, previousSpaceRefs, activePlanCopyMeta()?.id || null);
        } else if (wasNewSpace) {
          clearDeletedSpaceRefs(state.data, selectedSpace, [], activePlanCopyMeta()?.id || null);
        }
        const lab = labCode ? state.data.labs.find((row) => row.lab_code === labCode) || null : null;
        if (lab) {
          Object.assign(lab, normalizeLab({
            ...lab,
            lab_name: draft.lab.lab_name || lab.lab_name,
            college: draft.lab.college || lab.college,
            major: draft.lab.major,
            lab_type: draft.lab.lab_type || lab.lab_type,
            director: draft.lab.director,
            status: draft.lab.status || lab.status || "active",
            seat_count: draft.lab.seat_count || lab.seat_count,
            computer_count: draft.lab.computer_count || lab.computer_count,
          }));
        }
      }
    
      if (canEditAssignment) {
        if (selectedSpace.current_status === "unavailable" && assignmentStatus === "assigned") {
          state.data = normalizeDataset(previousData);
          state.serverRevision = previousRevision;
          state.planCopies = previousCopies;
          updateStatus("不可用空间不能保存为已分配，请先将人工状态改为可用。");
          return;
        }
        const existingForLab = labCode ? currentAssignments.find((row) => row.lab_code === labCode && row.assignment_status === "assigned") || null : null;
        const currentForSpace = assignedAssignmentForSpace(currentAssignments, selectedSpace);
        if (existingForLab && existingForLab.space_id && existingForLab.space_id !== selectedSpace.id) {
          const occupiedSpace = activeSpaces().find((row) => row.id === existingForLab.space_id);
          state.data = normalizeDataset(previousData);
          state.serverRevision = previousRevision;
          state.planCopies = previousCopies;
          updateStatus(`${labNameByCode(labCode)} 已落位到 ${occupiedSpace ? businessDoorRangeLabel(occupiedSpace) || occupiedSpace.space_code : "其他空间"}，不能重复落位。`);
          return;
        }
        const conflict = labCode && currentForSpace && currentForSpace.lab_code !== labCode && currentForSpace.assignment_status === "assigned"
          ? currentForSpace
          : null;
        if (conflict && !replaceConflict) {
          state.data = normalizeDataset(previousData);
          state.serverRevision = previousRevision;
          state.planCopies = previousCopies;
          updateStatus(`当前空间已被 ${labNameByCode(conflict.lab_code)} 占用，请勾选“替换当前占用”后再保存。`);
          return;
        }
    
        const removeIds = new Set([existingForLab?.id, currentForSpace?.id].filter(Boolean));
        const nextAssignments = state.data.plan_assignments.filter((row) => row.plan_id !== activePlan.id || !removeIds.has(row.id));
        if (conflict) {
          nextAssignments.push(normalizeAssignment({
            ...conflict,
            plan_code: activePlan.plan_code,
            space_code: "",
            previous_space_code: conflict.space_code || conflict.previous_space_code,
            assignment_status: "Invalid",
          }, relation));
        }
    
        if (labCode && assignmentStatus === "assigned") {
          nextAssignments.push(normalizeAssignment({
            plan_code: activePlan.plan_code,
            lab_code: labCode,
            space_code: selectedSpace.space_code,
            previous_space_code: existingForLab?.space_code || currentForSpace?.space_code || "",
            assignment_status: assignmentStatus,
            move_note: moveNote,
            effective_from: effectiveFrom,
            created_at: existingForLab?.created_at || currentForSpace?.created_at || isoNow(),
          }, relationMaps(state.data)));
        } else if (currentForSpace) {
          nextAssignments.push(normalizeAssignment({
            ...currentForSpace,
            plan_code: activePlan.plan_code,
            space_code: "",
            previous_space_code: currentForSpace.space_code || currentForSpace.previous_space_code,
            assignment_status: "Invalid",
            move_note: moveNote,
            effective_from: effectiveFrom,
          }, relation));
        }
        state.data.plan_assignments = nextAssignments;
      }
    
      state.data = normalizeDataset(state.data);
      let saveOk = true;
      if (canEditBase) {
        saveOk = await saveWithRollback(previousData, previousRevision, "业务编辑当前楼层资料", "业务资料保存失败");
      }
      if (saveOk && canEditAssignment && !canEditBase) {
        saveOk = await savePlanAssignmentsWithRollback(previousData, previousRevision);
      }
      if (!saveOk) {
        state.data = normalizeDataset(previousData);
        state.serverRevision = previousRevision;
        state.planCopies = previousCopies;
        return;
      }
      state.businessEditor.selectedSpaceId = selectedSpace.id;
      if (wasNewSpace || state.businessEditor.newSpaceId === selectedSpace.id) state.businessEditor.newSpaceId = "";
      if (state.businessEditor.spaceCorrectionId === selectedSpace.id) state.businessEditor.spaceCorrectionId = "";
      state.selectedSpaceId = selectedSpace.id;
      refreshStateAndRender(`已保存 ${selectedSpace.front_door || selectedSpace.space_code} 的业务信息。`, { stamp: false, forceMoveReset: true });
    }
    
    function canDeleteLabInActivePlan(lab, selectedSpace) {
      if (!lab || !selectedSpace || !canDeleteSpaceInActivePlan()) return false;
      const activePlan = planById(state.activePlanId);
      if (!activePlan) return false;
      const referencedByOtherPlan = state.data.plan_assignments.some((row) => row.plan_id !== activePlan.id && row.lab_code === lab.lab_code);
      if (referencedByOtherPlan) return false;
      const assignments = assignmentRowsForPlan(activePlan.id).filter((row) => row.lab_code === lab.lab_code && row.assignment_status === "assigned");
      return assignments.every((row) => !row.space_id || row.space_id === selectedSpace.id);
    }
    
    async function deleteSelectedBusinessLab() {
      const activePlan = planById(state.activePlanId);
      const selectedSpace = activeSpaces().find((row) => row.id === state.businessEditor.selectedSpaceId) || null;
      const assignment = activePlan && selectedSpace ? assignedAssignmentForSpace(assignmentRowsForPlan(activePlan.id), selectedSpace) : null;
      const lab = assignment ? state.data.labs.find((row) => row.lab_code === assignment.lab_code) || null : null;
      if (!canDeleteLabInActivePlan(lab, selectedSpace)) {
        updateStatus("只能删除当前非基线方案中未被其他空间占用的用途单元。");
        return;
      }
      if (!window.confirm(`确认删除用途单元“${lab.lab_name || lab.lab_code}”？当前空间会同步解绑。`)) return;
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const previousCopies = JSON.parse(JSON.stringify(state.planCopies));
      state.data.plan_assignments = state.data.plan_assignments.filter((row) => row.plan_id !== activePlan.id || row.lab_code !== lab.lab_code);
      state.data.labs = state.data.labs.filter((row) => row.lab_code !== lab.lab_code);
      state.data = normalizeDataset(state.data);
      const saveOk = await saveWithRollback(previousData, previousRevision, "删除用途单元", "删除用途单元失败");
      if (!saveOk) {
        state.data = normalizeDataset(previousData);
        state.serverRevision = previousRevision;
        state.planCopies = previousCopies;
        return;
      }
      state.businessEditor.selectedSpaceId = selectedSpace.id;
      state.selectedSpaceId = selectedSpace.id;
      refreshStateAndRender(`已删除用途单元 ${lab.lab_name || lab.lab_code}。`, { stamp: false, forceMoveReset: true });
    }
    
    async function markSelectedBusinessSpaceUnavailable() {
      if (!canDeleteSpaceInActivePlan()) {
        updateStatus("只能删除自己可管理的非基线方案中的空间。");
        return;
      }
      const activePlan = planById(state.activePlanId);
      const space = activeSpaces().find((row) => row.id === state.businessEditor.selectedSpaceId) || null;
      if (!activePlan || !space) {
        updateStatus("请先选择一个空间。");
        return;
      }
      if (!window.confirm(`确认从当前方案删除空间“${space.front_door || space.space_code}”？`)) return;
      const previousData = cloneDataset(state.data);
      const previousRevision = state.serverRevision;
      const relation = relationMaps(state.data);
      const deletedSpaceRefs = [space.id, space.space_code].filter(Boolean);
      const activeCopy = activePlanCopyMeta();
      const scopedDeletedSpaceRefs = activeCopy
        ? deletedSpaceRefs.map((ref) => `copy:${activeCopy.id}::${ref}`)
        : deletedSpaceRefs;
      state.data.deleted_space_ids = [...new Set([...(state.data.deleted_space_ids || []), ...scopedDeletedSpaceRefs])];
      state.data.spaces = state.data.spaces.filter((row) => row.id !== space.id && row.space_code !== space.space_code);
      state.data.plan_assignments = state.data.plan_assignments.map((row) => {
        if (
          row.plan_id !== activePlan.id ||
          (row.space_id !== space.id && row.space_code !== space.space_code)
        ) return row;
        return normalizeAssignment({
          ...row,
          previous_space_code: row.space_code || row.previous_space_code,
          space_code: "",
          assignment_status: "Invalid",
        }, relation);
      });
      state.data = normalizeDataset(state.data);
      const saveOk = await saveWithRollback(previousData, previousRevision, "删除当前楼层空间", "删除空间失败");
      if (saveOk) {
        state.businessEditor.newSpaceId = "";
        state.businessEditor.selectedSpaceId = "";
        state.selectedSpaceId = null;
        syncSelectedSpace();
        refreshStateAndRender(`${space.front_door || space.space_code} 已从当前方案删除。`, { stamp: false, forceMoveReset: true });
      }
    }
    
    

    return {
      renderBusinessAssignmentEditor,
      businessSpaceSectionHtml,
      updateSpaceCodePreview,
      currentFloorSpaces,
      currentFloorSegments,
      currentAssignableSegments,
      firstAssignableSegmentCode,
      nextBuildingNumber,
      nextGeneratedBuildingDraft,
      nextSegmentCodeForDraft,
      nextUnitCode,
      applySpaceCodeRefresh,
      refreshSpaceCode,
      ensureBusinessSpaceSelection,
      businessSpaceCard,
      businessLabOptions,
      assignedLabCodesForOtherSpaces,
      activeCollegeOptions,
      activeMajorOptions,
      activeLabTypeOptions,
      selectOptionsWithBlank,
      majorOptionsForCollege,
      businessDoorRangeLabel,
      renderBusinessLabPreview,
      renderBusinessMajorOptions,
      spaceDisplayName,
      labNameByCode,
      businessStatusLabel,
      labStatusLabel,
      normalizeBusinessAssignmentStatus,
      assignedAssignmentForSpace,
      deriveBusinessSpaceStatus,
      canEditBusinessBaseData,
      canDeleteSpaceInActivePlan,
      canDeleteLabInActivePlan,
      deleteSelectedBusinessLab,
      markSelectedBusinessSpaceUnavailable,
      applyBusinessAssignmentForm,
    };
  }

  const api = {
    createBusinessEditor,
    readBusinessFormDraft,
    canDeleteSpaceForActivePlan,
    clearDeletedSpaceRefs,
  };

  global.FloorplanApp = global.FloorplanApp || {};
  global.FloorplanApp.BusinessEdit = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
