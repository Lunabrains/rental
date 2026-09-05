import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerLocally } from "@/lib/ai/demo-engine";
import { executeTool, knownActionTarget, TOOL_DEFINITIONS } from "@/lib/ai/tools";
import type { PageContext } from "@/lib/ai/types";
import type { Store } from "@/types";

import { seedStore } from "./helpers";

let cached: Store | null = null;
const seed = (): Store => (cached ??= seedStore());
const ctx: PageContext = { pathname: "/dashboard" };

const QUESTIONS: [string, RegExp][] = [
  ["What is my collection rate this month?", /Collection for/],
  ["Who is overdue more than 30 days?", /overdue/],
  ["Which tenants are waiting for a renewal decision?", /renewal decision|No renewal/],
  ["Which building has the lowest occupancy?", /lowest occupancy/],
  ["Which apartments have been vacant the longest?", /empty longest/],
  ["Which building is most profitable?", /most profitable/],
  ["How much did Marina Residence make this year?", /Marina Residence year to date/],
  ["Which unit costs the most in maintenance?", /costs the most in maintenance/],
  ["How much did I spend on elevators this year?", /on elevator this year/],
  ["Which expense categories increased this month?", /categor/],
  ["What is my expected cash flow for the next 90 days?", /Next 90 days/],
  ["Which maintenance jobs are overdue?", /overdue|No maintenance job/],
  ["Which units have recurring plumbing problems?", /plumbing problems/],
  ["What assets need service this month?", /service|No preventive service/],
  ["Which supplier has the highest repeat-issue rate?", /repeat-issue rate|No supplier/],
  ["How much have I paid Schindler this year?", /Schindler Lebanon: /],
  ["Give me my daily briefing", /Today's briefing/],
  ["Remind me to call Karim next week", /set a reminder about Karim/],
  ["Create a work order for 403 in Beirut Heights", /prepared a work order/],
  ["What jobs are open?", /maintenance jobs are open/],
  ["How much do we hold in security deposits?", /deposits/],
  ["Remind me who hasn't paid this month", /owe|paid up/],
];

describe("assistant 2.0 — local answers", () => {
  for (const [question, expect] of QUESTIONS) {
    it(`answers "${question}" from the data`, () => {
      const a = answerLocally(question, seed(), ctx, "en");
      assert.ok(a, "answered locally");
      assert.ok(a.source === "local" || a.source === "scripted", `answered by the demo brain (${a.source})`);
      assert.match(a.text, expect);
      for (const act of a.actions ?? []) assert.ok(knownActionTarget(seed(), act.kind, act.targetId), `${act.kind} → ${act.targetId} exists`);
    });
  }

  it("answers the same questions in Arabic", () => {
    const s = seed();
    const a = answerLocally("شو نسبة التحصيل هالشهر؟", s, ctx);
    assert.ok(a && a.lang === "ar" && /التحصيل/.test(a.text), "collection in Arabic");
    const b = answerLocally("شو التدفق النقدي المتوقع للـ 90 يوم الجاية؟", s, ctx);
    assert.ok(b && b.lang === "ar" && /يوم/.test(b.text), "cash flow in Arabic");
    const c = answerLocally("أي صيانة متأخرة؟", s, ctx);
    assert.ok(c && c.lang === "ar", "maintenance in Arabic");
  });

  it("scopes to the building on screen", () => {
    const s = seed();
    const marina = s.properties.find((p) => p.name.startsWith("Marina"))!;
    const a = answerLocally("What is my collection rate this month?", s, { pathname: `/properties/${marina.id}`, propertyId: marina.id, propertyName: marina.name }, "en");
    assert.ok(a && a.text.includes("in Marina Residence"));
  });
});

describe("assistant 2.0 — tool layer", () => {
  const NEW_TOOLS = ["get_rent_roll", "get_collection_rate", "get_renewal_decisions", "get_building_performance", "get_unit_profitability", "get_expenses_summary", "get_maintenance_summary", "get_assets_due", "get_supplier_performance", "get_cash_flow_forecast", "get_briefing"];

  it("declares every new tool with a schema", () => {
    const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    for (const n of NEW_TOOLS) assert.ok(names.has(n), n);
    const answer = TOOL_DEFINITIONS.find((t) => t.name === "answer")!;
    const kinds = (answer.input_schema.properties.actions as { items: { properties: { kind: { enum: string[] } } } }).items.properties.kind.enum;
    for (const k of ["create_work_order", "create_reminder", "resolve_alert", "view_work_order", "view_supplier", "schedule_service"]) assert.ok(kinds.includes(k), k);
  });

  it("returns scoped, validated data from each new tool", () => {
    const s = seed();
    const marina = s.properties.find((p) => p.name.startsWith("Marina"))!;
    const rr = executeTool(s, "get_rent_roll", { property: "Marina" }, ctx) as { rows: unknown[]; summary: { collectionRate: number } };
    assert.ok(rr.rows.length > 0 && rr.rows.length <= s.units.filter((u) => u.propertyId === marina.id).length);
    const cr = executeTool(s, "get_collection_rate", {}, ctx) as { rate: number; history: unknown[] };
    assert.ok(cr.rate >= 0 && cr.rate <= 100 && cr.history.length === 6);
    const rd = executeTool(s, "get_renewal_decisions", {}, ctx) as unknown[];
    assert.ok(Array.isArray(rd));
    const bp = executeTool(s, "get_building_performance", { window: "ytd" }, ctx) as { rows: { propertyId: string }[] };
    assert.equal(bp.rows.length, s.properties.length);
    const up = executeTool(s, "get_unit_profitability", { property: "Marina", sort: "maintenance" }, ctx) as { unitId: string; maintenance: number }[];
    assert.ok(up.every((r) => s.units.find((u) => u.id === r.unitId)?.propertyId === marina.id));
    const ex = executeTool(s, "get_expenses_summary", { category: "elevator", period: "2026" }, ctx) as { total: number; byBuilding: unknown[] };
    assert.ok(ex.total >= 0 && Array.isArray(ex.byBuilding));
    const ms = executeTool(s, "get_maintenance_summary", {}, ctx) as { open: number; overdue: { workOrderId: string }[] };
    assert.ok(ms.open > 0 && Array.isArray(ms.overdue));
    const ad = executeTool(s, "get_assets_due", { days: 30 }, ctx) as { planId: string }[];
    assert.ok(ad.every((r) => s.preventivePlans.some((p) => p.id === r.planId)));
    const sp = executeTool(s, "get_supplier_performance", {}, ctx) as { supplierId: string }[];
    assert.equal(sp.length, s.suppliers.length);
    const one = executeTool(s, "get_supplier_performance", { supplier: "Schindler" }, ctx) as { supplierId: string; paidThisYear: number };
    assert.ok(one.supplierId && one.paidThisYear >= 0);
    const cf = executeTool(s, "get_cash_flow_forecast", { months: 3 }, ctx) as { months: unknown[]; totals: { net: number } };
    assert.equal(cf.months.length, 3);
    const br = executeTool(s, "get_briefing", {}, ctx) as { headline: string; sections: { key: string; items: unknown[] }[] };
    assert.ok(br.headline && br.sections.length === 5);
    assert.deepEqual(executeTool(s, "nope", {}, ctx), { error: "Unknown tool nope" });
  });

  it("validates action targets for the new kinds", () => {
    const s = seed();
    assert.ok(knownActionTarget(s, "view_work_order", s.workOrders[0].id));
    assert.ok(knownActionTarget(s, "view_supplier", s.suppliers[0].id));
    assert.ok(knownActionTarget(s, "schedule_service", s.preventivePlans[0].id));
    assert.ok(knownActionTarget(s, "create_work_order", s.units[0].id));
    assert.ok(knownActionTarget(s, "create_reminder", s.tenants[0].id));
    assert.ok(knownActionTarget(s, "resolve_alert", s.alerts[0].id));
    assert.ok(!knownActionTarget(s, "resolve_alert", "nope"));
    assert.ok(!knownActionTarget(s, "view_work_order", s.tenants[0].id));
  });
});
