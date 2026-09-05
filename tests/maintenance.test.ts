import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addAsset, addPreventivePlan, addSupplier, approveWorkOrder, canTransition, changeWorkOrderStatus, createWorkOrder, logService, updateSupplier, updateWorkOrder } from "../src/lib/commands";
import { recompute } from "../src/lib/derived/recompute";
import { getMaintenanceSummary, getSuppliers, getWorkOrderDetails } from "../src/lib/queries";
import { asset, plan, smallStore, workOrder, TODAY } from "./helpers";

describe("work orders", () => {
  it("creates, moves through the status timeline, records cost and audits every step", () => {
    const store = recompute(smallStore(), TODAY);
    const { store: s1, result: w } = createWorkOrder({ propertyId: "bh", unitId: "bh-101", title: "Leak under sink", category: "plumbing", priority: "high", estimatedCost: 800 })(store);
    assert.equal(w.number, "WO-0001");
    assert.equal(w.status, "open");
    assert.equal(w.approvalRequired, true, "quotes from $500 need approval");
    assert.throws(() => changeWorkOrderStatus({ workOrderId: w.id, status: "closed" })(s1), /Cannot move/);
    const { store: s2 } = changeWorkOrderStatus({ workOrderId: w.id, status: "awaiting_approval" })(s1);
    assert.ok(s2.alerts.some((a) => a.type === "maintenance_awaiting_approval" && a.entityId === w.id));
    const { store: s3 } = approveWorkOrder(w.id)(s2);
    const started = s3.workOrders.find((x) => x.id === w.id)!;
    assert.equal(started.status, "in_progress");
    assert.equal(started.approvedAt, TODAY);
    assert.equal(started.startedAt, TODAY);
    const { store: s4, undo } = changeWorkOrderStatus({ workOrderId: w.id, status: "completed", actualCost: 950, note: "Replaced the trap" })(s3);
    const done = getWorkOrderDetails(s4, w.id)!;
    assert.equal(done.workOrder.actualCost, 950);
    assert.equal(done.workOrder.completedAt, TODAY);
    assert.equal(done.workOrder.statusHistory.length, 4);
    assert.ok(s4.audit.some((a) => a.entityId === w.id && a.action === "status" && a.newValue === "completed"));
    assert.equal(getMaintenanceSummary(s4).open, 0);
    const reverted = undo!(s4);
    assert.equal(reverted.workOrders.find((x) => x.id === w.id)!.status, "in_progress");
    assert.throws(() => changeWorkOrderStatus({ workOrderId: w.id, status: "completed", actualCost: -5 })(s3), /negative/);
    assert.equal(canTransition("closed", "in_progress"), true);
    assert.equal(canTransition("cancelled", "completed"), false);
  });

  it("raises emergency and open-too-long alerts and links inspection follow-ups", () => {
    const base = recompute(smallStore({ inspections: [{ id: "insp-1", propertyId: "bh", unitId: "bh-101", assetId: null, tenantId: null, contractId: null, type: "annual_unit", scheduledDate: "2026-08-20", completedDate: "2026-08-20", inspector: "George", status: "completed", overallResult: "fail", notes: null, items: [{ id: "i1", area: "Bathroom", item: "Drain", result: "fail", notes: "Slow", photoIds: [], followUpRequired: true, workOrderId: null }], meterReadingIds: [], keyItemIds: [], depositId: null, createdAt: "2026-08-20" }] }), TODAY);
    assert.ok(base.alerts.some((a) => a.type === "inspection_followup_open"));
    const { store: s1, result: w } = createWorkOrder({ propertyId: "bh", unitId: "bh-101", title: "Fix drain", category: "plumbing", priority: "emergency", inspectionId: "insp-1", source: "inspection" })(base);
    assert.equal(s1.inspections[0].items[0].workOrderId, w.id);
    assert.ok(!s1.alerts.some((a) => a.type === "inspection_followup_open"));
    assert.ok(s1.alerts.some((a) => a.type === "maintenance_emergency_open" && a.entityId === w.id));
    const stale = recompute(smallStore({ workOrders: [workOrder({ reportedAt: "2026-08-01", status: "assigned" })] }), TODAY);
    assert.ok(stale.alerts.some((a) => a.type === "maintenance_open_too_long"));
    const { store: s2 } = updateWorkOrder(w.id, { estimatedCost: 300, notes: "Quote received" })(s1);
    assert.ok(s2.audit.some((a) => a.entityId === w.id && a.field === "estimatedCost"));
  });
});

describe("preventive plans, assets and suppliers", () => {
  it("logs a service, rolls the plan forward, books the expense and clears the overdue alert", () => {
    const store = recompute(smallStore({ assets: [asset()], preventivePlans: [plan({ nextServiceDate: "2026-08-15", estimatedCost: 350 })] }), TODAY);
    assert.ok(store.alerts.some((a) => a.type === "preventive_service_overdue"));
    const { store: s1, result: rolled } = logService({ planId: "pm-1", date: TODAY, cost: 400 })(store);
    assert.equal(rolled.lastServiceDate, TODAY);
    assert.equal(rolled.nextServiceDate, "2026-12-05");
    assert.ok(!s1.alerts.some((a) => a.type === "preventive_service_overdue"));
    assert.ok(s1.expenses.some((e) => e.amount === 400 && e.assetId === "as-1" && e.category === "elevator"));
    assert.equal(s1.assets[0].nextServiceDate, "2026-12-05");
    const { store: s2 } = addPreventivePlan({ propertyId: "bh", assetId: "as-1", maintenanceType: "Safety certification", recurrenceMonths: 12, nextServiceDate: "2026-10-01", estimatedCost: 600 })(s1);
    assert.equal(s2.preventivePlans.length, 2);
    assert.throws(() => addPreventivePlan({ propertyId: "bh", maintenanceType: "x", recurrenceMonths: 0, nextServiceDate: TODAY })(s2), /at least one month/);
  });

  it("completing a preventive work order rolls its plan", () => {
    const store = recompute(smallStore({ assets: [asset()], preventivePlans: [plan({ nextServiceDate: "2026-09-01" })] }), TODAY);
    const { store: s1, result: w } = createWorkOrder({ propertyId: "bh", assetId: "as-1", title: "Elevator service", category: "elevator", preventivePlanId: "pm-1", source: "preventive" })(store);
    const { store: s2 } = changeWorkOrderStatus({ workOrderId: w.id, status: "in_progress" })(s1);
    const { store: s3 } = changeWorkOrderStatus({ workOrderId: w.id, status: "completed", actualCost: 350 })(s2);
    assert.equal(s3.preventivePlans[0].lastServiceDate, TODAY);
    assert.equal(s3.preventivePlans[0].nextServiceDate, "2026-12-05");
  });

  it("registers assets with QR ids and scores suppliers only with enough history", () => {
    const store = recompute(smallStore(), TODAY);
    const { store: s1, result: a } = addAsset({ propertyId: "bh", assetType: "generator", name: "Generator", purchaseCost: 30000 })(store);
    assert.ok(a.qrCode.startsWith("AST-BH-GENERATOR"));
    assert.throws(() => addAsset({ propertyId: "bh", assetType: "generator", name: "Bad", purchaseCost: -1 })(s1), /negative/);
    const { store: s2, result: sup } = addSupplier({ name: "PowerGen", category: "generator", rating: 4 })(s1);
    assert.throws(() => addSupplier({ name: "powergen", category: "generator" })(s2), /already exists/);
    assert.throws(() => updateSupplier(sup.id, { rating: 7 })(s2), /between 1 and 5/);
    const row = getSuppliers(s2).find((r) => r.supplier.id === sup.id)!;
    assert.equal(row.score, null);
    assert.equal(row.scoreLabel, "Insufficient data");
    let s = s2;
    for (let i = 0; i < 3; i++) {
      const { store: sa, result: w } = createWorkOrder({ propertyId: "bh", assetId: a.id, title: `Job ${i}`, category: "generator", supplierId: sup.id, estimatedCost: 100, reportedAt: `2026-08-1${i}` })(s);
      const { store: sb } = changeWorkOrderStatus({ workOrderId: w.id, status: "in_progress", date: `2026-08-1${i + 1}` })(sa);
      s = changeWorkOrderStatus({ workOrderId: w.id, status: "completed", actualCost: 110, date: `2026-08-1${i + 2}` })(sb).store;
    }
    const scored = getSuppliers(s).find((r) => r.supplier.id === sup.id)!;
    assert.ok(scored.score !== null && scored.score > 50, `score ${scored.score}`);
    assert.equal(scored.completedJobs, 3);
    assert.equal(scored.components.length, 5);
  });
});
