import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recordPayment, updatePayment, waivePayment } from "../src/lib/commands";
import { recompute } from "../src/lib/derived/recompute";
import { getPaymentsDashboard, getRentRoll } from "../src/lib/queries";
import { contract, paidOnTime, payment, smallStore, tenant, unit, TODAY } from "./helpers";

describe("rent roll", () => {
  const store = recompute(
    smallStore({
      units: [unit(), unit({ id: "bh-102", unitNumber: "102" })],
      contracts: [contract()],
      payments: [paidOnTime("2026-07"), paidOnTime("2026-08"), payment({ periodMonth: "2026-09", dueDate: "2026-09-01" })],
    }),
    TODAY,
  );

  it("lists every rentable unit for the period with what is due, paid and owed", () => {
    const roll = getRentRoll(store, { period: "2026-09" }, TODAY);
    assert.equal(roll.rows.length, 2);
    const occupied = roll.rows.find((r) => r.unit.id === "bh-101")!;
    const vacant = roll.rows.find((r) => r.unit.id === "bh-102")!;
    assert.equal(occupied.tenant?.fullName, "Karim Daher");
    assert.equal(occupied.amountDue, 1000);
    assert.equal(occupied.status, "overdue");
    assert.equal(occupied.daysOverdue, 4);
    assert.equal(vacant.status, "vacant");
    assert.equal(roll.summary.expected, 1000);
    assert.equal(roll.summary.collected, 0);
    assert.equal(roll.summary.outstanding, 1000);
    assert.equal(roll.summary.overdueTenants, 1);
    assert.equal(roll.summary.occupied, 1);
    assert.equal(roll.summary.vacant, 1);
  });

  it("shows past months as history and honours filters", () => {
    const july = getRentRoll(store, { period: "2026-07" }, TODAY);
    assert.equal(july.rows.find((r) => r.unit.id === "bh-101")!.status, "paid");
    assert.equal(july.summary.collectionRate, 1);
    assert.equal(getRentRoll(store, { period: "2026-09", occupancy: "vacant" }, TODAY).rows.length, 1);
    assert.equal(getRentRoll(store, { period: "2026-09", status: "unpaid" }, TODAY).rows.length, 1);
    assert.equal(getRentRoll(store, { period: "2026-09", overdueMin: 30 }, TODAY).rows.length, 0);
    assert.equal(getRentRoll(store, { period: "2026-09", expiring: true }, TODAY).rows.length, 1);
  });

  it("covers quarterly billing with the payment that spans the month", () => {
    const quarterly = recompute(
      smallStore({
        contracts: [contract({ paymentFrequency: "quarterly", startDate: "2026-07-01", endDate: "2027-06-30" })],
        payments: [payment({ periodMonth: "2026-07", amountDue: 3000, amountPaid: 3000, paidDate: "2026-07-01" })],
      }),
      TODAY,
    );
    const row = getRentRoll(quarterly, { period: "2026-09" }, TODAY).rows.find((r) => r.unit.id === "bh-101")!;
    assert.equal(row.payment?.periodMonth, "2026-07");
    assert.equal(row.status, "paid");
  });
});

describe("payments dashboard", () => {
  it("summarises expected, collected, aging and tenants requiring attention", () => {
    const store = recompute(
      smallStore({
        tenants: [tenant()],
        payments: [paidOnTime("2026-07"), payment({ periodMonth: "2026-08", status: "overdue" }), payment({ periodMonth: "2026-09", dueDate: "2026-09-15" })],
      }),
      TODAY,
    );
    const d = getPaymentsDashboard(store, undefined, TODAY);
    assert.equal(d.expectedThisMonth, 1000);
    assert.equal(d.collectedForMonth, 0);
    assert.equal(d.outstanding, 1000);
    assert.equal(d.aging.buckets[1].amount, 1000); // 35 days late → 31–60
    assert.equal(d.attention.length, 1);
    assert.ok(d.attention[0].reasons.some((r) => r.includes("unpaid")));
    assert.equal(d.trend.length, 12);
  });
});

describe("payment commands", () => {
  it("records money with an audit entry and a receipt, and undoes cleanly", () => {
    const store = recompute(smallStore(), TODAY);
    const target = store.payments.find((p) => p.periodMonth === "2026-09")!;
    const { store: after, result, undo } = recordPayment({ paymentId: target.id, amount: 400, date: TODAY, method: "cash", reference: null, note: null })(store);
    assert.equal(result.partial, true);
    assert.equal(result.remaining, 600);
    assert.equal(after.payments.find((p) => p.id === target.id)!.status, "partial");
    assert.ok(after.audit.some((a) => a.entityId === target.id && a.field === "amountPaid" && a.newValue === "400"));
    assert.ok(after.documents.some((d) => d.paymentId === target.id && d.kind === "receipt"));
    const reverted = undo!(after);
    assert.equal(reverted.payments.find((p) => p.id === target.id)!.amountPaid, 0);
    assert.ok(!reverted.audit.some((a) => a.entityId === target.id));
  });

  it("waives a balance with a reason and refuses without one", () => {
    const store = recompute(smallStore(), TODAY);
    const target = store.payments.find((p) => p.periodMonth === "2026-09")!;
    assert.throws(() => waivePayment(target.id, "  ")(store), /reason/);
    const { store: after } = waivePayment(target.id, "Compensation for the water outage")(store);
    const p = after.payments.find((x) => x.id === target.id)!;
    assert.equal(p.status, "waived");
    assert.ok(after.audit.some((a) => a.field === "waived" && a.metadata?.reason?.includes("water")));
    assert.ok(!after.alerts.some((a) => a.entityId === target.id && a.type === "payment_overdue"));
  });

  it("rejects negative or absurd corrections", () => {
    const store = recompute(smallStore(), TODAY);
    const target = store.payments[0];
    assert.throws(() => updatePayment(target.id, { amountPaid: -1 })(store), /negative/);
    assert.throws(() => updatePayment(target.id, { amountPaid: 99999 })(store), /above/);
  });
});
