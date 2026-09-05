"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { BellPlus, Building2, Check, CircleDollarSign, Mail, Phone, RefreshCw, Users, Wrench } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AlertRow } from "@/components/alerts/alert-row";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { ContractStatusBadge, NeutralPill, PaymentStatusBadge } from "@/components/common/badges";
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
import { workOrderColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DocumentRow } from "@/components/units/documents-tab";
import { Field } from "@/components/units/tenant-tab";
import { InspectionsTab } from "@/components/units/unit-page";
import { completeReminder, updateTenantNotes } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatDate, formatMoney, formatMonth, formatPercent, initials, labelize } from "@/lib/format";
import { getTenant360, type ContractRow, type Tenant360 } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Payment, StoredDocument } from "@/types";

type Tab = "overview" | "payments" | "contracts" | "maintenance" | "documents" | "notes" | "timeline";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "payments", label: "Payments" },
  { key: "contracts", label: "Contracts" },
  { key: "maintenance", label: "Maintenance" },
  { key: "documents", label: "Documents" },
  { key: "notes", label: "Notes & reminders" },
  { key: "timeline", label: "Timeline" },
];

/**
 * Tenant 360° (plan §Phase 3): contact, tenancy, money, reliability, history,
 * maintenance, documents, notes and reminders on one profile.
 */
export function TenantPage({ tenantId }: { tenantId: string }) {
  const { store } = useStoreContext();
  const router = useRouter();
  const params = useSearchParams();
  const { openUnit, openUnitPage, renewContract, recordPayment, createReminder, renewalDecision } = useActions();
  const t = useMemo(() => getTenant360(store, tenantId), [store, tenantId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  const tabParam = params.get("tab");
  const tab: Tab = TABS.some((x) => x.key === tabParam) ? (tabParam as Tab) : "overview";
  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "overview") sp.delete("tab");
      else sp.set("tab", next);
      router.replace(`/tenants/${tenantId}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router, tenantId],
  );

  if (!t) {
    return (
      <EmptyState
        icon={Users}
        title="Tenant not found"
        action={
          <Button asChild variant="outline">
            <Link href="/tenants">All tenants</Link>
          </Button>
        }
      />
    );
  }

  const { tenant, current, payments, totals, documents, reliability } = t;
  const nextPayment = payments.find((p) => p.status === "overdue" || p.status === "partial") ?? payments.find((p) => p.status === "due");
  const hasOverdue = payments.some((p) => p.status === "overdue" || p.status === "partial");
  const heldDeposit = t.deposits.filter((d) => d.deposit.status === "held").reduce((n, d) => n + d.deposit.amountHeld, 0);
  const openAlerts = t.alerts.filter((a) => !a.resolved);
  const openWork = t.workOrders.filter((w) => w.isOpen).length;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Tenants", href: "/tenants" }, { label: tenant.fullName }]}
        title={
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{initials(tenant.fullName)}</span>
            <span className="flex flex-wrap items-center gap-2">
              {tenant.fullName}
              {hasOverdue && <NeutralPill className="bg-critical-muted text-critical border-critical/20">overdue</NeutralPill>}
              {!current && <NeutralPill>former tenant</NeutralPill>}
              {reliability.score !== null && <StatusBadge value={reliability.label} />}
            </span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-3">
            <a href={`tel:${tenant.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <Phone className="size-3.5" /> {tenant.phone}
            </a>
            {tenant.email && (
              <a href={`mailto:${tenant.email}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Mail className="size-3.5" /> {tenant.email}
              </a>
            )}
            <span>
              {tenant.occupation ?? "Tenant"} · {tenant.nationality} · {t.tenureMonths} months with us
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => createReminder({ entityType: "tenant", entityId: tenant.id, label: tenant.fullName, title: `Call ${tenant.fullName}` })}>
              <BellPlus className="size-4" /> Reminder
            </Button>
            {current && (
              <>
                <Button variant="outline" onClick={() => openUnitPage(current.unit.id)}>
                  <Building2 className="size-4" /> Unit 360°
                </Button>
                {nextPayment && (
                  <Button variant="outline" onClick={() => recordPayment(nextPayment.id)}>
                    <CircleDollarSign className="size-4" /> Record payment
                  </Button>
                )}
                <Button onClick={() => renewContract(current.contract.id)}>
                  <RefreshCw className="size-4" /> Renew
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Lifetime paid" value={formatMoney(totals.paid)} sublabel={`${payments.filter((p) => p.status === "paid").length} payments`} />
        <KpiCard label="Outstanding" value={totals.outstanding > 0 ? formatMoney(totals.outstanding) : "—"} tone={totals.outstanding > 0 ? "critical" : "success"} sublabel={totals.outstanding > 0 ? `${payments.filter((p) => p.status === "overdue" || p.status === "partial").length} unpaid` : "Settled"} />
        <KpiCard label="Late payments" value={`${totals.lateCount}×`} tone={totals.lateCount >= 3 ? "critical" : totals.lateCount > 0 ? "warning" : "success"} sublabel={totals.avgDaysLate > 0 ? `avg ${totals.avgDaysLate} days late` : "Never late"} />
        <KpiCard label="Reliability" value={reliability.score === null ? "—" : <ScoreBadge score={reliability.score} label={`Payment reliability · ${reliability.label}`} components={reliability.components} scale={1} caption="Internal indicator from this ledger only — not a credit score." size="lg" />} sublabel={`${reliability.label} · ${formatPercent(totals.onTimeRate)} on time`} />
        <KpiCard label="Deposit held" value={heldDeposit > 0 ? formatMoney(heldDeposit) : "—"} sublabel={t.deposits.length > 0 ? labelize(t.deposits[0].deposit.status) : "No deposit on record"} />
        <KpiCard label="Maintenance" value={t.workOrders.length} tone={openWork > 0 ? "warning" : "default"} sublabel={openWork > 0 ? `${openWork} open request${openWork === 1 ? "" : "s"}` : "No open requests"} icon={Wrench} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" className="h-10 w-max justify-start gap-1 bg-transparent p-0">
            {TABS.map((x) => (
              <TabsTrigger key={x.key} value={x.key} className="px-3 text-sm">
                {x.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <SectionCard
              title={current ? "Current apartment" : "No current apartment"}
              description={current ? `${current.property.name} · ${current.unit.unitNumber}` : "This tenant has moved out."}
              action={current ? <Button size="sm" variant="outline" onClick={() => openUnit(current.unit.id, "contract")}>Open in grid</Button> : undefined}
            >
              {current ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <Field label="Building">
                    <Link href={`/properties/${current.property.id}`} className="hover:underline">
                      {current.property.name}
                    </Link>
                  </Field>
                  <Field label="Unit">
                    {current.unit.unitNumber} · {current.unit.bedrooms} BR · {current.unit.sizeSqm} m²
                  </Field>
                  <Field label="Rent">
                    <span className="tabular font-semibold">{formatMoney(current.contract.monthlyRent)}</span>/month
                  </Field>
                  <Field label="Contract">{current.contract.contractNumber}</Field>
                  <Field label="Term">
                    {formatDate(current.contract.startDate)} → {formatDate(current.contract.endDate)}
                  </Field>
                  <Field label="Days remaining">
                    <span className={cn("tabular font-semibold", current.daysRemaining <= 30 && "text-warning-foreground")}>{current.daysRemaining}</span>
                  </Field>
                  <Field label="Renewal">
                    <StatusBadge value={current.contract.renewalStatus} />
                  </Field>
                  <Field label="Proposed rent">{current.contract.proposedRent ? formatMoney(current.contract.proposedRent) : "—"}</Field>
                  <Field label="Increase clause">{current.contract.rentIncreaseClause ?? "—"}</Field>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Previous apartments are listed under Contracts.</p>
              )}
              {current && current.daysRemaining <= 90 && (
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => renewalDecision(current.contract.id)}>
                    <Check className="size-3.5" /> Renewal decision
                  </Button>
                  {current.contract.renewalNotes && <span className="self-center text-xs text-muted-foreground">{current.contract.renewalNotes}</span>}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Needs attention" description={openAlerts.length > 0 ? `${openAlerts.length} open alert${openAlerts.length === 1 ? "" : "s"}` : "No open alerts"}>
              {openAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing is flagged for this tenant.</p>
              ) : (
                <div className="space-y-2">
                  {openAlerts.map((a) => (
                    <AlertRow key={a.id} alert={a} maxActions={1} compact />
                  ))}
                </div>
              )}
            </SectionCard>

            <LatePayments payments={t.latePayments} onRecord={recordPayment} />
          </div>

          <div className="space-y-6">
            <SectionCard>
              <ScoreBreakdown score={reliability.score} label={`Payment reliability · ${reliability.label}`} components={reliability.components} scale={1} caption="On-time ratio 45 · days late 20 · missed periods 15 · partial payments 10 · last 3 months 10. An internal indicator computed only from this ledger — not a credit score." />
            </SectionCard>
            <SectionCard title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="ID type">{labelize(tenant.idType)}</Field>
                <Field label="ID number">{tenant.idNumber || <span className="text-warning-foreground">Not on file</span>}</Field>
                <Field label="Nationality">{tenant.nationality}</Field>
                <Field label="Tenant since">{formatDate(t.contracts[t.contracts.length - 1]?.contract.startDate)}</Field>
                <Field label="Emergency contact">{tenant.emergencyContactName}</Field>
                <Field label="Emergency phone">{tenant.emergencyContactPhone}</Field>
              </dl>
            </SectionCard>
            <SectionCard title="Deposits, keys & parking">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {t.deposits.slice(0, 2).map((d) => (
                  <Field key={d.deposit.id} label={`Deposit · ${d.contract.contractNumber}`}>
                    {formatMoney(d.deposit.amountHeld)} <StatusBadge value={d.deposit.status} className="ml-1" />
                  </Field>
                ))}
                <Field label="Keys held">{t.keys.filter((k) => k.key.status === "issued").length > 0 ? t.keys.filter((k) => k.key.status === "issued").map((k) => `${labelize(k.key.type)} ${k.key.identifier}`).join(", ") : "None"}</Field>
                <Field label="Parking">{t.parking.length > 0 ? t.parking.map((p) => `${p.space.spaceNumber}${p.space.vehiclePlate ? ` · ${p.space.vehiclePlate}` : ""}${p.space.paid ? ` · ${formatMoney(p.space.monthlyFee)}/mo` : ""}`).join(", ") : "None"}</Field>
              </dl>
            </SectionCard>
          </div>
        </div>
      )}

      {tab === "payments" && (
        <div className="space-y-6">
          <LatePayments payments={t.latePayments} onRecord={recordPayment} />
          <SectionCard title="Full ledger" description={`${payments.length} rows · ${labelize(current?.contract.paymentMethod ?? "bank_transfer")}`} flush>
            <div className="max-h-[36rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Month</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Paid</th>
                    <th className="px-4 py-2 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {payments.map((p) => {
                    const actionable = p.status === "overdue" || p.status === "partial" || p.status === "due";
                    return (
                      <tr key={p.id} className={cn("border-t", actionable && "cursor-pointer hover:bg-accent/60", p.status === "overdue" && "bg-critical-muted/30")} onClick={actionable ? () => recordPayment(p.id) : undefined}>
                        <td className="px-4 py-2">{formatMonth(p.periodMonth)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(p.dueDate)}</td>
                        <td className="px-4 py-2 text-right">
                          {formatMoney(p.amountDue)}
                          {p.status === "partial" && <span className="block text-[11px] text-muted-foreground">paid {formatMoney(p.amountPaid)}</span>}
                        </td>
                        <td className="px-4 py-2">
                          <PaymentStatusBadge status={p.status} daysLate={p.daysLate} />
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{p.paidDate ? formatDate(p.paidDate) : "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.reference ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "contracts" && <ContractsTab rows={t.contractRows} onOpen={(row) => openUnit(row.unit.id, "contract")} onDecision={renewalDecision} />}

      {tab === "maintenance" && (
        <div className="space-y-6">
          <SectionCard title="Maintenance requests" description={`${t.workOrders.length} on record · ${openWork} open`} flush>
            <div className="p-3">
              <DataTable rows={t.workOrders} columns={workOrderColumns} rowKey={(r) => r.workOrder.id} dense emptyTitle="No maintenance requests" emptyIcon={Wrench} />
            </div>
          </SectionCard>
          <SectionCard title="Inspections" description="Move-in, move-out and annual visits">
            <InspectionsTab rows={t.inspections} />
          </SectionCard>
        </div>
      )}

      {tab === "documents" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <SectionCard title="Documents" description={`${documents.filter((d) => !d.deleted).length} on file`} flush>
            {documents.filter((d) => !d.deleted).length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState compact title="No documents yet" />
              </div>
            ) : (
              <ul className="divide-y">
                {documents
                  .filter((d) => !d.deleted)
                  .map((d) => (
                    <DocumentRow key={d.id} doc={d} onPreview={setPreview} />
                  ))}
              </ul>
            )}
          </SectionCard>
          <AttachmentUploader links={{ tenantId: tenant.id, contractId: current?.contract.id ?? null, unitId: current?.unit.id ?? null }} category="tenant_id" label="Add ID, lease or receipt" />
        </div>
      )}

      {tab === "notes" && <NotesTab t={t} />}

      {tab === "timeline" && (
        <SectionCard title="Timeline" description={`${t.timeline.length} events · newest first`}>
          <Timeline events={t.timeline} limit={100} />
        </SectionCard>
      )}

      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/* ---------------------------------- Pieces -------------------------------- */

function LatePayments({ payments, onRecord }: { payments: Payment[]; onRecord: (id: string) => void }) {
  return (
    <SectionCard title="Late-payment history" description={payments.length === 0 ? "Never late" : `${payments.length} late or unpaid period${payments.length === 1 ? "" : "s"}`} flush>
      {payments.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState compact icon={Check} title="Spotless record" description="Every payment arrived on the due date." />
        </div>
      ) : (
        <ul className="divide-y">
          {payments.slice(0, 12).map((p) => (
            <li key={p.id} className={cn("flex items-center gap-3 px-4 py-2 text-sm", (p.status === "overdue" || p.status === "partial") && "cursor-pointer hover:bg-accent/50")} onClick={p.status === "overdue" || p.status === "partial" ? () => onRecord(p.id) : undefined}>
              <span className={cn("tabular w-14 shrink-0 font-semibold", p.status === "paid" ? "text-warning-foreground" : "text-critical")}>{p.daysLate}d</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{formatMonth(p.periodMonth)}</span>
                <span className="block text-xs text-muted-foreground">
                  due {formatDate(p.dueDate)}
                  {p.paidDate ? ` · paid ${formatDate(p.paidDate)}` : " · still unpaid"}
                  {p.status === "partial" ? ` · ${formatMoney(p.amountPaid)} of ${formatMoney(p.amountDue)}` : ""}
                </span>
              </span>
              <PaymentStatusBadge status={p.status} daysLate={p.daysLate} />
            </li>
          ))}
          {payments.length > 12 && <li className="px-4 py-2 text-xs text-muted-foreground">+{payments.length - 12} earlier</li>}
        </ul>
      )}
    </SectionCard>
  );
}

function ContractsTab({ rows, onOpen, onDecision }: { rows: ContractRow[]; onOpen: (row: ContractRow) => void; onDecision: (id: string) => void }) {
  const columns: Column<ContractRow>[] = [
    { key: "number", header: "Contract", cell: (r) => <span className="font-mono text-xs">{r.contract.contractNumber}</span> },
    { key: "where", header: "Building · Unit", cell: (r) => `${r.property.name} · ${r.unit.unitNumber}` },
    { key: "term", header: "Term", cell: (r) => `${formatDate(r.contract.startDate)} → ${formatDate(r.contract.moveOutDate ?? r.contract.endDate)}`, value: (r) => r.contract.startDate },
    { key: "rent", header: "Rent", align: "right", cell: (r) => formatMoney(r.contract.monthlyRent), value: (r) => r.contract.monthlyRent },
    { key: "deposit", header: "Deposit", align: "right", cell: (r) => formatMoney(r.contract.deposit), value: (r) => r.contract.deposit },
    { key: "status", header: "Status", cell: (r) => <ContractStatusBadge status={r.contract.status} /> },
    { key: "renewal", header: "Renewal", cell: (r) => (isOccupying(r.contract) ? <StatusBadge value={r.contract.renewalStatus} /> : "—") },
    { key: "clause", header: "Clause / terms", cell: (r) => <span className="block max-w-64 truncate text-xs text-muted-foreground">{[r.contract.rentIncreaseClause, r.contract.specialTerms].filter(Boolean).join(" · ") || "—"}</span>, sortable: false },
    { key: "act", header: "", sortable: false, noExport: true, cell: (r) => (isOccupying(r.contract) ? <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); onDecision(r.contract.id); }}>Decision</Button> : null) },
  ];
  return (
    <SectionCard title="Contracts & previous apartments" description={`${rows.length} contract${rows.length === 1 ? "" : "s"} — renewals are linked into a chain`} flush>
      <div className="p-3">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.contract.id} onRowClick={onOpen} dense defaultSort={{ key: "term", dir: "desc" }} rowClassName={(r) => (isOccupying(r.contract) ? "bg-success-muted/20" : undefined)} />
      </div>
    </SectionCard>
  );
}

function NotesTab({ t }: { t: Tenant360 }) {
  const { run } = useStoreContext();
  const { createReminder } = useActions();
  const [notes, setNotes] = useState(t.tenant.notes ?? "");
  const [filter, setFilter] = useState<"open" | "done">("open");
  const dirty = notes !== (t.tenant.notes ?? "");
  const reminders = t.reminders.filter((r) => (filter === "open" ? !r.done : r.done));

  function save() {
    const { undo } = run(updateTenantNotes(t.tenant.id, notes));
    toast.success("Notes saved", { action: undo ? { label: "Undo", onClick: undo } : undefined });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Notes & complaints" description="Calls, agreements, complaints — kept with the tenant">
        <Textarea rows={10} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 12 Aug — called about the AC; agreed to a visit on Thursday." />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setNotes(t.tenant.notes ?? "")}>
            Discard
          </Button>
          <Button disabled={!dirty} onClick={save}>
            Save notes
          </Button>
        </div>
      </SectionCard>
      <SectionCard
        title="Reminders"
        description="Surface as alerts when they fall due"
        action={
          <Button size="sm" variant="outline" onClick={() => createReminder({ entityType: "tenant", entityId: t.tenant.id, label: t.tenant.fullName, title: `Call ${t.tenant.fullName}` })}>
            <BellPlus className="size-3.5" /> New
          </Button>
        }
      >
        <Chips value={filter} onChange={setFilter} className="mb-3" options={[{ value: "open", label: "Open", count: t.reminders.filter((r) => !r.done).length }, { value: "done", label: "Done", count: t.reminders.filter((r) => r.done).length }]} />
        {reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{filter === "open" ? "No open reminders." : "Nothing completed yet."}</p>
        ) : (
          <ul className="divide-y">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                <button type="button" aria-label={r.done ? "Reopen" : "Mark done"} className={cn("flex size-5 shrink-0 items-center justify-center rounded border", r.done ? "border-success bg-success text-white" : "hover:bg-accent")} onClick={() => run(completeReminder(r.id, !r.done))}>
                  {r.done && <Check className="size-3.5" />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-medium", r.done && "text-muted-foreground line-through")}>{r.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.done ? `done ${formatDate(r.doneAt)}` : `due ${formatDate(r.dueDate)}`}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
