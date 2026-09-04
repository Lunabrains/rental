"use client";

import Link from "next/link";
import { DoorOpen } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import type { VacancyOpportunity } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function VacancyCard({ opportunity, criticalDays }: { opportunity: VacancyOpportunity; criticalDays: number }) {
  const { openUnit } = useActions();

  if (opportunity.vacantUnits === 0) {
    return (
      <SectionCard title="Vacancy opportunity">
        <EmptyState compact icon={DoorOpen} title="Fully let" description="Every unit is rented." />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Vacancy opportunity"
      description={`${opportunity.vacantUnits} vacant units${opportunity.worstProperty ? ` · ${opportunity.worstProperty.vacant} in ${opportunity.worstProperty.property.name}` : ""}`}
      action={
        <Link href="/alerts?category=occupancy" className="text-xs font-medium text-brand hover:underline">
          Vacancy alerts
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="rounded-md bg-muted/50 p-3">
          <div className="text-xs text-muted-foreground">Unrealised rent</div>
          <div className="tabular mt-1 text-2xl font-semibold tracking-tight">{formatMoneyCompact(opportunity.monthlyPotential)}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
          <div className="tabular mt-0.5 text-xs text-muted-foreground">{formatMoney(opportunity.annualPotential)} a year at asking rents</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Longest vacant</div>
          <ul className="mt-1.5 divide-y">
            {opportunity.longest.map((v) => (
              <li
                key={v.unit.id}
                className="flex cursor-pointer items-center gap-3 py-1.5 hover:bg-accent/40"
                onClick={() => openUnit(v.unit.id)}
              >
                <span className={cn("tabular w-12 shrink-0 text-sm font-semibold", v.daysVacant > criticalDays ? "text-critical" : "text-foreground")}>{v.daysVacant}d</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {v.property.name} · {v.unit.unitNumber}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {v.unit.bedrooms} BR · asking {formatMoney(v.askingRent)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
