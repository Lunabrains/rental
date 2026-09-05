"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Building2, CircleDollarSign, DoorOpen, Gauge, KeyRound, LogOut, RefreshCw, UserPlus, Wrench } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { AlertRow } from "@/components/alerts/alert-row";
import { UnitStatusBadge } from "@/components/common/badges";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { ScoreBadge, ScoreBreakdown } from "@/components/common/score";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badge";
import { Timeline } from "@/components/common/timeline";
import { DocumentPreview } from "@/components/documents/document-preview";
import { expenseColumns, workOrderColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AvailablePanel } from "@/components/units/available-panel";
import { ContractTab } from "@/components/units/contract-tab";
import { DocumentsTab } from "@/components/units/documents-tab";
import { PaymentsTab } from "@/components/units/payments-tab";
import { Field, TenantTab } from "@/components/units/tenant-tab";
import { useStore } from "@/lib/data/store-context";
import { daysUntil } from "@/lib/date";
import { formatDate, formatMoney, formatMonth as formatMonthLabel, formatPercent, labelize } from "@/lib/format";
import { getUnit360, getUnitProfitability, type InspectionRow, type MeterRow, type ProfitabilityWindow, type TimelineEvent, type Unit360 } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { StoredDocument } from "@/types";

type Tab = "overview" | "tenancy" | "payments" | "profitability" | "maintenance" | "inspections" | "utilities" | "documents" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "tenancy", label: "Tenant & contract" },
  { key: "payments", label: "Payments" },
  { key: "profitability", label: "Profitability" },
  { key: "maintenance", label: "Maintenance" },
  { key: "inspections", label: "Inspections" },
  { key: "utilities", label: "Utilities" },
  { key: "documents", label: "Documents" },
  { key: "history", label: "History" },
];

/**
 * Unit 360°: everything about one apartment on a full page — the plan's
 * §Phase 2 unit screen. The drawer stays the quick view from the grid.
 */
export function UnitPage({ unitId }: { unitId: string }) {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openUnit, recordPayment, renewContract, markAsLeaving, addTenant, openTenant } = useActions();
  const u = useMemo(() => getUnit360(store, unitId), [store, unitId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  const tabParam = params.get("tab");
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "overview";
  const setTab = useCallback(
    (t: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (t === "overview") sp.delete("tab");
      else sp.set("tab", t);
      router.replace(`/units/${unitId}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router, unitId],
  );

  if (!u) {
    return (
      <EmptyState
        icon={DoorOpen}
        title="Unit not found"
        action={
          <Button asChild variant="outline">
            <Link href="/properties">All properties</Link>
          </Button>
        }
      />
    );
  }

  const rented = u.unit.status === "rented" && u.tenant !== null && u.contract !== null;
  const nextPayment = u.payments.find((p) => p.status === "overdue" || p.status === "partial") ?? u.payments.find((p) => p.status === "due");
  const daysLeft = u.contract ? daysUntil(u.contract.endDate) : null;
  const unitAlerts = u.alerts.filter((a) => !a.resolved);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Properties", href: "/properties" }, { label: u.property.name, href: `/properties/${u.property.id}` }, { label: u.unit.unitNumber }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">Unit {u.unit.unitNumber}</span>
            <UnitStatusBadge status={u.unit.status} />
            <ScoreBadge score={u.health.score} label="Unit health" components={u.health.components} caption="Informational — weighted from maintenance cost, repeat issues, condition, vacancy, payments and renovation need." />
          </span>
        }
        description={`${u.property.name} · floor ${u.unit.floor} · ${u.unit.bedrooms} BR · ${u.unit.bathrooms} bath · ${u.unit.sizeSqm} m² · ${u.unit.furnished ? "furnished" : "unfurnished"} · condition ${labelize(u.unit.condition).toLowerCase()}`}
        actions={
          <>
            <Button variant="outline" onClick={() => openUnit(u.unit.id)}>
              <Building2 className="size-4" /> Building grid
            </Button>
            {rented && nextPayment && (
              <Button variant="outline" onClick={() => recordPayment(nextPayment.id)}>
                <CircleDollarSign className="size-4" /> Record payment
              </Button>
            )}
            {rented && u.contract && (
              <>
                <Button variant="outline" onClick={() => markAsLeaving(u.contract!.id)}>
                  <LogOut className="size-4" /> Mark as leaving
                </Button>
                <Button onClick={() => renewContract(u.contract!.id)}>
                  <RefreshCw className="size-4" /> Renew
                </Button>
              </>
            )}
            {!rented && u.unit.status === "available" && (
              <Button onClick={() => addTenant(u.unit.id)}>
                <UserPlus className="size-4" /> Add tenant
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={rented ? "Current rent" : "Asking rent"} value={formatMoney(rented && u.contract ? u.contract.monthlyRent : u.unit.askingRent)} sublabel={u.unit.marketRent ? `Market reference ${formatMoney(u.unit.marketRent)}` : u.unit.lastRent ? `Last contracted ${formatMoney(u.unit.lastRent)}` : "No market reference set"} />
        <KpiCard
          label="Contract"
          value={u.contract && daysLeft !== null ? (daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`) : "—"}
          sublabel={u.contract ? `${u.contract.contractNumber} · ends ${formatDate(u.contract.endDate)}` : u.daysVacant !== null ? `Vacant ${u.daysVacant} days` : "No contract"}
          tone={daysLeft !== null && daysLeft <= 30 ? "warning" : "default"}
        />
        <KpiCard label="Outstanding" value={u.totals.outstanding > 0 ? formatMoney(u.totals.outstanding) : "—"} sublabel={u.totals.outstanding > 0 ? `${u.payments.filter((p) => p.status === "overdue" || p.status === "partial").length} unpaid` : "Rent is settled"} tone={u.totals.outstanding > 0 ? "critical" : "success"} />
        <KpiCard label="Security deposit" value={u.deposit ? formatMoney(u.deposit.deposit.amountHeld) : "—"} sublabel={u.deposit ? `${labelize(u.deposit.deposit.status)}${u.deposit.deducted > 0 ? ` · ${formatMoney(u.deposit.deducted)} deducted` : ""}` : "No deposit on record"} tone={u.deposit?.deposit.status === "pending" ? "warning" : "default"} />
        <KpiCard
          label="Payment reliability"
          value={u.reliability?.score === null || u.reliability === null ? "—" : <ScoreBadge score={u.reliability.score} label="Payment reliability" components={u.reliability.components} scale={1} caption="Internal indicator from this ledger only — not a credit score." size="lg" />}
          sublabel={u.reliability ? `${u.reliability.label} · ${formatPercent(u.totals.onTimeRate)} on time` : "No tenant"}
        />
        <KpiCard label="Maintenance YTD" value={formatMoney(u.maintenanceYtd)} sublabel={`${formatMoney(u.maintenanceLast12)} in the last 12 months · ${u.workOrders.filter((w) => w.isOpen).length} open`} tone={u.workOrders.some((w) => w.isOpen && w.workOrder.priority === "emergency") ? "critical" : "default"} />
        <KpiCard label="Vacancy" value={u.daysVacant !== null ? `${u.daysVacant} days` : "Occupied"} sublabel={u.daysVacant !== null ? `Est. ${formatMoney(u.reference.loss)} lost (${u.reference.source.replace("_", " ")})` : `${u.vacancyHistory.length} past vacancy spell${u.vacancyHistory.length === 1 ? "" : "s"}`} tone={u.daysVacant !== null && u.daysVacant > store.settings.thresholds.vacantWarningDays ? "warning" : "default"} />
        <KpiCard label="Alerts" value={unitAlerts.length} sublabel={unitAlerts.length > 0 ? unitAlerts[0].title.split(" — ")[0] : "Nothing open"} tone={unitAlerts.some((a) => a.severity === "critical") ? "critical" : unitAlerts.length > 0 ? "warning" : "success"} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" className="h-10 w-max justify-start gap-1 bg-transparent p-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="px-3 text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {tab === "overview" && <Overview u={u} rented={rented} alerts={unitAlerts} onTenant={openTenant} />}

      {tab === "tenancy" &&
        (rented ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title="Tenant">
              <TenantTab details={u} />
              <div className="mt-4 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => openTenant(u.tenant!.id)}>
                  Full tenant profile
                </Button>
              </div>
            </SectionCard>
            <SectionCard title="Contract">
              <ContractTab details={u} onPreview={setPreview} />
              {u.contract && (u.contract.rentIncreaseClause || u.contract.specialTerms || u.contract.renewalStatus !== "not_due") && (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
                  <Field label="Renewal">
                    <StatusBadge value={u.contract.renewalStatus} />
                  </Field>
                  <Field label="Proposed rent">{u.contract.proposedRent ? formatMoney(u.contract.proposedRent) : "—"}</Field>
                  <Field label="Increase clause">{u.contract.rentIncreaseClause ?? "—"}</Field>
                  <Field label="Special terms">{u.contract.specialTerms ?? "—"}</Field>
                </dl>
              )}
            </SectionCard>
          </div>
        ) : (
          <SectionCard title="Available unit">
            <AvailablePanel details={u} />
          </SectionCard>
        ))}

      {tab === "payments" && (
        <SectionCard title="Payments" description={rented ? "Ledger for the current tenancy" : "No current tenancy"}>
          {u.payments.length === 0 ? <EmptyState compact icon={CircleDollarSign} title="No payments" /> : <PaymentsTab details={u} />}
        </SectionCard>
      )}

      {tab === "profitability" && <ProfitabilityTab unitId={u.unit.id} />}
      {tab === "maintenance" && <MaintenanceTab u={u} />}
      {tab === "inspections" && <InspectionsTab rows={u.inspections} unitId={u.unit.id} propertyId={u.property.id} />}
      {tab === "utilities" && <UtilitiesTab meters={u.meters} />}
      {tab === "documents" && (
        <SectionCard title="Documents">
          <DocumentsTab details={u} onPreview={setPreview} />
        </SectionCard>
      )}
      {tab === "history" && <HistoryTab u={u} />}

      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/* --------------------------------- Overview ------------------------------- */

function Overview({ u, rented, alerts, onTenant }: { u: Unit360; rented: boolean; alerts: Unit360["alerts"]; onTenant: (id: string) => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        {rented && u.tenant && u.contract ? (
          <SectionCard title="Current tenancy" description={`${u.tenant.fullName} · since ${formatDate(u.history.filter((c) => c.tenantId === u.tenant!.id).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0]?.startDate)}`} action={<Button size="sm" variant="outline" onClick={() => onTenant(u.tenant!.id)}>Profile</Button>}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Rent">{formatMoney(u.contract.monthlyRent)}/month</Field>
              <Field label="Contract">{u.contract.contractNumber}</Field>
              <Field label="Term">
                {formatDate(u.contract.startDate)} → {formatDate(u.contract.endDate)}
              </Field>
              <Field label="Payment day">{u.contract.paymentDay}</Field>
              <Field label="Method">{labelize(u.contract.paymentMethod)}</Field>
              <Field label="Renewal">
                <StatusBadge value={u.contract.renewalStatus} />
              </Field>
              <Field label="Phone">{u.tenant.phone}</Field>
              <Field label="Email">{u.tenant.email || "—"}</Field>
              <Field label="Paid to date">{formatMoney(u.totals.paid)}</Field>
            </dl>
          </SectionCard>
        ) : (
          <SectionCard title={u.unit.status === "available" ? "Available" : labelize(u.unit.status)}>
            <AvailablePanel details={u} />
          </SectionCard>
        )}

        <SectionCard title="Needs attention" description={alerts.length > 0 ? `${alerts.length} open alert${alerts.length === 1 ? "" : "s"}` : "No open alerts"}>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is flagged for this unit.</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => (
                <AlertRow key={a.id} alert={a} maxActions={1} compact />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Vacancy history" description={u.vacancyHistory.length === 0 ? "Never vacant on record" : `${u.vacancyHistory.length} spell${u.vacancyHistory.length === 1 ? "" : "s"}`}>
          {u.vacancyHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gaps between tenancies on record.</p>
          ) : (
            <ul className="divide-y">
              {u.vacancyHistory.map((v) => (
                <li key={v.from} className="flex items-center gap-3 py-2 text-sm">
                  <span className={cn("tabular w-14 shrink-0 font-semibold", v.to === null ? "text-warning-foreground" : "text-foreground")}>{v.days}d</span>
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      {formatDate(v.from)} → {v.to ? formatDate(v.to) : "today"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {v.previousTenant ? `after ${v.previousTenant.fullName}` : ""}
                      {v.nextTenant ? ` · then ${v.nextTenant.fullName}` : v.to === null ? " · still vacant" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="space-y-5">
        <SectionCard>
          <ScoreBreakdown score={u.health.score} label="Unit health" components={u.health.components} caption="Informational — weighted from maintenance cost, repeat issues, condition, vacancy, payments and renovation need." />
        </SectionCard>
        {u.reliability && u.reliability.score !== null && (
          <SectionCard>
            <ScoreBreakdown score={u.reliability.score} label={`Payment reliability · ${u.reliability.label}`} components={u.reliability.components} scale={1} caption="Internal indicator computed only from this ledger — not a credit score." />
          </SectionCard>
        )}
        <SectionCard title="Deposit" description={u.deposit ? labelize(u.deposit.deposit.status) : "No deposit on record"}>
          {u.deposit ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Expected">{formatMoney(u.deposit.deposit.amountExpected)}</Field>
              <Field label="Received">{u.deposit.deposit.amountReceived > 0 ? `${formatMoney(u.deposit.deposit.amountReceived)} · ${formatDate(u.deposit.deposit.receivedDate)}` : "Not yet"}</Field>
              <Field label="Deductions">{u.deposit.deducted > 0 ? formatMoney(u.deposit.deducted) : "—"}</Field>
              <Field label="Held">{formatMoney(u.deposit.deposit.amountHeld)}</Field>
              {u.deposit.deposit.settlementDate && <Field label="Settled">{`${formatDate(u.deposit.deposit.settlementDate)} · refund ${formatMoney(u.deposit.deposit.finalRefund ?? 0)}`}</Field>}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">A deposit record is created with each contract.</p>
          )}
        </SectionCard>
        <SectionCard title="Keys & parking">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Keys issued">{u.keys.filter((k) => k.key.status === "issued").length > 0 ? u.keys.filter((k) => k.key.status === "issued").map((k) => labelize(k.key.type)).join(", ") : "None"}</Field>
            <Field label="Keys in office">{u.keys.filter((k) => k.key.status === "in_office").length || "—"}</Field>
            <Field label="Parking">{u.parking.length > 0 ? u.parking.map((p) => `${p.space.spaceNumber}${p.space.vehiclePlate ? ` (${p.space.vehiclePlate})` : ""}`).join(", ") : "No space assigned"}</Field>
            <Field label="Lost keys">{u.keys.filter((k) => k.key.status === "lost").length || "—"}</Field>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button asChild size="sm" variant="outline"><Link href={`/keys?property=${u.property.id}&unit=${u.unit.id}`}>Keys</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`/parking?property=${u.property.id}&unit=${u.unit.id}`}>Parking</Link></Button>
          </div>
          {u.keys.some((k) => k.key.status === "lost") && (
            <p className="mt-2 flex items-center gap-1 text-xs text-warning-foreground">
              <KeyRound className="size-3.5" /> A key for this unit is recorded as lost.
            </p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ------------------------------- Profitability ---------------------------- */

function ProfitabilityTab({ unitId }: { unitId: string }) {
  const store = useStore();
  const [window, setWindow] = useState<ProfitabilityWindow>("12m");
  const p = useMemo(() => getUnitProfitability(store, unitId, window), [store, unitId, window]);
  if (!p) return null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Chips<ProfitabilityWindow> aria-label="Window" value={window} onChange={setWindow} options={[{ value: "month", label: "This month" }, { value: "ytd", label: "Year to date" }, { value: "12m", label: "12 months" }]} />
        <span className="text-xs text-muted-foreground">{p.label} · {p.months} month{p.months === 1 ? "" : "s"}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Rent billed" value={formatMoney(p.rentBilled)} sublabel={`${formatMoney(p.rentCollected)} collected`} />
        <KpiCard label="Costs attributed" value={formatMoney(p.operatingExpenses + p.maintenanceCost)} sublabel={`${formatMoney(p.operatingExpenses)} expenses · ${formatMoney(p.maintenanceCost)} work orders`} />
        <KpiCard label="Net contribution" value={formatMoney(p.netContribution)} sublabel={`${formatPercent(p.margin)} of rent billed`} tone={p.netContribution < 0 ? "critical" : p.margin < 0.7 ? "warning" : "success"} />
        <KpiCard label="Vacancy loss*" value={p.vacancyLoss > 0 ? formatMoney(p.vacancyLoss) : "—"} sublabel={`${p.vacancyDays} vacant days in the window${p.capex > 0 ? ` · CapEx ${formatMoney(p.capex)} kept separate` : ""}`} tone={p.vacancyLoss > 0 ? "warning" : "default"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Breakdown" description="Every figure comes from the ledger, expenses and work orders on this unit">
          <ul className="divide-y">
            {p.breakdown.map((b) => (
              <li key={b.label} className="flex items-center justify-between py-2 text-sm">
                <span className={cn((b.tone === "estimate" || b.tone === "capex") && "text-muted-foreground")}>{b.label}</span>
                <span className={cn("tabular font-medium", b.amount < 0 && b.tone === "cost" && "text-critical", b.tone === "income" && "text-success", (b.tone === "estimate" || b.tone === "capex") && "text-muted-foreground")}>{b.amount < 0 ? `−${formatMoney(Math.abs(b.amount))}` : formatMoney(b.amount)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between py-2 text-sm font-semibold">
              <span>Operational net contribution</span>
              <span className={cn("tabular", p.netContribution < 0 && "text-critical")}>{formatMoney(p.netContribution)}</span>
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">*Vacancy loss is an estimate at the reference rent and is not subtracted from the net contribution.</p>
        </SectionCard>
        <SectionCard title="Month by month" flush>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 text-right font-medium">Rent billed</th>
                <th className="px-4 py-2 text-right font-medium">Costs</th>
                <th className="px-4 py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {p.monthly.slice().reverse().map((m) => (
                <tr key={m.period} className="border-t">
                  <td className="px-4 py-1.5">{formatMonthLabel(m.period)}</td>
                  <td className="px-4 py-1.5 text-right">{m.billed > 0 ? formatMoney(m.billed) : "—"}</td>
                  <td className="px-4 py-1.5 text-right">{m.expenses > 0 ? formatMoney(m.expenses) : "—"}</td>
                  <td className={cn("px-4 py-1.5 text-right font-medium", m.net < 0 && "text-critical")}>{formatMoney(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
    </div>
  );
}

/* -------------------------------- Maintenance ----------------------------- */

function MaintenanceTab({ u }: { u: Unit360 }) {
  const { openWorkOrder, createWorkOrder, openRenovation, createRenovation } = useActions();
  const open = u.workOrders.filter((w) => w.isOpen);
  const repeats = u.alerts.filter((a) => a.type === "maintenance_repeat_issue").length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Open work orders" value={open.length} tone={open.some((w) => w.workOrder.priority === "emergency") ? "critical" : open.length > 0 ? "warning" : "success"} sublabel={open.length > 0 ? open[0].workOrder.title : "Nothing open"} />
        <KpiCard label="Spend YTD" value={formatMoney(u.maintenanceYtd)} sublabel={`${formatMoney(u.maintenanceLast12)} last 12 months`} />
        <KpiCard label="Work orders (all time)" value={u.workOrders.length} sublabel={`${u.workOrders.filter((w) => !w.isOpen).length} completed`} />
        <KpiCard label="Repeat issues" value={repeats} tone={repeats > 0 ? "warning" : "success"} sublabel={repeats > 0 ? "Same problem keeps coming back" : "None detected"} icon={Wrench} />
      </div>
      <SectionCard title="Work orders" action={<Button size="sm" variant="outline" onClick={() => createWorkOrder({ propertyId: u.property.id, unitId: u.unit.id, tenantId: u.tenant?.id ?? null, source: u.tenant ? "tenant" : "owner" })}>New work order</Button>} flush>
        <div className="p-3">
          <DataTable rows={u.workOrders} columns={workOrderColumns} rowKey={(r) => r.workOrder.id} onRowClick={(r) => openWorkOrder(r.workOrder.id)} dense emptyTitle="No work orders for this unit" exportName={`unit-${u.unit.unitNumber}-maintenance`} rowClassName={(r) => (r.workOrder.priority === "emergency" && r.isOpen ? "bg-critical-muted/30" : undefined)} />
        </div>
      </SectionCard>
      {u.expenses.length > 0 && (
        <SectionCard title="Expenses attributed to this unit" flush>
          <div className="p-3">
            <DataTable rows={u.expenses} columns={expenseColumns} rowKey={(r) => r.expense.id} dense />
          </div>
        </SectionCard>
      )}
      <SectionCard title="Renovations" description={u.renovations.length === 0 ? "No projects on this unit" : undefined} action={<Button size="sm" variant="outline" onClick={() => createRenovation({ unitId: u.unit.id, propertyId: u.property.id })}>Plan renovation</Button>}>
        {u.renovations.length > 0 && (
          <ul className="divide-y">
            {u.renovations.map((r) => (
              <li key={r.renovation.id} className="flex cursor-pointer items-center justify-between gap-3 py-2 text-sm hover:bg-accent/40" onClick={() => openRenovation(r.renovation.id)}>
                <span>
                  <span className="font-medium">{r.renovation.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMoney(r.renovation.actualCost)} of {formatMoney(r.renovation.budget)} · {r.renovation.progressPercent}% · {formatDate(r.renovation.startDate)} → {formatDate(r.renovation.targetEndDate)}
                  </span>
                </span>
                <StatusBadge value={r.delayed ? "delayed" : r.renovation.status} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/* -------------------------------- Inspections ----------------------------- */

const inspectionColumns: Column<InspectionRow>[] = [
  { key: "date", header: "Date", cell: (r) => formatDate(r.inspection.completedDate ?? r.inspection.scheduledDate), value: (r) => r.inspection.completedDate ?? r.inspection.scheduledDate },
  { key: "type", header: "Type", cell: (r) => labelize(r.inspection.type) },
  { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.overdue ? "overdue" : r.inspection.status} label={r.overdue ? "Overdue" : undefined} /> },
  { key: "result", header: "Result", cell: (r) => (r.inspection.overallResult ? <StatusBadge value={r.inspection.overallResult} /> : "—") },
  { key: "items", header: "Items", cell: (r) => `${r.inspection.items.length}${r.failed > 0 ? ` · ${r.failed} failed` : ""}${r.attention > 0 ? ` · ${r.attention} attention` : ""}`, value: (r) => r.inspection.items.length },
  { key: "followups", header: "Follow-ups open", align: "right", cell: (r) => (r.followUps > 0 ? <span className="font-medium text-warning-foreground">{r.followUps}</span> : "—"), value: (r) => r.followUps },
  { key: "inspector", header: "Inspector", cell: (r) => r.inspection.inspector },
];

export function InspectionsTab({ rows, unitId, propertyId }: { rows: InspectionRow[]; unitId?: string; propertyId?: string }) {
  const { openInspection, scheduleInspection } = useActions();
  const [openId, setOpenId] = useState<string | null>(rows[0]?.inspection.id ?? null);
  const selected = rows.find((r) => r.inspection.id === openId) ?? null;
  return (
    <div className="space-y-5">
      <DataTable rows={rows} columns={[...inspectionColumns, { key: "open", header: "", sortable: false, noExport: true, cell: (r) => <span className="flex justify-end"><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); openInspection(r.inspection.id); }}>Open</Button></span> }]} rowKey={(r) => r.inspection.id} onRowClick={(r) => setOpenId(r.inspection.id)} rowClassName={(r) => (r.inspection.id === openId ? "bg-accent/50" : undefined)} dense emptyTitle="No inspections yet" emptyIcon={Gauge} toolbar={unitId && propertyId ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => scheduleInspection({ unitId, propertyId, type: "annual_unit" })}>Schedule inspection</Button><Button size="sm" variant="outline" onClick={() => scheduleInspection({ unitId, propertyId, type: "move_out" })}>Move-out checklist</Button></div> : undefined} />
      {selected && selected.inspection.items.length > 0 && (
        <SectionCard title={`${labelize(selected.inspection.type)} inspection · ${formatDate(selected.inspection.completedDate ?? selected.inspection.scheduledDate)}`} description={selected.inspection.notes ?? undefined} flush>
          <ul className="divide-y">
            {selected.inspection.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                <StatusBadge value={item.result} className="mt-0.5 w-20 justify-center" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {item.area} · {item.item}
                  </span>
                  {item.notes && <span className="block text-xs text-muted-foreground">{item.notes}</span>}
                </span>
                {item.followUpRequired && <StatusBadge value={item.workOrderId ? "assigned" : "open"} label={item.workOrderId ? "Work order raised" : "Follow-up needed"} />}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

/* --------------------------------- Utilities ------------------------------ */

export function UtilitiesTab({ meters }: { meters: MeterRow[] }) {
  if (meters.length === 0) return <EmptyState icon={Gauge} title="No meters for this unit" description="Add a meter on the Finance › Utilities page to track readings and consumption." />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {meters.map((m) => (
        <SectionCard key={m.meter.id} title={`${labelize(m.meter.utilityType)} · ${m.meter.meterNumber}`} description={`${labelize(m.meter.billingMethod)}${m.meter.unitRate ? ` · ${formatMoney(m.meter.unitRate)}/${m.meter.unitLabel}` : ""}${m.lastReading ? ` · last read ${formatDate(m.lastReading.readingDate)}` : ""}`} flush>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Previous</th>
                <th className="px-4 py-2 text-right font-medium">Current</th>
                <th className="px-4 py-2 text-right font-medium">Used</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {m.readings.slice().reverse().map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-1.5">{formatDate(r.readingDate)}{r.meterReset && <span className="ml-1 text-[10px] text-muted-foreground">reset</span>}</td>
                  <td className="px-4 py-1.5 text-right text-muted-foreground">{r.previousReading.toLocaleString("en-US")}</td>
                  <td className="px-4 py-1.5 text-right">{r.currentReading.toLocaleString("en-US")}</td>
                  <td className="px-4 py-1.5 text-right font-medium">{r.consumption.toLocaleString("en-US")} {m.meter.unitLabel}</td>
                  <td className="px-4 py-1.5 text-right">{r.calculatedAmount === null ? "—" : formatMoney(r.calculatedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ))}
    </div>
  );
}

/* ---------------------------------- History ------------------------------- */

const HISTORY_LABELS: Record<string, string> = { all: "Everything", contract: "Tenancies", payment: "Payments", maintenance: "Maintenance", inspection: "Inspections", renovation: "Renovations", document: "Documents", activity: "Activity" };

function HistoryTab({ u }: { u: Unit360 }) {
  const [kind, setKind] = useState("all");
  const kinds = ["all", ...new Set(u.timeline.map((e) => e.kind))];
  const shown: TimelineEvent[] = kind === "all" ? u.timeline : u.timeline.filter((e) => e.kind === kind);
  return (
    <SectionCard title="History" description={`${u.timeline.length} events · newest first`}>
      <Chips value={kind} onChange={setKind} className="mb-4" options={kinds.map((k) => ({ value: k, label: HISTORY_LABELS[k] ?? labelize(k), count: k === "all" ? u.timeline.length : u.timeline.filter((e) => e.kind === k).length }))} />
      <Timeline events={shown} limit={80} />
    </SectionCard>
  );
}
