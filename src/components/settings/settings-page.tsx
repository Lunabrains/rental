"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCompany, updateThresholds } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AlertThresholds } from "@/types";

type ThresholdKey = keyof AlertThresholds;

const THRESHOLD_FIELDS: { key: ThresholdKey; label: string; hint: string; unit: "days" | "$" | "%" | "count" | "months" }[] = [
  { key: "vacantWarningDays", label: "Vacancy warning", hint: "Unit empty longer than this raises a warning", unit: "days" },
  { key: "vacantCriticalDays", label: "Vacancy critical", hint: "…and longer than this becomes critical", unit: "days" },
  { key: "contractWarningDays", label: "Contract ending warning", hint: "Contracts ending within this window", unit: "days" },
  { key: "contractCriticalDays", label: "Contract ending critical", hint: "Contracts ending within this window", unit: "days" },
  { key: "paymentDueSoonDays", label: "Rent due soon", hint: "Warn this many days before a due date", unit: "days" },
  { key: "outstandingWarning", label: "Outstanding rent", hint: "Portfolio warning above this amount", unit: "$" },
  { key: "buildingOccupancyWarning", label: "Building occupancy", hint: "Warn when a building falls below this", unit: "%" },
  { key: "repeatLateMinCount", label: "Repeat late payer", hint: "Late at least this many times…", unit: "count" },
  { key: "repeatLateWindowMonths", label: "…within the last", hint: "Months looked back for late payments", unit: "months" },
  { key: "expiryClusterCount", label: "Renewal wave", hint: "Warn when this many contracts end in one month", unit: "count" },
];

export function SettingsPage() {
  const { store, run, reset, seed, status } = useStoreContext();
  const [companyName, setCompanyName] = useState(store.settings.companyName);
  const [ownerName, setOwnerName] = useState(store.settings.ownerName);
  const [thresholds, setThresholds] = useState<AlertThresholds>(store.settings.thresholds);
  const [resetting, setResetting] = useState(false);

  const dirtyCompany = companyName !== store.settings.companyName || ownerName !== store.settings.ownerName;
  const dirtyThresholds = (Object.keys(thresholds) as ThresholdKey[]).some((k) => thresholds[k] !== store.settings.thresholds[k]);

  function saveCompany() {
    run(updateCompany({ companyName: companyName.trim() || "Cedar Holdings", ownerName: ownerName.trim() || "Owner" }));
    toast.success("Company details saved");
  }

  function saveThresholds() {
    run(updateThresholds(thresholds));
    toast.success("Thresholds saved", { description: "Alerts were recomputed with the new rules." });
  }

  async function resetDemo() {
    setResetting(true);
    await reset();
    setResetting(false);
    toast.success("Demo data reset", { description: "Reloaded the seed workbook." });
  }

  const critical = store.alerts.filter((a) => a.severity === "critical" && !a.dismissed).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Company, alert thresholds and demo data." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-6">
          <SectionCard
            title="Company"
            action={
              <Button size="sm" onClick={saveCompany} disabled={!dirtyCompany}>
                <Save className="size-4" /> Save
              </Button>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-company" className="text-xs text-muted-foreground">
                  Company name
                </Label>
                <Input id="s-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-owner" className="text-xs text-muted-foreground">
                  Owner (greeting name)
                </Label>
                <Input id="s-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Currency</Label>
                  <Input value="USD" disabled />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Logo</Label>
                  <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">
                    <span className="flex size-5 items-center justify-center rounded bg-brand text-[10px] font-bold text-brand-foreground">{companyName.charAt(0) || "C"}</span>
                    generated from the name
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Demo data"
            description={seed ? `Seed loaded ${formatDateTime(seed.loadedAt)} · ${store.properties.length} buildings · ${store.units.length} units · ${store.tenants.length} tenants` : "Loading…"}
          >
            <p className="text-xs text-muted-foreground">Everything runs in memory. Reset reloads the seed workbook and discards every change made this session.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={resetDemo} disabled={resetting || status.state !== "ready"}>
                <RotateCcw className={cn("size-3.5", resetting && "animate-spin")} /> Reset demo data
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/settings/import">
                  Import data <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Alert thresholds"
          description={`Rules recompute live — ${critical} critical alert${critical === 1 ? "" : "s"} right now.`}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setThresholds(store.settings.thresholds)} disabled={!dirtyThresholds}>
                Revert
              </Button>
              <Button size="sm" onClick={saveThresholds} disabled={!dirtyThresholds}>
                <Save className="size-4" /> Apply
              </Button>
            </div>
          }
        >
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {THRESHOLD_FIELDS.map((f) => {
              const raw = thresholds[f.key];
              const shown = f.unit === "%" ? Math.round(raw * 100) : raw;
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`t-${f.key}`} className="text-xs text-muted-foreground">
                    {f.label}
                  </Label>
                  <div className="relative">
                    {f.unit === "$" && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>}
                    <Input
                      id={`t-${f.key}`}
                      type="number"
                      min={0}
                      value={shown}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setThresholds((t) => ({ ...t, [f.key]: f.unit === "%" ? Math.min(100, Math.max(0, v)) / 100 : Math.max(0, v) }));
                      }}
                      className={cn("tabular pr-14", f.unit === "$" && "pl-7")}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{f.unit === "$" ? "" : f.unit}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
