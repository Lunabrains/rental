import { indexStore } from "@/lib/data/store";
import { isOccupying } from "@/lib/derived/recompute";
import { daysUntil, today } from "@/lib/date";
import {
  computeVacancyOpportunity,
  getActivity,
  getAlerts,
  getExpiringContracts,
  getLatePayers,
  getOutstandingBalance,
  getOverduePayments,
  getPortfolioOverview,
  getProperties,
  getPropertyPerformance,
  getRevenueHistory,
  getTenantDetails,
  getUnitDetails,
  getUpcomingPayments,
  getVacantUnits,
  searchAll,
} from "@/lib/queries";
import type { AlertCategory, AlertSeverity, ID, Property, Store } from "@/types";

import type { PageContext, ToolDefinition } from "./types";

/**
 * The AI's only way into the data: a read-only tool layer over the query
 * functions. No SQL, no raw store access. Results are compact JSON the model
 * formats for the user.
 */

const optionalProperty = {
  property: { type: "string", description: "Building name, code or id. Defaults to the building the user is looking at, if any." },
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_portfolio_overview",
    description: "Portfolio KPIs: buildings, units, occupancy, monthly revenue, outstanding rent, critical alerts, with month-over-month trends.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_properties",
    description: "One row per building: units, rented, available, occupancy, revenue, outstanding, score, critical alerts. Sorted by occupancy.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_property",
    description: "Details for one building including its vacant units, contracts ending within 60 days and overdue payments.",
    input_schema: { type: "object", properties: { property: { type: "string", description: "Building name, code or id" } }, required: ["property"], additionalProperties: false },
  },
  {
    name: "get_unit",
    description: "Who rents a unit and on what terms: tenant, contract, payment history summary, documents. Use for 'who is in 403?'.",
    input_schema: {
      type: "object",
      properties: { ...optionalProperty, unit_number: { type: "string", description: "Unit number, e.g. 403 or B304" } },
      required: ["unit_number"],
      additionalProperties: false,
    },
  },
  {
    name: "find_tenant",
    description: "Search tenants by name, phone or ID number and return their current unit, contract and outstanding balance.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "get_tenant",
    description: "Full tenant profile: contact, current and past contracts, payment record, documents, alerts.",
    input_schema: { type: "object", properties: { tenant_id: { type: "string" } }, required: ["tenant_id"], additionalProperties: false },
  },
  {
    name: "get_expiring_contracts",
    description: "Contracts ending within N days, flagged when the tenant also has overdue rent or is a reliable payer.",
    input_schema: { type: "object", properties: { days: { type: "integer", description: "Window in days, default 30" }, ...optionalProperty }, additionalProperties: false },
  },
  {
    name: "get_overdue_payments",
    description: "Overdue and partially paid rent — who hasn't paid, how much, how many days late.",
    input_schema: { type: "object", properties: { ...optionalProperty }, additionalProperties: false },
  },
  {
    name: "get_upcoming_payments",
    description: "Rent falling due within N days.",
    input_schema: { type: "object", properties: { days: { type: "integer", description: "default 30" }, ...optionalProperty }, additionalProperties: false },
  },
  {
    name: "get_late_payers",
    description: "Tenants who regularly pay late: late in at least N of the last M months.",
    input_schema: {
      type: "object",
      properties: { months: { type: "integer", description: "window, default 6" }, min_late: { type: "integer", description: "default 3" }, ...optionalProperty },
      additionalProperties: false,
    },
  },
  {
    name: "get_outstanding_balance",
    description: "Total outstanding rent and its split by building.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_vacant_units",
    description: "Available units with days vacant, asking rent, previous tenant and rent missed so far.",
    input_schema: { type: "object", properties: { min_days: { type: "integer", description: "default 0" }, ...optionalProperty }, additionalProperties: false },
  },
  {
    name: "get_alerts",
    description: "Open alerts ranked by severity and weight, with their available actions.",
    input_schema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["critical", "warning", "info"] },
        category: { type: "string", enum: ["payment", "contract", "occupancy", "document", "portfolio"] },
        limit: { type: "integer", description: "default 15" },
        ...optionalProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_revenue_history",
    description: "Monthly billed vs collected rent and occupancy for the last N months.",
    input_schema: { type: "object", properties: { months: { type: "integer", description: "default 12" }, ...optionalProperty }, additionalProperties: false },
  },
  {
    name: "get_recent_activity",
    description: "What happened recently in the system: payments recorded, renewals, imports, notices, edits.",
    input_schema: { type: "object", properties: { limit: { type: "integer", description: "default 20" } }, additionalProperties: false },
  },
  {
    name: "search",
    description: "Free-text search across tenants, units, buildings and contract numbers.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "answer",
    description:
      "Deliver the final answer to the user. Call this exactly once when you have what you need. Use a table for lists, cards for one or two entities, a one-line recommendation when there is a clear next step, and actions the user can click.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Short plain-language answer, 1–3 sentences. No markdown tables." },
        table: {
          type: "object",
          properties: { columns: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: { type: ["string", "number"] } } } },
          required: ["columns", "rows"],
          additionalProperties: false,
        },
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              subtitle: { type: "string" },
              fields: { type: "array", items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 } },
            },
            required: ["title", "fields"],
            additionalProperties: false,
          },
        },
        recommendation: { type: "string" },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["record_payment", "send_reminder", "renew_contract", "mark_as_leaving", "view_unit", "view_tenant", "view_property", "view_contract"] },
              label: { type: "string" },
              targetId: { type: "string", description: "The id from the tool results: payment id, contract id, unit id, tenant id or property id" },
            },
            required: ["kind", "label", "targetId"],
            additionalProperties: false,
          },
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

/* ------------------------------ Resolution ------------------------------- */

export function resolveProperty(store: Store, raw: unknown, context?: PageContext): Property | null {
  const idx = indexStore(store);
  if (typeof raw === "string" && raw.trim()) {
    const q = raw.trim().toLowerCase();
    const byId = idx.propertyById.get(raw.trim());
    if (byId) return byId;
    const exact = store.properties.find((p) => p.name.toLowerCase() === q || p.code.toLowerCase() === q);
    if (exact) return exact;
    const partial = store.properties.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
    if (partial) return partial;
    return null;
  }
  if (context?.propertyId) return idx.propertyById.get(context.propertyId) ?? null;
  return null;
}

const money = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 1000) / 10;

/* -------------------------------- Execute -------------------------------- */

export function executeTool(store: Store, name: string, input: Record<string, unknown>, context: PageContext): unknown {
  const idx = indexStore(store);
  const t = store.settings.thresholds;
  const base = today();
  const scope = resolveProperty(store, input.property, context);
  const scopeId = scope?.id;

  switch (name) {
    case "get_portfolio_overview": {
      const o = getPortfolioOverview(store, base);
      return {
        asOf: base,
        buildings: o.buildings,
        units: o.units,
        occupied: o.occupied,
        available: o.available,
        occupancyPct: pct(o.occupancy.current),
        occupancyDeltaPts: pct(o.occupancy.delta),
        monthlyRevenue: money(o.monthlyRevenue.current),
        monthlyRevenueDelta: money(o.monthlyRevenue.delta),
        outstanding: money(o.outstanding.current),
        outstandingDelta: money(o.outstanding.delta),
        overduePayments: o.overdueCount,
        criticalAlerts: o.criticalAlerts.total,
        contractsExpiring30d: o.expiring30,
        contractsExpiring60d: o.expiring60,
      };
    }
    case "get_properties":
      return getPropertyPerformance(store, base).rows.map((r) => ({
        id: r.id,
        name: r.name,
        district: r.property.district,
        units: r.units,
        rented: r.rented,
        available: r.available,
        occupancyPct: pct(r.occupancy),
        monthlyRevenue: money(r.monthlyRevenue),
        outstanding: money(r.outstanding),
        outstandingSharePct: pct(r.outstandingShare),
        expiring30d: r.expiring30,
        criticalAlerts: r.criticalAlerts,
        score: r.score,
      }));
    case "get_property": {
      const p = resolveProperty(store, input.property, context);
      if (!p) return { error: `No building matches "${String(input.property)}". Known: ${store.properties.map((x) => x.name).join(", ")}` };
      const s = getProperties(store, base).find((x) => x.id === p.id)!;
      return {
        id: p.id,
        name: p.name,
        address: `${p.address}, ${p.district}, ${p.city}`,
        floors: p.floors,
        unitsPerFloor: p.unitsPerFloor,
        units: s.units,
        rented: s.rented,
        available: s.available,
        occupancyPct: pct(s.occupancy),
        belowTarget: s.occupancy < t.buildingOccupancyWarning,
        monthlyRevenue: money(s.monthlyRevenue),
        outstanding: money(s.outstanding),
        outstandingSharePct: pct(s.outstandingShare),
        score: s.score,
        vacantUnits: getVacantUnits(store, 0, p.id).map((v) => ({ unitId: v.unit.id, unit: v.unit.unitNumber, daysVacant: v.daysVacant, askingRent: v.askingRent, previousTenant: v.previousTenant?.fullName ?? null })),
        expiring60d: getExpiringContracts(store, 60, p.id, base).map((r) => ({ contractId: r.contract.id, tenant: r.tenant.fullName, unit: r.unit.unitNumber, daysLeft: r.daysRemaining, rent: r.contract.monthlyRent })),
        overdue: getOverduePayments(store, p.id).map((r) => ({ paymentId: r.payment.id, tenant: r.tenant.fullName, unit: r.unit.unitNumber, outstanding: money(r.outstanding), daysLate: r.payment.daysLate })),
      };
    }
    case "get_unit": {
      const number = String(input.unit_number ?? "").trim().toLowerCase();
      const candidates = store.units.filter((u) => u.unitNumber.toLowerCase() === number && (!scopeId || u.propertyId === scopeId));
      if (candidates.length === 0) return { error: `No unit ${input.unit_number}${scope ? ` in ${scope.name}` : ""}` };
      if (candidates.length > 1 && !scope) {
        return { ambiguous: candidates.map((u) => ({ unitId: u.id, property: idx.propertyById.get(u.propertyId)?.name })) , hint: "Ask which building, or pass property." };
      }
      const d = getUnitDetails(store, candidates[0].id);
      if (!d) return { error: "Unit not found" };
      return {
        unitId: d.unit.id,
        unit: d.unit.unitNumber,
        property: d.property.name,
        propertyId: d.property.id,
        floor: d.unit.floor,
        bedrooms: d.unit.bedrooms,
        sizeSqm: d.unit.sizeSqm,
        status: d.unit.status,
        tenant: d.tenant ? { id: d.tenant.id, name: d.tenant.fullName, phone: d.tenant.phone, email: d.tenant.email, nationality: d.tenant.nationality } : null,
        contract: d.contract
          ? { id: d.contract.id, number: d.contract.contractNumber, start: d.contract.startDate, end: d.contract.endDate, daysRemaining: daysUntil(d.contract.endDate), rent: d.contract.monthlyRent, deposit: d.contract.deposit, paymentDay: d.contract.paymentDay, status: d.contract.status }
          : null,
        payments: { paid: money(d.totals.paid), outstanding: money(d.totals.outstanding), lateCount: d.totals.lateCount, avgDaysLate: d.totals.avgDaysLate, onTimeRatePct: pct(d.totals.onTimeRate) },
        overdue: d.payments.filter((p) => p.status === "overdue" || p.status === "partial").map((p) => ({ paymentId: p.id, period: p.periodMonth, outstanding: money(p.amountDue - p.amountPaid), daysLate: p.daysLate })),
        documents: d.documents.map((x) => ({ kind: x.kind, title: x.title })),
        daysVacant: d.daysVacant,
        askingRent: d.unit.status === "available" ? d.unit.askingRent : undefined,
        previousTenant: d.previousTenant?.fullName ?? null,
        alerts: d.alerts.map((a) => a.title),
      };
    }
    case "find_tenant": {
      const r = searchAll(store, String(input.query ?? ""), 8);
      return r.tenants.map(({ tenant, unit, property }) => {
        const details = getTenantDetails(store, tenant.id);
        return {
          tenantId: tenant.id,
          name: tenant.fullName,
          phone: tenant.phone,
          property: property?.name ?? null,
          unit: unit?.unitNumber ?? null,
          unitId: unit?.id ?? null,
          current: details?.current ? { contractId: details.current.contract.id, rent: details.current.contract.monthlyRent, ends: details.current.contract.endDate, daysRemaining: details.current.daysRemaining } : null,
          outstanding: money(details?.totals.outstanding ?? 0),
          lateCount: details?.totals.lateCount ?? 0,
        };
      });
    }
    case "get_tenant": {
      const d = getTenantDetails(store, String(input.tenant_id ?? ""));
      if (!d) return { error: "Tenant not found" };
      return {
        tenantId: d.tenant.id,
        name: d.tenant.fullName,
        phone: d.tenant.phone,
        email: d.tenant.email,
        nationality: d.tenant.nationality,
        idNumber: d.tenant.idNumber || null,
        occupation: d.tenant.occupation,
        tenureMonths: d.tenureMonths,
        current: d.current ? { contractId: d.current.contract.id, property: d.current.property.name, unitId: d.current.unit.id, unit: d.current.unit.unitNumber, rent: d.current.contract.monthlyRent, ends: d.current.contract.endDate, daysRemaining: d.current.daysRemaining } : null,
        history: d.contracts.map((c) => ({ number: c.contract.contractNumber, property: c.property.name, unit: c.unit.unitNumber, start: c.contract.startDate, end: c.contract.endDate, rent: c.contract.monthlyRent, status: c.contract.status })),
        payments: { paid: money(d.totals.paid), outstanding: money(d.totals.outstanding), lateCount: d.totals.lateCount, avgDaysLate: d.totals.avgDaysLate, onTimeRatePct: pct(d.totals.onTimeRate) },
        documents: d.documents.map((x) => ({ kind: x.kind, title: x.title, expires: x.expiryDate })),
        alerts: d.alerts.map((a) => a.title),
      };
    }
    case "get_expiring_contracts": {
      const days = Number(input.days ?? 30) || 30;
      return getExpiringContracts(store, days, scopeId, base).map((r) => ({
        contractId: r.contract.id,
        tenantId: r.tenant.id,
        tenant: r.tenant.fullName,
        property: r.property.name,
        unitId: r.unit.id,
        unit: r.unit.unitNumber,
        ends: r.contract.endDate,
        daysLeft: r.daysRemaining,
        rent: r.contract.monthlyRent,
        alsoOverdue: r.hasOverdue,
        outstanding: money(r.outstanding),
        reliable: r.reliable,
        lateCount: r.lateCount,
      }));
    }
    case "get_overdue_payments":
      return getOverduePayments(store, scopeId).map((r) => ({
        paymentId: r.payment.id,
        tenantId: r.tenant.id,
        tenant: r.tenant.fullName,
        property: r.property.name,
        unitId: r.unit.id,
        unit: r.unit.unitNumber,
        period: r.payment.periodMonth,
        dueDate: r.payment.dueDate,
        amountDue: money(r.payment.amountDue),
        amountPaid: money(r.payment.amountPaid),
        outstanding: money(r.outstanding),
        daysLate: r.payment.daysLate,
        status: r.payment.status,
        contractEndsInDays: daysUntil(r.contract.endDate),
      }));
    case "get_upcoming_payments": {
      const days = Number(input.days ?? 30) || 30;
      return getUpcomingPayments(store, days, scopeId, base)
        .slice(0, 40)
        .map((r) => ({ paymentId: r.payment.id, tenant: r.tenant.fullName, property: r.property.name, unit: r.unit.unitNumber, dueDate: r.payment.dueDate, amount: money(r.payment.amountDue) }));
    }
    case "get_late_payers": {
      const months = Number(input.months ?? t.repeatLateWindowMonths) || t.repeatLateWindowMonths;
      const minLate = Number(input.min_late ?? t.repeatLateMinCount) || t.repeatLateMinCount;
      return getLatePayers(store, months, minLate, scopeId).map((l) => ({
        tenantId: l.tenant.id,
        tenant: l.tenant.fullName,
        property: l.property.name,
        unitId: l.unit.id,
        unit: l.unit.unitNumber,
        contractId: l.contract.id,
        lateCount: l.lateCount,
        windowMonths: l.windowMonths,
        lateMonths: l.lateMonths,
        avgDaysLate: l.avgDaysLate,
        currentlyOverdue: l.currentlyOverdue,
        outstanding: money(l.outstanding),
      }));
    }
    case "get_outstanding_balance": {
      const ob = getOutstandingBalance(store);
      return { total: money(ob.total), payments: ob.count, byBuilding: ob.byProperty.map((b) => ({ propertyId: b.property.id, building: b.property.name, amount: money(b.amount), payments: b.count, sharePct: pct(b.share) })) };
    }
    case "get_vacant_units": {
      const minDays = Number(input.min_days ?? 0) || 0;
      const v = computeVacancyOpportunity(store, base);
      return {
        vacantUnits: v.vacantUnits,
        monthlyPotential: money(v.monthlyPotential),
        units: getVacantUnits(store, minDays, scopeId).map((r) => ({ unitId: r.unit.id, property: r.property.name, unit: r.unit.unitNumber, daysVacant: r.daysVacant, askingRent: r.askingRent, previousTenant: r.previousTenant?.fullName ?? null, rentMissed: r.lostRevenue })),
      };
    }
    case "get_alerts": {
      const limit = Number(input.limit ?? 15) || 15;
      return getAlerts(store, {
        severity: input.severity as AlertSeverity | undefined,
        category: input.category as AlertCategory | undefined,
        propertyId: scopeId,
      })
        .slice(0, limit)
        .map((a) => ({
          id: a.id,
          severity: a.severity,
          category: a.category,
          title: a.title,
          message: a.message,
          propertyId: a.propertyId,
          unitId: a.unitId,
          tenantId: a.tenantId,
          entityType: a.entityType,
          entityId: a.entityId,
          actions: a.actions.map((x) => ({ kind: x.kind, label: x.label, targetId: x.targetId })),
        }));
    }
    case "get_revenue_history": {
      const months = Number(input.months ?? 12) || 12;
      return getRevenueHistory(store, months, base, scopeId).map((p) => ({ month: p.period, billed: money(p.billed), collected: money(p.collected), occupancyPct: pct(p.occupancy) }));
    }
    case "get_recent_activity": {
      const limit = Number(input.limit ?? 20) || 20;
      return getActivity(store, undefined, undefined, limit).map((a) => ({ at: a.at, type: a.type, message: a.message, by: a.actor }));
    }
    case "search": {
      const r = searchAll(store, String(input.query ?? ""), 6);
      return {
        tenants: r.tenants.map((x) => ({ tenantId: x.tenant.id, name: x.tenant.fullName, property: x.property?.name ?? null, unit: x.unit?.unitNumber ?? null })),
        units: r.units.map((x) => ({ unitId: x.unit.id, property: x.property.name, unit: x.unit.unitNumber, status: x.unit.status, tenant: x.tenant?.fullName ?? null })),
        properties: r.properties.map((p) => ({ propertyId: p.id, name: p.name })),
        contracts: r.contracts.map((x) => ({ contractId: x.contract.id, number: x.contract.contractNumber, tenant: x.tenant?.fullName ?? null })),
      };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Ids the model may act on — kept for validation of returned actions. */
export function knownActionTarget(store: Store, kind: string, id: ID): boolean {
  const idx = indexStore(store);
  switch (kind) {
    case "record_payment":
      return idx.paymentById.has(id);
    case "send_reminder":
    case "view_tenant":
      return idx.tenantById.has(id);
    case "renew_contract":
    case "mark_as_leaving":
    case "view_contract":
      return idx.contractById.has(id);
    case "view_unit":
      return idx.unitById.has(id);
    case "view_property":
      return idx.propertyById.has(id);
    default:
      return false;
  }
}

export function contractIsOccupying(store: Store, contractId: ID): boolean {
  const c = indexStore(store).contractById.get(contractId);
  return c ? isOccupying(c) : false;
}
