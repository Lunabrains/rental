import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { importData } from "../src/lib/commands";
import { createEmptyStore } from "../src/lib/data/store";
import { buildTemplateWorkbook, buildWorkbook, rowsToAoa, workbookToArrayBuffer } from "../src/lib/import/template";
import { parseWorkbook } from "../src/lib/import/parse";
import { planImport } from "../src/lib/import/validate";
import { getPortfolioOverview } from "../src/lib/queries";
import { seedStore, TODAY } from "./helpers";

function planOf(buffer: ArrayBuffer, name: string, store = createEmptyStore()) {
  return planImport(parseWorkbook(buffer, name), store, TODAY);
}

describe("seed workbook", () => {
  it("imports every tab, generates the payment history and computes the demo KPIs", () => {
    const store = seedStore();
    assert.equal(store.properties.length, 7);
    assert.equal(store.units.length, 170);
    assert.ok(store.payments.length > 3000);
    assert.ok(store.suppliers.length >= 10);
    assert.ok(store.assets.length > 40);
    assert.ok(store.workOrders.length > 40);
    assert.ok(store.expenses.length > 300);
    assert.ok(store.deposits.length >= store.contracts.length, "one deposit per contract");
    assert.ok(store.inspections.some((i) => i.items.some((x) => x.result === "fail")));
    assert.ok(store.renovations.length >= 3);
    const o = getPortfolioOverview(store, TODAY);
    assert.ok(o.occupancy.current > 0.75 && o.occupancy.current < 0.9);
    // The demo cast.
    const karim = store.tenants.find((t) => t.fullName === "Karim Daher")!;
    assert.ok(store.payments.some((p) => p.tenantId === karim.id && p.status === "overdue" && p.daysLate === 8));
    assert.ok(store.alerts.some((a) => a.type === "payment_repeat_late" && a.title.includes("Michel Saab")));
    assert.ok(store.alerts.some((a) => a.type === "maintenance_repeat_issue"));
    assert.ok(store.alerts.some((a) => a.type === "maintenance_emergency_open"));
    assert.ok(store.alerts.some((a) => a.type === "budget_over"));
    assert.ok(store.alerts.some((a) => a.type === "preventive_service_overdue"));
  });

  it("re-imports idempotently", () => {
    const store = seedStore();
    const buffer = readFileSync("public/seed/portfolio.xlsx");
    const plan = planOf(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "portfolio.xlsx", store);
    const { store: again, result } = importData(plan)(store);
    assert.equal(Object.values(result.created).reduce((a, b) => a + b, 0), 0);
    assert.equal(again.units.length, store.units.length);
    assert.equal(again.payments.length, store.payments.length);
    assert.equal(again.workOrders.length, store.workOrders.length);
    assert.equal(again.expenses.length, store.expenses.length);
  });
});

describe("template workbook", () => {
  it("round-trips through parse → plan → apply without errors", () => {
    const wb = buildTemplateWorkbook();
    const plan = planOf(workbookToArrayBuffer(wb), "template.xlsx");
    const errors = Object.values(plan.rows).flat().flatMap((r) => r.issues.filter((i) => i.level === "error").map((i) => `${r.entity} row ${r.rowNumber}: ${i.message}`));
    assert.deepEqual(errors, []);
    const { store } = importData(plan)(createEmptyStore());
    assert.equal(store.properties.length, 2);
    assert.equal(store.workOrders.length, 1);
    assert.equal(store.commonCharges[0].allocations.length, 3);
    assert.ok(store.readings[0].consumption === 320);
  });
});

describe("validation rules", () => {
  it("rejects negative amounts, backwards dates and unknown references", () => {
    const wb = buildWorkbook({
      properties: rowsToAoa("properties", [{ property_code: "ZZ", name: "Zeta", floors: 1, units_per_floor: 1 }]),
      units: rowsToAoa("units", [{ property_code: "ZZ", unit_number: "1", floor: 1, asking_rent: -5 }]),
      expenses: rowsToAoa("expenses", [
        { property_code: "ZZ", category: "cleaning", amount: -20, expense_date: "today", description: "Negative" },
        { property_code: "QQ", category: "cleaning", amount: 20, expense_date: "today", description: "Unknown building" },
      ]),
      renovations: rowsToAoa("renovations", [{ property_code: "ZZ", title: "Backwards", budget: 100, start_date: "today", target_end_date: "today-10d" }]),
      deposits: rowsToAoa("deposits", [{ contract_number: "NOPE", amount_received: 100 }]),
    });
    const plan = planOf(workbookToArrayBuffer(wb), "bad.xlsx");
    const messages = Object.values(plan.rows).flat().flatMap((r) => r.issues.filter((i) => i.level === "error").map((i) => i.message));
    assert.ok(messages.some((m) => m.includes("asking_rent cannot be negative")));
    assert.ok(messages.some((m) => m.includes("amount cannot be negative")));
    assert.ok(messages.some((m) => m.includes('Unknown property "QQ"')));
    assert.ok(messages.some((m) => m.includes("target_end_date is before start_date")));
    assert.ok(messages.some((m) => m.includes("Unknown contract NOPE")));
    assert.equal(plan.counts.expenses.skip, 2);
  });

  it("refuses a deposit refund larger than the amount held", () => {
    const wb = buildWorkbook({
      properties: rowsToAoa("properties", [{ property_code: "ZZ", name: "Zeta", floors: 1, units_per_floor: 1 }]),
      units: rowsToAoa("units", [{ property_code: "ZZ", unit_number: "1", floor: 1, asking_rent: 500 }]),
      tenants: rowsToAoa("tenants", [{ first_name: "A", last_name: "B", phone: "+961 3 000 001", id_number: "X1" }]),
      contracts: rowsToAoa("contracts", [{ contract_number: "ZZ-1-01", property_code: "ZZ", unit_number: "1", tenant_phone: "+961 3 000 001", start_date: "today-2m", end_date: "today+10m", monthly_rent: 500 }]),
      deposits: rowsToAoa("deposits", [{ contract_number: "ZZ-1-01", amount_received: 500, deductions: "Paint:100:today", final_refund: 450 }]),
    });
    const plan = planOf(workbookToArrayBuffer(wb), "deposit.xlsx");
    assert.ok(plan.rows.deposits[0].issues.some((i) => i.message.includes("Refund cannot exceed")));
  });
});
