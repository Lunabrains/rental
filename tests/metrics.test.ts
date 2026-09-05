import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  arrearsAging,
  budgetActual,
  budgetVariance,
  buildingHealth,
  collectionRate,
  noiFor,
  occupancyRate,
  outstandingRent,
  tenantReliability,
  unitHealth,
  vacancyLoss,
} from "../src/lib/derived/metrics";
import { recompute } from "../src/lib/derived/recompute";
import { TODAY, budget, contract, expense, paidLate, paidOnTime, payment, smallStore, unit, workOrder } from "./helpers";

describe("occupancy rate", () => {
  it("counts rented units over rentable units, ignoring unavailable ones", () => {
    const units = [unit({ status: "rented" }), unit({ id: "u2", status: "available" }), unit({ id: "u3", status: "unavailable" }), unit({ id: "u4", status: "renovation" })];
    const r = occupancyRate(units);
    assert.equal(r.occupied, 1);
    assert.equal(r.rentable, 3);
    assert.ok(Math.abs(r.rate - 1 / 3) < 1e-9);
  });

  it("is 0 with no units", () => {
    assert.equal(occupancyRate([]).rate, 0);
  });
});

describe("collection rate", () => {
  it("divides collected by due for the period and ignores waived rent", () => {
    const payments = [
      paidOnTime("2026-08"),
      payment({ id: "p2", periodMonth: "2026-08", amountPaid: 250, status: "partial" }),
      payment({ id: "p3", periodMonth: "2026-08", waived: true, status: "waived" }),
      paidOnTime("2026-07"),
    ];
    const r = collectionRate(payments, "2026-08");
    assert.equal(r.due, 2000);
    assert.equal(r.collected, 1250);
    assert.equal(r.rate, 0.625);
  });

  it("never counts more than the amount due", () => {
    const r = collectionRate([payment({ periodMonth: "2026-08", amountPaid: 1500, status: "paid" })], "2026-08");
    assert.equal(r.collected, 1000);
    assert.equal(r.rate, 1);
  });
});

describe("outstanding rent and arrears aging", () => {
  const payments = [
    payment({ id: "a", status: "overdue", daysLate: 8 }),
    payment({ id: "b", status: "partial", amountPaid: 400, daysLate: 45 }),
    payment({ id: "c", status: "overdue", daysLate: 75 }),
    payment({ id: "d", status: "overdue", daysLate: 120 }),
    paidOnTime("2026-07"),
    payment({ id: "f", status: "scheduled" }),
  ];

  it("sums due minus paid over unpaid and partial payments only", () => {
    assert.equal(outstandingRent(payments), 1000 + 600 + 1000 + 1000);
  });

  it("buckets balances by days overdue", () => {
    const aging = arrearsAging(payments);
    assert.equal(aging.total, 3600);
    assert.equal(aging.count, 4);
    assert.deepEqual(
      aging.buckets.map((b) => [b.key, b.amount, b.count]),
      [
        ["0-30", 1000, 1],
        ["31-60", 600, 1],
        ["61-90", 1000, 1],
        ["90+", 1000, 1],
      ],
    );
  });
});

describe("NOI", () => {
  it("subtracts operating expenses from rent billed and reports CapEx separately", () => {
    const store = smallStore({
      expenses: [expense({ amount: 300 }), expense({ id: "e2", amount: 5000, classification: "capex", category: "renovation" }), expense({ id: "e3", amount: 999, deleted: true })],
    });
    const r = noiFor(store, "2026-09", "bh");
    assert.equal(r.income, 1000);
    assert.equal(r.operatingExpenses, 300);
    assert.equal(r.capex, 5000);
    assert.equal(r.noi, 700);
    assert.equal(r.margin, 0.7);
  });

  it("supports whole-year periods", () => {
    const store = smallStore({ expenses: [expense({ expenseDate: "2026-03-10", amount: 120 })] });
    const r = noiFor(store, "2026");
    assert.equal(r.operatingExpenses, 120);
    assert.equal(r.income, 4000);
  });
});

describe("vacancy loss", () => {
  it("prefers the last contracted rent, then market rent, then asking rent", () => {
    const base = TODAY;
    const vacant = unit({ status: "available", availableSince: "2026-08-06", askingRent: 900, marketRent: 950, lastRent: 1200 });
    assert.deepEqual(vacancyLoss(vacant, base), { referenceRent: 1200, source: "last_rent", daysVacant: 30, loss: 1200 });
    assert.equal(vacancyLoss({ ...vacant, lastRent: null }, base).source, "market_rent");
    assert.equal(vacancyLoss({ ...vacant, lastRent: null, marketRent: null }, base).source, "asking_rent");
  });

  it("is zero for occupied units", () => {
    assert.equal(vacancyLoss(unit({ status: "rented", lastRent: 1000 }), TODAY).loss, 0);
  });
});

describe("budget variance", () => {
  it("returns the difference and percentage", () => {
    const v = budgetVariance(1000, 1250, 0.1);
    assert.equal(v.variance, 250);
    assert.equal(v.variancePct, 0.25);
    assert.equal(v.over, true);
  });

  it("respects the over-budget tolerance and handles a zero budget", () => {
    assert.equal(budgetVariance(1000, 1050, 0.1).over, false);
    assert.equal(budgetVariance(0, 10).variancePct, null);
    assert.equal(budgetVariance(0, 10).over, true);
  });

  it("matches actual spend to a monthly or yearly budget line", () => {
    const expenses = [expense({ expenseDate: "2026-09-03", amount: 40 }), expense({ id: "x", expenseDate: "2026-02-03", amount: 60 }), expense({ id: "y", expenseDate: "2026-09-03", category: "water", amount: 500 })];
    assert.equal(budgetActual(expenses, budget()), 40);
    assert.equal(budgetActual(expenses, budget({ periodType: "year", period: "2026" })), 100);
  });
});

describe("tenant reliability score", () => {
  it("rates a spotless ledger Excellent", () => {
    const r = tenantReliability(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map(paidOnTime), TODAY);
    assert.equal(r.score, 100);
    assert.equal(r.label, "Excellent");
    assert.equal(r.components.reduce((n, c) => n + c.weight, 0), 100);
  });

  it("rates a chronic late payer High attention and explains why", () => {
    const r = tenantReliability(
      [paidLate("2026-03", 12), paidLate("2026-04", 20), payment({ id: "m", periodMonth: "2026-05", status: "overdue", daysLate: 97 }), paidLate("2026-06", 15), payment({ id: "n", periodMonth: "2026-07", amountPaid: 300, status: "partial", daysLate: 36 }), payment({ id: "o", periodMonth: "2026-08", status: "overdue", daysLate: 35 })],
      TODAY,
    );
    assert.ok(r.score !== null && r.score < 60, `score ${r.score}`);
    assert.equal(r.label, "High attention");
    assert.ok(r.components.find((c) => c.key === "on_time")!.score === 0);
    assert.ok(r.metrics.missed >= 2);
  });

  it("reports insufficient data below three counted payments", () => {
    const r = tenantReliability([paidOnTime("2026-08"), payment({ periodMonth: "2026-09" })], TODAY);
    assert.equal(r.score, null);
    assert.equal(r.label, "Insufficient data");
  });
});

describe("building health score", () => {
  it("is decomposable — component weights sum to 100 and a healthy building scores high", () => {
    const store = recompute(
      smallStore({
        units: [unit({ status: "rented" }), unit({ id: "bh-102", unitNumber: "102", status: "rented" })],
        contracts: [contract(), contract({ id: "c-2", contractNumber: "BH-102-01", unitId: "bh-102", tenantId: "t-1" })],
        payments: [
          ...["2026-06", "2026-07", "2026-08"].map(paidOnTime),
          ...["2026-06", "2026-07", "2026-08"].map((m) => ({ ...paidOnTime(m), id: `p2-${m}`, contractId: "c-2", unitId: "bh-102" })),
          payment({ periodMonth: "2026-09", dueDate: "2026-09-10" }),
        ],
      }),
      TODAY,
    );
    const h = buildingHealth(store, "bh", TODAY);
    assert.equal(h.components.reduce((n, c) => n + c.weight, 0), 100);
    assert.ok(h.score >= 85, `score ${h.score}: ${h.components.map((c) => `${c.key}=${c.score}`).join(" ")}`);
    for (const c of h.components) assert.ok(c.detail.length > 0);
  });

  it("drops with emergencies, overdue services and unpaid rent", () => {
    const healthy = recompute(smallStore(), TODAY);
    const troubled = recompute(
      smallStore({
        payments: [payment({ periodMonth: "2026-07", status: "overdue" }), payment({ periodMonth: "2026-08", status: "overdue" }), payment({ periodMonth: "2026-09" })],
        workOrders: [workOrder({ priority: "emergency", reportedAt: "2026-08-01" }), workOrder({ id: "wo-2", number: "WO-0002", reportedAt: "2026-07-01" })],
      }),
      TODAY,
    );
    assert.ok(buildingHealth(troubled, "bh", TODAY).score < buildingHealth(healthy, "bh", TODAY).score);
  });
});

describe("unit health score", () => {
  it("scores a long-vacant, poor-condition unit below an occupied good one", () => {
    const store = recompute(
      smallStore({
        units: [unit({ status: "rented" }), unit({ id: "bh-102", unitNumber: "102", status: "available", availableSince: "2026-05-01", condition: "poor", lastRent: 900 })],
        contracts: [contract()],
      }),
      TODAY,
    );
    const good = unitHealth(store, "bh-101", TODAY);
    const bad = unitHealth(store, "bh-102", TODAY);
    assert.ok(good.score > bad.score, `${good.score} vs ${bad.score}`);
    assert.ok(bad.components.find((c) => c.key === "vacancy")!.detail.includes("vacant"));
  });
});
