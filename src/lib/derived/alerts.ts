import { ids } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addPeriods, currentPeriod, daysSince, daysUntil, nowISO, periodEnd, periodOf, previousPeriod } from "@/lib/date";
import { formatMoney, formatMonth, formatPercent } from "@/lib/format";
import type { Alert, AlertAction, AlertCategory, AlertEntityType, AlertSeverity, AlertType, Contract, ID, ISODate, Store } from "@/types";

import { isOccupying } from "./recompute";

/**
 * Alert engine — every rule in §4 of the implementation plan, computed from
 * the store on each recompute. Alerts are keyed `${type}:${entityId}` so they
 * update in place, never duplicate, and disappear the moment their condition
 * clears. Read / dismissed flags survive recomputes.
 */

type Candidate = Omit<Alert, "createdAt" | "read" | "dismissed">;

interface CandidateInput {
  type: AlertType;
  category: AlertCategory;
  severity: AlertSeverity;
  entityType: AlertEntityType;
  entityId: ID;
  title: string;
  message: string;
  actions: AlertAction[];
  weight: number;
  propertyId?: ID | null;
  unitId?: ID | null;
  tenantId?: ID | null;
}

function candidate(input: CandidateInput): Candidate {
  return {
    id: ids.alert(input.type, input.entityId),
    type: input.type,
    category: input.category,
    severity: input.severity,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    message: input.message,
    actions: input.actions,
    weight: Math.round(input.weight),
    propertyId: input.propertyId ?? null,
    unitId: input.unitId ?? null,
    tenantId: input.tenantId ?? null,
  };
}

const act = (kind: AlertAction["kind"], label: string, targetId: ID): AlertAction => ({ kind, label, targetId });

export function computeAlerts(store: Store, base: ISODate): Alert[] {
  const idx = indexStore(store);
  const t = store.settings.thresholds;
  const out: Candidate[] = [];

  const unitLabel = (unitId: ID): string => {
    const u = idx.unitById.get(unitId);
    const p = u ? idx.propertyById.get(u.propertyId) : undefined;
    return u && p ? `${p.name} · ${u.unitNumber}` : unitId;
  };
  const tenantName = (tenantId: ID): string => idx.tenantById.get(tenantId)?.fullName ?? "Tenant";

  /* ------------------------------ Payments ------------------------------ */

  const expiringSoonByTenant = new Set<ID>();
  for (const c of store.contracts) {
    if (isOccupying(c)) {
      const d = daysUntil(c.endDate);
      if (d >= 0 && d <= t.contractWarningDays) expiringSoonByTenant.add(c.tenantId);
    }
  }

  for (const p of store.payments) {
    const name = tenantName(p.tenantId);
    const where = unitLabel(p.unitId);
    const outstanding = p.amountDue - p.amountPaid;
    const link = { propertyId: p.propertyId, unitId: p.unitId, tenantId: p.tenantId };
    const paymentActions = [
      act("record_payment", "Record payment", p.id),
      act("send_reminder", "Send reminder", p.tenantId),
      act("view_unit", "View unit", p.unitId),
    ];

    if (p.status === "overdue") {
      out.push(
        candidate({
          type: "payment_overdue",
          category: "payment",
          severity: "critical",
          entityType: "payment",
          entityId: p.id,
          title: `Rent overdue — ${name}`,
          message: `${where} · ${formatMoney(outstanding)} due for ${formatMonth(p.periodMonth)} · ${p.daysLate} days overdue`,
          actions: paymentActions,
          // Overdue and about to expire is the decision that can't wait.
          weight: outstanding + p.daysLate * 50 + (expiringSoonByTenant.has(p.tenantId) ? 5_000 : 0),
          ...link,
        }),
      );
    } else if (p.status === "partial" && p.dueDate < base) {
      out.push(
        candidate({
          type: "payment_partial",
          category: "payment",
          severity: "critical",
          entityType: "payment",
          entityId: p.id,
          title: `Partial payment — ${name}`,
          message: `${where} · ${formatMoney(p.amountPaid)} of ${formatMoney(p.amountDue)} paid · ${formatMoney(outstanding)} outstanding · ${p.daysLate} days`,
          actions: paymentActions,
          weight: outstanding + p.daysLate * 50 + (expiringSoonByTenant.has(p.tenantId) ? 5_000 : 0),
          ...link,
        }),
      );
    } else if (p.status === "due") {
      const inDays = daysUntil(p.dueDate);
      if (inDays === 0) {
        out.push(
          candidate({
            type: "payment_due_today",
            category: "payment",
            severity: "warning",
            entityType: "payment",
            entityId: p.id,
            title: `Rent due today — ${name}`,
            message: `${where} · ${formatMoney(p.amountDue)} for ${formatMonth(p.periodMonth)}`,
            actions: [act("record_payment", "Record payment", p.id), act("send_reminder", "Send reminder", p.tenantId)],
            weight: p.amountDue,
            ...link,
          }),
        );
      } else if (inDays > 0 && inDays <= t.paymentDueSoonDays) {
        out.push(
          candidate({
            type: "payment_due_soon",
            category: "payment",
            severity: "warning",
            entityType: "payment",
            entityId: p.id,
            title: `Rent due in ${inDays} day${inDays === 1 ? "" : "s"} — ${name}`,
            message: `${where} · ${formatMoney(p.amountDue)} for ${formatMonth(p.periodMonth)}`,
            actions: [act("record_payment", "Record payment", p.id), act("send_reminder", "Send reminder", p.tenantId)],
            weight: p.amountDue - inDays,
            ...link,
          }),
        );
      }
    }
  }

  // Repeat late payers: late in ≥ N of the last M months.
  const windowStart = addPeriods(currentPeriod(), -(t.repeatLateWindowMonths - 1));
  for (const tenant of store.tenants) {
    const current = (idx.contractsByTenant.get(tenant.id) ?? []).find(isOccupying);
    if (!current) continue;
    const inWindow = (idx.paymentsByTenant.get(tenant.id) ?? []).filter((p) => p.periodMonth >= windowStart && p.periodMonth <= currentPeriod());
    const late = inWindow.filter((p) => (p.status === "paid" && p.daysLate > 0) || p.status === "overdue" || p.status === "partial");
    if (late.length < t.repeatLateMinCount) continue;
    const lateDays = late.map((p) => p.daysLate).filter((d) => d > 0);
    const avg = lateDays.length > 0 ? Math.round(lateDays.reduce((a, b) => a + b, 0) / lateDays.length) : 0;
    const outstanding = late.reduce((n, p) => n + Math.max(0, p.amountDue - p.amountPaid), 0);
    out.push(
      candidate({
        type: "payment_repeat_late",
        category: "payment",
        severity: "critical",
        entityType: "tenant",
        entityId: tenant.id,
        title: `Repeat late payer — ${tenant.fullName}`,
        message: `${unitLabel(current.unitId)} · late ${late.length} of the last ${t.repeatLateWindowMonths} months · avg ${avg} days late${outstanding > 0 ? ` · ${formatMoney(outstanding)} outstanding now` : ""}`,
        actions: [act("view_tenant", "View tenant", tenant.id), act("send_reminder", "Send reminder", tenant.id)],
        weight: 2_000 + late.length * 300 + outstanding,
        propertyId: current.propertyId,
        unitId: current.unitId,
        tenantId: tenant.id,
      }),
    );
  }

  /* ------------------------------ Contracts ----------------------------- */

  const expiringByPeriod = new Map<string, number>();

  for (const c of store.contracts) {
    if (!isOccupying(c)) continue;
    const name = tenantName(c.tenantId);
    const where = unitLabel(c.unitId);
    const link = { propertyId: c.propertyId, unitId: c.unitId, tenantId: c.tenantId };
    const renewActions = [act("renew_contract", "Renew", c.id), act("mark_as_leaving", "Mark as leaving", c.id), act("view_unit", "View unit", c.unitId)];
    const d = daysUntil(c.endDate);

    if (c.status === "expired" || d < 0) {
      out.push(
        candidate({
          type: "contract_expired_occupied",
          category: "contract",
          severity: "critical",
          entityType: "contract",
          entityId: c.id,
          title: `Contract expired — ${name} still in ${idx.unitById.get(c.unitId)?.unitNumber ?? "unit"}`,
          message: `${where} · ended ${Math.abs(d)} days ago · ${formatMoney(c.monthlyRent)}/month`,
          actions: renewActions,
          weight: 4_000 + Math.abs(d) * 20 + c.monthlyRent,
          ...link,
        }),
      );
      continue;
    }

    if (d <= t.contractInfoDays) expiringByPeriod.set(periodOf(c.endDate), (expiringByPeriod.get(periodOf(c.endDate)) ?? 0) + 1);

    let type: AlertType | null = null;
    let severity: AlertSeverity = "info";
    if (d <= t.contractCriticalDays) {
      type = "contract_expires_7d";
      severity = "critical";
    } else if (d <= t.contractWarningDays) {
      type = "contract_expires_30d";
      severity = "warning";
    } else if (d <= 60) {
      type = "contract_expires_60d";
      severity = "info";
    } else if (d <= t.contractInfoDays) {
      type = "contract_expires_90d";
      severity = "info";
    }
    if (!type) continue;

    const hasOverdue = (idx.paymentsByContract.get(c.id) ?? []).some((p) => p.status === "overdue" || p.status === "partial");
    out.push(
      candidate({
        type,
        category: "contract",
        severity,
        entityType: "contract",
        entityId: c.id,
        title: `Contract ends in ${d} day${d === 1 ? "" : "s"} — ${name}`,
        message: `${where} · ${formatMoney(c.monthlyRent)}/month · ends ${c.endDate}${hasOverdue ? " · also has overdue rent" : ""}`,
        actions: renewActions,
        weight: c.monthlyRent + Math.max(0, t.contractInfoDays - d) * 20 + (hasOverdue ? 1_500 : 0),
        ...link,
      }),
    );
  }

  /* ------------------------------ Occupancy ----------------------------- */

  for (const u of store.units) {
    if (u.status !== "available") continue;
    const property = idx.propertyById.get(u.propertyId);
    if (!property) continue;
    const askingRent = u.askingRent || u.lastRent || 0;
    const prev = u.previousTenantId ? idx.tenantById.get(u.previousTenantId)?.fullName : null;
    const link = { propertyId: u.propertyId, unitId: u.id };

    if (u.availableSince === null) continue;
    const days = daysSince(u.availableSince);

    if (days > t.vacantWarningDays) {
      const critical = days > t.vacantCriticalDays;
      out.push(
        candidate({
          type: critical ? "occupancy_vacant_critical" : "occupancy_vacant_long",
          category: "occupancy",
          severity: critical ? "critical" : "warning",
          entityType: "unit",
          entityId: u.id,
          title: `Vacant ${days} days — ${property.name} ${u.unitNumber}`,
          message: `Asking ${formatMoney(askingRent)}/month${prev ? ` · previous tenant ${prev}` : ""} · ${formatMoney(Math.round((askingRent / 30) * days))} of rent missed so far`,
          actions: [act("view_unit", "View unit", u.id)],
          weight: (askingRent / 30) * days,
          ...link,
        }),
      );
    } else if (days >= 0 && days <= 7) {
      out.push(
        candidate({
          type: "occupancy_unit_available",
          category: "occupancy",
          severity: "info",
          entityType: "unit",
          entityId: u.id,
          title: `Unit became available — ${property.name} ${u.unitNumber}`,
          message: `Available since ${u.availableSince}${prev ? ` · ${prev} moved out` : ""} · asking ${formatMoney(askingRent)}/month`,
          actions: [act("view_unit", "View unit", u.id)],
          weight: askingRent,
          ...link,
        }),
      );
    }
  }

  for (const property of store.properties) {
    const units = (idx.unitsByProperty.get(property.id) ?? []).filter((u) => u.status !== "maintenance");
    if (units.length === 0) continue;
    const rented = units.filter((u) => u.status === "rented").length;
    const occupancy = rented / units.length;
    if (occupancy < t.buildingOccupancyWarning) {
      const vacant = units.length - rented;
      const avgRent = units.reduce((n, u) => n + (u.askingRent || u.lastRent || 0), 0) / units.length;
      out.push(
        candidate({
          type: "occupancy_building_low",
          category: "occupancy",
          severity: "warning",
          entityType: "property",
          entityId: property.id,
          title: `Low occupancy — ${property.name}`,
          message: `${formatPercent(occupancy)} occupied · ${vacant} of ${units.length} units vacant · below the ${formatPercent(t.buildingOccupancyWarning)} target`,
          actions: [act("view_property", "View building", property.id)],
          weight: vacant * avgRent,
          propertyId: property.id,
        }),
      );
    }
  }

  /* ------------------------------ Documents ----------------------------- */

  for (const tenant of store.tenants) {
    const current = (idx.contractsByTenant.get(tenant.id) ?? []).find(isOccupying);
    if (!current) continue;
    const docs = idx.documentsByTenant.get(tenant.id) ?? [];
    const link = { propertyId: current.propertyId, unitId: current.unitId, tenantId: tenant.id };

    if (!tenant.idNumber) {
      out.push(
        candidate({
          type: "document_missing_id",
          category: "document",
          severity: "warning",
          entityType: "tenant",
          entityId: tenant.id,
          title: `No ID on file — ${tenant.fullName}`,
          message: `${unitLabel(current.unitId)} · no ID or passport number recorded`,
          actions: [act("upload_document", "Upload ID", tenant.id), act("view_tenant", "View tenant", tenant.id)],
          weight: 100,
          ...link,
        }),
      );
    }

    const hasContractDoc = docs.some((d) => d.kind === "contract" && (d.contractId === current.id || d.contractId === null));
    if (!hasContractDoc && Math.abs(daysUntil(current.startDate)) <= 30) {
      out.push(
        candidate({
          type: "document_missing_contract",
          category: "document",
          severity: "warning",
          entityType: "contract",
          entityId: current.id,
          title: `Contract not uploaded — ${tenant.fullName}`,
          message: `${unitLabel(current.unitId)} · contract ${current.contractNumber} starts ${current.startDate} · no signed copy on file`,
          actions: [act("upload_document", "Upload contract", current.id), act("view_contract", "View contract", current.id)],
          weight: 80,
          ...link,
        }),
      );
    }

    for (const d of docs) {
      if ((d.kind !== "id" && d.kind !== "passport") || !d.expiryDate) continue;
      const inDays = daysUntil(d.expiryDate);
      if (inDays <= t.idExpiringDays) {
        out.push(
          candidate({
            type: "document_id_expiring",
            category: "document",
            severity: "info",
            entityType: "tenant",
            entityId: `${tenant.id}:${d.id}`,
            title: `${d.kind === "passport" ? "Passport" : "ID"} ${inDays < 0 ? "expired" : "expiring"} — ${tenant.fullName}`,
            message: `${d.title} ${inDays < 0 ? `expired ${Math.abs(inDays)} days ago` : `expires in ${inDays} days`} (${d.expiryDate})`,
            actions: [act("upload_document", "Upload new copy", tenant.id), act("view_tenant", "View tenant", tenant.id)],
            weight: 60 - inDays,
            ...link,
          }),
        );
      }
    }
  }

  /* ------------------------------ Portfolio ----------------------------- */

  let outstandingTotal = 0;
  let outstandingCount = 0;
  const outstandingByProperty = new Map<ID, number>();
  for (const p of store.payments) {
    if (p.status !== "overdue" && p.status !== "partial") continue;
    const amt = p.amountDue - p.amountPaid;
    outstandingTotal += amt;
    outstandingCount++;
    outstandingByProperty.set(p.propertyId, (outstandingByProperty.get(p.propertyId) ?? 0) + amt);
  }
  if (outstandingTotal > t.outstandingWarning) {
    const top = [...outstandingByProperty.entries()].sort((a, b) => b[1] - a[1])[0];
    const topName = top ? idx.propertyById.get(top[0])?.name : null;
    out.push(
      candidate({
        type: "portfolio_outstanding_high",
        category: "portfolio",
        severity: "warning",
        entityType: "portfolio",
        entityId: "outstanding",
        title: `Outstanding rent above ${formatMoney(t.outstandingWarning)}`,
        message: `${formatMoney(outstandingTotal)} across ${outstandingCount} payments${topName && top ? ` · ${topName} holds ${formatPercent(top[1] / outstandingTotal)}` : ""}`,
        actions: [],
        weight: outstandingTotal,
      }),
    );
  }

  for (const [period, count] of expiringByPeriod) {
    if (count >= t.expiryClusterCount) {
      out.push(
        candidate({
          type: "portfolio_expiry_cluster",
          category: "portfolio",
          severity: "warning",
          entityType: "portfolio",
          entityId: `expiry:${period}`,
          title: `${count} contracts expire in ${formatMonth(period)}`,
          message: `A renewal wave — start conversations early to avoid a vacancy spike.`,
          actions: [],
          weight: count * 500,
        }),
      );
    }
  }

  const rentRollNow = rentRoll(store.contracts, base);
  const rentRollPrev = rentRoll(store.contracts, periodEnd(previousPeriod(periodOf(base))));
  if (rentRollPrev > 0 && rentRollNow < rentRollPrev) {
    out.push(
      candidate({
        type: "portfolio_revenue_down",
        category: "portfolio",
        severity: "info",
        entityType: "portfolio",
        entityId: "revenue",
        title: "Monthly revenue down vs last month",
        message: `${formatMoney(rentRollNow)} now vs ${formatMoney(rentRollPrev)} at the end of last month (${formatMoney(rentRollNow - rentRollPrev)})`,
        actions: [],
        weight: rentRollPrev - rentRollNow,
      }),
    );
  }

  /* ------------------------------- Merge -------------------------------- */

  const previous = new Map(store.alerts.map((a) => [a.id, a]));
  const now = nowISO();
  const seen = new Set<string>();
  const merged: Alert[] = [];
  for (const c of out) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const p = previous.get(c.id);
    merged.push({ ...c, createdAt: p?.createdAt ?? now, read: p?.read ?? false, dismissed: p?.dismissed ?? false });
  }
  return merged;
}

function occupyingAt(c: Contract, d: ISODate): boolean {
  if (c.startDate > d) return false;
  const leftOn = c.moveOutDate ?? (isOccupying(c) ? null : c.endDate);
  return leftOn === null || leftOn >= d;
}

function rentRoll(contracts: Contract[], d: ISODate): number {
  const seen = new Set<ID>();
  let total = 0;
  for (const c of contracts) {
    if (seen.has(c.unitId) || !occupyingAt(c, d)) continue;
    seen.add(c.unitId);
    total += c.monthlyRent;
  }
  return total;
}
