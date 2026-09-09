import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerLocally } from "@/lib/ai/demo-engine";
import { clearVacateUndertaking, importData, openComplaint, recordVacateUndertaking, resolveComplaint } from "@/lib/commands";
import { createEmptyStore } from "@/lib/data/store";
import { recompute } from "@/lib/derived/recompute";
import { buildWorkbook, rowsToAoa } from "@/lib/import/template";
import { parseWorkbook } from "@/lib/import/parse";
import { planImport } from "@/lib/import/validate";
import { cellMatches, getUnitsByProperty } from "@/lib/queries";
import { workbookToArrayBuffer } from "@/lib/import/template";
import type { Store } from "@/types";

import { seedStore, smallStore, TODAY } from "./helpers";

function base(): Store {
  return recompute(smallStore());
}

describe("grid flags — complaint (red) and تعهد بالإخلاء (orange)", () => {
  it("opens, updates and resolves a complaint with audit, activity and undo", () => {
    const s0 = base();
    const { store: s1, result, undo } = openComplaint("t-1", { summary: "Disputes the late fee" })(s0);
    assert.equal(result.complaint?.summary, "Disputes the late fee");
    assert.equal(result.complaint?.openedOn, TODAY);
    assert.ok(s1.activity.some((a) => a.type === "complaint_opened" && a.tenantId === "t-1"));
    assert.ok(s1.audit.some((a) => a.entityType === "tenant" && a.field === "complaint"));
    assert.throws(() => openComplaint("t-1", { summary: "   " })(s1), /Describe/);
    const { store: s2 } = resolveComplaint("t-1", "Fee waived")(s1);
    assert.equal(s2.tenants[0].complaint, null);
    assert.ok(s2.tenants[0].notes?.includes("Fee waived"), "resolution kept in the notes");
    assert.ok(s2.activity.some((a) => a.type === "complaint_resolved"));
    assert.throws(() => resolveComplaint("t-1")(s2), /No open complaint/);
    const back = undo!(s1);
    assert.equal(back.tenants[0].complaint ?? null, null);
    assert.ok(!back.activity.some((a) => a.type === "complaint_opened"));
  });

  it("records and withdraws an undertaking to vacate", () => {
    const s0 = base();
    assert.throws(() => recordVacateUndertaking("c-1", { vacateBy: "2026-01-01", signedOn: "2026-09-01" })(s0), /cannot be before/);
    const { store: s1, result } = recordVacateUndertaking("c-1", { vacateBy: "2026-11-30", notes: "Signed at the office" })(s0);
    assert.deepEqual(result.vacateUndertaking, { signedOn: TODAY, vacateBy: "2026-11-30", notes: "Signed at the office" });
    assert.ok(s1.activity.some((a) => a.type === "vacate_undertaking_recorded" && /تعهد بالإخلاء/.test(a.message)));
    const { store: s2, undo } = clearVacateUndertaking("c-1")(s1);
    assert.equal(s2.contracts[0].vacateUndertaking, null);
    assert.equal(undo!(s2).contracts[0].vacateUndertaking?.vacateBy, "2026-11-30");
  });

  it("colours the grid: green rented, red complaint, orange undertaking, white available", () => {
    const s0 = base();
    const cell = (s: Store, id: string) => getUnitsByProperty(s, "bh").flatMap((f) => f.units).find((c) => c.unit.id === id)!;
    assert.equal(cell(s0, "bh-101").state, "rented");
    assert.equal(cell(s0, "bh-102").state, "available");
    const s1 = openComplaint("t-1", { summary: "Noise" })(s0).store;
    assert.equal(cell(s1, "bh-101").state, "complaint");
    const s2 = recordVacateUndertaking("c-1", { vacateBy: "2026-12-31" })(s1).store;
    const c = cell(s2, "bh-101");
    assert.equal(c.state, "vacating", "the undertaking wins the colour; the complaint stays on the cell");
    assert.ok(c.complaint && c.vacate);
    assert.ok(cellMatches(c, "rented") && cellMatches(c, "complaint") && cellMatches(c, "vacating") && !cellMatches(c, "available"));
    assert.ok(cellMatches(cell(s2, "bh-102"), "available"));
  });

  it("imports the flags from the tenants and contracts tabs", () => {
    const wb = buildWorkbook({
      properties: rowsToAoa("properties", [{ property_code: "ZZ", name: "Zed Tower", floors: 1, units_per_floor: 2 }]),
      units: rowsToAoa("units", [{ property_code: "ZZ", unit_number: "101", floor: 1, asking_rent: 700 }, { property_code: "ZZ", unit_number: "102", floor: 1, asking_rent: 700 }]),
      tenants: rowsToAoa("tenants", [
        { first_name: "Hala", last_name: "Rizk", phone: "+961 3 700 001", complaint: "Water leak not fixed", complaint_date: "2026-08-20" },
        { first_name: "Fadi", last_name: "Ayoub", phone: "+961 3 700 002" },
      ]),
      contracts: rowsToAoa("contracts", [
        { contract_number: "ZZ-101-01", property_code: "ZZ", unit_number: "101", tenant_phone: "+961 3 700 001", start_date: "2026-03-01", end_date: "2027-02-28", monthly_rent: 700 },
        { contract_number: "ZZ-102-01", property_code: "ZZ", unit_number: "102", tenant_phone: "+961 3 700 002", start_date: "2026-03-01", end_date: "2027-02-28", monthly_rent: 700, vacate_undertaking_signed: "2026-09-01", vacate_by: "2026-10-31", vacate_notes: "Moving abroad" },
      ]),
    });
    const plan = planImport(parseWorkbook(workbookToArrayBuffer(wb), "flags.xlsx"), createEmptyStore(), TODAY);
    assert.equal(plan.errorCount, 0);
    const { store } = importData(plan)(createEmptyStore());
    const hala = store.tenants.find((t) => t.firstName === "Hala")!;
    assert.deepEqual(hala.complaint, { openedOn: "2026-08-20", summary: "Water leak not fixed" });
    const fadi = store.contracts.find((c) => c.contractNumber === "ZZ-102-01")!;
    assert.deepEqual(fadi.vacateUndertaking, { signedOn: "2026-09-01", vacateBy: "2026-10-31", notes: "Moving abroad" });
    const cells = getUnitsByProperty(store, store.properties[0].id).flatMap((f) => f.units);
    assert.deepEqual(cells.map((c) => [c.unit.unitNumber, c.state]), [["101", "complaint"], ["102", "vacating"]]);
  });

  it("lets the assistant open the two forms for a named tenant", () => {
    const store = recompute(seedStore());
    const a = answerLocally("open a complaint for Karim Daher about the AC still not repaired", store, { pathname: "/dashboard" });
    assert.equal(a?.actions?.[0]?.kind, "open_complaint");
    const karim = store.tenants.find((t) => t.fullName === "Karim Daher")!;
    assert.equal(a?.actions?.[0]?.targetId, karim.id);
    assert.equal((a?.actions?.[0]?.payload as { summary?: string })?.summary, "the AC still not repaired");
    const b = answerLocally("record a vacate undertaking for Karim Daher by 2026-10-31", store, { pathname: "/dashboard" });
    assert.equal(b?.actions?.[0]?.kind, "record_vacate");
    const contract = store.contracts.find((c) => c.tenantId === karim.id && c.status === "active")!;
    assert.equal(b?.actions?.[0]?.targetId, contract.id);
    assert.equal((b?.actions?.[0]?.payload as { vacateBy?: string })?.vacateBy, "2026-10-31");
    const ar = answerLocally("سجل شكوى على كريم ضاهر", store, { pathname: "/dashboard" });
    assert.equal(ar?.actions?.[0]?.kind, "open_complaint");
    const nobody = answerLocally("open a complaint for Zorro", store, { pathname: "/dashboard" });
    assert.ok(nobody && !nobody.actions?.length && /which tenant/.test(nobody.text));
  });
});
