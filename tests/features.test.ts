import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NAV_GROUPS } from "@/components/shell/nav";
import { answerLocally } from "@/lib/ai/demo-engine";
import { availableTools } from "@/lib/ai/tools";
import { getDailyBriefing } from "@/lib/derived/briefing";
import { getInsights } from "@/lib/derived/insights";
import { recompute } from "@/lib/derived/recompute";
import { actionVisible, alertTypeVisible, briefingItemVisible, featureOn, hiddenAlertTypes, hiddenTopicIn, hrefVisible, resetHiddenFeatures, routeFeature, setHiddenFeatures } from "@/lib/features";

import { seedStore, TODAY } from "./helpers";

describe("edition switches — the simple edition hides everything from Budgets to Reports", () => {
  afterEach(() => setHiddenFeatures([]));

  it("maps routes and links to their section", () => {
    resetHiddenFeatures();
    assert.equal(routeFeature("/maintenance/wo-1"), "maintenance");
    assert.equal(routeFeature("/finance/cash-flow"), "cashflow");
    assert.equal(routeFeature("/analytics/performance?property=bh"), "analytics");
    assert.equal(routeFeature("/finance/expenses"), null);
    assert.equal(hrefVisible("/payments?status=overdue"), true);
    assert.equal(hrefVisible("/reports"), false);
    assert.equal(featureOn("maintenance"), false);
    assert.equal(featureOn("budgets"), false);
  });

  it("leaves only the friendly navigation", () => {
    resetHiddenFeatures();
    // NAV_GROUPS is computed at import time — with the default switches, as the app sees it.
    const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    for (const h of ["/finance/budgets", "/finance/deposits", "/finance/utilities", "/finance/charges", "/finance/cash-flow", "/maintenance", "/maintenance/preventive", "/suppliers", "/inspections", "/keys", "/parking", "/renovations", "/analytics", "/documents", "/reports"]) assert.ok(!hrefs.includes(h), `${h} should be hidden`);
    for (const h of ["/dashboard", "/properties", "/assets", "/tenants", "/contracts", "/alerts", "/finance/rent-roll", "/payments", "/finance/expenses", "/settings/import"]) assert.ok(hrefs.includes(h), `${h} should stay`);
    assert.ok(!NAV_GROUPS.some((g) => g.label === "Maintenance" || g.label === "Operations" || g.label === "Analytics"), "empty groups disappear");
  });

  it("parks alerts of hidden sections and strips their actions", () => {
    resetHiddenFeatures();
    assert.ok(hiddenAlertTypes().includes("maintenance_emergency_open"));
    assert.equal(alertTypeVisible("payment_overdue"), true);
    assert.equal(alertTypeVisible("budget_over"), false);
    assert.equal(actionVisible("create_work_order"), false);
    assert.equal(actionVisible("record_payment"), true);
    const store = recompute(seedStore());
    assert.ok(!store.alerts.some((a) => a.type.startsWith("maintenance_") || a.type.startsWith("document_") || a.type === "budget_over" || a.type === "key_lost"), "hidden types are not in the open list");
    assert.ok((store.mutedAlerts ?? []).some((a) => a.type === "maintenance_emergency_open"), "…but they are parked, not lost");
    assert.ok(store.alerts.some((a) => a.type === "asset_out_of_service"), "asset alerts stay (assets are visible)");
    assert.ok(store.alerts.every((a) => a.actions.every((x) => x.kind !== "create_work_order" && x.kind !== "view_supplier")), "no button leads into a hidden section");
    setHiddenFeatures([]);
    const full = recompute(seedStore());
    assert.ok(full.alerts.some((a) => a.type === "maintenance_emergency_open"), "with every section on, the engine is unchanged");
  });

  it("keeps the briefing and the insights inside the edition", () => {
    resetHiddenFeatures();
    const store = recompute(seedStore());
    const b = getDailyBriefing(store, TODAY);
    for (const s of b.sections) for (const i of s.items) assert.ok(briefingItemVisible(i.id) && !/^(wo|em|old|plan|dep|rn|insp|move|key)-/.test(i.id), `${i.id} belongs to a hidden section`);
    assert.ok(!b.narrative.some((n) => /emergenc/.test(n)), "no emergency talk without the maintenance section");
    for (const i of getInsights(store)) assert.ok(hrefVisible(i.href), `${i.href} is hidden`);
  });

  it("lets the assistant say no politely and hides the matching tools", () => {
    resetHiddenFeatures();
    assert.equal(hiddenTopicIn("which supplier has the highest repeat rate"), "suppliers");
    assert.equal(hiddenTopicIn("what is my cash flow forecast"), "cashflow");
    assert.equal(hiddenTopicIn("who hasn't paid this month"), null);
    const store = recompute(seedStore());
    const a = answerLocally("Which supplier has the highest repeat-issue rate?", store, { pathname: "/dashboard" });
    assert.ok(a && /not in this edition/.test(a.text), a?.text);
    const wo = answerLocally("create a work order for the elevator in Beirut Heights", store, { pathname: "/dashboard" });
    assert.ok(wo && /not in this edition/.test(wo.text), wo?.text);
    const ok = answerLocally("Who hasn't paid this month?", store, { pathname: "/dashboard" });
    assert.ok(ok && !/not in this edition/.test(ok.text));
    const sup = answerLocally("add supplier Ali Electric, electrical, phone 70 111 222", store, { pathname: "/dashboard" });
    assert.ok(sup && /not in this edition/.test(sup.text), "supplier creation is off with the section");
    const asset = answerLocally("register a Kone elevator in Marina Residence serial K-889", store, { pathname: "/dashboard" });
    assert.equal(asset?.actions?.[0]?.kind, "create_asset", "assets stay");
    assert.ok(availableTools().every((t) => t.name !== "get_supplier_performance" && t.name !== "get_cash_flow_forecast"), "tools of hidden sections are not offered");
  });
});
