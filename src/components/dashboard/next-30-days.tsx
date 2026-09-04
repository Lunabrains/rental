"use client";

import Link from "next/link";
import { CalendarClock, CircleDollarSign } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { NeutralPill } from "@/components/common/badges";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { formatDateShort, formatMoney } from "@/lib/format";
import type { ContractRow, PaymentRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

const LIMIT = 8;

export function Next30Days({ expiring, payments }: { expiring: ContractRow[]; payments: PaymentRow[] }) {
  const { openUnit, renewContract, recordPayment } = useActions();
  const dueTotal = payments.reduce((n, p) => n + p.payment.amountDue, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard
        title="Contracts ending in 30 days"
        description={`${expiring.length} contract${expiring.length === 1 ? "" : "s"}`}
        action={
          <Link href="/contracts?expiring=30" className="text-xs font-medium text-brand hover:underline">
            View all
          </Link>
        }
        flush
      >
        {expiring.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState compact icon={CalendarClock} title="No contracts ending soon" />
          </div>
        ) : (
          <ul className="divide-y">
            {expiring.slice(0, LIMIT).map((r) => (
              <li
                key={r.contract.id}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-accent/60"
                onClick={() => openUnit(r.unit.id, "contract")}
              >
                <span
                  className={cn(
                    "tabular flex h-8 w-11 shrink-0 flex-col items-center justify-center rounded-md text-[11px] font-semibold leading-none",
                    r.daysRemaining <= 7 ? "bg-critical-muted text-critical" : "bg-muted text-foreground",
                  )}
                >
                  <span className="text-sm">{r.daysRemaining}</span>
                  <span className="mt-0.5 font-normal text-muted-foreground">days</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{r.tenant.fullName}</span>
                    {r.hasOverdue && <NeutralPill className="bg-critical-muted text-critical border-critical/20">also overdue</NeutralPill>}
                    {r.reliable && !r.hasOverdue && <NeutralPill className="bg-success-muted text-success border-success/20">reliable</NeutralPill>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.property.name} · {r.unit.unitNumber} · {formatMoney(r.contract.monthlyRent)}/mo · ends {formatDateShort(r.contract.endDate)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2.5 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    renewContract(r.contract.id);
                  }}
                >
                  Renew
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Payments due in 30 days"
        description={`${payments.length} payment${payments.length === 1 ? "" : "s"} · ${formatMoney(dueTotal)}`}
        action={
          <Link href="/payments?status=due" className="text-xs font-medium text-brand hover:underline">
            View all
          </Link>
        }
        flush
      >
        {payments.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState compact icon={CircleDollarSign} title="Nothing due" />
          </div>
        ) : (
          <ul className="divide-y">
            {payments.slice(0, LIMIT).map((r) => (
              <li
                key={r.payment.id}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-accent/60"
                onClick={() => openUnit(r.unit.id, "payments")}
              >
                <span className="tabular flex h-8 w-11 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
                  {formatDateShort(r.payment.dueDate)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.tenant.fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.property.name} · {r.unit.unitNumber}
                  </span>
                </span>
                <span className="tabular text-sm font-medium">{formatMoney(r.payment.amountDue)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2.5 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    recordPayment(r.payment.id);
                  }}
                >
                  Record
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
