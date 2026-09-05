import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addExpense, deleteExpense, markExpensePaid, restoreExpense, scheduleNextOccurrence, updateExpense } from "../src/lib/commands";
import { recompute } from "../src/lib/derived/recompute";
import { getPortfolioComparison, getUnitProfitability } from "../src/lib/queries";
import { contract, expense, paidOnTime, smallStore, unit, workOrder, TODAY } from "./helpers";

describe("expense commands", () => {
  it("adds, audits, pays, soft-deletes and restores an expense", () => {
    const store = recompute(smallStore(), TODAY);
    const { store: s1, result: e } = addExpense({ propertyId: "bh", category: "plumbing", amount: 120, expenseDate: TODAY, description: "Sink repair", recurring: false })(store);
    assert.equal(e.paymentStatus, "unpaid");
    assert.ok(s1.audit.some((a) => a.entityId === e.id && a.action === "create"));
    const { store: s2 } = markExpensePaid(e.id, TODAY)(s1);
    assert.equal(s2.expenses.find((x) => x.id === e.id)!.paymentStatus, "paid");
    assert.ok(s2.audit.some((a) => a.entityId === e.id && a.field === "paymentStatus" && a.newValue === "paid"));
    const { store: s3, undo } = deleteExpense(e.id, "duplicate")(s2);
    assert.equal(s3.expenses.find((x) => x.id === e.id)!.deleted, true);
    assert.ok(s3.audit.some((a) => a.entityId === e.id && a.action === "delete" && a.metadata?.reason === "duplicate"));
    const { store: s4 } = restoreExpense(e.id)(s3);
    assert.equal(s4.expenses.find((x) => x.id === e.id)!.deleted, false);
    const reverted = undo!(s3);
    assert.equal(reverted.expenses.find((x) => x.id === e.id)!.deleted, false);
  });

  it("refuses negative amounts and impossible dates", () => {
    const store = recompute(smallStore(), TODAY);
    assert.throws(() => addExpense({ propertyId: "bh", category: "cleaning", amount: -5, expenseDate: TODAY, description: "x" })(store), /negative/);
    assert.throws(() => addExpense({ propertyId: "bh", category: "cleaning", amount: 5, expenseDate: TODAY, dueDate: "2026-01-01", description: "x" })(store), /Due date/);
    const withOne = addExpense({ propertyId: "bh", category: "cleaning", amount: 5, expenseDate: TODAY, description: "x" })(store).store;
    assert.throws(() => updateExpense(withOne.expenses[0].id, { amount: -1 })(withOne), /negative/);
  });

  it("schedules the next occurrence of a recurring expense", () => {
    const store = recompute(smallStore(), TODAY);
    const { store: s1, result: e } = addExpense({ propertyId: "bh", category: "cleaning", amount: 300, expenseDate: "2026-09-01", description: "Cleaning", recurring: true, recurrence: "monthly", paymentStatus: "paid", paidDate: "2026-09-01" })(store);
    const { store: s2, result: next } = scheduleNextOccurrence(e.id)(s1);
    assert.equal(next.expenseDate, "2026-10-01");
    assert.equal(next.paymentStatus, "scheduled");
    assert.equal(s2.expenses.length, 2);
    assert.throws(() => scheduleNextOccurrence(e.id)(s2), /already exists/);
  });
});

describe("profitability", () => {
  const store = recompute(
    smallStore({
      units: [unit({ status: "rented" }), unit({ id: "bh-102", unitNumber: "102", availableSince: "2026-06-01", lastRent: 900 })],
      contracts: [contract({ startDate: "2025-10-01", endDate: "2026-09-30" })],
      payments: ["2026-06", "2026-07", "2026-08"].map(paidOnTime),
      expenses: [expense({ unitId: "bh-101", amount: 200, expenseDate: "2026-07-10" }), expense({ id: "cap", unitId: "bh-101", amount: 5000, classification: "capex", category: "renovation", expenseDate: "2026-08-10" }), expense({ id: "bld", amount: 400, expenseDate: "2026-08-12" })],
      workOrders: [workOrder({ status: "closed", completedAt: "2026-08-20", actualCost: 150, reportedAt: "2026-08-15" })],
    }),
    TODAY,
  );

  it("computes unit net contribution from rent, attributed costs and work orders, keeping CapEx apart", () => {
    const p = getUnitProfitability(store, "bh-101", "12m", TODAY)!;
    assert.equal(p.rentBilled, 3000);
    assert.equal(p.operatingExpenses, 200);
    assert.equal(p.maintenanceCost, 150);
    assert.equal(p.capex, 5000);
    assert.equal(p.netContribution, 2650);
    assert.equal(p.monthly.length, 12);
  });

  it("estimates vacancy loss for the empty unit and ranks buildings", () => {
    const vacant = getUnitProfitability(store, "bh-102", "12m", TODAY)!;
    assert.ok(vacant.vacancyDays > 90, `days ${vacant.vacancyDays}`);
    assert.ok(vacant.vacancyLoss > 2000);
    const cmp = getPortfolioComparison(store, "12m", TODAY);
    assert.equal(cmp.rows.length, 1);
    assert.equal(cmp.rows[0].revenue, 3000);
    assert.equal(cmp.rows[0].operatingExpenses, 600);
    assert.equal(cmp.rows[0].capex, 5000);
    assert.equal(cmp.rows[0].noi, 2400);
    assert.equal(cmp.totals.noi, 2400);
  });
});
