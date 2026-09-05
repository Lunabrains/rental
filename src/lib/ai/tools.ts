import { indexStore } from "@/lib/data/store";
import { isOccupying } from "@/lib/derived/recompute";
import { getDailyBriefing } from "@/lib/derived/briefing";
import { collectionRate } from "@/lib/derived/metrics";
import { addPeriods, currentPeriod, daysUntil, today } from "@/lib/date";
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
  getRentRoll,
  getRenewals,
  getPortfolioComparison,
  getUnitRankings,
  getExpenses,
  getMaintenanceSummary,
  getWorkOrders,
  getPreventivePlans,
  getSuppliers,
  getSupplierDetails,
  getCashFlowForecast,
} from "@/lib/queries";
import type { AlertCategory, AlertSeverity, ExpenseCategory, ID, Property, Store } from "@/types";

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
    name: "get_rent_roll",
    description: "Rent roll for a month: every rentable unit with tenant, rent due, paid, outstanding and status, plus summary totals and the collection rate.",
    input_schema: { type: "object", properties: { ...optionalProperty, period: { type: "string", description: "YYYY-MM; defaults to this month" } }, additionalProperties: false },
  },
  {
    name: "get_collection_rate",
    description: "Collection rate (collected ÷ due) for a month with the six-month history.",
    input_schema: { type: "object", properties: { ...optionalProperty, period: { type: "string", description: "YYYY-MM; defaults to this month" } }, additionalProperties: false },
  },
  {
    name: "get_renewal_decisions",
    description: "Contracts ending within 90 days that still await the owner's renewal decision, with reliability and arrears.",
    input_schema: { type: "object", properties: { ...optionalProperty }, additionalProperties: false },
  },
  {
    name: "get_building_performance",
    description: "Building-by-building profitability: revenue, collected, operating expenses, maintenance, CapEx, NOI, margin, occupancy, outstanding and health score. Also returns the best and worst building.",
    input_schema: { type: "object", properties: { window: { type: "string", enum: ["month", "ytd", "12m"], description: "Defaults to ytd" } }, additionalProperties: false },
  },
  {
    name: "get_unit_profitability",
    description: "Units ranked by net contribution or maintenance cost over the window: rent billed, costs, net, maintenance, vacancy days.",
    input_schema: { type: "object", properties: { ...optionalProperty, window: { type: "string", enum: ["month", "ytd", "12m"] }, sort: { type: "string", enum: ["net", "maintenance", "costs"], description: "Defaults to net (best first); maintenance sorts highest maintenance first" }, limit: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "get_expenses_summary",
    description: "Expense totals for a period (YYYY or YYYY-MM) by category, building and supplier, with month-over-month change per category, optionally filtered by category.",
    input_schema: { type: "object", properties: { ...optionalProperty, period: { type: "string", description: "YYYY or YYYY-MM; defaults to this year" }, category: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "get_maintenance_summary",
    description: "Open, emergency, awaiting-approval and overdue work orders, spend, average resolution time, repeat issues, and the list of overdue jobs and repeat-issue units.",
    input_schema: { type: "object", properties: { ...optionalProperty }, additionalProperties: false },
  },
  {
    name: "get_assets_due",
    description: "Preventive services due or overdue within N days, with asset, building, supplier and estimated cost.",
    input_schema: { type: "object", properties: { ...optionalProperty, days: { type: "number", description: "Defaults to 30" } }, additionalProperties: false },
  },
  {
    name: "get_supplier_performance",
    description: "Supplier scores: response and completion days, repeat-issue rate, cost vs quote, jobs and spend. Pass a supplier name for one supplier's detail including what was paid this year.",
    input_schema: { type: "object", properties: { supplier: { type: "string", description: "Supplier name or id; omit for all" } }, additionalProperties: false },
  },
  {
    name: "get_cash_flow_forecast",
    description: "Month-by-month cash forecast for the next 1–12 months: expected rent, rent at risk, invoices, recurring costs, services, CapEx, deposit refunds, net and running balance. An estimate built from the records.",
    input_schema: { type: "object", properties: { ...optionalProperty, months: { type: "number", description: "1–12, defaults to 3" } }, additionalProperties: false },
  },
  {
    name: "get_briefing",
    description: "Today's owner briefing: headline, narrative and the items under Decide today, Money, Today & this week, Operations and Good news, each with clickable actions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
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
              kind: { type: "string", enum: ["record_payment", "send_reminder", "renew_contract", "mark_as_leaving", "view_unit", "view_tenant", "view_property", "view_contract", "view_work_order", "view_asset", "view_supplier", "view_inspection", "view_renovation", "view_deposit", "view_expense", "create_work_order", "create_reminder", "approve_work_order", "schedule_service", "settle_deposit", "resolve_alert"] },
              label: { type: "string" },
              targetId: { type: "string", description: "The id from the tool results: payment, contract, unit, tenant, property, work order, asset, supplier, inspection, renovation, deposit, expense, plan or alert id. Actions that change data open a form the owner must confirm." },
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
      const scopedRows = scopeId ? getVacantUnits(store, 0, scopeId) : null;
      return {
        property: scope?.name ?? null,
        vacantUnits: scopedRows ? scopedRows.length : v.vacantUnits,
        monthlyPotential: money(scopedRows ? scopedRows.reduce((n, r) => n + r.askingRent, 0) : v.monthlyPotential),
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
    case "get_rent_roll": {
      const period = typeof input.period === "string" && /^\d{4}-\d{2}$/.test(input.period) ? input.period : currentPeriod();
      const rr = getRentRoll(store, { propertyId: scopeId, period }, base);
      return { period, summary: rr.summary, rows: rr.rows.slice(0, 60).map((r) => ({ unitId: r.unit.id, property: r.property.name, unit: r.unit.unitNumber, tenantId: r.tenant?.id ?? null, tenant: r.tenant?.fullName ?? null, contractId: r.contract?.id ?? null, paymentId: r.payment?.id ?? null, rent: money(r.rent), due: money(r.amountDue), paid: money(r.amountPaid), outstanding: money(r.outstanding), status: r.status, daysOverdue: r.daysOverdue, contractEnd: r.contractEnd })) };
    }
    case "get_collection_rate": {
      const period = typeof input.period === "string" && /^\d{4}-\d{2}$/.test(input.period) ? input.period : currentPeriod();
      const payments = store.payments.filter((p) => !scopeId || p.propertyId === scopeId);
      const cr = collectionRate(payments, period, period === currentPeriod() ? base : undefined);
      const history = Array.from({ length: 6 }, (_, i) => addPeriods(period, -5 + i)).map((p) => {
        const r = collectionRate(payments, p, p === currentPeriod() ? base : undefined);
        return { month: p, due: money(r.due), collected: money(r.collected), ratePct: pct(r.rate) };
      });
      return { period, property: scope?.name ?? null, due: money(cr.due), collected: money(cr.collected), rate: pct(cr.rate), history };
    }
    case "get_renewal_decisions":
      return getRenewals(store, 90, scopeId, base)
        .filter((r) => r.contract.renewalStatus === "awaiting_decision" || (r.contract.renewalDecision === null && r.daysRemaining <= 60))
        .map((r) => ({ contractId: r.contract.id, tenantId: r.tenant.id, tenant: r.tenant.fullName, property: r.property.name, unitId: r.unit.id, unit: r.unit.unitNumber, endDate: r.contract.endDate, daysRemaining: r.daysRemaining, monthlyRent: money(r.contract.monthlyRent), proposedRent: r.contract.proposedRent, suggestedRent: r.suggestedRent, reliable: r.reliable, hasOverdue: r.hasOverdue, outstanding: money(r.outstanding), renewalStatus: r.contract.renewalStatus }));
    case "get_building_performance": {
      const window = input.window === "month" || input.window === "12m" ? input.window : "ytd";
      const cmp = getPortfolioComparison(store, window, base);
      const row = (r: (typeof cmp.rows)[number]) => ({ propertyId: r.property.id, building: r.property.name, units: r.units, occupancyPct: pct(r.occupancy), revenue: money(r.revenue), collected: money(r.collected), collectionPct: pct(r.collectionRate), operatingExpenses: money(r.operatingExpenses), maintenance: money(r.maintenance), capex: money(r.capex), noi: money(r.noi), marginPct: pct(r.margin), noiPerUnit: money(r.noiPerUnit), outstanding: money(r.outstanding), vacancyLoss: money(r.vacancyLoss), health: r.health });
      return { window: cmp.window, label: cmp.label, rows: cmp.rows.map(row), best: cmp.best ? row(cmp.best) : null, worst: cmp.worst ? row(cmp.worst) : null };
    }
    case "get_unit_profitability": {
      const window = input.window === "month" || input.window === "ytd" ? input.window : "12m";
      const sort = input.sort === "maintenance" ? "maintenance" : input.sort === "costs" ? "costs" : "net";
      const limit = Number(input.limit ?? 15) || 15;
      const rows = getUnitRankings(store, window, scopeId, base);
      const sorted = sort === "net" ? rows : [...rows].sort((a, b) => b[sort] - a[sort]);
      return sorted.slice(0, limit).map((r) => ({ unitId: r.unit.id, property: r.property.name, unit: r.unit.unitNumber, tenant: r.tenant, rentBilled: money(r.rentBilled), costs: money(r.costs), maintenance: money(r.maintenance), net: money(r.net), vacancyDays: r.vacancyDays }));
    }
    case "get_expenses_summary": {
      const period = typeof input.period === "string" && /^\d{4}(-\d{2})?$/.test(input.period) ? input.period : base.slice(0, 4);
      const category = typeof input.category === "string" ? (input.category.toLowerCase().replace(/\s+/g, "_") as ExpenseCategory) : undefined;
      const rows = getExpenses(store, { propertyId: scopeId, period, category }, base);
      const sumBy = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
        const m = new Map<K, { amount: number; count: number }>();
        for (const r of rows) {
          const k = key(r);
          const cur = m.get(k) ?? { amount: 0, count: 0 };
          cur.amount += r.expense.amount;
          cur.count += 1;
          m.set(k, cur);
        }
        return [...m.entries()].map(([k, v]) => ({ key: k, amount: money(v.amount), count: v.count })).sort((a, b) => b.amount - a.amount);
      };
      const cur = currentPeriod();
      const prev = addPeriods(cur, -1);
      const byCat = (p: string) => {
        const m = new Map<string, number>();
        for (const r of getExpenses(store, { propertyId: scopeId, period: p }, base)) m.set(r.expense.category, (m.get(r.expense.category) ?? 0) + r.expense.amount);
        return m;
      };
      const a = byCat(cur);
      const b = byCat(prev);
      return {
        period,
        total: money(rows.reduce((n, r) => n + r.expense.amount, 0)),
        count: rows.length,
        capex: money(rows.filter((r) => r.expense.classification === "capex").reduce((n, r) => n + r.expense.amount, 0)),
        byCategory: sumBy((r) => r.expense.category),
        byBuilding: sumBy((r) => r.property.name),
        bySupplier: sumBy((r) => r.supplier?.name ?? "none"),
        monthOverMonth: [...new Set([...a.keys(), ...b.keys()])].map((c) => ({ category: c, thisMonth: money(a.get(c) ?? 0), lastMonth: money(b.get(c) ?? 0), change: money((a.get(c) ?? 0) - (b.get(c) ?? 0)) })).sort((x, y) => y.change - x.change),
        largest: rows.slice(0, 10).map((r) => ({ expenseId: r.expense.id, date: r.expense.expenseDate, description: r.expense.description, category: r.expense.category, building: r.property.name, supplier: r.supplier?.name ?? null, amount: money(r.expense.amount), status: r.expense.paymentStatus })),
      };
    }
    case "get_maintenance_summary": {
      const m = getMaintenanceSummary(store, scopeId, base);
      const open = getWorkOrders(store, { propertyId: scopeId, status: "open" }, base);
      const groups = new Map<string, { unitId: string; unit: string; property: string; category: string; count: number }>();
      for (const w of store.workOrders) {
        if (w.status === "cancelled" || !w.unitId || (scopeId && w.propertyId !== scopeId)) continue;
        const key = `${w.unitId}|${w.category}`;
        const g = groups.get(key) ?? { unitId: w.unitId, unit: idx.unitById.get(w.unitId)?.unitNumber ?? "", property: idx.propertyById.get(w.propertyId)?.name ?? "", category: w.category, count: 0 };
        g.count += 1;
        groups.set(key, g);
      }
      return {
        ...m,
        spendLast30: money(m.spendLast30),
        spendThisMonth: money(m.spendThisMonth),
        overdue: open.filter((r) => r.overdue).sort((a, b) => b.ageDays - a.ageDays).map((r) => ({ workOrderId: r.workOrder.id, number: r.workOrder.number, title: r.workOrder.title, property: r.property.name, unit: r.unit?.unitNumber ?? null, status: r.workOrder.status, priority: r.workOrder.priority, ageDays: r.ageDays, supplier: r.supplier?.name ?? null })),
        awaitingApprovalList: open.filter((r) => r.workOrder.status === "awaiting_approval").map((r) => ({ workOrderId: r.workOrder.id, number: r.workOrder.number, title: r.workOrder.title, quote: money(r.workOrder.estimatedCost ?? 0), supplier: r.supplier?.name ?? null })),
        repeatIssueUnits: [...groups.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count),
      };
    }
    case "get_assets_due": {
      const days = Number(input.days ?? 30) || 30;
      return getPreventivePlans(store, { propertyId: scopeId }, base)
        .filter((r) => r.state !== "paused" && r.daysUntil <= days)
        .sort((a, b) => a.daysUntil - b.daysUntil)
        .map((r) => ({ planId: r.plan.id, service: r.plan.maintenanceType, assetId: r.asset?.id ?? null, asset: r.asset?.name ?? null, property: r.property.name, nextServiceDate: r.plan.nextServiceDate, daysUntil: r.daysUntil, state: r.state, supplier: r.supplier?.name ?? null, estimatedCost: r.plan.estimatedCost }));
    }
    case "get_supplier_performance": {
      const q = typeof input.supplier === "string" ? input.supplier.trim().toLowerCase() : "";
      const rows = getSuppliers(store);
      const shape = (r: (typeof rows)[number]) => ({ supplierId: r.supplier.id, name: r.supplier.name, category: r.supplier.category, active: r.supplier.active, rating: r.supplier.rating, score: r.score, scoreLabel: r.scoreLabel, jobs: r.jobs, completedJobs: r.completedJobs, openJobs: r.openJobs, avgResponseDays: r.avgResponseDays, avgCompletionDays: r.avgCompletionDays, repeatIssueRatePct: r.repeatIssueRate === null ? null : pct(r.repeatIssueRate), costVsQuotePct: r.costVariance === null ? null : pct(r.costVariance - 1), totalSpend: money(r.totalSpend), lastJobAt: r.lastJobAt });
      if (!q) return rows.map(shape);
      const hit = rows.find((r) => r.supplier.id === q || r.supplier.name.toLowerCase() === q) ?? rows.find((r) => r.supplier.name.toLowerCase().includes(q) || (r.supplier.company ?? "").toLowerCase().includes(q));
      if (!hit) return { error: `No supplier matches "${input.supplier}"`, known: rows.map((r) => r.supplier.name) };
      const d = getSupplierDetails(store, hit.supplier.id, base);
      const year = base.slice(0, 4);
      return { ...shape(hit), paidThisYear: money((d?.expenses ?? []).filter((e) => e.expense.expenseDate.startsWith(year)).reduce((n, e) => n + e.expense.amount, 0)), spendByYear: d?.spendByYear ?? [], recentJobs: (d?.workOrders ?? []).slice(0, 8).map((w) => ({ workOrderId: w.workOrder.id, number: w.workOrder.number, title: w.workOrder.title, status: w.workOrder.status, property: w.property.name, cost: money(w.cost) })) };
    }
    case "get_cash_flow_forecast": {
      const months = Math.max(1, Math.min(12, Number(input.months ?? 3) || 3));
      const f = getCashFlowForecast(store, { months, propertyId: scopeId }, base);
      return { from: f.from, to: f.to, collectionRatePct: pct(f.collectionRate), likelyCollected: money(f.likelyCollected), vacancyRunRate: money(f.vacancyRunRate), totals: { inflows: money(f.totals.inflows), rentAtRisk: money(f.totals.rentAtRisk), outflows: money(f.totals.outflows), capex: money(f.totals.capex), net: money(f.totals.net) }, months: f.months.map((m) => ({ month: m.period, rentExpected: money(m.rentExpected), rentAtRisk: money(m.rentAtRisk), invoicesDue: money(m.expensesDue), recurring: money(m.expensesRecurring), services: money(m.services), capex: money(m.capex), depositRefunds: money(m.depositRefunds), inflows: money(m.inflows), outflows: money(m.outflows), net: money(m.net), cumulative: money(m.cumulative) })) };
    }
    case "get_briefing": {
      const b = getDailyBriefing(store, base);
      return { date: b.date, headline: b.headline, narrative: b.narrative, numbers: b.numbers, sections: b.sections.map((s) => ({ key: s.key, title: s.title, items: s.items.slice(0, 10).map((i) => ({ id: i.id, title: i.title, detail: i.detail, tone: i.tone, actions: i.actions })) })) };
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
    case "view_work_order":
    case "approve_work_order":
      return idx.workOrderById.has(id);
    case "view_asset":
      return idx.assetById.has(id);
    case "view_supplier":
      return idx.supplierById.has(id);
    case "view_inspection":
      return idx.inspectionById.has(id);
    case "view_renovation":
      return idx.renovationById.has(id);
    case "view_deposit":
    case "settle_deposit":
      return idx.depositById.has(id);
    case "view_expense":
    case "record_expense_payment":
      return idx.expenseById.has(id);
    case "schedule_service":
      return idx.planById.has(id);
    case "create_work_order":
      return idx.unitById.has(id) || idx.propertyById.has(id) || idx.assetById.has(id) || idx.inspectionById.has(id);
    case "create_reminder":
      return id === "portfolio" || idx.tenantById.has(id) || idx.unitById.has(id) || idx.propertyById.has(id);
    case "resolve_alert":
      return store.alerts.some((a) => a.id === id);
    default:
      return false;
  }
}

export function contractIsOccupying(store: Store, contractId: ID): boolean {
  const c = indexStore(store).contractById.get(contractId);
  return c ? isOccupying(c) : false;
}
