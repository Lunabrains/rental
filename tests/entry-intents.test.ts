import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerLocally } from "@/lib/ai/demo-engine";
import { entryKindOf } from "@/lib/ai/entry-intents";
import type { PageContext } from "@/lib/ai/types";

import { seedStore } from "./helpers";

const store = seedStore();
const portfolio: PageContext = { pathname: "/dashboard" };

function creation(question: string, context: PageContext = portfolio) {
  const a = answerLocally(question, store, context);
  assert.ok(a, `no answer for "${question}"`);
  const action = a!.actions?.[0];
  assert.ok(action, `no action for "${question}": ${a!.text}`);
  assert.equal(action!.targetId, "new");
  assert.equal(a!.autoOpen, true, "form opens by itself");
  return { answer: a!, kind: action!.kind, payload: action!.payload as Record<string, unknown> };
}

describe("data entry by instruction", () => {
  it("knows an instruction from a question", () => {
    assert.equal(entryKindOf("add a new building called marina bay"), "building");
    assert.equal(entryKindOf("add tenant omar haddad to unit 403"), "tenant");
    assert.equal(entryKindOf("add unit 403 to building marina"), "unit");
    assert.equal(entryKindOf("who is the tenant in 403"), null);
    assert.equal(entryKindOf("create a work order for the elevator"), null, "work orders keep their own intent");
    assert.equal(entryKindOf("add a reminder to call nadine"), null);
    assert.equal(entryKindOf("which building has the most expenses"), null);
  });

  it("prepares a building with its layout", () => {
    const { kind, payload, answer } = creation("Add a new building called Marina Bay Towers with 6 floors and 4 units per floor in Jounieh");
    assert.equal(kind, "create_property");
    assert.equal(payload.name, "Marina Bay Towers");
    assert.equal(payload.floors, 6);
    assert.equal(payload.unitsPerFloor, 4);
    assert.equal(payload.city, "Jounieh");
    assert.equal(payload.generateUnits, true);
    assert.ok(answer.table?.rows.some((r) => r[0] === "Floors" && r[1] === "6"));
  });

  it("prepares a unit inside a known building", () => {
    const { kind, payload } = creation("add unit 905 to Beirut Heights, 3 bedrooms, 2 bathrooms, 140 sqm, rent $1,800, furnished");
    assert.equal(kind, "create_unit");
    assert.equal(payload.propertyId, "beirut-heights");
    assert.equal(payload.unitNumber, "905");
    assert.equal(payload.floor, 9);
    assert.equal(payload.bedrooms, 3);
    assert.equal(payload.bathrooms, 2);
    assert.equal(payload.sizeSqm, 140);
    assert.equal(payload.askingRent, 1800);
    assert.equal(payload.furnished, true);
  });

  it("prepares a tenant with contact details and the unit they are taking", () => {
    const vacant = store.units.find((u) => u.propertyId === "beirut-heights" && u.status === "available")!;
    const { kind, payload } = creation(`Add tenant Omar Haddad phone 03 123 456, email omar@example.com, to unit ${vacant.unitNumber} in Beirut Heights, rent 950 from 1 October for 12 months`);
    assert.equal(kind, "create_tenant");
    assert.equal(payload.firstName, "Omar");
    assert.equal(payload.lastName, "Haddad");
    assert.equal(payload.phone, "03 123 456");
    assert.equal(payload.email, "omar@example.com");
    assert.equal(payload.unitId, vacant.id);
    assert.equal(payload.rent, 950);
    assert.equal(payload.months, 12);
    assert.equal(payload.startDate, "2026-10-01");
  });

  it("prepares a contract for an existing tenant and warns when the unit is taken", () => {
    const tenant = store.tenants.find((t) => store.tenants.filter((x) => x.firstName === t.firstName).length === 1 && store.tenants.filter((x) => x.lastName === t.lastName).length === 1)!;
    const { kind, payload, answer } = creation(`new contract for ${tenant.fullName} in unit 403 Beirut Heights at 1200 for 2 years`);
    assert.equal(kind, "create_contract");
    assert.equal(payload.tenantId, tenant.id);
    assert.equal(payload.rent, 1200);
    assert.equal(payload.months, 24);
    const unit = store.units.find((u) => u.propertyId === "beirut-heights" && u.unitNumber === "403")!;
    assert.equal(payload.unitId, unit.id);
    assert.ok(/occupied/.test(answer.text), answer.text);
  });

  it("prepares an asset, an expense and a supplier", () => {
    const asset = creation("register a Kone elevator in Marina Residence serial K-889");
    assert.equal(asset.kind, "create_asset");
    assert.equal(asset.payload.propertyId, "marina-residence");
    assert.equal(asset.payload.assetType, "elevator");
    assert.equal(asset.payload.manufacturer, "Kone");
    assert.equal(asset.payload.serialNumber, "K-889");

    const expense = creation("add an expense of $450 for cleaning in Beirut Heights");
    assert.equal(expense.kind, "create_expense");
    assert.equal(expense.payload.propertyId, "beirut-heights");
    assert.equal(expense.payload.amount, 450);
    assert.equal(expense.payload.category, "cleaning");

    const supplier = creation("add supplier Ali Electric, electrical, phone 70 111 222");
    assert.equal(supplier.kind, "create_supplier");
    assert.equal(supplier.payload.name, "Ali Electric");
    assert.equal(supplier.payload.category, "electrical");
    assert.equal(supplier.payload.phone, "70 111 222");
  });

  it("takes the same instruction in Arabic", () => {
    const { kind, payload, answer } = creation("ضيف مبنى جديد اسمه مارينا باي مع 5 طوابق و 4 شقق بكل طابق");
    assert.equal(kind, "create_property");
    assert.equal(payload.floors, 5);
    assert.equal(payload.unitsPerFloor, 4);
    assert.ok(String(payload.name).includes("مارينا"), String(payload.name));
    assert.equal(answer.lang, "ar");
    const tenant = creation("ضيف مستأجر جديد اسمه سامي حداد رقمه 03 555 666");
    assert.equal(tenant.kind, "create_tenant");
    assert.equal(tenant.payload.firstName, "سامي");
    assert.equal(tenant.payload.phone, "03 555 666");
  });

  it("leaves questions to the question router", () => {
    const a = answerLocally("Who is renting 403 in Beirut Heights?", store, portfolio);
    assert.ok(a && !a.autoOpen);
  });
});
