const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addBasketItem,
  applyBasketTargets,
  applyTemporaryUnbind,
  basketItemsFromUnplacedAssignments,
  canReturnBasketItem,
  resolveBasketDrop,
  restoreBasketItem,
} = require("../js/app/move-basket.js");

function normalizeAssignment(row) {
  return {
    ...row,
    space_id: row.space_code ? `space:${row.space_code}` : "",
    assignment_status: row.assignment_status || (row.space_code ? "assigned" : "Invalid"),
  };
}

test("temporarily unbinds a moved lab while preserving the source space for undo", () => {
  const assignment = { id: "plan-a__lab-a", plan_id: "plan-a", lab_id: "lab-a", lab_code: "LAB-A", space_code: "101", space_id: "space:101", assignment_status: "assigned" };
  const item = addBasketItem([], { assignment, lab: { lab_name: "AI Lab", college: "AI" }, sourceSpace: { id: "space:101", space_code: "101" }, color: "#7c3aed" })[0];

  const updated = applyTemporaryUnbind([assignment], item, normalizeAssignment);

  assert.equal(updated[0].assignment_status, "Invalid");
  assert.equal(updated[0].space_code, "");
  assert.equal(updated[0].previous_space_code, "101");
  assert.equal(item.sourceSpaceCode, "101");
});

test("restores the original assignment when a basket item is removed before saving", () => {
  const assignment = { id: "plan-a__lab-a", plan_id: "plan-a", lab_id: "lab-a", lab_code: "LAB-A", space_code: "", space_id: "", previous_space_code: "101", assignment_status: "Invalid" };
  const item = { assignmentId: "plan-a__lab-a", sourceSpaceCode: "101" };

  const restored = restoreBasketItem([assignment], item, normalizeAssignment);

  assert.equal(restored[0].assignment_status, "assigned");
  assert.equal(restored[0].space_code, "101");
  assert.equal(restored[0].previous_space_code, "101");
});

test("allows a saved basket item to return only when its source space is active and free", () => {
  const item = { assignmentId: "plan-a__lab-a", planId: "plan-a", sourceSpaceCode: "101" };
  const spaces = [
    { id: "space:101", space_code: "101", current_status: "active" },
    { id: "space:102", space_code: "102", current_status: "unavailable" },
  ];

  assert.deepEqual(canReturnBasketItem(item, spaces, []), { ok: true, reason: "", space: spaces[0] });

  assert.deepEqual(
    canReturnBasketItem({ ...item, sourceSpaceCode: "102" }, spaces, []),
    { ok: false, reason: "原空间不可用。", space: spaces[1] }
  );

  assert.deepEqual(
    canReturnBasketItem(item, spaces, [
      { id: "plan-a__lab-b", plan_id: "plan-a", space_code: "101", assignment_status: "assigned" },
    ]),
    { ok: false, reason: "原空间已被其他实验室占用。", space: spaces[0] }
  );
});

test("returns a saved unplaced basket item to its previous space", () => {
  const assignment = { id: "plan-a__lab-a", plan_id: "plan-a", lab_id: "lab-a", lab_code: "LAB-A", space_code: "", space_id: "", previous_space_code: "101", assignment_status: "Invalid" };
  const item = { assignmentId: "plan-a__lab-a", sourceSpaceCode: "101", isSavedUnplaced: true };

  const restored = restoreBasketItem([assignment], item, normalizeAssignment);

  assert.equal(restored[0].assignment_status, "assigned");
  assert.equal(restored[0].space_code, "101");
});

test("resolves basket drops to either return-to-source or place-on-free-active-target", () => {
  const item = { id: "basket-a", assignmentId: "plan-a__lab-a", planId: "plan-a", sourceSpaceCode: "101" };
  const spaces = [
    { id: "space:101", space_code: "101", current_status: "active" },
    { id: "space:201", space_code: "201", current_status: "active" },
    { id: "space:301", space_code: "301", current_status: "unavailable" },
  ];
  const assignments = [
    { id: "plan-a__lab-b", plan_id: "plan-a", space_code: "401", space_id: "space:401", assignment_status: "assigned" },
  ];

  assert.deepEqual(resolveBasketDrop(item, spaces[0], spaces, assignments), { ok: true, action: "return", reason: "" });
  assert.deepEqual(resolveBasketDrop(item, spaces[1], spaces, assignments), { ok: true, action: "place", reason: "" });
  assert.equal(resolveBasketDrop(item, spaces[2], spaces, assignments).ok, false);
  assert.equal(resolveBasketDrop(item, { id: "space:401", space_code: "401", current_status: "active" }, spaces, assignments).ok, false);
});

test("saves basket items with targets as assigned and unplaced items as Invalid", () => {
  const assignments = [
    { id: "plan-a__lab-a", plan_id: "plan-a", lab_id: "lab-a", lab_code: "LAB-A", space_code: "", previous_space_code: "101", assignment_status: "Invalid" },
    { id: "plan-a__lab-b", plan_id: "plan-a", lab_id: "lab-b", lab_code: "LAB-B", space_code: "", previous_space_code: "102", assignment_status: "Invalid" },
  ];
  const basket = [
    { assignmentId: "plan-a__lab-a", sourceSpaceCode: "101", targetSpaceCode: "301" },
    { assignmentId: "plan-a__lab-b", sourceSpaceCode: "102", targetSpaceCode: "" },
  ];

  const saved = applyBasketTargets(assignments, basket, normalizeAssignment);

  assert.equal(saved[0].assignment_status, "assigned");
  assert.equal(saved[0].space_code, "301");
  assert.equal(saved[0].previous_space_code, "101");
  assert.equal(saved[1].assignment_status, "Invalid");
  assert.equal(saved[1].space_code, "");
  assert.equal(saved[1].previous_space_code, "102");
});

test("rebuilds saved unplaced assignments as draggable basket items", () => {
  const assignments = [
    { id: "plan-a__lab-a", plan_id: "plan-a", lab_id: "lab-a", lab_code: "LAB-A", space_code: "", previous_space_code: "101", assignment_status: "Invalid" },
    { id: "plan-a__lab-b", plan_id: "plan-a", lab_id: "lab-b", lab_code: "LAB-B", space_code: "201", previous_space_code: "102", assignment_status: "assigned" },
  ];
  const labsById = new Map([
    ["lab-a", { id: "lab-a", lab_name: "AI Lab", college: "AI", seat_count: 28, computer_count: 18 }],
  ]);

  const items = basketItemsFromUnplacedAssignments(assignments, {
    planId: "plan-a",
    labsById,
    colorForCollege: () => "#7c3aed",
    sourceSpaceLabelForCode: (code) => `来源 ${code}`,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].assignmentId, "plan-a__lab-a");
  assert.equal(items[0].sourceSpaceCode, "101");
  assert.equal(items[0].isSavedUnplaced, true);
  assert.equal(items[0].color, "#7c3aed");
});
