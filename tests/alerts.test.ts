import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recordPayment, setAlertTypeMuted, snoozeAlert, unsnoozeAlert, updateThresholds } from "@/lib/commands";
import { recompute } from "@/lib/derived/recompute";
import { ALERT_RULES, ALERT_TYPES, THRESHOLD_FIELDS } from "@/lib/derived/alert-catalog";
import { getAlerts } from "@/lib/queries";
import { ALERT_CATEGORIES, type AlertType, type Store } from "@/types";

import { seedStore } from "./helpers";

let cached: Store | null = null;
const seed = (): Store => (cached ??= seedStore());

describe("alert catalog", () => {
  it("describes every alert type and every threshold", () => {
    const keys = Object.keys(seed().settings.thresholds).sort();
    assert.deepEqual(THRESHOLD_FIELDS.map((f) => f.key).sort(), keys, "every threshold has a field description");
    for (const t of ALERT_TYPES) {
      const r = ALERT_RULES[t];
      assert.ok(r.label && r.description, `${t} is documented`);
      assert.ok(ALERT_CATEGORIES.includes(r.category), `${t} category valid`);
      for (const k of r.thresholds) assert.ok(keys.includes(k), `${t} threshold ${k} exists`);
    }
  });

  it("matches the categories the engine actually emits", () => {
    for (const a of seed().alerts) assert.equal(a.category, ALERT_RULES[a.type].category, `${a.type} category`);
  });
});

describe("alert engine on the demo portfolio", () => {
  it("raises the scripted demo situations", () => {
    const s = seed();
    const types = new Set(s.alerts.filter((a) => !a.dismissed).map((a) => a.type));
    const expected: AlertType[] = ["payment_overdue", "payment_repeat_late", "contract_expires_30d", "occupancy_vacant_long", "maintenance_repeat_issue", "maintenance_emergency_open", "preventive_service_overdue", "budget_over", "renovation_over_budget", "renovation_delayed", "inspection_followup_open", "deposit_unsettled", "expense_overdue", "asset_out_of_service"];
    for (const t of expected) assert.ok(types.has(t), `seed raises ${t}`);
    const karim = s.tenants.find((t) => t.fullName.startsWith("Karim"))!;
    assert.ok(s.alerts.some((a) => a.type === "payment_overdue" && a.tenantId === karim.id), "Karim is overdue");
    assert.ok(s.alerts.some((a) => a.type === "contract_expires_30d" && a.tenantId === karim.id), "Karim's contract is ending");
  });

  it("keeps alert ids stable and resolves them when the condition clears", () => {
    const s = seed();
    const overdue = s.alerts.find((a) => a.type === "payment_overdue")!;
    const payment = s.payments.find((p) => p.id === overdue.entityId)!;
    const { store: paid } = recordPayment({ paymentId: payment.id, amount: payment.amountDue - payment.amountPaid, date: "2026-09-05", method: "cash", reference: null, note: null })(s);
    assert.ok(!paid.alerts.some((a) => a.id === overdue.id), "alert disappears once paid");
    const other = s.alerts.find((a) => a.type === "payment_overdue" && a.id !== overdue.id);
    if (other) assert.ok(paid.alerts.some((a) => a.id === other.id), "other alerts keep their ids");
  });
});

describe("muting, snoozing and thresholds", () => {
  it("muting hides a rule until it is enabled again — and is undoable", () => {
    const s = seed();
    assert.ok(s.alerts.some((a) => a.type === "payment_due_soon" || a.type === "payment_overdue"));
    const { store: muted, undo } = setAlertTypeMuted("payment_overdue", true)(s);
    assert.equal(muted.alerts.filter((a) => a.type === "payment_overdue").length, 0);
    assert.ok(muted.settings.mutedAlertTypes.includes("payment_overdue"));
    const back = undo!(muted);
    assert.ok(back.alerts.some((a) => a.type === "payment_overdue"));
    const { store: enabled } = setAlertTypeMuted("payment_overdue", false)(muted);
    assert.ok(enabled.alerts.some((a) => a.type === "payment_overdue"));
  });

  it("snoozed alerts leave the open list, survive recompute and wake up on time", () => {
    const s = seed();
    const target = getAlerts(s, { status: "open" })[0];
    const { store: snoozed } = snoozeAlert(target.id, "2026-09-12")(s);
    assert.ok(!getAlerts(snoozed, { status: "open" }).some((a) => a.id === target.id));
    assert.ok(getAlerts(snoozed, { status: "snoozed" }).some((a) => a.id === target.id));
    const again = recompute(snoozed);
    assert.equal(again.alerts.find((a) => a.id === target.id)?.snoozedUntil, "2026-09-12", "snooze preserved through recompute");
    assert.throws(() => snoozeAlert(target.id, "2026-09-01")(s), /future/);
    const { store: woken } = unsnoozeAlert(target.id)(snoozed);
    assert.ok(getAlerts(woken, { status: "open" }).some((a) => a.id === target.id));
    // A snooze that has passed is dropped on recompute.
    const expired = recompute({ ...snoozed, alerts: snoozed.alerts.map((a) => (a.id === target.id ? { ...a, snoozedUntil: "2026-09-01" } : a)) });
    assert.equal(expired.alerts.find((a) => a.id === target.id)?.snoozedUntil, null);
  });

  it("changing a threshold recomputes the alerts", () => {
    const s = seed();
    const before = s.alerts.filter((a) => a.type === "occupancy_vacant_long" || a.type === "occupancy_vacant_critical").length;
    const { store: strict } = updateThresholds({ vacantWarningDays: 1, vacantCriticalDays: 2 })(s);
    const after = strict.alerts.filter((a) => a.type === "occupancy_vacant_long" || a.type === "occupancy_vacant_critical").length;
    assert.ok(after >= before, "tighter vacancy rules raise at least as many alerts");
    const { store: lax } = updateThresholds({ vacantWarningDays: 3650, vacantCriticalDays: 3650 })(s);
    assert.equal(lax.alerts.filter((a) => a.type === "occupancy_vacant_long").length, 0);
  });
});
