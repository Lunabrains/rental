import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addExpense, addRenovationTask, completeRenovation, createRenovation, setRenovationStatus, toggleRenovationTask, updateRenovation } from "@/lib/commands";
import { recompute } from "@/lib/derived/recompute";
import { getCapexSummary, getRenovationImpact } from "@/lib/queries";
import type { Store } from "@/types";

import { contract, property, smallStore, tenant, TODAY, unit } from "./helpers";

function base(): Store {
  const p = property({ id: "p1" });
  const vacant = unit({ id: "u1", propertyId: "p1", unitNumber: "A1", marketRent: 1200, condition: "poor" });
  const t = tenant({ id: "t1" });
  // Previous tenancy at 900/month ended two months ago.
  const old = contract({ id: "c0", propertyId: "p1", unitId: "u1", tenantId: "t1", startDate: "2024-09-01", endDate: "2026-07-05", moveOutDate: "2026-07-05", status: "expired", monthlyRent: 900 });
  return recompute(smallStore({ properties: [p], units: [vacant], tenants: [t], contracts: [old] }));
}

describe("renovations", () => {
  it("creates a project, flags the vacant unit, and tracks CapEx against the budget", () => {
    const s0 = base();
    const { store: s1, result: r } = createRenovation({ propertyId: "p1", unitId: "u1", title: "Kitchen refit", projectType: "renovation", budget: 6000, startDate: "2026-08-20", targetEndDate: "2026-09-20", tasks: [{ title: "Demolition" }, { title: "Cabinets" }, { title: "Paint" }], markUnit: true })(s0);
    assert.equal(r.status, "in_progress", "start date in the past → in progress");
    assert.equal(s1.units[0].status, "renovation");
    assert.equal(r.tasks.length, 3);
    assert.throws(() => createRenovation({ propertyId: "p1", title: "Bad", projectType: "repair", budget: -1, startDate: TODAY, targetEndDate: TODAY })(s1), /negative/);
    assert.throws(() => createRenovation({ propertyId: "p1", title: "Bad", projectType: "repair", budget: 1, startDate: "2026-09-10", targetEndDate: "2026-09-01" })(s1), /after the start/);
    // Book CapEx against it.
    const { store: s2 } = addExpense({ propertyId: "p1", unitId: "u1", renovationId: r.id, category: "renovation", classification: "capex", amount: 4500, expenseDate: "2026-09-01", description: "Cabinets and worktop", paymentStatus: "paid", paidDate: "2026-09-01" })(s1);
    assert.equal(s2.renovations[0].actualCost, 4500);
    const { store: s3 } = addExpense({ propertyId: "p1", unitId: "u1", renovationId: r.id, category: "renovation", classification: "capex", amount: 2500, expenseDate: "2026-09-03", description: "Extra plumbing", paymentStatus: "unpaid" })(s2);
    assert.equal(s3.renovations[0].actualCost, 7000);
    assert.ok(s3.alerts.some((a) => a.type === "renovation_over_budget" && a.entityId === r.id), "over budget alert");
    // Tasks drive progress.
    const { store: s4 } = toggleRenovationTask(r.id, r.tasks[0].id)(s3);
    assert.equal(s4.renovations[0].progressPercent, 33);
    const { store: s5 } = addRenovationTask(r.id, { title: "Snagging" })(s4);
    assert.equal(s5.renovations[0].progressPercent, 25);
    const summary = getCapexSummary(s5);
    assert.equal(summary.live, 1);
    assert.equal(summary.overBudget, 1);
    assert.equal(summary.spentThisYear, 7000);
  });

  it("completes with the unit condition and asking rent, and estimates the return", () => {
    const s0 = base();
    const { store: s1, result: r } = createRenovation({ propertyId: "p1", unitId: "u1", title: "Full refit", projectType: "upgrade", budget: 6000, startDate: "2026-08-01", targetEndDate: "2026-08-31", markUnit: true })(s0);
    const { store: s2 } = addExpense({ propertyId: "p1", unitId: "u1", renovationId: r.id, category: "renovation", classification: "capex", amount: 6000, expenseDate: "2026-08-15", description: "Works", paymentStatus: "paid", paidDate: "2026-08-15" })(s1);
    assert.throws(() => completeRenovation(r.id, { actualEndDate: "2099-01-01" })(s2), /future/);
    assert.throws(() => completeRenovation(r.id, { actualEndDate: "2026-07-01" })(s2), /before the start/);
    const { store: s3, result: done, undo } = completeRenovation(r.id, { actualEndDate: "2026-09-04", unitCondition: "good", marketRent: 1400 })(s2);
    assert.equal(done.status, "completed");
    assert.equal(done.progressPercent, 100);
    const u = s3.units[0];
    assert.equal(u.status, "available", "unit released");
    assert.equal(u.condition, "good");
    assert.equal(u.marketRent, 1400);
    const impact = getRenovationImpact(s3, r.id)!;
    assert.equal(impact.rentBefore, 900);
    assert.equal(impact.rentAfter, 1400);
    assert.equal(impact.afterIsProjected, true);
    assert.equal(impact.monthlyUplift, 500);
    assert.equal(impact.paybackMonths, 12);
    assert.equal(impact.annualReturn, 1);
    assert.equal(impact.slipDays, 4, "finished four days late");
    assert.ok(impact.vacantDays! >= 30);
    assert.ok(!s3.alerts.some((a) => a.type === "renovation_delayed" && a.entityId === r.id && !a.resolved));
    const back = undo!(s3);
    assert.equal(back.renovations[0].status, "in_progress");
    assert.equal(back.units[0].status, "renovation");
    assert.equal(back.units[0].marketRent, 1200);
  });

  it("guards status transitions and frees the unit on cancel", () => {
    const s0 = base();
    const { store: s1, result: r } = createRenovation({ propertyId: "p1", unitId: "u1", title: "Balcony", projectType: "repair", budget: 800, startDate: "2026-10-01", targetEndDate: "2026-10-10" })(s0);
    assert.equal(r.status, "planned");
    assert.throws(() => setRenovationStatus(r.id, "completed")(s1), /Complete/);
    const { store: s2 } = setRenovationStatus(r.id, "in_progress")(s1);
    assert.equal(s2.units[0].status, "renovation", "starting on a vacant unit flags it");
    const { store: s3 } = setRenovationStatus(r.id, "cancelled", "Tenant found first")(s2);
    assert.equal(s3.units[0].status, "available");
    assert.throws(() => setRenovationStatus(r.id, "in_progress")(s3), /Cannot move/);
    const { result: u } = updateRenovation(r.id, { budget: 1000 })(s3);
    assert.equal(u.budget, 1000);
    assert.throws(() => updateRenovation(r.id, { progressPercent: 140 })(s3), /percentage/);
  });
});
