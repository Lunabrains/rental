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
import { updateCompany } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDateTime } from "@/lib/format";
import { THRESHOLD_FIELDS } from "@/lib/derived/alert-catalog";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const { store, run, reset, seed, status } = useStoreContext();
  const [companyName, setCompanyName] = useState(store.settings.companyName);
  const [ownerName, setOwnerName] = useState(store.settings.ownerName);
  const [resetting, setResetting] = useState(false);

  const dirtyCompany = companyName !== store.settings.companyName || ownerName !== store.settings.ownerName;

  function saveCompany() {
    run(updateCompany({ companyName: companyName.trim() || "Succar Holdings", ownerName: ownerName.trim() || "Owner" }));
    toast.success("Company details saved");
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
      <PageHeader title="Settings" description="Company, alert rules and demo data." />

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
          title="Alert rules"
          description={`${critical} critical alert${critical === 1 ? "" : "s"} right now · ${store.settings.mutedAlertTypes.length} rule${store.settings.mutedAlertTypes.length === 1 ? "" : "s"} muted`}
          action={
            <Button size="sm" asChild>
              <Link href="/alerts/rules">
                Open rules <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">Every rule the engine runs is listed with its thresholds and a mute switch. Changes recompute the alerts immediately — nothing is sent outside the app.</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {THRESHOLD_FIELDS.slice(0, 6).map((f) => (
              <div key={f.key}>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                <dd className="tabular">{f.unit === "%" ? `${Math.round(store.settings.thresholds[f.key] * 100)}%` : f.unit === "$" ? `$${store.settings.thresholds[f.key].toLocaleString()}` : `${store.settings.thresholds[f.key]} ${f.unit}`}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>
    </div>
  );
}
