/**
 * Phase 2 acceptance: load the seed through the importer, dump the KPIs,
 * prove re-import is idempotent, and time the Cedar import.
 *
 *   npx tsx scripts/check-seed.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createEmptyStore } from "../src/lib/data/store";
import { importData } from "../src/lib/commands";
import { today } from "../src/lib/date";
import { parseWorkbook } from "../src/lib/import/parse";
import { planImport } from "../src/lib/import/validate";
import { summarize } from "../src/lib/import/apply";
import {
  getExpiringContracts,
  getLatePayers,
  getOutstandingBalance,
  getOverduePayments,
  getPortfolioOverview,
  getPropertyPerformance,
  getRevenueHistory,
  getVacantUnits,
} from "../src/lib/queries";
import type { Store } from "../src/types";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function load(store: Store, file: string) {
  const buffer = readFileSync(join(process.cwd(), "public", "seed", file));
  const parsed = parseWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), file);
  const plan = planImport(parsed, store);
  const issues = Object.values(plan.rows)
    .flat()
    .flatMap((r) => r.issues.map((i) => `  [${i.level}] ${r.entity} row ${r.rowNumber} (${r.label}): ${i.message}`));
  const started = performance.now();
  const { store: next, result } = importData(plan)(store);
  const ms = performance.now() - started;
  return { store: next, plan, summary: result, issues, ms };
}

function dump(store: Store, title: string) {
  const o = getPortfolioOverview(store);
  console.log(`\n=== ${title} (today = ${today()}) ===`);
  console.log(
    `buildings ${o.buildings} · units ${o.units} · occupied ${o.occupied} · available ${o.available} · occupancy ${pct(o.occupancy.current)} (prev ${pct(o.occupancy.previous)})`,
  );
  console.log(`monthly revenue ${money(o.monthlyRevenue.current)} (prev ${money(o.monthlyRevenue.previous)})`);
  console.log(`outstanding ${money(o.outstanding.current)} across ${o.overdueCount} payments (prev ${money(o.outstanding.previous)})`);
  console.log(`expiring: ${o.expiring30} within 30d · ${o.expiring60} within 60d · vacant > 45d: ${o.vacantOver45}`);
  console.log(`critical alerts ${o.criticalAlerts.total} (${store.alerts.length} total alerts)`);

  const perf = getPropertyPerformance(store);
  console.log("\nranking:");
  for (const r of perf.rows) {
    console.log(
      `  ${r.name.padEnd(22)} ${String(r.rented).padStart(3)}/${String(r.units).padEnd(3)} ${pct(r.occupancy).padStart(6)}  rev ${money(r.monthlyRevenue).padStart(8)}  out ${money(r.outstanding).padStart(7)}  score ${r.score}`,
    );
  }
  console.log(`  ${"Portfolio".padEnd(22)} ${String(perf.total.rented).padStart(3)}/${String(perf.total.units).padEnd(3)} ${pct(perf.total.occupancy).padStart(6)}  rev ${money(perf.total.monthlyRevenue).padStart(8)}  out ${money(perf.total.outstanding).padStart(7)}`);

  console.log("\noverdue / partial:");
  for (const r of getOverduePayments(store)) {
    console.log(`  ${r.tenant.fullName.padEnd(24)} ${r.property.name.padEnd(20)} ${r.unit.unitNumber.padEnd(6)} ${r.payment.status.padEnd(8)} ${String(r.payment.daysLate).padStart(3)}d  ${money(r.outstanding)}`);
  }
  const ob = getOutstandingBalance(store);
  console.log(`  by building: ${ob.byProperty.map((b) => `${b.property.name} ${money(b.amount)} (${pct(b.share)})`).join(" · ")}`);

  console.log("\nexpiring ≤ 60d:");
  for (const r of getExpiringContracts(store, 60)) {
    console.log(`  ${r.tenant.fullName.padEnd(24)} ${r.property.name.padEnd(20)} ${r.unit.unitNumber.padEnd(6)} in ${String(r.daysRemaining).padStart(3)}d  ${money(r.contract.monthlyRent)}${r.hasOverdue ? "  ⚠ overdue" : ""}${r.reliable ? "  ✓ reliable" : ""}`);
  }

  console.log("\nlate payers (≥3 of last 6):");
  for (const l of getLatePayers(store, 6, 3)) {
    console.log(`  ${l.tenant.fullName.padEnd(24)} ${l.property.name.padEnd(20)} ${l.unit.unitNumber}  ${l.lateCount}/${l.windowMonths} late · avg ${l.avgDaysLate}d${l.currentlyOverdue ? " · currently overdue" : ""}`);
  }

  console.log("\nvacant ≥ 45d:");
  for (const v of getVacantUnits(store, 45)) {
    console.log(`  ${v.property.name.padEnd(20)} ${v.unit.unitNumber.padEnd(6)} ${v.daysVacant}d  asking ${money(v.askingRent)}  prev: ${v.previousTenant?.fullName ?? "—"}`);
  }

  console.log("\nrevenue history (billed / collected / occupancy):");
  for (const p of getRevenueHistory(store, 12)) {
    console.log(`  ${p.period}  ${money(p.billed).padStart(9)}  ${money(p.collected).padStart(9)}  ${pct(p.occupancy)}`);
  }
}

/* --------------------------------- Run ------------------------------------ */

let store = createEmptyStore();

const first = load(store, "portfolio.xlsx");
store = first.store;
console.log(`portfolio.xlsx → ${summarize(first.summary)} (${first.summary.paymentsGenerated} payments generated, ${Math.round(first.ms)} ms)`);
if (first.issues.length > 0) console.log(`issues (${first.issues.length}):\n${first.issues.slice(0, 40).join("\n")}`);
dump(store, "After portfolio seed");

const again = load(store, "portfolio.xlsx");
const created = Object.values(again.summary.created).reduce((a, b) => a + b, 0);
console.log(`\nre-import portfolio.xlsx → ${summarize(again.summary)}  ${created === 0 ? "✓ no duplicates" : "✗ DUPLICATES CREATED"}`);
console.log(`  units before ${store.units.length} after ${again.store.units.length} · payments before ${store.payments.length} after ${again.store.payments.length}`);
store = again.store;

const cedar = load(store, "cedar-residence.xlsx");
store = cedar.store;
console.log(`\ncedar-residence.xlsx → ${summarize(cedar.summary)} in ${Math.round(cedar.ms)} ms ${cedar.ms < 2000 ? "✓ < 2 s" : "✗ too slow"}`);
if (cedar.issues.length > 0) console.log(`issues (${cedar.issues.length}):\n${cedar.issues.slice(0, 20).join("\n")}`);
dump(store, "After Cedar import");
