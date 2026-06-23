# Thumbnail Scroll Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a room in the main floorplan must not move the thumbnail list scroll position, and users must be able to scroll the thumbnail list fully to the bottom without it bouncing upward.

**Architecture:** Keep thumbnail scrolling owned by `.compare-columns` and stop rebuilding thumbnail DOM for room-selection-only renders. Capture thumbnail scroll positions before render as a defensive fallback, restore them after unchanged thumbnail content is rendered, and add a focused regression test around `renderApp` behavior.

**Tech Stack:** Browser JavaScript, CommonJS `node:test`, static CSS, Node.js server.

---

## Root Cause Summary

- `app.js` `handleSpaceSelect()` updates only `state.selectedSpaceId`, `state.businessEditor.selectedSpaceId`, and details state, but then calls `renderApp()`.
- `renderApp()` always calls `renderThumbList()` for `#beforeThumbs` and, in compare mode, `#afterThumbs`.
- `js/render.js` `renderThumbList()` always assigns `container.innerHTML = ...`, which destroys and recreates every thumbnail button/SVG even when building, floor list, plan, and colors did not change.
- The actual vertical scrollbar is on `.compare-columns`, not on individual `.thumb-preview`. Rebuilding the child tree changes the scrollable content height during the same click event; when the user is near `scrollHeight - clientHeight`, the browser clamps `scrollTop` to the recalculated maximum, which appears as the thumbnail scrollbar jumping upward. This also explains why scrolling to the very bottom cannot hold: subsequent main-map selection rerenders the list and the bottom coordinate is recalculated.
- `Canvas.applyCanvasMode()` only adjusts `els.floorplan.scrollTop`; it does not touch thumbnail scroll. The culprit is thumbnail DOM replacement during unrelated main-map selection renders.

## File Structure

- Modify `app.js`: add thumbnail render memoization/scroll preservation near `renderApp()` and `handleSpaceSelect()`.
- Modify `js/render.js`: optionally let `renderThumbList()` return whether it changed content, or accept a stable render key to skip `innerHTML` replacement.
- Modify `tests/floorplan-behavior.test.js`: add a regression test proving unchanged thumbnail input does not replace DOM and does not reset scroll.
- Modify `codex-requirements.md`: add a lasting thumbnail-scroll requirement.
- Modify `acceptance-checklist.md`: add a manual regression check for thumbnail bottom scrolling after repeated main-map room selection.

### Task 1: Add a Failing Thumbnail Stability Test

**Files:**
- Modify: `tests/floorplan-behavior.test.js`

- [ ] **Step 1: Extend the test stub to support scroll state and button listeners**

Add this helper below `StubElement`:

```js
class ThumbContainerStub extends StubElement {
  constructor() {
    super();
    this.scrollTop = 0;
    this.scrollHeight = 1200;
    this.clientHeight = 400;
    this.listenerCount = 0;
  }

  querySelectorAll(selector) {
    if (selector !== "button") return [];
    const matches = this.innerHTML.match(/<button /g) || [];
    return matches.map(() => ({
      dataset: { planId: "plan-1", floor: "1" },
      addEventListener: () => {
        this.listenerCount += 1;
      },
    }));
  }
}
```

- [ ] **Step 2: Write the failing regression test**

Add this test after `thumbnail previews fit without an internal scroll container`:

```js
test("thumbnail list keeps existing DOM and scroll when render input is unchanged", () => {
  const { FloorplanRender } = loadBrowserModules();
  const container = new ThumbContainerStub();
  const params = {
    data: {
      floor_segments: [
        { id: "seg-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" },
        { id: "seg-2", building_code: "B0101", floor_code: "2", segment_code: "EW01010201", start_x_m: 0, start_y_m: 0, end_x_m: 20, end_y_m: 0, width_m: 2.4, element_type: "corridor" },
      ],
      spaces: [
        { id: "space-1", building_code: "B0101", floor_code: "1", segment_code: "EW01010101", offset_m: 0, side: "north", space_code: "101", front_door: "101", rear_door: "", length_m: 8, width_m: 6, current_status: "active" },
        { id: "space-2", building_code: "B0101", floor_code: "2", segment_code: "EW01010201", offset_m: 0, side: "north", space_code: "201", front_door: "201", rear_door: "", length_m: 8, width_m: 6, current_status: "active" },
      ],
      labs: [],
      plan_assignments: [],
    },
    buildingCode: "B0101",
    plan: { id: "plan-1", plan_name: "Baseline" },
    activePlanId: "plan-1",
    currentFloorCode: "1",
    colors: {},
    onSelect() {},
  };

  FloorplanRender.renderThumbList(container, params);
  const firstHtml = container.innerHTML;
  container.scrollTop = 800;
  FloorplanRender.renderThumbList(container, params);

  assert.equal(container.innerHTML, firstHtml);
  assert.equal(container.scrollTop, 800);
});
```

- [ ] **Step 3: Run the test to verify it fails before implementation**

Run:

```powershell
npm.cmd test
```

Expected: the new test fails because current `renderThumbList()` always replaces `innerHTML`.

### Task 2: Make Thumbnail Rendering Idempotent

**Files:**
- Modify: `js/render.js`

- [ ] **Step 1: Add a stable render key helper inside `attachFloorplanRender()`**

Place this helper near `renderThumbList()`:

```js
  function thumbRenderKey(params) {
    const { data, buildingCode, plan, activePlanId, currentFloorCode, colors } = params;
    const planId = plan?.id || "";
    const floors = unique(data.floor_segments.filter((row) => row.building_code === buildingCode).map((row) => row.floor_code)).sort(compare);
    const floorParts = floors.map((floorCode) => {
      const segments = data.floor_segments
        .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
        .map((row) => [row.id, row.segment_code, row.start_x_m, row.start_y_m, row.end_x_m, row.end_y_m, row.width_m, row.element_type].join(":"))
        .join("|");
      const spaces = data.spaces
        .filter((row) => row.building_code === buildingCode && row.floor_code === floorCode)
        .map((row) => [row.id, row.space_code, row.segment_code, row.offset_m, row.side, row.length_m, row.width_m, row.current_status].join(":"))
        .join("|");
      const assignments = data.plan_assignments
        .filter((row) => row.plan_id === planId && row.assignment_status === "assigned")
        .map((row) => [row.id, row.space_id, row.lab_id, row.assignment_status].join(":"))
        .join("|");
      return [floorCode, segments, spaces, assignments].join("~");
    });
    const colorPart = Object.entries(colors || {}).sort(([a], [b]) => compare(a, b)).map(([key, value]) => `${key}:${value}`).join("|");
    return JSON.stringify({ buildingCode, planId, activePlanId, currentFloorCode, floors: floorParts, colors: colorPart });
  }
```

- [ ] **Step 2: Skip `innerHTML` replacement when the key has not changed**

At the start of `renderThumbList(container, params)`, compute the key:

```js
    const nextKey = thumbRenderKey(params);
    if (container.dataset?.thumbRenderKey === nextKey) return false;
```

After setting `container.innerHTML`, store the key and return `true`:

```js
    if (container.dataset) container.dataset.thumbRenderKey = nextKey;
    container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => onSelect(button.dataset.planId, button.dataset.floor)));
    return true;
```

When rendering the empty state, also store the key:

```js
      if (container.dataset) container.dataset.thumbRenderKey = nextKey;
      container.innerHTML = `<div class="empty">...</div>`;
      return true;
```

- [ ] **Step 3: Keep the existing public API**

Do not change callers yet. Returning `true` or `false` is backward-compatible because existing callers ignore the return value.

- [ ] **Step 4: Run the focused test**

Run:

```powershell
npm.cmd test
```

Expected: the new thumbnail stability test passes, and existing tests still pass.

### Task 3: Preserve Outer Thumbnail Scroll Defensively

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add helper functions near `renderApp()`**

Add:

```js
function snapshotThumbnailScroll() {
  const scroller = els.compareColumns;
  if (!scroller) return null;
  return {
    top: scroller.scrollTop,
    left: scroller.scrollLeft,
    maxTop: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    maxLeft: Math.max(0, scroller.scrollWidth - scroller.clientWidth),
  };
}

function restoreThumbnailScroll(snapshot) {
  if (!snapshot || !els.compareColumns) return;
  const scroller = els.compareColumns;
  const nextMaxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const nextMaxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  scroller.scrollTop = Math.min(snapshot.top, nextMaxTop);
  scroller.scrollLeft = Math.min(snapshot.left, nextMaxLeft);
}
```

- [ ] **Step 2: Snapshot and restore around thumbnail rendering**

In `renderApp()`, before the first `renderThumbList()` call:

```js
  const thumbScroll = snapshotThumbnailScroll();
```

After the `afterThumbs` branch and before `renderFloorplan()`:

```js
  restoreThumbnailScroll(thumbScroll);
```

- [ ] **Step 3: Avoid stale memo keys when clearing compare mode**

Where single-plan mode clears `els.afterThumbs.innerHTML = "";`, also clear the key:

```js
    els.afterThumbs.innerHTML = "";
    if (els.afterThumbs.dataset) delete els.afterThumbs.dataset.thumbRenderKey;
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

### Task 4: Add Manual Browser Verification

**Files:**
- No code files.

- [ ] **Step 1: Start the app**

Run:

```powershell
$env:PORT = "5180"
npm.cmd start
```

Expected: server reports it is listening on port `5180`.

- [ ] **Step 2: Verify the user workflow**

In the browser:

1. Open `http://127.0.0.1:5180/`.
2. Log in as admin if needed.
3. Choose a building with enough floors to make the thumbnail list vertically scrollable.
4. Scroll the thumbnail list to the bottom.
5. Click three different rooms in the main floorplan.
6. Confirm the thumbnail list stays at the same bottom position.
7. Scroll the thumbnail list to the bottom again and wait two seconds.
8. Confirm it does not automatically jump upward.

- [ ] **Step 3: Verify compare mode**

Switch to compare mode and repeat the same workflow. Expected: both the thumbnail list scroll and horizontal/vertical scroll positions remain stable unless the user changes building, floor, plan, or compare mode.

### Task 5: Update Requirements and Checklist

**Files:**
- Modify: `codex-requirements.md`
- Modify: `acceptance-checklist.md`

- [ ] **Step 1: Add lasting requirement**

Add this requirement to the main-map/thumbnail section of `codex-requirements.md`:

```markdown
- 主图中选择空间/实验室只允许更新主图选中态和详情面板；不得重建未变化的缩略图列表，也不得改变缩略图列表容器的滚动位置。
```

- [ ] **Step 2: Add acceptance checklist item**

Add this item to the UI/viewer regression section of `acceptance-checklist.md`:

```markdown
- 将缩略图列表滚动到最底部后，连续点击主图中的多个空间，缩略图滚动条保持在原位置，不会自动上跳；对比模式下同样成立。
```

- [ ] **Step 3: Run final verification**

Run:

```powershell
npm.cmd test
git status --short
```

Expected: tests pass; only intended source/docs/test files are modified, and data files under `data/`, `outputs/`, or Excel workbooks are not staged.

## Self-Review

- Spec coverage: The plan covers root cause, failing test, implementation, manual single/compare-mode verification, and long-term requirement updates.
- Placeholder scan: No `TBD`, `TODO`, or unspecified “add tests” steps remain.
- Type consistency: The plan uses existing globals `els.compareColumns`, `renderThumbList()`, `state.selectedSpaceId`, and current test helper loading for `js/domain.js` and `js/render.js`.
