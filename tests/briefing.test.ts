import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { briefingAsText, getDailyBriefing } from "@/lib/derived/briefing";
import type { Store } from "@/types";

import { seedStore, TODAY } from "./helpers";

let cached: Store | null = null;
const seed = (): Store => (cached ??= seedStore());

describe("daily briefing", () => {
  it("assembles decisions, money, calendar, operations and good news from the demo portfolio", () => {
    const b = getDailyBriefing(seed(), TODAY);
    assert.equal(b.date, TODAY);
    assert.ok(b.headline.length > 10);
    assert.ok(b.narrative.length >= 3, "narrative paragraphs");
    const by = Object.fromEntries(b.sections.map((s) => [s.key, s.items]));
    assert.ok(by.decide.some((i) => i.title.startsWith("Approve")), "quote awaiting approval");
    assert.ok(by.money.some((i) => i.title.includes("Karim") && i.title.includes("overdue")), "Karim overdue in Money");
    assert.ok(by.operations.some((i) => i.title.startsWith("Emergency open")), "generator emergency in Operations");
    assert.ok(by.operations.some((i) => i.title.includes("empty")), "long vacancy in Operations");
    assert.ok(by.today.some((i) => i.id.startsWith("plan-")), "overdue service on the calendar");
    for (const s of b.sections) for (const i of s.items) assert.ok(i.title && i.id, `${s.key} items have ids and titles`);
    assert.ok(b.numbers.dueThisMonth > 0);
    assert.ok(b.numbers.collectionRate >= 0 && b.numbers.collectionRate <= 1);
  });

  it("every action points at a record that exists", () => {
    const s = seed();
    const b = getDailyBriefing(s, TODAY);
    const known = new Set<string>([...s.payments, ...s.contracts, ...s.tenants, ...s.units, ...s.workOrders, ...s.assets, ...s.preventivePlans, ...s.inspections, ...s.deposits, ...s.renovations, ...s.expenses, ...s.keys].map((x) => x.id));
    for (const sec of b.sections) for (const i of sec.items) for (const a of i.actions) assert.ok(known.has(a.targetId), `${sec.key} · ${i.title} → ${a.kind} ${a.targetId}`);
  });

  it("renders as plain text with every non-empty section", () => {
    const b = getDailyBriefing(seed(), TODAY);
    const text = briefingAsText(b, "Succar Holdings");
    assert.ok(text.startsWith("Succar Holdings — daily briefing"));
    for (const s of b.sections) if (s.items.length > 0) assert.ok(text.includes(s.title.toUpperCase()), s.title);
    assert.ok(text.includes("Occupancy"));
  });
});
