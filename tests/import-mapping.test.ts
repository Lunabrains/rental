import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";

import { importData } from "@/lib/commands";
import { createEmptyStore } from "@/lib/data/store";
import { buildParsedWorkbook, cleanDate, cleanNumber, detectEntity, isTemplateShaped, mappingIssues, scanWorkbook, suggestMappings } from "@/lib/import/mapping";
import { parseWorkbook } from "@/lib/import/parse";
import { workbookToArrayBuffer } from "@/lib/import/template";
import { planImport } from "@/lib/import/validate";

import { TODAY } from "./helpers";

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return workbookToArrayBuffer(wb);
}

const LEGACY = {
  Buildings: [
    ["Building", "Address", "City", "Floors", "Insurance expiry"],
    ["Marina Residence", "Corniche", "Beirut", 4, "31/12/2027"],
  ],
  Apartments: [
    ["Building", "Apt", "Bedrooms", "Rent $", "Furnished", "Size (m2)"],
    ["Marina Residence", 101, 2, "$1,200", "Yes", 120],
    ["Marina Residence", 102, 1, "900", "no", 80],
    ["Marina Residence", 201, 2, "1,100", "نعم", 120],
    ["Cedar Tower", 301, 3, 1500, "no", "150 m2"],
  ],
  Renters: [
    ["Name", "Mobile", "ID", "Nationality"],
    ["Omar Haddad", "03 111 222", "12345", "Lebanese"],
    ["Rana Khoury", "+961 3 333 444", "", "Lebanese"],
  ],
  Leases: [
    ["Building", "Apt", "Tenant", "Rent", "Start", "Months", "Payment", "Deposit"],
    ["Marina Residence", 101, "Omar Haddad", 1200, "01/03/2026", 12, "Bank transfer", 1200],
    ["Cedar Tower", 301, "Rana Khoury", "1,500", "2026-01-15", 24, "cash", "1500"],
  ],
};

describe("flexible import — mapping the owner's own spreadsheets", () => {
  it("detects what each tab holds and where each column goes", () => {
    const scan = scanWorkbook(workbook(LEGACY), "legacy.xlsx");
    assert.deepEqual(scan.sheets.map((s) => s.name), ["Buildings", "Apartments", "Renters", "Leases"]);
    const mappings = suggestMappings(scan);
    assert.deepEqual(mappings.map((m) => m.entity), ["properties", "units", "tenants", "contracts"]);
    const target = (sheet: string, header: string) => mappings.find((m) => m.sheet === sheet)!.columns.find((c) => c.header === header)!.target;
    assert.equal(target("Buildings", "Building"), "name");
    assert.equal(target("Buildings", "Insurance expiry"), "insurance_expiry");
    assert.equal(target("Apartments", "Building"), "property_name");
    assert.equal(target("Apartments", "Apt"), "unit_number");
    assert.equal(target("Apartments", "Rent $"), "asking_rent");
    assert.equal(target("Apartments", "Size (m2)"), "size_sqm");
    assert.equal(target("Renters", "Name"), "full_name");
    assert.equal(target("Renters", "Mobile"), "phone");
    assert.equal(target("Renters", "ID"), "id_number");
    assert.equal(target("Leases", "Tenant"), "tenant_name");
    assert.equal(target("Leases", "Months"), "duration_months");
    assert.equal(target("Leases", "Payment"), "payment_method");
    assert.equal(target("Leases", "Start"), "start_date");
    assert.deepEqual(mappingIssues(mappings).filter((i) => i.level === "error"), [], "everything required is mapped or derivable");
    assert.equal(isTemplateShaped(scan, mappings), false);
  });

  it("derives codes, floors, names, contract numbers and end dates, then imports cleanly", () => {
    const scan = scanWorkbook(workbook(LEGACY), "legacy.xlsx");
    const mappings = suggestMappings(scan);
    const { parsed, notes } = buildParsedWorkbook(scan, mappings, createEmptyStore());
    const props = parsed.sheets.properties.rows.map((r) => r.values);
    assert.equal(props.length, 2, "Cedar Tower is created from the units that mention it");
    const marina = props.find((p) => p.name === "Marina Residence")!;
    assert.equal(marina.property_code, "MR");
    assert.equal(marina.floors, 4, "from the sheet");
    assert.equal(marina.units_per_floor, 2, "busiest floor in the units tab");
    assert.equal(marina.insurance_expiry, "31/12/2027");
    const cedar = props.find((p) => p.name === "Cedar Tower")!;
    assert.equal(cedar.property_code, "CT");
    assert.equal(cedar.floors, 3);
    assert.ok(notes.some((n) => n.includes("Cedar Tower")));
    const units = parsed.sheets.units.rows.map((r) => r.values);
    assert.deepEqual(units.map((u) => [u.property_code, u.unit_number, u.floor, u.asking_rent, u.furnished, u.size_sqm]), [["MR", "101", 1, 1200, "yes", 120], ["MR", "102", 1, 900, "no", 80], ["MR", "201", 2, 1100, "yes", 120], ["CT", "301", 3, 1500, "no", 150]]);
    const tenants = parsed.sheets.tenants.rows.map((r) => r.values);
    assert.deepEqual(tenants.map((t) => [t.first_name, t.last_name, t.phone]), [["Omar", "Haddad", "03 111 222"], ["Rana", "Khoury", "+961 3 333 444"]]);
    const contracts = parsed.sheets.contracts.rows.map((r) => r.values);
    assert.equal(contracts[0].tenant_phone, "03 111 222", "tenant matched by name");
    assert.equal(contracts[0].end_date, "2027-02-28", "start + 12 months − 1 day");
    assert.equal(contracts[0].payment_method, "bank_transfer");
    assert.equal(contracts[0].contract_number, "MR-101-202603");
    assert.equal(contracts[1].monthly_rent, 1500);
    assert.equal(contracts[1].deposit, 1500);
    assert.equal(contracts[1].end_date, "2028-01-14");

    const plan = planImport(parsed, createEmptyStore(), TODAY);
    assert.equal(plan.errorCount, 0, JSON.stringify(Object.values(plan.rows).flat().flatMap((r) => r.issues.filter((i) => i.level === "error"))));
    const { store } = importData(plan)(createEmptyStore());
    assert.equal(store.properties.length, 2);
    assert.equal(store.units.length, 4);
    assert.equal(store.tenants.length, 2);
    assert.equal(store.contracts.length, 2);
    const u101 = store.units.find((u) => u.unitNumber === "101")!;
    assert.equal(u101.status, "rented");
    assert.equal(u101.furnished, true);
    assert.equal(u101.askingRent, 1200);
    assert.ok(store.payments.length >= 12, "schedule generated from the derived contract");
    assert.equal(store.deposits.length, 2);
  });

  it("reads Arabic headers and values", () => {
    const buffer = workbook({
      "المستأجرين": [
        ["الاسم", "رقم الهاتف", "الجنسية"],
        ["سامي حداد", "70 123 456", "لبناني"],
      ],
      "العقود": [
        ["المبنى", "الشقة", "المستأجر", "الإيجار الشهري", "تاريخ البداية", "تاريخ النهاية", "طريقة الدفع", "التأمين"],
        ["برج الأرز", "5", "سامي حداد", "800", "2026-02-01", "2027-01-31", "نقدي", 800],
      ],
    });
    const scan = scanWorkbook(buffer, "arabic.xlsx");
    const mappings = suggestMappings(scan);
    assert.deepEqual(mappings.map((m) => m.entity), ["tenants", "contracts"]);
    const { parsed } = buildParsedWorkbook(scan, mappings, createEmptyStore());
    assert.equal(parsed.sheets.tenants.rows[0].values.first_name, "سامي");
    assert.equal(parsed.sheets.tenants.rows[0].values.last_name, "حداد");
    const c = parsed.sheets.contracts.rows[0].values;
    assert.equal(c.tenant_phone, "70 123 456");
    assert.equal(c.payment_method, "cash");
    assert.equal(c.monthly_rent, 800);
    assert.equal(c.unit_number, "5");
    assert.ok(parsed.sheets.properties.rows.length === 1 && parsed.sheets.units.rows.length === 0);
    const plan = planImport(parsed, createEmptyStore(), TODAY);
    // The unit itself is not in the file — the contract row says so instead of crashing.
    assert.ok(plan.rows.contracts[0].issues.some((i) => /Unknown unit/.test(i.message)));
    assert.equal(plan.rows.tenants[0].action, "create");
  });

  it("keeps the template path byte-for-byte compatible", () => {
    const file = readFileSync(join(process.cwd(), "public", "seed", "portfolio.xlsx"));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const scan = scanWorkbook(buffer, "portfolio.xlsx");
    const mappings = suggestMappings(scan);
    assert.ok(isTemplateShaped(scan, mappings), mappings.filter((m) => m.detected !== "name").map((m) => `${m.sheet}:${m.detected}`).join(","));
    const viaMapping = planImport(buildParsedWorkbook(scan, mappings, createEmptyStore()).parsed, createEmptyStore(), TODAY);
    const viaTemplate = planImport(parseWorkbook(buffer, "portfolio.xlsx"), createEmptyStore(), TODAY);
    assert.deepEqual(viaMapping.counts, viaTemplate.counts);
    assert.equal(viaMapping.errorCount, viaTemplate.errorCount);
  });

  it("cleans money, booleans, enums and dates the way owners type them", () => {
    assert.equal(cleanNumber("$1,200"), 1200);
    assert.equal(cleanNumber("1.200,50"), 1200.5);
    assert.equal(cleanNumber("1200,5"), 1200.5);
    assert.equal(cleanNumber("950 USD"), 950);
    assert.equal(cleanNumber("n/a"), "n/a");
    assert.equal(cleanDate("1 Sep 2026"), "2026-09-01");
    assert.equal(cleanDate("Sept 1, 2026"), "2026-09-01");
    assert.equal(cleanDate("2026/09/01"), "2026-09-01");
    assert.equal(cleanDate("01.09.2026"), "2026-09-01");
    assert.equal(cleanDate("March 2026"), "2026-03-01");
    assert.equal(cleanDate("2026-09-01"), "2026-09-01");
    const scan = scanWorkbook(workbook({ Flats: [["Unit", "Floor", "Status", "Condition", "Furnished"], ["G1", 0, "Under maintenance", "Needs repair", "✓"]] }), "x.xlsx");
    const mappings = suggestMappings(scan);
    assert.equal(detectEntity(scan.sheets[0]).entity, "units");
    const { parsed } = buildParsedWorkbook(scan, mappings, createEmptyStore());
    const v = parsed.sheets.units.rows[0].values;
    assert.equal(v.status, "maintenance");
    assert.equal(v.condition, "needs_work");
    assert.equal(v.furnished, "yes");
  });

  it("takes a vendor list that only has company and trade", () => {
    const scan = scanWorkbook(workbook({ Vendors: [["Company", "Trade", "Phone"], ["Ali Electric", "Electrical", "70 111 222"], ["Beirut Lifts", "Elevator", "01 222 333"]] }), "vendors.xlsx");
    const mappings = suggestMappings(scan);
    assert.equal(mappings[0].entity, "suppliers");
    assert.deepEqual(mappings[0].columns.map((c) => c.target), ["company", "category", "phone"]);
    assert.deepEqual(mappingIssues(mappings).filter((i) => i.level === "error"), []);
    const { parsed } = buildParsedWorkbook(scan, mappings, createEmptyStore());
    assert.deepEqual(parsed.sheets.suppliers.rows.map((r) => [r.values.name, r.values.category, r.values.phone]), [["Ali Electric", "electrical", "70 111 222"], ["Beirut Lifts", "elevator", "01 222 333"]]);
    const plan = planImport(parsed, createEmptyStore(), TODAY);
    assert.equal(plan.errorCount, 0);
  });

  it("skips a title row above the headers and ignores tabs it cannot place", () => {
    const scan = scanWorkbook(workbook({ Sheet1: [["My buildings 2026"], [], ["Building", "Floors", "Units per floor", "City"], ["Sunset Plaza", 6, 3, "Jbeil"]], Scratch: [["a", "b"], [1, 2]] }), "odd.xlsx");
    const sheet = scan.sheets.find((s) => s.name === "Sheet1")!;
    assert.equal(sheet.headerRow, 3);
    assert.deepEqual(sheet.headers, ["Building", "Floors", "Units per floor", "City"]);
    const mappings = suggestMappings(scan);
    assert.equal(mappings.find((m) => m.sheet === "Sheet1")!.entity, "properties");
    assert.equal(mappings.find((m) => m.sheet === "Scratch")!.entity, null);
    const { parsed } = buildParsedWorkbook(scan, mappings, createEmptyStore());
    assert.equal(parsed.sheets.properties.rows[0].values.property_code, "SP");
    assert.deepEqual(parsed.unknownSheets, ["Scratch"]);
  });
});
