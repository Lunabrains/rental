import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dueDateFor } from "../src/lib/date";
import { recompute } from "../src/lib/derived/recompute";
import { allocateCharge, generateSchedule } from "../src/lib/import/apply";
import { asset, budget, contract, deposit, expense, payment, plan, reminder, smallStore, unit, workOrder, TODAY } from "./helpers";

describe("recompute — contracts", () => {
  it("derives renewal status from the decision and the time left", () => {
    const store = recompute(
      smallStore({
        contracts: [
          contract({ id: "far", endDate: "2027-06-30" }),
          contract({ id: "soon", unitId: "bh-102", endDate: "2026-10-15" }),
          contract({ id: "decided", unitId: "bh-102", endDate: "2026-10-15", renewalDecision: "renew" }),
          contract({ id: "gone", status: "terminated", moveOutDate: "2026-05-01", endDate: "2026-09-30" }),
        ],
      }),
      TODAY,
    );
    const by = (id: string) => store.contracts.find((c) => c.id === id)!;
    assert.equal(by("far").renewalStatus, "not_due");
    assert.equal(by("soon").renewalStatus, "upcoming");
    assert.equal(by("decided").renewalStatus, "renew");
    assert.equal(by("gone").renewalStatus, "ended");
  });

  it("expires active contracts past their end date", () => {
    const store = recompute(smallStore({ contracts: [contract({ endDate: "2026-08-31" })] }), TODAY);
    assert.equal(store.contracts[0].status, "expired");
    // Still occupying: the unit stays rented and the alert engine flags it.
    assert.equal(store.units[0].status, "rented");
    assert.ok(store.alerts.some((a) => a.type === "contract_expired_occupied"));
  });
});

describe("recompute — payments", () => {
  it("derives paid / partial / overdue / due / scheduled / waived", () => {
    const store = recompute(
      smallStore({
        payments: [
          payment({ id: "paid", periodMonth: "2026-08", amountPaid: 1000, paidDate: "2026-08-03" }),
          payment({ id: "partial", periodMonth: "2026-07", amountPaid: 300 }),
          payment({ id: "overdue", periodMonth: "2026-06" }),
          payment({ id: "due", periodMonth: "2026-09", dueDate: "2026-09-07" }),
          payment({ id: "scheduled", periodMonth: "2026-10" }),
          payment({ id: "waived", periodMonth: "2026-05", waived: true }),
        ],
      }),
      TODAY,
    );
    const by = (id: string) => store.payments.find((p) => p.id === id)!;
    assert.equal(by("paid").status, "paid");
    assert.equal(by("paid").daysLate, 2);
    assert.equal(by("partial").status, "partial");
    assert.equal(by("overdue").status, "overdue");
    assert.equal(by("overdue").daysLate, 96);
    assert.equal(by("due").status, "due");
    assert.equal(by("scheduled").status, "scheduled");
    assert.equal(by("waived").status, "waived");
  });
});

describe("recompute — operations", () => {
  it("derives deposit status and amount held", () => {
    const store = recompute(
      smallStore({
        deposits: [
          deposit({ id: "held", deductions: [{ id: "d1", description: "Paint", amount: 250, date: TODAY }] }),
          deposit({ id: "pending", amountReceived: 0, receivedDate: null }),
          deposit({ id: "settled", finalRefund: 1000, settlementDate: TODAY }),
        ],
      }),
      TODAY,
    );
    const by = (id: string) => store.deposits.find((d) => d.id === id)!;
    assert.equal(by("held").status, "held");
    assert.equal(by("held").amountHeld, 750);
    assert.equal(by("pending").status, "pending");
    assert.equal(by("settled").status, "settled");
    assert.equal(by("settled").amountHeld, 0);
  });

  it("turns a scheduled expense unpaid once its due date passes", () => {
    const store = recompute(smallStore({ expenses: [expense({ paymentStatus: "scheduled", paidDate: null, dueDate: "2026-09-01" })] }), TODAY);
    assert.equal(store.expenses[0].paymentStatus, "unpaid");
  });

  it("computes reading consumption and cost, honouring meter resets", () => {
    const store = recompute(
      smallStore({
        meters: [{ id: "m1", propertyId: "bh", unitId: null, utilityType: "electricity", meterNumber: "M1", billingMethod: "metered", unitRate: 0.1, unitLabel: "kWh", createdAt: TODAY }],
        readings: [
          { id: "r1", meterId: "m1", readingDate: "2026-08-01", previousReading: 100, currentReading: 350, consumption: 0, calculatedAmount: null, documentId: null, meterReset: false, note: null },
          { id: "r2", meterId: "m1", readingDate: "2026-09-01", previousReading: 350, currentReading: 40, consumption: 0, calculatedAmount: null, documentId: null, meterReset: true, note: null },
        ],
      }),
      TODAY,
    );
    assert.equal(store.readings[0].consumption, 250);
    assert.equal(store.readings[0].calculatedAmount, 25);
    assert.equal(store.readings[1].consumption, 40);
  });

  it("takes the asset's next service date from its earliest active plan", () => {
    const store = recompute(smallStore({ assets: [asset()], preventivePlans: [plan({ nextServiceDate: "2026-12-01" }), plan({ id: "pm-2", nextServiceDate: "2026-10-01" }), plan({ id: "pm-3", nextServiceDate: "2026-09-10", status: "paused" })] }), TODAY);
    assert.equal(store.assets[0].nextServiceDate, "2026-10-01");
    assert.equal(store.assets[0].lastServiceDate, "2026-06-01");
  });

  it("sums CapEx into a renovation's actual cost and derives progress from tasks", () => {
    const store = recompute(
      smallStore({
        renovations: [{ id: "rn-1", propertyId: "bh", unitId: null, title: "Lobby", description: "", projectType: "upgrade", budget: 1000, actualCost: 0, contractorSupplierId: null, startDate: "2026-08-01", targetEndDate: "2026-10-01", actualEndDate: null, progressPercent: 0, status: "in_progress", tasks: [{ id: "t1", title: "A", done: true, dueDate: null }, { id: "t2", title: "B", done: false, dueDate: null }], photoIds: [], notes: null, createdAt: "2026-08-01" }],
        expenses: [expense({ classification: "capex", renovationId: "rn-1", amount: 700 }), expense({ id: "e2", classification: "capex", renovationId: "rn-1", amount: 500 })],
      }),
      TODAY,
    );
    assert.equal(store.renovations[0].actualCost, 1200);
    assert.equal(store.renovations[0].progressPercent, 50);
    assert.ok(store.alerts.some((a) => a.type === "renovation_over_budget"));
  });
});

describe("alert engine", () => {
  it("raises deterministic maintenance, preventive, finance and reminder alerts", () => {
    const store = recompute(
      smallStore({
        assets: [asset()],
        workOrders: [workOrder({ priority: "emergency" }), workOrder({ id: "wo-2", number: "WO-0002", reportedAt: "2026-07-01", status: "assigned" })],
        preventivePlans: [plan({ nextServiceDate: "2026-08-01" })],
        budgets: [budget({ amount: 100 })],
        expenses: [expense({ amount: 150 }), expense({ id: "inv", paymentStatus: "unpaid", paidDate: null, dueDate: "2026-08-20", description: "Invoice" })],
        reminders: [reminder()],
      }),
      TODAY,
    );
    const types = new Set(store.alerts.map((a) => a.type));
    for (const t of ["maintenance_emergency_open", "maintenance_open_too_long", "preventive_service_overdue", "budget_over", "expense_overdue", "reminder_due"]) {
      assert.ok(types.has(t as never), `missing ${t}`);
    }
    const emergency = store.alerts.find((a) => a.type === "maintenance_emergency_open")!;
    assert.equal(emergency.severity, "critical");
    assert.equal(emergency.generatedBy, "rule");
    assert.equal(store.alerts.find((a) => a.type === "reminder_due")!.generatedBy, "manual");
    assert.equal(store.alerts.find((a) => a.type === "expense_overdue")!.dueDate, "2026-08-20");
  });

  it("keys alerts by type and entity so they update instead of duplicating, and keeps flags", () => {
    const first = recompute(smallStore({ workOrders: [workOrder({ priority: "emergency" })] }), TODAY);
    const id = first.alerts.find((a) => a.type === "maintenance_emergency_open")!.id;
    const flagged = { ...first, alerts: first.alerts.map((a) => (a.id === id ? { ...a, read: true, resolved: true, resolvedAt: "2026-09-05T10:00:00.000Z" } : a)) };
    const second = recompute(flagged, TODAY);
    const again = second.alerts.filter((a) => a.id === id);
    assert.equal(again.length, 1);
    assert.equal(again[0].read, true);
    assert.equal(again[0].resolved, true);
  });

  it("honours muted alert types", () => {
    const base = smallStore({ workOrders: [workOrder({ priority: "emergency" })] });
    const muted = recompute({ ...base, settings: { ...base.settings, mutedAlertTypes: ["maintenance_emergency_open"] } }, TODAY);
    assert.ok(!muted.alerts.some((a) => a.type === "maintenance_emergency_open"));
  });

  it("flags repeat issues on the same unit and category", () => {
    const orders = [1, 2, 3].map((i) => workOrder({ id: `wo-${i}`, number: `WO-000${i}`, reportedAt: `2026-0${5 + i}-15`, status: "closed", completedAt: `2026-0${5 + i}-16` }));
    const store = recompute(smallStore({ workOrders: orders }), TODAY);
    const repeat = store.alerts.find((a) => a.type === "maintenance_repeat_issue");
    assert.ok(repeat);
    assert.equal(repeat!.unitId, "bh-101");
  });
});

describe("payment schedules", () => {
  it("bills quarterly contracts every three months for three months of rent", () => {
    const c = contract({ paymentFrequency: "quarterly", startDate: "2026-01-01", endDate: "2026-12-31", durationMonths: 12 });
    const schedule = generateSchedule(c, [], TODAY, false);
    assert.equal(schedule.length, 4);
    assert.deepEqual(schedule.map((p) => p.periodMonth), ["2026-01", "2026-04", "2026-07", "2026-10"]);
    assert.ok(schedule.every((p) => p.amountDue === 3000));
  });

  it("marks past periods paid on time for seed history and honours the pattern DSL", () => {
    const c = contract({ startDate: "2026-01-01", endDate: "2026-12-31", durationMonths: 12 });
    const schedule = generateSchedule(c, [{ kind: "overdue", offsetDays: -35, arg: null }], TODAY, true);
    assert.equal(schedule.length, 12);
    assert.equal(schedule.filter((p) => p.amountPaid > 0).length, 8);
    const overdue = schedule.find((p) => p.periodMonth === "2026-08")!;
    assert.equal(overdue.amountPaid, 0);
  });

  it("clamps the due day to the month length", () => {
    assert.equal(dueDateFor("2026-02", 28), "2026-02-28");
    assert.equal(dueDateFor("2026-04", 31), "2026-04-30");
  });
});

describe("common charge allocation", () => {
  it("splits a total across units and adds up exactly", () => {
    const units = [unit({ id: "a", sizeSqm: 100 }), unit({ id: "b", sizeSqm: 50 }), unit({ id: "c", sizeSqm: 50, status: "unavailable" })];
    const equal = allocateCharge(100, units, "equal");
    assert.deepEqual(equal.map((x) => x.amount), [50, 50]);
    const byArea = allocateCharge(100.01, units, "by_area");
    assert.equal(byArea.reduce((n, x) => n + x.amount, 0), 100.01);
    assert.ok(byArea[0].amount > byArea[1].amount);
  });
});
