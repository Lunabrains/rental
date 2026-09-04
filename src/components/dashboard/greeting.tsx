"use client";

import { useState } from "react";

import { formatMoney } from "@/lib/format";
import type { SinceLastLogin } from "@/lib/queries";

function greetingFor(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface GreetingProps {
  ownerName: string;
  since: SinceLastLogin;
}

export function Greeting({ ownerName, since }: GreetingProps) {
  // The dashboard only mounts once the store is ready (client-side), so the
  // browser clock is safe to read during the first render.
  const [now] = useState(() => new Date());

  const greeting = greetingFor(now.getHours());
  const dateLine = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const bits: string[] = [];
  if (since.paymentsReceived > 0) bits.push(`${since.paymentsReceived} payment${since.paymentsReceived === 1 ? "" : "s"} received (${formatMoney(since.paymentsAmount)})`);
  if (since.unitsVacated > 0) bits.push(`${since.unitsVacated} unit${since.unitsVacated === 1 ? "" : "s"} became vacant`);
  if (since.newAlerts > 0) bits.push(`${since.newAlerts} new alert${since.newAlerts === 1 ? "" : "s"}`);
  if (since.contractsExpiringSoon > 0) bits.push(`${since.contractsExpiringSoon} contract${since.contractsExpiringSoon === 1 ? "" : "s"} ending this week`);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}, {ownerName}
        </h1>
        {dateLine && <span className="text-sm text-muted-foreground">{dateLine}</span>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {bits.length > 0 ? `Since you last logged in: ${bits.join(", ")}.` : "Nothing new since you last logged in."}
      </p>
    </div>
  );
}
