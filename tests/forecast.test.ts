import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recompute } from "@/lib/derived/recompute";
import { getCashFlowForecast, getVacancyCost } from "@/lib/queries";
import type { Store } from "@/types";

import { contract, deposit, expense, payment, property, smallStore, tenant, unit } from "./helpers";

function base(): Store {
  const p = property({ id: "bh" });
  const rented = unit({ id: "bh-101", propertyId: "bh", unitNumber: "101" });
  const empty = unit({ id: "bh-102", propertyId: "bh", unitNumber: "102", status: "available", availableSince: "2026-07-07", lastRent: 900, marketRent: 950 });
  const t = tenant({ id: "t-1" });
  // Ends in 25 days, no renewal agreed → the October instalment is "at risk".
  const c = contract({ id: "c-1", propertyId: "bh", unitId: "bh-101", tenantId: "t-1", startDate: "2025-10-01", endDate: "2026-09-30", status: "active", monthlyRent: 1000 });
  const payments = [payment({ id: "p-sep", periodMonth: "2026-09", dueDate: "2026-09-01", amountDue: 1000, amountPaid: 400, status: "partial" }), payment({ id: "p-oct", periodMonth: "2026-10", dueDate: "2026-10-01", status: "scheduled" })];
  const expenses = [
    expense({ id: "e-clean", description: "Cleaning contract", amount: 200, recurring: true, recurrence: "monthly", expenseDate: "2026-08-15", paymentStatus: "paid", paidDate: "2026-08-15" }),
    expense({ id: "e-inv", description: "Elevator repair invoice", category: "elevator", amount: 650, expenseDate: "2026-08-28", dueDate: "2026-09-20", paymentStatus: "unpaid", paidDate: null }),
  ];
  return recompute(smallStore({ properties: [p], units: [rented, empty], tenants: [t], contracts: [c], payments, expenses, deposits: [deposit({ id: "d-1", contractId: "c-1", tenantId: "t-1", unitId: "bh-101", propertyId: "bh", amountExpected: 1000, amountReceived: 1000, receivedDate: "2025-10-01" })] }));
}

describe("cash-flow forecast", () => {
  it("projects rent, invoices, recurring costs and deposit refunds month by month", () => {
    const f = getCashFlowForecast(base(), { months: 3 });
    assert.equal(f.months.length, 3);
    const [sep, oct, nov] = f.months;
    assert.equal(sep.period, "2026-09");
    assert.equal(sep.rentExpected, 600, "open part of the partial instalment");
    assert.equal(sep.expensesDue, 650, "unpaid invoice by due date");
    assert.equal(sep.expensesRecurring, 200, "cleaning projected for September (last booked in August)");
    assert.equal(sep.depositRefunds, 1000, "deposit due back when the contract ends this month");
    assert.equal(oct.rentAtRisk, 1000, "October rent depends on a renewal");
    assert.equal(oct.rentExpected, 0);
    assert.equal(oct.expensesRecurring, 200);
    assert.equal(nov.expensesRecurring, 200);
    assert.equal(sep.net, 600 - 650 - 200 - 1000);
    assert.equal(nov.cumulative, sep.net + oct.net + nov.net);
    assert.equal(f.totals.rentAtRisk, 1000);
    assert.equal(f.vacancyRunRate, 900, "empty unit at its last rent");
    assert.ok(sep.items.some((i) => i.kind === "expense_recurring" && i.projected));
    assert.ok(sep.items.every((i) => i.ref !== null), "every line points at a record");
  });

  it("does not project a recurring cost that is already booked for the month", () => {
    const s = base();
    const withSep = recompute({ ...s, expenses: [...s.expenses, expense({ id: "e-clean-sep", description: "Cleaning contract", amount: 200, recurring: true, recurrence: "monthly", expenseDate: "2026-09-15", paymentStatus: "unpaid", paidDate: null, dueDate: "2026-09-30" })] });
    const f = getCashFlowForecast(withSep, { months: 2 });
    assert.equal(f.months[0].expensesRecurring, 0);
    assert.equal(f.months[0].expensesDue, 650 + 200);
    assert.equal(f.months[1].expensesRecurring, 200, "October is still projected");
  });

  it("scopes to a building and honours the horizon", () => {
    const f = getCashFlowForecast(base(), { months: 6, propertyId: "other" });
    assert.equal(f.months.length, 6);
    assert.equal(f.totals.inflows, 0);
    assert.equal(f.totals.outflows, 0);
  });

  it("prices vacancy and lists contracts at risk", () => {
    const v = getVacancyCost(base());
    assert.equal(v.rows.length, 1);
    assert.equal(v.rows[0].unit.id, "bh-102");
    assert.equal(v.rows[0].daysVacant, 60);
    assert.equal(v.rows[0].lostSoFar, 1800);
    assert.equal(v.monthlyRunRate, 900);
    assert.equal(v.atRisk.length, 1);
    assert.equal(v.atRiskMonthly, 1000);
  });
});
