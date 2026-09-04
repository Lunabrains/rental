"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { ContractStatusBadge } from "@/components/common/badges";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { isOccupying } from "@/lib/derived/recompute";
import { today } from "@/lib/date";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { getContracts } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Rent Roll: every occupied unit, its tenant, rent and outstanding — with totals. */
export function ReportsPage() {
  const store = useStore();
  const { openUnitHere } = useActions();

  const rows = useMemo(() => getContracts(store).filter((r) => isOccupying(r.contract)).sort((a, b) => a.property.name.localeCompare(b.property.name) || a.unit.unitNumber.localeCompare(b.unit.unitNumber, undefined, { numeric: true })), [store]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: typeof rows; rent: number; outstanding: number }>();
    for (const r of rows) {
      const g = map.get(r.property.id) ?? { name: r.property.name, rows: [], rent: 0, outstanding: 0 };
      g.rows.push(r);
      g.rent += r.contract.monthlyRent;
      g.outstanding += r.outstanding;
      map.set(r.property.id, g);
    }
    return [...map.values()];
  }, [rows]);

  const totals = useMemo(
    () => ({
      units: rows.length,
      rent: rows.reduce((n, r) => n + r.contract.monthlyRent, 0),
      outstanding: rows.reduce((n, r) => n + r.outstanding, 0),
      deposits: rows.reduce((n, r) => n + r.contract.deposit, 0),
    }),
    [rows],
  );

  function exportCsv() {
    const header = ["Building", "Unit", "Tenant", "Contract", "Start", "End", "Monthly rent", "Deposit", "Outstanding", "Status"];
    const lines = rows.map((r) => [r.property.name, r.unit.unitNumber, r.tenant.fullName, r.contract.contractNumber, r.contract.startDate, r.contract.endDate, r.contract.monthlyRent, r.contract.deposit, r.outstanding, r.contract.status]);
    const csv = [header, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rent-roll-${today()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Rent roll as of ${formatDate(today())}`}
        actions={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Units rented" value={formatNumber(totals.units)} sublabel={`of ${store.units.length} units`} />
        <KpiCard label="Monthly rent roll" value={formatMoney(totals.rent)} sublabel={`${formatMoney(totals.rent * 12)} annualised`} />
        <KpiCard label="Outstanding" value={formatMoney(totals.outstanding)} tone={totals.outstanding > 0 ? "critical" : "success"} sublabel="past due, unpaid" />
        <KpiCard label="Deposits held" value={formatMoney(totals.deposits)} sublabel="across active contracts" />
      </div>

      <SectionCard title="Rent roll" description={`${groups.length} buildings · ${rows.length} occupied units`} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium">Tenant</th>
                <th className="px-4 py-2 font-medium">Contract</th>
                <th className="px-4 py-2 font-medium">Term</th>
                <th className="px-4 py-2 text-right font-medium">Rent / mo</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {groups.map((g) => (
                <GroupRows key={g.name} group={g} onOpen={(unitId) => openUnitHere(unitId, "contract")} />
              ))}
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="px-4 py-2.5" colSpan={4}>
                  Portfolio total · {rows.length} units
                </td>
                <td className="px-4 py-2.5 text-right">{formatMoney(totals.rent)}</td>
                <td className={cn("px-4 py-2.5 text-right", totals.outstanding > 0 && "text-critical")}>{formatMoney(totals.outstanding)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function GroupRows({ group, onOpen }: { group: { name: string; rows: ReturnType<typeof getContracts>; rent: number; outstanding: number }; onOpen: (unitId: string) => void }) {
  return (
    <>
      <tr className="border-t bg-muted/20">
        <td className="px-4 py-2 font-medium" colSpan={4}>
          {group.name} <span className="text-xs font-normal text-muted-foreground">· {group.rows.length} units</span>
        </td>
        <td className="px-4 py-2 text-right font-medium">{formatMoney(group.rent)}</td>
        <td className={cn("px-4 py-2 text-right font-medium", group.outstanding > 0 && "text-critical")}>{group.outstanding > 0 ? formatMoney(group.outstanding) : "—"}</td>
        <td />
      </tr>
      {group.rows.map((r) => (
        <tr key={r.contract.id} className="cursor-pointer border-t hover:bg-accent/60" onClick={() => onOpen(r.unit.id)}>
          <td className="px-4 py-1.5 pl-8">{r.unit.unitNumber}</td>
          <td className="px-4 py-1.5">{r.tenant.fullName}</td>
          <td className="px-4 py-1.5 font-mono text-xs">{r.contract.contractNumber}</td>
          <td className="px-4 py-1.5 text-muted-foreground">
            {formatDate(r.contract.startDate)} → {formatDate(r.contract.endDate)}
          </td>
          <td className="px-4 py-1.5 text-right">{formatMoney(r.contract.monthlyRent)}</td>
          <td className={cn("px-4 py-1.5 text-right", r.outstanding > 0 ? "text-critical" : "text-muted-foreground")}>{r.outstanding > 0 ? formatMoney(r.outstanding) : "—"}</td>
          <td className="px-4 py-1.5">
            <ContractStatusBadge status={r.contract.status} />
          </td>
        </tr>
      ))}
    </>
  );
}
