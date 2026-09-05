import { ids } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addDaysISO, addPeriods, currentPeriod, daysBetween, daysSince, daysUntil, lastPeriods, nowISO, periodEnd, periodOf, previousPeriod, today } from "@/lib/date";
import { formatMoney, formatMonth, formatPercent, labelize } from "@/lib/format";
import type {
  Alert,
  AlertAction,
  AlertCategory,
  AlertEntityType,
  AlertOrigin,
  AlertSeverity,
  AlertType,
  Contract,
  ID,
  ISODate,
  Store,
  WorkOrder,
} from "@/types";

import { budgetActual, budgetVariance, expensesFor, isOpenWorkOrder, isUnpaid, maintenanceSpend, noiFor, outstandingRent, sum } from "./metrics";
import { isOccupying, occupyingAt } from "./occupancy";

/**
 * Alert engine — deterministic business rules computed from the store on each
 * recompute. Alerts are keyed `${type}:${entityId}` so they update in place,
 * never duplicate, and disappear the moment their condition clears. Read /
 * dismissed / resolved flags survive recomputes. No LLM is involved: AI may
 * summarise these, never create them.
 */

type Candidate = Omit<Alert, "createdAt" | "read" | "dismissed" | "resolved" | "resolvedAt" | "snoozedUntil">;

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
  dueDate?: ISODate | null;
  generatedBy?: AlertOrigin;
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
    dueDate: input.dueDate ?? null,
    generatedBy: input.generatedBy ?? "rule",
  };
}

const act = (kind: AlertAction["kind"], label: string, targetId: ID): AlertAction => ({ kind, label, targetId });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function computeAlerts(store: Store, base: ISODate): Alert[] {
  return computeAlertSets(store, base).alerts;
}

/** Live alerts plus the ones parked because their rule is muted. */
export function computeAlertSets(store: Store, base: ISODate): { alerts: Alert[]; mutedAlerts: Alert[] } {
  const idx = indexStore(store);
  const t = store.settings.thresholds;
  const out: Candidate[] = [];

  const unitLabel = (unitId: ID | null): string => {
    if (!unitId) return "";
    const u = idx.unitById.get(unitId);
    const p = u ? idx.propertyById.get(u.propertyId) : undefined;
    return u && p ? `${p.name} · ${u.unitNumber}` : unitId;
  };
  const propertyName = (propertyId: ID): string => idx.propertyById.get(propertyId)?.name ?? "Building";
  const tenantName = (tenantId: ID): string => idx.tenantById.get(tenantId)?.fullName ?? "Tenant";
  const supplierName = (supplierId: ID | null): string | null => (supplierId ? idx.supplierById.get(supplierId)?.name ?? null : null);
  const where = (propertyId: ID, unitId: ID | null): string => (unitId ? unitLabel(unitId) : propertyName(propertyId));

  /* ------------------------------ Payments ------------------------------ */

  const expiringSoonByTenant = new Set<ID>();
  for (const c of store.contracts) {
    if (isOccupying(c)) {
      const d = daysUntil(c.endDate);
      if (d >= 0 && d <= t.contractWarningDays) expiringSoonByTenant.add(c.tenantId);
    }
  }

  const bucketLabel = (days: number): string => (days >= 90 ? "90+ days" : days >= 60 ? "60+ days" : days >= 30 ? "30+ days" : days >= 15 ? "15+ days" : days >= 7 ? "7+ days" : `${days} days`);

  for (const p of store.payments) {
    const name = tenantName(p.tenantId);
    const place = unitLabel(p.unitId);
    const outstanding = p.amountDue - p.amountPaid;
    const link = { propertyId: p.propertyId, unitId: p.unitId, tenantId: p.tenantId, dueDate: p.dueDate };
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
          severity: p.daysLate >= 7 ? "critical" : "warning",
          entityType: "payment",
          entityId: p.id,
          title: `Rent overdue ${bucketLabel(p.daysLate)} — ${name}`,
          message: `${place} · ${formatMoney(outstanding)} due for ${formatMonth(p.periodMonth)} · ${p.daysLate} days overdue`,
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
          message: `${place} · ${formatMoney(p.amountPaid)} of ${formatMoney(p.amountDue)} paid · ${formatMoney(outstanding)} outstanding · ${p.daysLate} days`,
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
            message: `${place} · ${formatMoney(p.amountDue)} for ${formatMonth(p.periodMonth)}`,
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
            severity: "attention",
            entityType: "payment",
            entityId: p.id,
            title: `Rent due in ${plural(inDays, "day")} — ${name}`,
            message: `${place} · ${formatMoney(p.amountDue)} for ${formatMonth(p.periodMonth)}`,
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
    const all = idx.paymentsByTenant.get(tenant.id) ?? [];
    const inWindow = all.filter((p) => p.periodMonth >= windowStart && p.periodMonth <= currentPeriod());
    const late = inWindow.filter((p) => (p.status === "paid" && p.daysLate > 0) || isUnpaid(p));
    if (late.length >= t.repeatLateMinCount) {
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

    // Unusually high balance: more than N months of rent outstanding.
    const balance = outstandingRent(all);
    if (balance > current.monthlyRent * t.tenantBalanceHighMonths) {
      out.push(
        candidate({
          type: "tenant_balance_high",
          category: "payment",
          severity: "critical",
          entityType: "tenant",
          entityId: tenant.id,
          title: `Balance above ${t.tenantBalanceHighMonths} months of rent — ${tenant.fullName}`,
          message: `${unitLabel(current.unitId)} · ${formatMoney(balance)} outstanding against ${formatMoney(current.monthlyRent)}/month`,
          actions: [act("view_tenant", "View tenant", tenant.id), act("send_reminder", "Send reminder", tenant.id)],
          weight: balance + 3_000,
          propertyId: current.propertyId,
          unitId: current.unitId,
          tenantId: tenant.id,
        }),
      );
    }
  }

  /* ------------------------------ Contracts ----------------------------- */

  const expiringByPeriod = new Map<string, number>();

  for (const c of store.contracts) {
    if (!isOccupying(c)) continue;
    const name = tenantName(c.tenantId);
    const place = unitLabel(c.unitId);
    const link = { propertyId: c.propertyId, unitId: c.unitId, tenantId: c.tenantId, dueDate: c.endDate };
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
          message: `${place} · ended ${Math.abs(d)} days ago · ${formatMoney(c.monthlyRent)}/month`,
          actions: renewActions,
          weight: 4_000 + Math.abs(d) * 20 + c.monthlyRent,
          ...link,
        }),
      );
      continue;
    }

    if (c.renewalStatus === "awaiting_decision") {
      out.push(
        candidate({
          type: "contract_renewal_pending",
          category: "contract",
          severity: "attention",
          entityType: "contract",
          entityId: c.id,
          title: `Renewal decision pending — ${name}`,
          message: `${place} · ends in ${plural(d, "day")} · ${formatMoney(c.monthlyRent)}/month${c.proposedRent ? ` · proposed ${formatMoney(c.proposedRent)}` : ""}`,
          actions: [act("renew_contract", "Renew", c.id), act("mark_as_leaving", "Do not renew", c.id), act("view_contract", "View contract", c.id)],
          weight: c.monthlyRent + Math.max(0, 90 - d) * 10,
          ...link,
        }),
      );
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
      severity = "attention";
    } else if (d <= t.contractInfoDays) {
      type = "contract_expires_90d";
      severity = "info";
    }
    if (!type) continue;
    // A decision already taken lowers the urgency of the countdown.
    if (c.renewalStatus === "renew" || c.renewalStatus === "do_not_renew") severity = severity === "critical" ? "warning" : "info";

    const hasOverdue = (idx.paymentsByContract.get(c.id) ?? []).some(isUnpaid);
    out.push(
      candidate({
        type,
        category: "contract",
        severity,
        entityType: "contract",
        entityId: c.id,
        title: `Contract ends in ${plural(d, "day")} — ${name}`,
        message: `${place} · ${formatMoney(c.monthlyRent)}/month · ends ${c.endDate}${hasOverdue ? " · also has overdue rent" : ""}${c.renewalStatus === "renew" ? " · marked to renew" : c.renewalStatus === "do_not_renew" ? " · not renewing" : ""}`,
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
          message: `Asking ${formatMoney(askingRent)}/month${prev ? ` · previous tenant ${prev}` : ""} · est. ${formatMoney(Math.round((askingRent / 30) * days))} of rent missed so far`,
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
    const units = (idx.unitsByProperty.get(property.id) ?? []).filter((u) => u.status !== "maintenance" && u.status !== "unavailable" && u.status !== "renovation");
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

    // Insurance lapsing.
    if (property.insuranceExpiry) {
      const inDays = daysUntil(property.insuranceExpiry);
      if (inDays <= t.insuranceExpiringDays) {
        out.push(
          candidate({
            type: "property_insurance_expiring",
            category: "document",
            severity: inDays < 0 ? "critical" : "warning",
            entityType: "property",
            entityId: property.id,
            title: `Insurance ${inDays < 0 ? "expired" : "expiring"} — ${property.name}`,
            message: `${property.insuranceProvider ?? "Policy"}${property.insurancePolicyNumber ? ` ${property.insurancePolicyNumber}` : ""} ${inDays < 0 ? `expired ${Math.abs(inDays)} days ago` : `expires in ${plural(inDays, "day")}`} (${property.insuranceExpiry})`,
            actions: [act("view_property", "View building", property.id), act("upload_document", "Upload policy", property.id)],
            weight: 2_500 + Math.max(0, 60 - inDays) * 20,
            propertyId: property.id,
            dueDate: property.insuranceExpiry,
          }),
        );
      }
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
            severity: inDays < 0 ? "attention" : "info",
            entityType: "tenant",
            entityId: `${tenant.id}:${d.id}`,
            title: `${d.kind === "passport" ? "Passport" : "ID"} ${inDays < 0 ? "expired" : "expiring"} — ${tenant.fullName}`,
            message: `${d.title} ${inDays < 0 ? `expired ${Math.abs(inDays)} days ago` : `expires in ${plural(inDays, "day")}`} (${d.expiryDate})`,
            actions: [act("upload_document", "Upload new copy", tenant.id), act("view_tenant", "View tenant", tenant.id)],
            weight: 60 - inDays,
            dueDate: d.expiryDate,
            ...link,
          }),
        );
      }
    }
  }

  // Certificates, warranties and insurance documents on buildings / assets.
  for (const d of store.documents) {
    if (d.deleted || d.tenantId || !d.expiryDate) continue;
    if (d.category !== "certificate" && d.category !== "warranty" && d.category !== "insurance") continue;
    const inDays = daysUntil(d.expiryDate);
    if (inDays > t.certificateExpiringDays) continue;
    const subject = d.assetId ? idx.assetById.get(d.assetId)?.name : d.propertyId ? propertyName(d.propertyId) : null;
    out.push(
      candidate({
        type: "document_certificate_expiring",
        category: "document",
        severity: inDays < 0 ? "warning" : "attention",
        entityType: d.assetId ? "asset" : "property",
        entityId: `${d.id}`,
        title: `${labelize(d.category)} ${inDays < 0 ? "expired" : "expiring"} — ${d.title}`,
        message: `${subject ? `${subject} · ` : ""}${inDays < 0 ? `expired ${Math.abs(inDays)} days ago` : `expires in ${plural(inDays, "day")}`} (${d.expiryDate})`,
        actions: [...(d.assetId ? [act("view_asset", "View asset", d.assetId)] : d.propertyId ? [act("view_property", "View building", d.propertyId)] : []), act("upload_document", "Upload renewal", d.assetId ?? d.propertyId ?? d.id)],
        weight: 300 + Math.max(0, 60 - inDays) * 5,
        propertyId: d.propertyId,
        unitId: d.unitId,
        dueDate: d.expiryDate,
      }),
    );
  }

  /* ----------------------------- Maintenance ---------------------------- */

  const openOrders = store.workOrders.filter(isOpenWorkOrder);
  for (const w of openOrders) {
    const place = where(w.propertyId, w.unitId);
    const link = { propertyId: w.propertyId, unitId: w.unitId, tenantId: w.tenantId };
    const age = daysSince(w.reportedAt);
    const supplier = supplierName(w.supplierId);
    const actions = [act("view_work_order", "Open work order", w.id), ...(w.unitId ? [act("view_unit", "View unit", w.unitId)] : [act("view_property", "View building", w.propertyId)])];

    if (w.priority === "emergency") {
      out.push(
        candidate({
          type: "maintenance_emergency_open",
          category: "maintenance",
          severity: "critical",
          entityType: "work_order",
          entityId: w.id,
          title: `Emergency open ${plural(age, "day")} — ${w.title}`,
          message: `${place} · ${labelize(w.category)} · ${labelize(w.status)}${supplier ? ` · ${supplier}` : " · no supplier assigned"}`,
          actions: w.status === "awaiting_approval" ? [act("approve_work_order", "Approve", w.id), ...actions] : actions,
          weight: 6_000 + age * 200 + (w.estimatedCost ?? 0),
          ...link,
        }),
      );
    } else if (age > t.workOrderOpenTooLongDays) {
      out.push(
        candidate({
          type: "maintenance_open_too_long",
          category: "maintenance",
          severity: age > t.workOrderOpenTooLongDays * 2 ? "warning" : "attention",
          entityType: "work_order",
          entityId: w.id,
          title: `Open ${plural(age, "day")} — ${w.title}`,
          message: `${place} · ${labelize(w.category)} · ${labelize(w.priority)} priority · ${labelize(w.status)}${supplier ? ` · ${supplier}` : ""}`,
          actions,
          weight: 500 + age * 30 + (w.estimatedCost ?? 0) / 10,
          ...link,
        }),
      );
    }

    if (w.status === "awaiting_approval") {
      out.push(
        candidate({
          type: "maintenance_awaiting_approval",
          category: "maintenance",
          severity: "attention",
          entityType: "work_order",
          entityId: w.id,
          title: `Quote awaiting approval — ${w.title}`,
          message: `${place} · ${w.estimatedCost ? `estimated ${formatMoney(w.estimatedCost)}` : "no estimate yet"}${supplier ? ` · ${supplier}` : ""} · waiting ${plural(age, "day")}`,
          actions: [act("approve_work_order", "Approve", w.id), act("view_work_order", "Open work order", w.id)],
          weight: 400 + (w.estimatedCost ?? 0) / 5 + age * 20,
          dueDate: null,
          ...link,
        }),
      );
    }
  }

  // Repeat issues: same unit (or asset / building) + category, N+ times in the window.
  const windowFrom = addDaysISO(base, -t.repeatIssueWindowDays);
  const groups = new Map<string, WorkOrder[]>();
  for (const w of store.workOrders) {
    if (w.status === "cancelled" || w.reportedAt < windowFrom) continue;
    const scope = w.unitId ? `unit:${w.unitId}` : w.assetId ? `asset:${w.assetId}` : `property:${w.propertyId}`;
    const key = `${scope}:${w.category}`;
    const list = groups.get(key);
    if (list) list.push(w);
    else groups.set(key, [w]);
  }
  for (const [key, list] of groups) {
    if (list.length < t.repeatIssueMinCount) continue;
    const latest = list.slice().sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1))[0];
    const scopeLabel = latest.unitId ? unitLabel(latest.unitId) : latest.assetId ? idx.assetById.get(latest.assetId)?.name ?? "Asset" : propertyName(latest.propertyId);
    const spent = sum(list.map((w) => w.actualCost ?? 0));
    out.push(
      candidate({
        type: "maintenance_repeat_issue",
        category: "maintenance",
        severity: "warning",
        entityType: latest.unitId ? "unit" : latest.assetId ? "asset" : "property",
        entityId: key,
        title: `Repeat ${labelize(latest.category).toLowerCase()} issue — ${scopeLabel}`,
        message: `${list.length} ${labelize(latest.category).toLowerCase()} work orders in ${t.repeatIssueWindowDays} days${spent > 0 ? ` · ${formatMoney(spent)} spent` : ""} · latest: ${latest.title}`,
        actions: [act("view_work_order", "Latest work order", latest.id), ...(latest.unitId ? [act("view_unit", "View unit", latest.unitId)] : latest.assetId ? [act("view_asset", "View asset", latest.assetId)] : [act("view_property", "View building", latest.propertyId)])],
        weight: 1_500 + list.length * 300 + spent / 5,
        propertyId: latest.propertyId,
        unitId: latest.unitId,
      }),
    );
  }

  // Maintenance cost unusually high vs the 6-month average.
  const period = periodOf(base);
  for (const property of store.properties) {
    const now = maintenanceSpend(store.expenses, property.id, period);
    const history = lastPeriods(6, addPeriods(period, -1)).map((p) => maintenanceSpend(store.expenses, property.id, p));
    const avg = history.length > 0 ? sum(history) / history.length : 0;
    if (avg > 0 && now > avg * t.maintenanceCostHighMultiplier) {
      out.push(
        candidate({
          type: "maintenance_cost_high",
          category: "maintenance",
          severity: "attention",
          entityType: "property",
          entityId: `${property.id}:${period}`,
          title: `Maintenance spend ${formatPercent(now / avg - 1)} above average — ${property.name}`,
          message: `${formatMoney(now)} so far in ${formatMonth(period)} vs a 6-month average of ${formatMoney(Math.round(avg))}`,
          actions: [act("view_property", "View building", property.id)],
          weight: now - avg,
          propertyId: property.id,
        }),
      );
    }
  }

  /* ------------------------------ Preventive ---------------------------- */

  for (const plan of store.preventivePlans) {
    if (plan.status !== "active") continue;
    const asset = plan.assetId ? idx.assetById.get(plan.assetId) : undefined;
    const subject = asset ? `${asset.name} · ${propertyName(plan.propertyId)}` : propertyName(plan.propertyId);
    const d = daysUntil(plan.nextServiceDate);
    const link = { propertyId: plan.propertyId, unitId: asset?.unitId ?? null, dueDate: plan.nextServiceDate };
    const actions = [act("schedule_service", "Log service", plan.id), act("view_plan", "View plan", plan.id), ...(asset ? [act("view_asset", "View asset", asset.id)] : [])];
    if (d < 0) {
      out.push(
        candidate({
          type: "preventive_service_overdue",
          category: "preventive",
          severity: d < -30 ? "critical" : "warning",
          entityType: "preventive_plan",
          entityId: plan.id,
          title: `Service overdue ${plural(Math.abs(d), "day")} — ${plan.maintenanceType}`,
          message: `${subject} · was due ${plan.nextServiceDate}${plan.lastServiceDate ? ` · last done ${plan.lastServiceDate}` : " · never serviced"}${supplierName(plan.supplierId) ? ` · ${supplierName(plan.supplierId)}` : ""}`,
          actions,
          weight: 1_200 + Math.abs(d) * 25 + (plan.estimatedCost ?? 0) / 10,
          ...link,
        }),
      );
    } else if (d <= Math.max(plan.reminderDays, t.serviceDueSoonDays)) {
      out.push(
        candidate({
          type: "preventive_service_due",
          category: "preventive",
          severity: "attention",
          entityType: "preventive_plan",
          entityId: plan.id,
          title: `Service due in ${plural(d, "day")} — ${plan.maintenanceType}`,
          message: `${subject} · due ${plan.nextServiceDate}${plan.estimatedCost ? ` · est. ${formatMoney(plan.estimatedCost)}` : ""}${supplierName(plan.supplierId) ? ` · ${supplierName(plan.supplierId)}` : ""}`,
          actions,
          weight: 300 + Math.max(0, 30 - d) * 10,
          ...link,
        }),
      );
    }
  }

  for (const asset of store.assets) {
    if (asset.status === "retired") continue;
    const link = { propertyId: asset.propertyId, unitId: asset.unitId };
    if (asset.status === "out_of_service") {
      const critical = ["elevator", "generator", "fire_system", "water_pump", "boiler"].includes(asset.assetType);
      const open = (idx.workOrdersByAsset.get(asset.id) ?? []).filter(isOpenWorkOrder)[0];
      out.push(
        candidate({
          type: "asset_out_of_service",
          category: "maintenance",
          severity: critical ? "critical" : "warning",
          entityType: "asset",
          entityId: asset.id,
          title: `${asset.name} out of service — ${propertyName(asset.propertyId)}`,
          message: `${labelize(asset.assetType)}${open ? ` · work order ${open.number} ${labelize(open.status)}` : " · no open work order"}`,
          actions: open ? [act("view_work_order", "Open work order", open.id), act("view_asset", "View asset", asset.id)] : [act("create_work_order", "Create work order", asset.id), act("view_asset", "View asset", asset.id)],
          weight: (critical ? 5_000 : 1_500) + (open ? 0 : 1_000),
          ...link,
        }),
      );
    }
    if (asset.warrantyExpiry) {
      const inDays = daysUntil(asset.warrantyExpiry);
      if (inDays >= -30 && inDays <= t.warrantyExpiringDays) {
        out.push(
          candidate({
            type: "asset_warranty_expiring",
            category: "preventive",
            severity: inDays < 0 ? "attention" : "info",
            entityType: "asset",
            entityId: asset.id,
            title: `Warranty ${inDays < 0 ? "expired" : "expiring"} — ${asset.name}`,
            message: `${propertyName(asset.propertyId)} · ${inDays < 0 ? `expired ${Math.abs(inDays)} days ago` : `expires in ${plural(inDays, "day")}`} (${asset.warrantyExpiry})${asset.manufacturer ? ` · ${asset.manufacturer}` : ""}`,
            actions: [act("view_asset", "View asset", asset.id)],
            weight: 100 + Math.max(0, 60 - inDays),
            dueDate: asset.warrantyExpiry,
            ...link,
          }),
        );
      }
    }
  }

  /* -------------------------------- Finance ----------------------------- */

  const year = period.slice(0, 4);
  for (const b of store.budgets) {
    if (b.period !== period && b.period !== year) continue;
    const actual = budgetActual(store.expenses, b);
    const v = budgetVariance(b.amount, actual, t.budgetOverPct);
    if (!v.over) continue;
    out.push(
      candidate({
        type: "budget_over",
        category: "finance",
        severity: v.variancePct !== null && v.variancePct > 0.5 ? "warning" : "attention",
        entityType: "budget",
        entityId: b.id,
        title: `${labelize(b.category)} over budget — ${propertyName(b.propertyId)}`,
        message: `${formatMoney(actual)} spent vs ${formatMoney(b.amount)} budgeted for ${b.periodType === "month" ? formatMonth(b.period) : b.period} (${v.variancePct !== null ? `+${formatPercent(v.variancePct)}` : formatMoney(v.variance)})`,
        actions: [act("view_budget", "View budget", b.id), act("view_property", "View building", b.propertyId)],
        weight: v.variance,
        propertyId: b.propertyId,
      }),
    );
  }

  // Single expenses far above their category's recent average.
  const recentFrom = addDaysISO(base, -30);
  for (const e of store.expenses) {
    if (e.deleted || e.expenseDate < recentFrom || e.expenseDate > base) continue;
    const history = expensesFor(store.expenses, { propertyId: e.propertyId, category: e.category }).filter((x) => x.id !== e.id && x.expenseDate < e.expenseDate && x.expenseDate >= addDaysISO(e.expenseDate, -180));
    const avg = history.length >= 2 ? sum(history.map((x) => x.amount)) / history.length : 0;
    if (avg > 0 && e.amount > avg * t.expenseUnusualMultiplier) {
      out.push(
        candidate({
          type: "expense_unusual",
          category: "finance",
          severity: "attention",
          entityType: "expense",
          entityId: e.id,
          title: `Unusually high ${labelize(e.category).toLowerCase()} expense — ${propertyName(e.propertyId)}`,
          message: `${formatMoney(e.amount)} on ${e.expenseDate} for "${e.description}" vs an average of ${formatMoney(Math.round(avg))} (${history.length} previous)`,
          actions: [act("view_expense", "View expense", e.id)],
          weight: e.amount - avg,
          propertyId: e.propertyId,
          unitId: e.unitId,
        }),
      );
    }
    if (e.paymentStatus === "unpaid" && e.dueDate && e.dueDate < base) {
      const late = daysBetween(e.dueDate, base);
      out.push(
        candidate({
          type: "expense_overdue",
          category: "finance",
          severity: late > 30 ? "warning" : "attention",
          entityType: "expense",
          entityId: e.id,
          title: `Invoice unpaid ${plural(late, "day")} — ${e.description}`,
          message: `${propertyName(e.propertyId)} · ${formatMoney(e.amount)}${supplierName(e.supplierId) ? ` to ${supplierName(e.supplierId)}` : ""} · was due ${e.dueDate}`,
          actions: [act("record_expense_payment", "Mark paid", e.id), act("view_expense", "View expense", e.id)],
          weight: e.amount + late * 10,
          propertyId: e.propertyId,
          dueDate: e.dueDate,
        }),
      );
    }
  }
  // Unpaid expenses older than 30 days (outside the "recent" loop above).
  for (const e of store.expenses) {
    if (e.deleted || e.paymentStatus !== "unpaid" || !e.dueDate || e.dueDate >= base) continue;
    if (e.expenseDate >= recentFrom && e.expenseDate <= base) continue; // already handled
    const late = daysBetween(e.dueDate, base);
    out.push(
      candidate({
        type: "expense_overdue",
        category: "finance",
        severity: late > 30 ? "warning" : "attention",
        entityType: "expense",
        entityId: e.id,
        title: `Invoice unpaid ${plural(late, "day")} — ${e.description}`,
        message: `${propertyName(e.propertyId)} · ${formatMoney(e.amount)}${supplierName(e.supplierId) ? ` to ${supplierName(e.supplierId)}` : ""} · was due ${e.dueDate}`,
        actions: [act("record_expense_payment", "Mark paid", e.id), act("view_expense", "View expense", e.id)],
        weight: e.amount + late * 10,
        propertyId: e.propertyId,
        dueDate: e.dueDate,
      }),
    );
  }

  // NOI falling three complete months in a row.
  for (const property of store.properties) {
    const months = lastPeriods(3, addPeriods(period, -1)).map((p) => noiFor(store, p, property.id));
    if (months.length < 3) continue;
    const [m3, m2, m1] = months;
    if (m3.noi > 0 && m2.noi < m3.noi && m1.noi < m2.noi) {
      out.push(
        candidate({
          type: "noi_deteriorating",
          category: "finance",
          severity: "warning",
          entityType: "property",
          entityId: property.id,
          title: `NOI falling three months running — ${property.name}`,
          message: `${formatMoney(m3.noi)} → ${formatMoney(m2.noi)} → ${formatMoney(m1.noi)} (${formatMonth(m3.period)} to ${formatMonth(m1.period)})`,
          actions: [act("view_property", "View building", property.id)],
          weight: m3.noi - m1.noi,
          propertyId: property.id,
        }),
      );
    }
  }

  for (const d of store.deposits) {
    const c = idx.contractById.get(d.contractId);
    if (!c) continue;
    const link = { propertyId: d.propertyId, unitId: d.unitId, tenantId: d.tenantId };
    const ended = c.status === "terminated" || (c.status === "expired" && !isOccupying(c));
    const endedOn = c.moveOutDate ?? c.endDate;
    if (ended && d.status === "held" && daysSince(endedOn) > 14) {
      out.push(
        candidate({
          type: "deposit_unsettled",
          category: "finance",
          severity: "warning",
          entityType: "deposit",
          entityId: d.id,
          title: `Deposit not settled — ${tenantName(d.tenantId)}`,
          message: `${unitLabel(d.unitId)} · ${formatMoney(d.amountHeld)} held · tenancy ended ${endedOn} (${daysSince(endedOn)} days ago)`,
          actions: [act("settle_deposit", "Settle deposit", d.id), act("view_deposit", "View deposit", d.id)],
          weight: d.amountHeld + daysSince(endedOn) * 10,
          ...link,
        }),
      );
    }
    if (isOccupying(c) && d.status === "pending" && daysSince(c.startDate) > 7) {
      out.push(
        candidate({
          type: "deposit_not_received",
          category: "finance",
          severity: "attention",
          entityType: "deposit",
          entityId: d.id,
          title: `Deposit not received — ${tenantName(d.tenantId)}`,
          message: `${unitLabel(d.unitId)} · ${formatMoney(d.amountExpected)} expected · contract started ${c.startDate}`,
          actions: [act("view_deposit", "View deposit", d.id), act("send_reminder", "Send reminder", d.tenantId)],
          weight: d.amountExpected,
          ...link,
        }),
      );
    }
  }

  /* ------------------------------ Inspections --------------------------- */

  for (const i of store.inspections) {
    const link = { propertyId: i.propertyId, unitId: i.unitId, tenantId: i.tenantId };
    const place = where(i.propertyId, i.unitId);
    if ((i.status === "scheduled" || i.status === "in_progress") && daysSince(i.scheduledDate) > t.inspectionOverdueDays) {
      out.push(
        candidate({
          type: "inspection_overdue",
          category: "inspection",
          severity: "warning",
          entityType: "inspection",
          entityId: i.id,
          title: `${labelize(i.type)} inspection overdue — ${place}`,
          message: `Scheduled ${i.scheduledDate} · ${daysSince(i.scheduledDate)} days ago · ${i.inspector}`,
          actions: [act("view_inspection", "Open inspection", i.id)],
          weight: 400 + daysSince(i.scheduledDate) * 15,
          dueDate: i.scheduledDate,
          ...link,
        }),
      );
    }
    if (i.status === "completed") {
      const pending = i.items.filter((x) => x.followUpRequired && !x.workOrderId);
      if (pending.length > 0) {
        out.push(
          candidate({
            type: "inspection_followup_open",
            category: "inspection",
            severity: "attention",
            entityType: "inspection",
            entityId: i.id,
            title: `${plural(pending.length, "failed item")} without follow-up — ${place}`,
            message: `${labelize(i.type)} inspection on ${i.completedDate} · ${pending.map((x) => x.item).slice(0, 3).join(", ")}${pending.length > 3 ? "…" : ""}`,
            actions: [act("create_work_order", "Create work order", i.id), act("view_inspection", "Open inspection", i.id)],
            weight: 300 + pending.length * 100,
            ...link,
          }),
        );
      }
    }
  }

  /* --------------------------- Move-in / move-out ----------------------- */

  for (const c of store.contracts) {
    const hasInspection = (type: "move_in" | "move_out") => store.inspections.some((i) => i.contractId === c.id && i.type === type && i.status !== "cancelled");
    const name = tenantName(c.tenantId);
    const place = unitLabel(c.unitId);
    const link = { propertyId: c.propertyId, unitId: c.unitId, tenantId: c.tenantId };
    if (isOccupying(c) && c.renewalDecision !== "renew") {
      const end = c.moveOutDate ?? c.endDate;
      const d = daysUntil(end);
      const leaving = c.status === "notice_given" || c.renewalDecision === "do_not_renew";
      // Leaving for sure, or two weeks from the end with no renewal agreed — either way the move-out needs planning.
      if ((leaving || d <= 14) && d >= -t.inspectionOverdueDays && !hasInspection("move_out")) {
        out.push(
          candidate({
            type: "move_out_unplanned",
            category: "inspection",
            severity: d <= 7 ? "warning" : "attention",
            entityType: "contract",
            entityId: c.id,
            title: `Move-out checklist not scheduled — ${name}`,
            message: `${place} · ${d < 0 ? `left ${Math.abs(d)} days ago` : d === 0 ? "leaving today" : `leaving in ${d} days`} · inspection, keys, readings and deposit settlement`,
            actions: [act("schedule_inspection", "Schedule move-out", c.id), act("view_tenant", "View tenant", c.tenantId)],
            weight: 900 + Math.max(0, t.moveOutInspectionLeadDays - d) * 20,
            dueDate: end,
            ...link,
          }),
        );
      }
    }
    if (c.status === "active" && daysUntil(c.startDate) <= t.moveInInspectionLeadDays && daysSince(c.startDate) <= t.inspectionOverdueDays && !hasInspection("move_in")) {
      const d = daysUntil(c.startDate);
      out.push(
        candidate({
          type: "move_in_unplanned",
          category: "inspection",
          severity: "attention",
          entityType: "contract",
          entityId: c.id,
          title: `Move-in checklist not scheduled — ${name}`,
          message: `${place} · ${d < 0 ? `moved in ${Math.abs(d)} days ago` : d === 0 ? "moving in today" : `moving in ${d} days`} · condition report protects the deposit`,
          actions: [act("schedule_inspection", "Schedule move-in", c.id), act("view_tenant", "View tenant", c.tenantId)],
          weight: 700 + Math.max(0, t.moveInInspectionLeadDays - d) * 10,
          dueDate: c.startDate,
          ...link,
        }),
      );
    }
  }

  for (const k of store.keys) {
    if (k.status !== "lost") continue;
    out.push(
      candidate({
        type: "key_lost",
        category: "inspection",
        severity: k.type === "apartment_key" || k.type === "building_key" ? "warning" : "attention",
        entityType: "key",
        entityId: k.id,
        title: `${labelize(k.type)} ${k.identifier} recorded lost — ${where(k.propertyId, k.unitId)}`,
        message: `${k.assignedTo ? `Last held by ${k.assignedTo} · ` : ""}consider changing the lock and issuing a replacement`,
        actions: [act("view_keys", "Key register", k.id), ...(k.type === "apartment_key" || k.type === "building_key" ? [act("create_work_order", "Change the lock", k.unitId ?? k.propertyId)] : [])],
        weight: 500,
        propertyId: k.propertyId,
        unitId: k.unitId,
        tenantId: k.tenantId,
      }),
    );
  }

  /* ------------------------------ Renovations --------------------------- */

  for (const r of store.renovations) {
    if (r.status === "cancelled" || r.status === "completed") continue;
    const link = { propertyId: r.propertyId, unitId: r.unitId };
    const place = where(r.propertyId, r.unitId);
    if (r.actualCost > r.budget && r.budget > 0) {
      out.push(
        candidate({
          type: "renovation_over_budget",
          category: "finance",
          severity: "warning",
          entityType: "renovation",
          entityId: r.id,
          title: `Over budget — ${r.title}`,
          message: `${place} · ${formatMoney(r.actualCost)} spent vs ${formatMoney(r.budget)} budget (+${formatPercent(r.actualCost / r.budget - 1)}) · ${r.progressPercent}% complete`,
          actions: [act("view_renovation", "Open project", r.id)],
          weight: r.actualCost - r.budget,
          ...link,
        }),
      );
    }
    if (r.targetEndDate < base) {
      out.push(
        candidate({
          type: "renovation_delayed",
          category: "maintenance",
          severity: "attention",
          entityType: "renovation",
          entityId: r.id,
          title: `Behind schedule — ${r.title}`,
          message: `${place} · target end ${r.targetEndDate} (${daysSince(r.targetEndDate)} days ago) · ${r.progressPercent}% complete · ${labelize(r.status)}`,
          actions: [act("view_renovation", "Open project", r.id)],
          weight: 200 + daysSince(r.targetEndDate) * 10,
          dueDate: r.targetEndDate,
          ...link,
        }),
      );
    }
  }

  /* ------------------------------- Reminders ---------------------------- */

  for (const r of store.reminders) {
    if (r.done) continue;
    const d = daysUntil(r.dueDate);
    if (d > 3) continue;
    const viewAction: AlertAction | null =
      r.entityType === "tenant" && r.entityId ? act("view_tenant", "View tenant", r.entityId)
      : r.entityType === "unit" && r.entityId ? act("view_unit", "View unit", r.entityId)
      : r.entityType === "contract" && r.entityId ? act("view_contract", "View contract", r.entityId)
      : r.entityType === "property" && r.entityId ? act("view_property", "View building", r.entityId)
      : r.entityType === "work_order" && r.entityId ? act("view_work_order", "Open work order", r.entityId)
      : r.entityType === "asset" && r.entityId ? act("view_asset", "View asset", r.entityId)
      : null;
    out.push(
      candidate({
        type: "reminder_due",
        category: "reminder",
        severity: d < 0 ? "warning" : "attention",
        entityType: "reminder",
        entityId: r.id,
        title: `${d < 0 ? `Overdue ${plural(Math.abs(d), "day")}` : d === 0 ? "Due today" : `Due in ${plural(d, "day")}`} — ${r.title}`,
        message: `${r.note ?? "Reminder"}${r.createdBy === "assistant" ? " · created by the assistant" : ""}`,
        actions: [act("complete_reminder", "Mark done", r.id), ...(viewAction ? [viewAction] : [])],
        weight: 500 + Math.max(0, -d) * 50,
        propertyId: r.propertyId,
        unitId: r.unitId,
        tenantId: r.tenantId,
        dueDate: r.dueDate,
        generatedBy: "manual",
      }),
    );
  }

  /* ------------------------------ Portfolio ----------------------------- */

  let outstandingTotal = 0;
  let outstandingCount = 0;
  const outstandingByProperty = new Map<ID, number>();
  for (const p of store.payments) {
    if (!isUnpaid(p)) continue;
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

  for (const [p, count] of expiringByPeriod) {
    if (count >= t.expiryClusterCount) {
      out.push(
        candidate({
          type: "portfolio_expiry_cluster",
          category: "portfolio",
          severity: "warning",
          entityType: "portfolio",
          entityId: `expiry:${p}`,
          title: `${count} contracts expire in ${formatMonth(p)}`,
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

  const muted = new Set(store.settings.mutedAlertTypes);
  const previous = new Map<string, Alert>([...(store.mutedAlerts ?? []), ...store.alerts].map((a) => [a.id, a]));
  const now = nowISO();
  const seen = new Set<string>();
  const merged: Alert[] = [];
  const parked: Alert[] = [];
  for (const c of out) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const p = previous.get(c.id);
    (muted.has(c.type) ? parked : merged).push({
      ...c,
      createdAt: p?.createdAt ?? now,
      read: p?.read ?? false,
      dismissed: p?.dismissed ?? false,
      resolved: p?.resolved ?? false,
      resolvedAt: p?.resolvedAt ?? null,
      snoozedUntil: p?.snoozedUntil && p.snoozedUntil > today() ? p.snoozedUntil : null,
    });
  }
  return { alerts: merged, mutedAlerts: parked };
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
