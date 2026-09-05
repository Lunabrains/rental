import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getInsights } from "@/lib/derived/insights";
import { searchAll } from "@/lib/queries";
import type { Store } from "@/types";

import { seedStore, TODAY } from "./helpers";

let cached: Store | null = null;
const seed = (): Store => (cached ??= seedStore());

describe("global search", () => {
  it("finds suppliers, work orders, assets and documents as well as people and places", () => {
    const s = seed();
    const sup = searchAll(s, "schindler");
    assert.ok(sup.suppliers.some((x) => x.name.startsWith("Schindler")));
    const wo = s.workOrders[0];
    const byNumber = searchAll(s, wo.number.toLowerCase());
    assert.ok(byNumber.workOrders.some((x) => x.workOrder.id === wo.id), "work order by number");
    const byTitle = searchAll(s, wo.title.split(" ").slice(0, 2).join(" "));
    assert.ok(byTitle.workOrders.length > 0, "work order by title");
    const assets = searchAll(s, "generator");
    assert.ok(assets.assets.some((x) => x.asset.assetType === "generator"));
    const byQr = searchAll(s, s.assets[0].qrCode.toLowerCase());
    assert.ok(byQr.assets.some((x) => x.asset.id === s.assets[0].id), "asset by QR code");
    const docs = searchAll(s, "lease");
    assert.ok(docs.documents.length > 0 && docs.documents.every((d) => !d.document.deleted));
    const tenants = searchAll(s, "karim");
    assert.ok(tenants.tenants.length > 0);
    assert.equal(searchAll(s, "").total, 0);
    const all = searchAll(s, "a", 3);
    assert.ok(all.suppliers.length <= 3 && all.workOrders.length <= 3 && all.assets.length <= 3 && all.documents.length <= 3, "limit applies per group");
    assert.equal(all.total, all.tenants.length + all.units.length + all.properties.length + all.contracts.length + all.suppliers.length + all.workOrders.length + all.assets.length + all.documents.length);
  });
});

describe("dashboard insights", () => {
  it("returns three to five specific insights, each linked to a screen", () => {
    const s = seed();
    const list = getInsights(s, TODAY);
    assert.ok(list.length >= 3 && list.length <= 5, `got ${list.length}`);
    assert.equal(new Set(list.map((i) => i.id)).size, list.length, "unique");
    for (const i of list) {
      assert.ok(i.href.startsWith("/"), i.id);
      assert.ok(i.text.length > 20 && i.source.length > 0, i.id);
    }
    for (let k = 1; k < list.length; k++) assert.ok(list[k - 1].weight >= list[k].weight, "ranked by weight");
    assert.ok(list.some((i) => i.id.startsWith("repeat-") || i.id === "expiring-30" || i.id === "owing-60"), "the demo cast shows up");
  });

  it("respects the limit", () => {
    assert.ok(getInsights(seed(), TODAY, 3).length <= 3);
  });
});
