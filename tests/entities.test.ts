import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addProperty, addTenant, addUnit, createContract, suggestPropertyCode, updateProperty } from "@/lib/commands";
import { recompute } from "@/lib/derived/recompute";
import type { Store } from "@/types";

import { property, smallStore, tenant, TODAY, unit } from "./helpers";

function base(): Store {
  return recompute(smallStore({ properties: [property({ id: "bh", code: "BH", name: "Beirut Heights" })], units: [unit({ id: "bh-101", propertyId: "bh", unitNumber: "101", status: "available", availableSince: "2026-08-01" })], tenants: [tenant({ id: "t-1", fullName: "Rana Khoury", firstName: "Rana", lastName: "Khoury", phone: "+961 3 111 111" })], contracts: [], payments: [] }));
}

describe("manual entry — buildings and units", () => {
  it("adds a building with a suggested code and a generated grid of units, undoable", () => {
    const s0 = base();
    assert.equal(suggestPropertyCode(s0, "Marina Residence"), "MR");
    assert.equal(suggestPropertyCode(s0, "Beirut Harbour"), "BH2", "existing code gets a suffix");
    const { store: s1, result, undo } = addProperty({ name: "Marina Residence", floors: 3, unitsPerFloor: 2, city: "Beirut", generateUnits: { bedrooms: 2, bathrooms: 1, sizeSqm: 110, askingRent: 900, askingDeposit: 900, furnished: false } })(s0);
    assert.equal(result.property.code, "MR");
    assert.equal(result.units.length, 6);
    assert.deepEqual(result.units.map((u) => u.unitNumber), ["101", "102", "201", "202", "301", "302"]);
    assert.ok(result.units.every((u) => u.status === "available" && u.availableSince === TODAY && u.askingRent === 900));
    assert.ok(s1.audit.some((a) => a.entityType === "property" && a.entityId === result.property.id));
    assert.throws(() => addProperty({ name: "Marina Residence", floors: 1, unitsPerFloor: 1 })(s1), /already exists/);
    assert.throws(() => addProperty({ name: "X", code: "MR", floors: 1, unitsPerFloor: 1 })(s1), /already used/);
    assert.throws(() => addProperty({ name: "Y", floors: 0, unitsPerFloor: 1 })(s1), /Floors/);
    const back = undo!(s1);
    assert.equal(back.properties.length, 1);
    assert.equal(back.units.length, 1);
  });

  it("edits a building and refuses to shrink below existing floors", () => {
    const s0 = base();
    const { store: s1, result } = updateProperty("bh", { name: "Beirut Heights Tower", insuranceExpiry: "2027-01-01" })(s0);
    assert.equal(result.name, "Beirut Heights Tower");
    assert.ok(s1.audit.some((a) => a.entityType === "property" && a.field === "name"));
    assert.throws(() => updateProperty("bh", { floors: 0 })(s1), /at least 1/);
  });

  it("adds a unit, grows the building when needed, and rejects duplicates", () => {
    const s0 = base();
    const { store: s1, result: u } = addUnit({ propertyId: "bh", unitNumber: "PH1", floor: 12, bedrooms: 3, askingRent: 3000 })(s0);
    assert.equal(u.status, "available");
    assert.equal(u.askingDeposit, 3000, "deposit defaults to the rent");
    assert.equal(s1.properties[0].floors, 13, "building grew to fit the floor");
    assert.throws(() => addUnit({ propertyId: "bh", unitNumber: "101", floor: 1 })(s1), /already exists/);
    assert.throws(() => addUnit({ propertyId: "bh", unitNumber: "102", floor: -1 })(s1), /Floor/);
    const { result: parked } = addUnit({ propertyId: "bh", unitNumber: "S1", floor: 0, status: "unavailable" })(s1);
    assert.equal(parked.status, "unavailable");
    assert.equal(parked.availableSince, null);
  });
});

describe("manual entry — tenants and contracts", () => {
  it("adds a standalone tenant keyed on the phone number", () => {
    const s0 = base();
    const { store: s1, result: t } = addTenant({ firstName: "Omar", lastName: "Haddad", phone: "03 222 222", email: "omar@example.com" })(s0);
    assert.equal(t.fullName, "Omar Haddad");
    assert.equal(t.nationality, "Lebanese");
    assert.throws(() => addTenant({ firstName: "Omar", lastName: "H", phone: "+961 3 222 222" })(s1), /already has this phone/);
    assert.throws(() => addTenant({ firstName: "", lastName: "X", phone: "1" })(s1), /first name/);
  });

  it("creates a contract for an existing tenant with schedule and deposit, blocks overlaps, undoes cleanly", () => {
    const s0 = base();
    const { store: s1, result, undo } = createContract({ unitId: "bh-101", tenantId: "t-1", startDate: "2026-10-01", months: 12, rent: 1200, deposit: 1200, paymentDay: 1, method: "bank_transfer" })(s0);
    assert.equal(result.contract.contractNumber, "BH-101-01");
    assert.equal(result.contract.endDate, "2027-09-30");
    assert.equal(result.paymentsScheduled, 12);
    assert.equal(result.deposit.amountExpected, 1200);
    assert.equal(result.deposit.status, "pending");
    assert.ok(s1.payments.every((p) => p.contractId !== result.contract.id || p.status === "scheduled" || p.status === "due"));
    assert.throws(() => createContract({ unitId: "bh-101", tenantId: "t-1", startDate: "2027-03-01", months: 6, rent: 1000, deposit: 0, paymentDay: 5, method: "cash" })(s1), /occupies 101 until 2027-09-30/);
    assert.throws(() => createContract({ unitId: "bh-101", tenantId: "t-1", startDate: "2026-10-01", months: 12, rent: 0, deposit: 0, paymentDay: 1, method: "cash" })(s0), /Rent/);
    assert.throws(() => createContract({ unitId: "bh-101", tenantId: "t-1", startDate: "2026-10-01", months: 12, rent: 100, deposit: 0, paymentDay: 31, method: "cash" })(s0), /Payment day/);
    const back = undo!(s1);
    assert.equal(back.contracts.length, 0);
    assert.equal(back.deposits.length, 0);
    assert.equal(back.payments.length, 0);
  });

  it("marks past instalments as paid for historical entry", () => {
    const s0 = base();
    const { store: s1, result } = createContract({ unitId: "bh-101", tenantId: "t-1", startDate: "2026-03-01", months: 12, rent: 800, deposit: 800, paymentDay: 1, method: "cash", pastAsPaid: true, depositReceivedOn: "2026-03-01" })(s0);
    const mine = s1.payments.filter((p) => p.contractId === result.contract.id);
    assert.equal(mine.length, 12);
    assert.ok(mine.filter((p) => p.periodMonth < "2026-09").every((p) => p.status === "paid"), "history paid");
    assert.ok(mine.filter((p) => p.periodMonth > "2026-09").every((p) => p.status === "scheduled"), "future scheduled");
    assert.equal(s1.deposits.find((d) => d.contractId === result.contract.id)?.amountReceived, 800);
    assert.equal(s1.units[0].status, "rented");
    assert.ok(!s1.alerts.some((a) => a.type === "payment_overdue" && a.tenantId === "t-1"), "no false overdue from history");
  });
});
