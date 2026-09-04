"use client";

import { CircleDollarSign } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { PaymentStatusBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import type { UnitDetails } from "@/lib/queries";
import { cn } from "@/lib/utils";

function Total({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "critical" | "warning" | "success" }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("tabular mt-0.5 text-sm font-semibold", tone === "critical" && "text-critical", tone === "warning" && "text-warning-foreground", tone === "success" && "text-success")}>{value}</div>
    </div>
  );
}

export function PaymentsTab({ details }: { details: UnitDetails }) {
  const { recordPayment } = useActions();
  const { payments, totals } = details;
  const next = payments.find((p) => p.status === "overdue" || p.status === "partial") ?? payments.find((p) => p.status === "due") ?? payments.find((p) => p.status === "scheduled");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Total label="Paid" value={formatMoney(totals.paid)} />
        <Total label="Outstanding" value={totals.outstanding > 0 ? formatMoney(totals.outstanding) : "—"} tone={totals.outstanding > 0 ? "critical" : "success"} />
        <Total label="Late" value={`${totals.lateCount}×`} tone={totals.lateCount >= 3 ? "critical" : totals.lateCount > 0 ? "warning" : "success"} />
        <Total label="Avg days late" value={totals.avgDaysLate > 0 ? totals.avgDaysLate : "0"} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">On-time rate {formatPercent(totals.onTimeRate)}</span>
        {next && (
          <Button size="sm" onClick={() => recordPayment(next.id)}>
            <CircleDollarSign className="size-4" /> Record payment
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Paid</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {payments.map((p) => {
              const actionable = p.status === "overdue" || p.status === "partial" || p.status === "due";
              return (
                <tr
                  key={p.id}
                  className={cn("border-t", actionable && "cursor-pointer hover:bg-accent/60", p.status === "overdue" && "bg-critical-muted/40")}
                  onClick={actionable ? () => recordPayment(p.id) : undefined}
                >
                  <td className="px-3 py-2 font-medium">{formatMonth(p.periodMonth)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(p.dueDate)}</td>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(p.amountDue)}
                    {p.status === "partial" && <span className="block text-[11px] text-muted-foreground">paid {formatMoney(p.amountPaid)}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <PaymentStatusBadge status={p.status} daysLate={p.daysLate} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.paidDate ? formatDate(p.paidDate) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
