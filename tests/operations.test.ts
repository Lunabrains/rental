import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addKey, addParkingSpace, assignParking, CHECKLIST_TEMPLATES, completeInspection, createWorkOrder, deriveOverallResult, issueKey, markKeyLost, recordInspectionItem, releaseParking, returnAllKeys, returnKey, scheduleInspection, startMoveOut } from "@/lib/commands";
import { recompute } from "@/lib/derived/recompute";
import { getInspectionDetails, getMoves } from "@/lib/queries";
import type { Store } from "@/types";

import { contract, deposit, property, smallStore, tenant, TODAY, unit } from "./helpers";

function base(): Store {
  const p = property({ id: "p1" });
  const u = unit({ id: "u1", propertyId: "p1", unitNumber: "A1" });
  const t = tenant({ id: "t1", fullName: "Rana Khoury" });
  const c = contract({ id: "c1", propertyId: "p1", unitId: "u1", tenantId: "t1", startDate: "2025-10-01", endDate: "2026-09-30", status: "notice_given" });
  return smallStore({ properties: [p], units: [u], tenants: [t], contracts: [c], deposits: [deposit({ id: "d1", contractId: "c1", tenantId: "t1", unitId: "u1", propertyId: "p1", amountExpected: 1000, amountReceived: 1000, receivedDate: "2025-10-01" })] });
}

describe("inspections", () => {
  it("schedules from the template and resolves tenant, contract and deposit", () => {
    const { result } = scheduleInspection({ propertyId: "p1", unitId: "u1", type: "move_out", scheduledDate: "2026-09-30", inspector: "George" })(base());
    assert.equal(result.items.length, CHECKLIST_TEMPLATES.move_out.length);
    assert.ok(result.items.every((i) => i.result === "na"));
    assert.equal(result.tenantId, "t1");
    assert.equal(result.contractId, "c1");
    assert.equal(result.depositId, "d1");
    assert.equal(result.status, "scheduled");
  });

  it("refuses unit-level types without a unit and asset inspections without an asset", () => {
    assert.throws(() => scheduleInspection({ propertyId: "p1", type: "annual_unit", scheduledDate: TODAY, inspector: "G" })(base()), /need a unit/);
    assert.throws(() => scheduleInspection({ propertyId: "p1", type: "asset", scheduledDate: TODAY, inspector: "G" })(base()), /asset/);
  });

  it("records items, derives the overall result and links follow-ups to one work order", () => {
    const s0 = base();
    const { store: s1, result: insp } = scheduleInspection({ propertyId: "p1", unitId: "u1", type: "annual_unit", scheduledDate: TODAY, inspector: "George" })(s0);
    const [first, second, third] = insp.items;
    const { store: s2 } = recordInspectionItem(insp.id, first.id, { result: "pass" })(s1);
    assert.equal(s2.inspections[0].status, "in_progress");
    const { store: s3 } = recordInspectionItem(insp.id, second.id, { result: "fail", notes: "Cracked tile" })(s2);
    assert.equal(s3.inspections[0].items[1].followUpRequired, true, "fail flags a follow-up");
    const { store: s4 } = recordInspectionItem(insp.id, third.id, { result: "attention" })(s3);
    assert.equal(deriveOverallResult(s4.inspections[0].items), "fail");
    assert.throws(() => completeInspection(insp.id, { completedDate: "2099-01-01" })(s4), /future/);
    const { store: s5, result: done, undo } = completeInspection(insp.id, { completedDate: TODAY })(s4);
    assert.equal(done.status, "completed");
    assert.equal(done.overallResult, "fail");
    assert.ok(s5.alerts.some((a) => a.type === "inspection_followup_open" && a.entityId === insp.id), "open follow-up raises an alert");
    // Raise a work order for exactly the failed item.
    const { store: s6, result: wo } = createWorkOrder({ propertyId: "p1", unitId: "u1", inspectionId: insp.id, inspectionItemId: second.id, title: "Cracked tile", category: "other", priority: "normal", source: "inspection" })(s5);
    const items = s6.inspections[0].items;
    assert.equal(items[1].workOrderId, wo.id);
    assert.equal(items[2].workOrderId, null, "other items stay unlinked");
    assert.ok(!s6.alerts.some((a) => a.type === "inspection_followup_open" && a.entityId === insp.id && !a.resolved), "alert resolves once linked");
    // Undo completion restores the previous state.
    const back = undo!(s5);
    assert.equal(back.inspections[0].status, "in_progress");
  });

  it("compares a move-out with the move-in report", () => {
    const s0 = base();
    const { store: s1, result: moveIn } = scheduleInspection({ propertyId: "p1", unitId: "u1", contractId: "c1", tenantId: "t1", type: "move_in", scheduledDate: "2025-10-01", inspector: "George" })(s0);
    let s = s1;
    for (const it of moveIn.items) s = recordInspectionItem(moveIn.id, it.id, { result: "pass" })(s).store;
    s = completeInspection(moveIn.id, { completedDate: "2025-10-01" })(s).store;
    const { store: s2, result: moveOut } = startMoveOut("c1", { inspector: "George" })(s);
    assert.equal(moveOut.type, "move_out");
    assert.throws(() => startMoveOut("c1", { inspector: "George" })(s2), /already exists/);
    const wall = moveOut.items.find((i) => i.item === "Walls and ceiling")!;
    const s3 = recordInspectionItem(moveOut.id, wall.id, { result: "attention", notes: "Scuffs" })(s2).store;
    const d = getInspectionDetails(s3, moveOut.id)!;
    assert.equal(d.reference?.inspection.id, moveIn.id);
    const row = d.comparison.find((c) => c.item === "Walls and ceiling")!;
    assert.equal(row.before, "pass");
    assert.equal(row.after, "attention");
    assert.equal(row.deteriorated, true);
    assert.equal(d.deposit?.id, "d1");
  });

  it("lists moves with their checklist steps and alerts on unplanned move-outs", () => {
    const s0 = recompute(base());
    const moves = getMoves(s0);
    const out = moves.find((m) => m.kind === "move_out" && m.contract.id === "c1")!;
    assert.ok(out, "notice given → move-out listed");
    assert.equal(out.steps.find((x) => x.label === "Inspection scheduled")?.done, false);
    assert.ok(s0.alerts.some((a) => a.type === "move_out_unplanned" && a.entityId === "c1"));
    const s1 = startMoveOut("c1", { inspector: "George" })(s0).store;
    assert.ok(!s1.alerts.some((a) => a.type === "move_out_unplanned" && a.entityId === "c1" && !a.resolved));
    assert.equal(getMoves(s1).find((m) => m.kind === "move_out")?.steps.find((x) => x.label === "Inspection scheduled")?.done, true);
  });
});

describe("keys", () => {
  it("issues, returns and tracks lost keys with alerts", () => {
    const s0 = base();
    const { store: s1, result: k } = addKey({ propertyId: "p1", unitId: "u1", type: "apartment_key", identifier: "A1-1" })(s0);
    assert.equal(k.status, "in_office");
    assert.throws(() => addKey({ propertyId: "p1", unitId: "u1", type: "apartment_key", identifier: "a1-1" })(s1), /already exists/);
    assert.throws(() => returnKey(k.id)(s1), /not out/);
    const { store: s2, result: issued } = issueKey(k.id, { assignedTo: "", tenantId: "t1" })(s1);
    assert.equal(issued.status, "issued");
    assert.equal(issued.assignedTo, "Rana Khoury");
    assert.throws(() => issueKey(k.id, { assignedTo: "Someone" })(s2), /Already issued/);
    const { store: s3 } = markKeyLost(k.id, "Left in taxi")(s2);
    assert.ok(s3.alerts.some((a) => a.type === "key_lost" && a.entityId === k.id));
    assert.throws(() => issueKey(k.id, { assignedTo: "X" })(s3), /lost/);
    const { store: s4, result: found } = returnKey(k.id)(s3);
    assert.equal(found.status, "returned");
    assert.ok(!s4.alerts.some((a) => a.type === "key_lost" && a.entityId === k.id && !a.resolved));
  });

  it("returns every key held by a tenant in one step, undoable", () => {
    let s = base();
    const a = addKey({ propertyId: "p1", unitId: "u1", type: "apartment_key", identifier: "A1-1" })(s);
    s = a.store;
    const b = addKey({ propertyId: "p1", unitId: "u1", type: "mailbox_key", identifier: "MB-A1" })(s);
    s = b.store;
    s = issueKey(a.result.id, { assignedTo: "", tenantId: "t1" })(s).store;
    s = issueKey(b.result.id, { assignedTo: "", tenantId: "t1" })(s).store;
    const { store: after, result, undo } = returnAllKeys("t1")(s);
    assert.equal(result.length, 2);
    assert.ok(after.keys.every((k) => k.status === "returned"));
    const back = undo!(after);
    assert.ok(back.keys.every((k) => k.status === "issued"));
  });
});

describe("parking", () => {
  it("assigns a free space to a unit, resolves the occupant, and releases it", () => {
    const s0 = base();
    const { store: s1, result: space } = addParkingSpace({ propertyId: "p1", spaceNumber: "P-1", monthlyFee: 50 })(s0);
    assert.equal(space.status, "free");
    assert.throws(() => addParkingSpace({ propertyId: "p1", spaceNumber: "p-1" })(s1), /already exists/);
    assert.throws(() => assignParking(space.id, {})(s1), /unit or a tenant/);
    const { store: s2, result: assigned } = assignParking(space.id, { unitId: "u1", vehiclePlate: "B 123456" })(s1);
    assert.equal(assigned.status, "assigned");
    assert.equal(assigned.tenantId, "t1", "occupant resolved from the contract");
    assert.equal(assigned.paid, true);
    assert.throws(() => assignParking(space.id, { unitId: "u1" })(s2), /already assigned/);
    const { store: s3, result: released } = releaseParking(space.id)(s2);
    assert.equal(released.status, "free");
    assert.equal(released.unitId, null);
    assert.throws(() => releaseParking(space.id)(s3), /not assigned/);
  });
});
