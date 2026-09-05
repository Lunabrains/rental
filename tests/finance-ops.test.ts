import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addCommonCharge, addDeduction, addMeter, deleteCommonCharge, recordReading, setAllocationPaid, setBudget, settleDeposit } from "../src/lib/commands";
import { recompute } from "../src/lib/derived/recompute";
import { getBudgets, getCommonCharges, getMeters } from "../src/lib/queries";
import { deposit, expense, smallStore, unit, TODAY } from "./helpers";

describe("budgets", () => {
  it("sets a budget line, computes the variance and raises the over-budget alert", () => {
    const store = recompute(smallStore({ expenses: [expense({ amount: 250, expenseDate: "2026-09-03" })] }), TODAY);
    const { store: s1 } = setBudget({ propertyId: "bh", periodType: "month", period: "2026-09", category: "cleaning", amount: 200 })(store);
    const rows = getBudgets(s1, { propertyId: "bh", period: "2026-09" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actual, 250);
    assert.equal(rows[0].variance.variance, 50);
    assert.equal(rows[0].variance.over, true);
    assert.ok(s1.alerts.some((a) => a.type === "budget_over"));
    // Updating the same line keeps one record.
    const { store: s2 } = setBudget({ propertyId: "bh", periodType: "month", period: "2026-09", category: "cleaning", amount: 400 })(s1);
    assert.equal(s2.budgets.length, 1);
    assert.equal(getBudgets(s2, { propertyId: "bh" })[0].variance.over, false);
    assert.throws(() => setBudget({ propertyId: "bh", periodType: "year", period: "2026", category: "water", amount: -1 })(s2), /negative/);
  });
});

describe("deposits", () => {
  it("limits deductions to the amount received and needs a reason to over-refund", () => {
    const store = recompute(smallStore({ deposits: [deposit()] }), TODAY);
    assert.throws(() => addDeduction("dep-c-1", { description: "Paint", amount: 1200 })(store), /cannot exceed/);
    const { store: s1 } = addDeduction("dep-c-1", { description: "Paint", amount: 250 })(store);
    assert.equal(s1.deposits[0].amountHeld, 750);
    assert.throws(() => settleDeposit({ depositId: "dep-c-1", refund: 900 })(s1), /exceeds/);
    const { store: s2 } = settleDeposit({ depositId: "dep-c-1", refund: 750, notes: "Bank transfer" })(s1);
    assert.equal(s2.deposits[0].status, "settled");
    assert.equal(s2.deposits[0].finalRefund, 750);
    assert.ok(s2.audit.some((a) => a.entityType === "deposit" && a.field === "finalRefund"));
    assert.throws(() => addDeduction("dep-c-1", { description: "Late", amount: 10 })(s2), /already settled/);
    const { store: s3 } = settleDeposit({ depositId: "dep-c-1", refund: 800, overrideReason: "Goodwill" })(s1);
    assert.equal(s3.deposits[0].finalRefund, 800);
    assert.ok(s3.deposits[0].settlementNotes?.includes("Goodwill"));
  });
});

describe("utilities", () => {
  it("adds a meter, records readings, refuses decreasing readings and books the expense", () => {
    const store = recompute(smallStore(), TODAY);
    const { store: s1, result: meter } = addMeter({ propertyId: "bh", utilityType: "electricity", meterNumber: "EDL-1", unitRate: 0.1 })(store);
    assert.throws(() => addMeter({ propertyId: "bh", utilityType: "electricity", meterNumber: "edl-1" })(s1), /already exists/);
    const { store: s2 } = recordReading({ meterId: meter.id, readingDate: "2026-08-01", currentReading: 1000 })(s1);
    assert.throws(() => recordReading({ meterId: meter.id, readingDate: "2026-09-01", currentReading: 900 })(s2), /lower/);
    const { store: s3, result: r } = recordReading({ meterId: meter.id, readingDate: "2026-09-01", currentReading: 1350, bookExpense: true })(s2);
    assert.equal(r.consumption, 350);
    assert.equal(r.calculatedAmount, 35);
    assert.ok(s3.expenses.some((e) => e.amount === 35 && e.category === "electricity"));
    const { store: s4, result: reset } = recordReading({ meterId: meter.id, readingDate: "2026-09-05", currentReading: 20, meterReset: true })(s3);
    assert.equal(reset.consumption, 20);
    assert.equal(getMeters(s4)[0].readings.length, 3);
  });
});

describe("common charges", () => {
  it("allocates by area, tracks per-unit payment and refuses deleting a paid charge", () => {
    const store = recompute(smallStore({ units: [unit({ sizeSqm: 100 }), unit({ id: "bh-102", unitNumber: "102", sizeSqm: 50 })] }), TODAY);
    const { store: s1, result: c } = addCommonCharge({ propertyId: "bh", period: "2026-09", category: "cleaning", totalAmount: 300, allocationMethod: "by_area" })(store);
    assert.deepEqual(c.allocations.map((a) => a.amount), [200, 100]);
    assert.throws(() => addCommonCharge({ propertyId: "bh", period: "2026-09", category: "cleaning", totalAmount: 300, allocationMethod: "equal" })(s1), /already exists/);
    const { store: s2 } = setAllocationPaid(c.id, "bh-101", true)(s1);
    const row = getCommonCharges(s2)[0];
    assert.equal(row.paidAmount, 200);
    assert.equal(row.unpaidAmount, 100);
    assert.throws(() => deleteCommonCharge(c.id)(s2), /already paid/);
  });
});
