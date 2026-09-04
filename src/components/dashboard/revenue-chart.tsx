"use client";

import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SectionCard } from "@/components/common/section-card";
import { currentPeriod } from "@/lib/date";
import { formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";
import type { RevenuePoint } from "@/lib/queries";
import { cn } from "@/lib/utils";

const COLLECTED = "var(--chart-1)";
const BILLED = "var(--chart-2)";

interface TooltipPayload {
  payload?: RevenuePoint;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const mtd = point.period === currentPeriod();
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">
        {formatMonth(point.period)}
        {mtd && <span className="ml-1 text-muted-foreground">(month to date)</span>}
      </div>
      <div className="tabular mt-1.5 space-y-1">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-sm" style={{ background: COLLECTED }} />
          <span className="text-muted-foreground">Collected</span>
          <span className="ml-auto font-medium">{formatMoney(point.collected)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-2 rounded" style={{ background: BILLED }} />
          <span className="text-muted-foreground">Billed</span>
          <span className="ml-auto font-medium">{formatMoney(point.billed)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2" />
          <span className="text-muted-foreground">Occupancy</span>
          <span className="ml-auto font-medium">{formatPercent(point.occupancy)}</span>
        </div>
      </div>
    </div>
  );
}

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const current = currentPeriod();
  const last = data[data.length - 1];
  const prev = data[data.length - 2];

  return (
    <SectionCard
      title="Revenue, 12 months"
      description={
        last && prev
          ? `${formatMoney(prev.collected)} collected last month · ${formatMoney(last.collected)} so far this month`
          : undefined
      }
      action={
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex" aria-hidden>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: COLLECTED }} /> Collected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded" style={{ background: BILLED }} /> Billed
            </span>
          </div>
          <div className="flex rounded-md border p-0.5 text-xs">
            {(["chart", "table"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn("rounded px-2 py-0.5 capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {view === "chart" ? (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis
                dataKey="period"
                tickFormatter={(p: string) => formatMonthShort(p)}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                dy={6}
              />
              <YAxis
                tickFormatter={(v: number) => formatMoneyCompact(v)}
                tickLine={false}
                axisLine={false}
                width={52}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="collected" name="Collected" fill={COLLECTED} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                {data.map((p) => (
                  <Cell key={p.period} fill={COLLECTED} fillOpacity={p.period === current ? 0.45 : 1} />
                ))}
              </Bar>
              <Line
                dataKey="billed"
                name="Billed"
                type="monotone"
                stroke={BILLED}
                strokeWidth={2}
                dot={{ r: 4, fill: BILLED, stroke: "var(--card)", strokeWidth: 2 }}
                activeDot={{ r: 5, fill: BILLED, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Month</th>
                <th className="py-2 pr-3 text-right font-medium">Billed</th>
                <th className="py-2 pr-3 text-right font-medium">Collected</th>
                <th className="py-2 text-right font-medium">Occupancy</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {data.map((p) => (
                <tr key={p.period} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">
                    {formatMonth(p.period)}
                    {p.period === current && <span className="ml-1 text-xs text-muted-foreground">MTD</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{formatMoney(p.billed)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatMoney(p.collected)}</td>
                  <td className="py-1.5 text-right">{formatPercent(p.occupancy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
