import { indexStore } from "@/lib/data/store";
import { addDaysISO, daysSince, daysUntil, periodOf, today } from "@/lib/date";
import { collectionRate } from "@/lib/derived/metrics";
import { generateIntelligence } from "@/lib/derived/intelligence";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatDate, formatMoney, formatPercent, labelize } from "@/lib/format";
import { getCashFlowForecast, getDeposits, getExpiringContracts, getInspections, getMoves, getOverduePayments, getPortfolioOverview, getPreventivePlans, getRenovations, getUpcomingPayments, getWorkOrders } from "@/lib/queries";
import type { AlertAction, AlertSeverity, ISODate, Store } from "@/types";

export type BriefingTone = AlertSeverity | "success" | "neutral";

export interface BriefingItem {
  id: string;
  title: string;
  detail: string;
  tone: BriefingTone;
  amount?: number;
  date?: ISODate;
  actions: AlertAction[];
}

export type BriefingSectionKey = "decide" | "money" | "today" | "operations" | "good_news";

export interface BriefingSection {
  key: BriefingSectionKey;
  title: string;
  description: string;
  items: BriefingItem[];
}

export interface DailyBriefing {
  date: ISODate;
  headline: string;
  /** Plain-language paragraphs — the same facts as the sections, in prose. */
  narrative: string[];
  numbers: {
    occupancy: number;
    collectedThisMonth: number;
    dueThisMonth: number;
    collectionRate: number;
    outstanding: number;
    criticalAlerts: number;
    net30: number;
  };
  sections: BriefingSection[];
}

const act = (kind: AlertAction["kind"], label: string, targetId: string): AlertAction => ({ kind, label, targetId });
const plural = (n: number, word: string, pluralWord?: string) => `${n} ${n === 1 ? word : (pluralWord ?? `${word}s`)}`;

/**
 * The owner's daily briefing (plan §Phase 14): what to decide, what money moves,
 * what happens today and this week, what is stuck, and what went well. Built
 * from the same queries as the screens — no figure appears here that cannot be
 * clicked through to its record.
 */
export function getDailyBriefing(store: Store, base: ISODate = today()): DailyBriefing {
  const idx = indexStore(store);
  const t = store.settings.thresholds;
  const overview = getPortfolioOverview(store, base);
  const brief = generateIntelligence(store, base);
  const weekEnd = addDaysISO(base, 7);
  const name = (id: string | null) => (id ? idx.tenantById.get(id)?.fullName ?? "Tenant" : "—");
  const place = (pid: string, uid: string | null) => `${idx.propertyById.get(pid)?.name ?? ""}${uid ? ` ${idx.unitById.get(uid)?.unitNumber ?? ""}` : ""}`.trim();

  /* ------------------------------ Decide today ----------------------------- */
  const decide: BriefingItem[] = [];
  for (const w of getWorkOrders(store, { status: "open" }, base).filter((w) => w.workOrder.status === "awaiting_approval")) {
    decide.push({ id: `wo-${w.workOrder.id}`, title: `Approve ${w.workOrder.number} — ${w.workOrder.title}`, detail: `${place(w.workOrder.propertyId, w.workOrder.unitId)} · ${w.supplier?.name ?? "no supplier"} · quote ${w.workOrder.estimatedCost ? formatMoney(w.workOrder.estimatedCost) : "pending"} · waiting ${w.ageDays} days`, tone: w.workOrder.priority === "emergency" ? "critical" : "warning", amount: w.workOrder.estimatedCost ?? undefined, actions: [act("approve_work_order", "Approve", w.workOrder.id), act("view_work_order", "Open", w.workOrder.id)] });
  }
  for (const c of getExpiringContracts(store, t.contractWarningDays, undefined, base).filter((r) => r.contract.status !== "notice_given" && r.contract.moveOutDate === null && (r.contract.renewalStatus === "awaiting_decision" || (r.contract.renewalDecision === null && r.daysRemaining <= t.contractWarningDays)))) {
    decide.push({ id: `renew-${c.contract.id}`, title: `Renewal decision — ${c.tenant.fullName}`, detail: `${c.property.name} ${c.unit.unitNumber} · ${formatMoney(c.contract.monthlyRent)}/month · ends ${formatDate(c.contract.endDate)} (${c.daysRemaining} days)${c.hasOverdue ? " · currently overdue" : c.reliable ? " · always on time" : ""}`, tone: c.daysRemaining <= 7 ? "critical" : "warning", date: c.contract.endDate, actions: [act("renew_contract", "Renew", c.contract.id), act("mark_as_leaving", "Leaving", c.contract.id), act("view_tenant", "Tenant", c.tenant.id)] });
  }
  for (const d of getDeposits(store, {}).filter((r) => r.tenancyEnded && r.deposit.status !== "settled")) {
    decide.push({ id: `dep-${d.deposit.id}`, title: `Settle deposit — ${d.tenant.fullName}`, detail: `${d.property.name} ${d.unit.unitNumber} · ${formatMoney(d.deposit.amountHeld)} held · tenancy ended ${formatDate(d.endedOn)}${d.deducted > 0 ? ` · ${formatMoney(d.deducted)} deducted so far` : ""}`, tone: "warning", amount: d.deposit.amountHeld, actions: [act("settle_deposit", "Settle", d.deposit.id)] });
  }
  for (const r of getRenovations(store, { status: "live" }, base).filter((r) => r.variance > 0 || r.delayed)) {
    decide.push({ id: `rn-${r.renovation.id}`, title: `${r.variance > 0 ? "Over budget" : "Behind schedule"} — ${r.renovation.title}`, detail: `${r.property.name}${r.unit ? ` ${r.unit.unitNumber}` : ""} · ${formatMoney(r.renovation.actualCost)} of ${formatMoney(r.renovation.budget)} · ${r.renovation.progressPercent}%${r.delayed ? ` · ${Math.abs(r.daysToTarget)} days past target` : ""}`, tone: r.variance > 0 ? "warning" : "attention", actions: [act("view_renovation", "Open project", r.renovation.id)] });
  }

  /* --------------------------------- Money --------------------------------- */
  const money: BriefingItem[] = [];
  const overdue = getOverduePayments(store);
  for (const p of overdue.slice(0, 8)) {
    money.push({ id: `pay-${p.payment.id}`, title: `${p.tenant.fullName} — ${formatMoney(p.outstanding)} overdue`, detail: `${p.property.name} ${p.unit.unitNumber} · due ${formatDate(p.payment.dueDate)} · ${daysSince(p.payment.dueDate)} days late`, tone: daysSince(p.payment.dueDate) > 14 ? "critical" : "warning", amount: p.outstanding, date: p.payment.dueDate, actions: [act("record_payment", "Record payment", p.payment.id), act("send_reminder", "Remind", p.payment.id)] });
  }
  const dueToday = getUpcomingPayments(store, 0, undefined, base).filter((p) => p.payment.dueDate === base);
  for (const p of dueToday) money.push({ id: `due-${p.payment.id}`, title: `${p.tenant.fullName} — ${formatMoney(p.outstanding)} due today`, detail: `${p.property.name} ${p.unit.unitNumber}`, tone: "attention", amount: p.outstanding, date: p.payment.dueDate, actions: [act("record_payment", "Record payment", p.payment.id)] });
  const invoices = store.expenses.filter((e) => !e.deleted && e.paymentStatus !== "paid" && (e.dueDate ?? e.expenseDate) <= weekEnd).sort((a, b) => ((a.dueDate ?? a.expenseDate) < (b.dueDate ?? b.expenseDate) ? -1 : 1));
  for (const e of invoices.slice(0, 6)) {
    const due = e.dueDate ?? e.expenseDate;
    money.push({ id: `inv-${e.id}`, title: `${e.description} — ${formatMoney(e.amount)}`, detail: `${place(e.propertyId, e.unitId)} · ${e.supplierId ? idx.supplierById.get(e.supplierId)?.name ?? "supplier" : labelize(e.category)} · ${due < base ? `overdue since ${formatDate(due)}` : `due ${formatDate(due)}`}`, tone: due < base ? "warning" : "neutral", amount: e.amount, date: due, actions: [act("record_expense_payment", "Mark paid", e.id)] });
  }

  /* ----------------------------- Today & this week ------------------------- */
  const week: BriefingItem[] = [];
  for (const m of getMoves(store, base).filter((m) => m.daysUntil >= -1 && m.daysUntil <= 7)) {
    const done = m.steps.filter((s) => s.done).length;
    week.push({ id: `move-${m.kind}-${m.contract.id}`, title: `${m.kind === "move_out" ? "Move-out" : "Move-in"} — ${m.tenant.fullName}`, detail: `${m.property.name} ${m.unit.unitNumber} · ${m.daysUntil === 0 ? "today" : m.daysUntil < 0 ? "yesterday" : `in ${m.daysUntil} days`} · ${done}/${m.steps.length} steps done`, tone: m.inspection ? "attention" : "warning", date: m.date, actions: m.inspection ? [act("view_inspection", "Checklist", m.inspection.inspection.id)] : [act("schedule_inspection", "Schedule checklist", m.contract.id)] });
  }
  for (const i of getInspections(store, {}, base).filter((r) => (r.inspection.status === "scheduled" || r.inspection.status === "in_progress") && (r.overdue || r.inspection.scheduledDate <= weekEnd))) {
    week.push({ id: `insp-${i.inspection.id}`, title: `${labelize(i.inspection.type)} inspection — ${i.property.name}${i.unit ? ` ${i.unit.unitNumber}` : ""}`, detail: `${i.overdue ? `overdue since ${formatDate(i.inspection.scheduledDate)}` : i.inspection.scheduledDate === base ? "today" : formatDate(i.inspection.scheduledDate)} · ${i.inspection.inspector}`, tone: i.overdue ? "warning" : "neutral", date: i.inspection.scheduledDate, actions: [act("view_inspection", "Open", i.inspection.id)] });
  }
  for (const p of getPreventivePlans(store, {}, base).filter((r) => r.state === "overdue" || (r.state === "due_soon" && r.daysUntil <= 7))) {
    week.push({ id: `plan-${p.plan.id}`, title: `${p.plan.maintenanceType} — ${p.asset?.name ?? p.property.name}`, detail: `${p.property.name} · ${p.state === "overdue" ? `${Math.abs(p.daysUntil)} days overdue` : p.daysUntil === 0 ? "due today" : `due in ${p.daysUntil} days`}${p.supplier ? ` · ${p.supplier.name}` : ""}${p.plan.estimatedCost ? ` · ~${formatMoney(p.plan.estimatedCost)}` : ""}`, tone: p.state === "overdue" ? "warning" : "neutral", date: p.plan.nextServiceDate, actions: [act("schedule_service", "Log service", p.plan.id)] });
  }
  for (const c of getExpiringContracts(store, 7, undefined, base)) {
    if (decide.some((d) => d.id === `renew-${c.contract.id}`)) continue;
    week.push({ id: `end-${c.contract.id}`, title: `Contract ends — ${c.tenant.fullName}`, detail: `${c.property.name} ${c.unit.unitNumber} · ${formatDate(c.contract.endDate)} · ${labelize(c.contract.renewalStatus)}`, tone: "attention", date: c.contract.endDate, actions: [act("view_tenant", "Tenant", c.tenant.id)] });
  }
  const dueWeek = getUpcomingPayments(store, 7, undefined, base).filter((p) => p.payment.dueDate > base);
  if (dueWeek.length > 0) {
    week.push({ id: "due-week", title: `${plural(dueWeek.length, "instalment")} due this week — ${formatMoney(dueWeek.reduce((n, p) => n + p.outstanding, 0))}`, detail: dueWeek.slice(0, 4).map((p) => `${p.tenant.fullName} ${formatDate(p.payment.dueDate)}`).join(" · ") + (dueWeek.length > 4 ? " · …" : ""), tone: "neutral", amount: dueWeek.reduce((n, p) => n + p.outstanding, 0), actions: [] });
  }
  week.sort((a, b) => ((a.date ?? "9") < (b.date ?? "9") ? -1 : 1));

  /* ------------------------------- Operations ------------------------------ */
  const ops: BriefingItem[] = [];
  const openOrders = getWorkOrders(store, { status: "open" }, base);
  for (const w of openOrders.filter((w) => w.workOrder.priority === "emergency")) {
    ops.push({ id: `em-${w.workOrder.id}`, title: `Emergency open ${w.ageDays} day${w.ageDays === 1 ? "" : "s"} — ${w.workOrder.title}`, detail: `${place(w.workOrder.propertyId, w.workOrder.unitId)} · ${labelize(w.workOrder.status)} · ${w.supplier?.name ?? "no supplier assigned"}`, tone: "critical", actions: [act("view_work_order", "Open", w.workOrder.id)] });
  }
  for (const w of openOrders.filter((w) => w.overdue && w.workOrder.priority !== "emergency").slice(0, 6)) {
    ops.push({ id: `old-${w.workOrder.id}`, title: `Open ${w.ageDays} days — ${w.workOrder.title}`, detail: `${place(w.workOrder.propertyId, w.workOrder.unitId)} · ${labelize(w.workOrder.status)} · ${w.supplier?.name ?? "no supplier"}`, tone: "warning", actions: [act("view_work_order", "Open", w.workOrder.id)] });
  }
  for (const a of store.assets.filter((x) => x.status === "out_of_service")) {
    ops.push({ id: `asset-${a.id}`, title: `${a.name} out of service`, detail: `${place(a.propertyId, a.unitId)} · ${labelize(a.assetType)}`, tone: "critical", actions: [act("view_asset", "Asset", a.id), act("create_work_order", "Raise work order", a.id)] });
  }
  for (const k of store.keys.filter((x) => x.status === "lost")) {
    ops.push({ id: `key-${k.id}`, title: `Key lost — ${labelize(k.type)} ${k.identifier}`, detail: `${place(k.propertyId, k.unitId)}${k.assignedTo ? ` · last held by ${k.assignedTo}` : ""}`, tone: "attention", actions: [act("view_keys", "Key register", k.id)] });
  }
  const vacantLong = store.units.filter((u) => u.status === "available" && u.availableSince && daysSince(u.availableSince) >= t.vacantWarningDays).sort((a, b) => (a.availableSince! < b.availableSince! ? -1 : 1));
  for (const u of vacantLong.slice(0, 4)) {
    ops.push({ id: `vac-${u.id}`, title: `${place(u.propertyId, u.id)} empty ${daysSince(u.availableSince!)} days`, detail: `${u.marketRent ? `asking ${formatMoney(u.marketRent)}/month` : "no asking rent set"}${u.lastRent ? ` · last rent ${formatMoney(u.lastRent)}` : ""}`, tone: daysSince(u.availableSince!) >= t.vacantCriticalDays ? "critical" : "warning", actions: [act("view_unit", "Unit", u.id)] });
  }

  /* -------------------------------- Good news ------------------------------ */
  const good: BriefingItem[] = [];
  const since = addDaysISO(base, -2);
  const received = store.payments.filter((p) => p.paidDate && p.paidDate > since && p.paidDate <= base);
  if (received.length > 0) good.push({ id: "received", title: `${formatMoney(received.reduce((n, p) => n + p.amountPaid, 0))} received in the last two days`, detail: received.slice(0, 4).map((p) => `${name(p.tenantId)} ${formatMoney(p.amountPaid)}`).join(" · ") + (received.length > 4 ? ` · +${received.length - 4} more` : ""), tone: "success", actions: [] });
  const completed = store.workOrders.filter((w) => w.completedAt && w.completedAt > addDaysISO(base, -7) && w.completedAt <= base);
  if (completed.length > 0) good.push({ id: "completed", title: `${plural(completed.length, "work order")} completed this week`, detail: completed.slice(0, 3).map((w) => w.title).join(" · ") + (completed.length > 3 ? " · …" : ""), tone: "success", actions: completed[0] ? [act("view_work_order", "Latest", completed[0].id)] : [] });
  const renewed = store.contracts.filter((c) => c.renewalDecision === "renew" && isOccupying(c) && daysUntil(c.endDate) <= 90);
  if (renewed.length > 0) good.push({ id: "renewing", title: `${plural(renewed.length, "tenant")} agreed to renew`, detail: renewed.slice(0, 4).map((c) => name(c.tenantId)).join(" · "), tone: "success", actions: [] });
  const starting = store.contracts.filter((c) => c.status === "active" && c.startDate > addDaysISO(base, -7) && c.startDate <= weekEnd);
  if (starting.length > 0) good.push({ id: "starting", title: `${plural(starting.length, "new tenancy", "new tenancies")} starting`, detail: starting.map((c) => `${name(c.tenantId)} · ${place(c.propertyId, c.unitId)} · ${formatDate(c.startDate)}`).join(" · "), tone: "success", actions: [] });
  const services = store.preventivePlans.filter((p) => p.lastServiceDate && p.lastServiceDate > addDaysISO(base, -7) && p.lastServiceDate <= base);
  if (services.length > 0) good.push({ id: "serviced", title: `${plural(services.length, "preventive service")} done this week`, detail: services.map((p) => p.maintenanceType).slice(0, 4).join(" · "), tone: "success", actions: [] });

  /* -------------------------------- Numbers -------------------------------- */
  const cr = collectionRate(store.payments, periodOf(base), base);
  const forecast = getCashFlowForecast(store, { months: 2 }, base);
  const horizon = addDaysISO(base, 30);
  const within = forecast.months.flatMap((m) => m.items).filter((i) => i.date <= horizon);
  const net30 = within.reduce((n, i) => n + (i.direction === "in" ? i.amount : -i.amount), 0);
  const numbers = {
    occupancy: overview.occupancy.current,
    collectedThisMonth: cr.collected,
    dueThisMonth: cr.due,
    collectionRate: cr.rate,
    outstanding: overview.outstanding.current,
    criticalAlerts: overview.criticalAlerts.total,
    net30,
  };

  /* ------------------------------- Narrative ------------------------------- */
  const narrative: string[] = [...brief.paragraphs];
  const bits: string[] = [];
  if (decide.length > 0) bits.push(`${plural(decide.length, "decision")} waiting for you`);
  if (overdue.length > 0) bits.push(`${plural(overdue.length, "tenant")} overdue for ${formatMoney(overdue.reduce((n, p) => n + p.outstanding, 0))}`);
  if (invoices.length > 0) bits.push(`${plural(invoices.length, "supplier invoice")} due this week`);
  const emergencies = openOrders.filter((w) => w.workOrder.priority === "emergency").length;
  if (emergencies > 0) bits.push(`${plural(emergencies, "emergency", "emergencies")} still open`);
  if (week.length > 0) bits.push(`${plural(week.length, "thing")} on the calendar this week`);
  if (bits.length > 0) narrative.push(`Today: ${bits.join(", ")}.`);
  if (good.length > 0) narrative.push(`On the bright side, ${good.map((g) => g.title.charAt(0).toLowerCase() + g.title.slice(1)).join("; ")}.`);
  narrative.push(`Collected ${formatMoney(cr.collected)} of ${formatMoney(cr.due)} due this month (${formatPercent(cr.rate)}); the next 30 days net out at ${numbers.net30 >= 0 ? "+" : ""}${formatMoney(numbers.net30)} before anything unexpected.`);

  const headline = decide.length > 0 ? `${plural(decide.length, "decision")} to make · ${plural(overdue.length, "tenant")} overdue · ${plural(emergencies, "emergency", "emergencies")} open` : overdue.length > 0 ? `${plural(overdue.length, "tenant")} overdue · ${formatPercent(overview.occupancy.current)} occupied · ${plural(week.length, "item")} this week` : `Quiet day · ${formatPercent(overview.occupancy.current)} occupied · ${plural(week.length, "item")} this week`;

  return {
    date: base,
    headline,
    narrative,
    numbers,
    sections: [
      { key: "decide", title: "Decide today", description: "Approvals, renewals, settlements and projects that need your call", items: decide },
      { key: "money", title: "Money", description: "Overdue rent, rent due today, supplier invoices this week", items: money },
      { key: "today", title: "Today & this week", description: "Moves, inspections, services, contract ends and instalments", items: week },
      { key: "operations", title: "Operations", description: "What is stuck, broken or sitting empty", items: ops },
      { key: "good_news", title: "Good news", description: "What went right recently", items: good },
    ],
  };
}

/** Plain-text version for copy / print / e-mail. */
export function briefingAsText(b: DailyBriefing, companyName: string): string {
  const lines: string[] = [`${companyName} — daily briefing, ${formatDate(b.date)}`, b.headline, ""];
  for (const p of b.narrative) lines.push(p, "");
  lines.push(`Occupancy ${formatPercent(b.numbers.occupancy)} · collected ${formatMoney(b.numbers.collectedThisMonth)} of ${formatMoney(b.numbers.dueThisMonth)} · outstanding ${formatMoney(b.numbers.outstanding)} · ${b.numbers.criticalAlerts} critical alerts`, "");
  for (const s of b.sections) {
    if (s.items.length === 0) continue;
    lines.push(s.title.toUpperCase());
    for (const i of s.items) lines.push(`- ${i.title}${i.detail ? ` (${i.detail})` : ""}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
