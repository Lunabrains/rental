"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { AlertRow } from "@/components/alerts/alert-row";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import type { Alert } from "@/types";

export function AttentionList({ alerts, total }: { alerts: Alert[]; total: number }) {
  return (
    <SectionCard
      title="Needs attention"
      description={total > 0 ? `${total} critical · showing the top ${alerts.length}` : "No critical alerts"}
      action={
        <Link href="/alerts" className="text-xs font-medium text-brand hover:underline">
          All alerts
        </Link>
      }
    >
      {alerts.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="Nothing critical" description="Every payment is on time and no contract is at risk." />
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} maxActions={1} compact />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
