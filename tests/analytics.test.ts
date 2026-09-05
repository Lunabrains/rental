import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOccupying } from "@/lib/derived/occupancy";
import { buildAllReports, buildReport, getExpenseAnalytics, getExpirationTimeline, getMaintenanceAnalytics, getPortfolioTrends, REPORT_KEYS } from "@/lib/queries";
import type { Store } from "@/types";

import { seedStore, TODAY } from "./helpers";

let cached: Store | null = null;
const seed = (): Store => (cached ??= seedStore());

describe("portfolio trends", () => {
  it("produces one consistent point per month", () => {
    const s = seed();
    const t = getPortfolioTrends(s, 12, undefined, TODAY);
    assert.equal(t.length, 12);
    assert.equal(t[t.length - 1].period, "2026-09");
    for (const p of t) {
      assert.ok(p.occupancy >= 0 && p.occupancy <= 1, `${p.period} occupancy`);
      assert.equal(p.noi, p.expected - p.operating, `${p.period} NOI = rent due − operating`);
      assert.ok(p.collectionRate >= 0 && p.collectionRate <= 1);
      assert.ok(p.outstanding >= 0 && p.vacancyLoss >= 0 && p.maintenance >= 0);
    }
    assert.ok(t.some((p) => p.expected > 0), "rent billed somewhere");
    assert.ok(t.some((p) => p.vacancyLoss > 0), "the seed has vacancies");
  });

  it("scopes to a building", () => {
    const s = seed();
    const marina = s.properties.find((p) => p.name.startsWith("Marina"))!;
    const all = getPortfolioTrends(s, 3, undefined, TODAY);
    const one = getPortfolioTrends(s, 3, marina.id, TODAY);
    assert.ok(one[2].expected < all[2].expected);
    assert.ok(one[2].expected > 0);
  });

  it("times contract expirations and their renewal state", () => {
    const s = seed();
    const tl = getExpirationTimeline(s, 12, undefined, TODAY);
    assert.equal(tl.length, 12);
    const ending = s.contracts.filter((c) => isOccupying(c) && (c.moveOutDate ?? c.endDate) >= "2026-09-01" && (c.moveOutDate ?? c.endDate) <= "2027-08-31").length;
    assert.equal(tl.reduce((n, p) => n + p.count, 0), ending);
    for (const p of tl) assert.equal(p.renewing + p.leaving + p.undecided, p.count, p.period);
  });
});

describe("expense analytics", () => {
  it("totals match the ledger and shares add up", () => {
    const s = seed();
    const a = getExpenseAnalytics(s, { year: "2026" }, TODAY);
    const ledger = s.expenses.filter((e) => !e.deleted && e.expenseDate.startsWith("2026")).reduce((n, e) => n + e.amount, 0);
    assert.equal(a.total, ledger);
    assert.equal(a.operating + a.capex, a.total);
    assert.ok(Math.abs(a.byCategory.reduce((n, r) => n + r.share, 0) - 1) < 0.001);
    assert.ok(Math.abs(a.byBuilding.reduce((n, r) => n + r.share, 0) - 1) < 0.001);
    assert.equal(a.byBuilding.reduce((n, r) => n + r.amount, 0), a.total);
    assert.equal(a.bySupplier.reduce((n, r) => n + r.amount, 0), a.total);
    assert.equal(a.monthly.length, 12);
    assert.equal(a.monthly[11].period, "2026-09");
    assert.ok(a.yearOverYear.some((y) => y.year === "2026"));
    assert.ok(a.largest.length > 0 && a.largest[0].expense.amount >= a.largest[a.largest.length - 1].expense.amount);
  });
});

describe("maintenance analytics", () => {
  it("counts every live work order once and derives resolution times", () => {
    const s = seed();
    const a = getMaintenanceAnalytics(s, undefined, TODAY);
    const live = s.workOrders.filter((w) => w.status !== "cancelled").length;
    assert.equal(a.byCategory.reduce((n, r) => n + r.jobs, 0), live);
    assert.equal(a.resolution.byPriority.reduce((n, r) => n + r.jobs, 0), live);
    assert.ok(a.resolution.avgDays !== null && a.resolution.avgDays > 0);
    assert.equal(a.monthly.length, 12);
    assert.ok(a.repeatIssues.some((r) => r.category === "plumbing"), "the seed's repeat plumbing unit shows up");
    assert.ok(a.suppliers.length > 0 && a.suppliers.every((r) => r.jobs > 0));
    assert.ok(a.topAssets.length > 0 && a.topAssets[0].totalSpend >= (a.topAssets[1]?.totalSpend ?? 0));
  });
});

describe("reports", () => {
  it("builds every report with matching columns, rows and totals", () => {
    const s = seed();
    for (const key of REPORT_KEYS) {
      const r = buildReport(s, key, {}, TODAY);
      assert.ok(r.columns.length > 0, key);
      for (const row of r.rows) assert.equal(row.length, r.columns.length, `${key} row width`);
      if (r.totals) {
        assert.equal(r.totals.length, r.columns.length, `${key} totals width`);
        for (const i of r.moneyColumns) assert.equal(r.totals[i], r.rows.reduce((n, row) => n + (typeof row[i] === "number" ? (row[i] as number) : 0), 0), `${key} total column ${i}`);
      }
    }
    assert.equal(buildAllReports(s, {}, TODAY).length, REPORT_KEYS.length);
  });

  it("filters by building, month, year and horizon", () => {
    const s = seed();
    const marina = s.properties.find((p) => p.name.startsWith("Marina"))!;
    const rr = buildReport(s, "rent_roll", { propertyId: marina.id, period: "2026-09" }, TODAY);
    assert.ok(rr.rows.length > 0 && rr.rows.every((row) => row[0] === marina.name));
    const ph = buildReport(s, "payment_history", { period: "2026-08" }, TODAY);
    assert.ok(ph.rows.every((row) => String(row[0]).startsWith("2026-08")));
    const ex = buildReport(s, "expenses", { period: "2026" }, TODAY);
    assert.ok(ex.rows.every((row) => String(row[0]).startsWith("2026")));
    const soon = buildReport(s, "contracts_expiring", { days: 30 }, TODAY);
    const later = buildReport(s, "contracts_expiring", { days: 180 }, TODAY);
    assert.ok(soon.rows.length <= later.rows.length);
    assert.ok(soon.rows.every((row) => (row[1] as number) <= 30));
    const balances = buildReport(s, "tenant_balances", {}, TODAY);
    assert.ok(balances.rows.some((row) => String(row[0]).startsWith("Karim")), "Karim owes rent");
  });
});
