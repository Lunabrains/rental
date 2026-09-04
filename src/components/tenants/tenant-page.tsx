"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, CircleDollarSign, Mail, Phone, RefreshCw, Users } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { ContractStatusBadge, NeutralPill, PaymentStatusBadge } from "@/components/common/badges";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { DocumentPreview } from "@/components/documents/document-preview";
import { Button } from "@/components/ui/button";
import { ActivityTab } from "@/components/units/activity-tab";
import { DocumentRow } from "@/components/units/documents-tab";
import { Field } from "@/components/units/tenant-tab";
import { useStore } from "@/lib/data/store-context";
import { isOccupying } from "@/lib/derived/recompute";
import { formatDate, formatMoney, formatMonth, formatPercent, initials, labelize } from "@/lib/format";
import { getTenantDetails, getTenantTimeline } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { StoredDocument } from "@/types";

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "critical" | "success" | "warning" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("tabular mt-0.5 text-lg font-semibold", tone === "critical" && "text-critical", tone === "success" && "text-success", tone === "warning" && "text-warning-foreground")}>{value}</div>
    </div>
  );
}

export function TenantPage({ tenantId }: { tenantId: string }) {
  const store = useStore();
  const { openUnit, renewContract, recordPayment } = useActions();
  const details = useMemo(() => getTenantDetails(store, tenantId), [store, tenantId]);
  const timeline = useMemo(() => getTenantTimeline(store, tenantId), [store, tenantId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  if (!details) {
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

  const { tenant, current, contracts, payments, totals, documents } = details;
  const nextPayment = payments.find((p) => p.status === "overdue" || p.status === "partial") ?? payments.find((p) => p.status === "due");
  const hasOverdue = payments.some((p) => p.status === "overdue" || p.status === "partial");

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Tenants", href: "/tenants" }, { label: tenant.fullName }]}
        title={
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{initials(tenant.fullName)}</span>
            <span className="flex items-center gap-2">
              {tenant.fullName}
              {hasOverdue && <NeutralPill className="bg-critical-muted text-critical border-critical/20">overdue</NeutralPill>}
              {!current && <NeutralPill>former tenant</NeutralPill>}
              {totals.lateCount === 0 && payments.filter((p) => p.status === "paid").length >= 12 && <NeutralPill className="bg-success-muted text-success border-success/20">reliable</NeutralPill>}
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
              {tenant.occupation ?? "Tenant"} · {tenant.nationality} · {details.tenureMonths} months with us
            </span>
          </span>
        }
        actions={
          current ? (
            <>
              <Button variant="outline" onClick={() => openUnit(current.unit.id)}>
                <Building2 className="size-4" /> Open unit
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
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Paid to date" value={formatMoney(totals.paid)} />
        <Stat label="Outstanding" value={totals.outstanding > 0 ? formatMoney(totals.outstanding) : "—"} tone={totals.outstanding > 0 ? "critical" : "success"} />
        <Stat label="Late payments" value={`${totals.lateCount}×`} tone={totals.lateCount >= 3 ? "critical" : totals.lateCount > 0 ? "warning" : "success"} />
        <Stat label="On-time rate" value={formatPercent(totals.onTimeRate)} tone={totals.onTimeRate >= 0.9 ? "success" : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard title={current ? "Current apartment" : "No current apartment"} description={current ? `${current.property.name} · ${current.unit.unitNumber}` : "This tenant has moved out."}>
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
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Previous apartments are listed below.</p>
            )}
          </SectionCard>

          <SectionCard title="Contracts & previous apartments" description={`${contracts.length} contract${contracts.length === 1 ? "" : "s"}`} flush>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Contract</th>
                  <th className="px-4 py-2 font-medium">Building · Unit</th>
                  <th className="px-4 py-2 font-medium">Term</th>
                  <th className="px-4 py-2 text-right font-medium">Rent</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {contracts.map((c) => (
                  <tr key={c.contract.id} className={cn("cursor-pointer border-t hover:bg-accent/60", isOccupying(c.contract) && "bg-success-muted/20")} onClick={() => openUnit(c.unit.id, "contract")}>
                    <td className="px-4 py-2 font-mono text-xs">{c.contract.contractNumber}</td>
                    <td className="px-4 py-2">
                      {c.property.name} · {c.unit.unitNumber}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatDate(c.contract.startDate)} → {formatDate(c.contract.moveOutDate ?? c.contract.endDate)}
                    </td>
                    <td className="px-4 py-2 text-right">{formatMoney(c.contract.monthlyRent)}</td>
                    <td className="px-4 py-2">
                      <ContractStatusBadge status={c.contract.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard title="Payments" description={`${payments.length} rows · ${labelize(current?.contract.paymentMethod ?? "bank_transfer")}`} flush>
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Month</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {payments.map((p) => {
                    const actionable = p.status === "overdue" || p.status === "partial" || p.status === "due";
                    return (
                      <tr key={p.id} className={cn("border-t", actionable && "cursor-pointer hover:bg-accent/60", p.status === "overdue" && "bg-critical-muted/30")} onClick={actionable ? () => recordPayment(p.id) : undefined}>
                        <td className="px-4 py-2">{formatMonth(p.periodMonth)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(p.dueDate)}</td>
                        <td className="px-4 py-2 text-right">{formatMoney(p.amountDue)}</td>
                        <td className="px-4 py-2">
                          <PaymentStatusBadge status={p.status} daysLate={p.daysLate} />
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{p.paidDate ? formatDate(p.paidDate) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="ID type">{labelize(tenant.idType)}</Field>
              <Field label="ID number">{tenant.idNumber || <span className="text-warning-foreground">Not on file</span>}</Field>
              <Field label="Nationality">{tenant.nationality}</Field>
              <Field label="Tenant since">{formatDate(contracts[contracts.length - 1]?.contract.startDate)}</Field>
              <Field label="Emergency contact">{tenant.emergencyContactName}</Field>
              <Field label="Emergency phone">{tenant.emergencyContactPhone}</Field>
            </dl>
          </SectionCard>

          <SectionCard title="Documents" description={`${documents.length} on file`} flush>
            {documents.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState compact title="No documents yet" />
              </div>
            ) : (
              <ul className="divide-y">
                {documents.map((d) => (
                  <DocumentRow key={d.id} doc={d} onPreview={setPreview} />
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Activity">
            <ActivityTab events={timeline.slice(0, 25)} />
          </SectionCard>
        </div>
      </div>

      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
