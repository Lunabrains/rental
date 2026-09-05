"use client";

import Link from "next/link";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SectionCard } from "@/components/common/section-card";
import { formatMoney, formatMoneyCompact, formatMonth, formatMonthShort } from "@/lib/format";
import type { TrendPoint } from "@/lib/queries";

const tick = { fill: "var(--muted-foreground)", fontSize: 11 };

/** Financial trend (plan §10): rent due vs collected, operating expenses and NOI over twelve months. */
export function FinancialTrend({ data }: { data: TrendPoint[] }) {
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  return (
    <SectionCard
      title="Financial trend, 12 months"
      description={last && prev ? `NOI ${formatMoney(last.noi)} so far this month · ${formatMoney(prev.noi)} last month` : undefined}
      action={
        <Link href="/analytics" className="text-xs font-medium text-brand hover:underline">
          All analytics
        </Link>
      }
    >
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={(p: string) => formatMonthShort(p)} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={52} tick={tick} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="expected" name="Rent due" fill="var(--chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="collected" name="Collected" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="operating" name="Operating expenses" fill="var(--chart-4)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line type="monotone" dataKey="noi" name="NOI" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
