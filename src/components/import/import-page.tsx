"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Dropzone } from "@/components/import/dropzone";
import { MappingTable } from "@/components/import/mapping-table";
import { PlanPreview, PlanSummary } from "@/components/import/preview";
import { Button } from "@/components/ui/button";
import { importData } from "@/lib/commands";
import { CEDAR_SEED_URL, useStoreContext } from "@/lib/data/store-context";
import { formatDateTime } from "@/lib/format";
import {
  buildTemplateWorkbook,
  downloadArrayBuffer,
  parseWorkbook,
  planImport,
  summarize,
  workbookToArrayBuffer,
  type ImportPlan,
  type ImportSummary,
  type ParsedWorkbook,
} from "@/lib/import";
import { cn } from "@/lib/utils";

type Step = "upload" | "review" | "done";

interface Loaded {
  parsed: ParsedWorkbook;
  plan: ImportPlan;
}

export function ImportPage() {
  const { store, run, reset, seed, status } = useStoreContext();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [resetting, setResetting] = useState(false);

  const step: Step = result ? "done" : loaded ? "review" : "upload";

  const readFile = useCallback(
    async (file: File | { name: string; buffer: ArrayBuffer }) => {
      setBusy(true);
      setResult(null);
      try {
        const buffer = "buffer" in file ? file.buffer : await file.arrayBuffer();
        const parsed = parseWorkbook(buffer, file.name);
        const plan = planImport(parsed, store);
        if (plan.empty) {
          toast.error("No data found", { description: "The workbook has no rows in any recognised tab." });
          setLoaded(null);
          return;
        }
        setLoaded({ parsed, plan });
      } catch (err) {
        toast.error("Could not read the file", { description: err instanceof Error ? err.message : String(err) });
        setLoaded(null);
      } finally {
        setBusy(false);
      }
    },
    [store],
  );

  const loadSample = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(CEDAR_SEED_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await readFile({ name: "cedar-residence.xlsx", buffer: await res.arrayBuffer() });
    } catch (err) {
      toast.error("Sample file unavailable", { description: err instanceof Error ? err.message : String(err) });
      setBusy(false);
    }
  }, [readFile]);

  function confirm() {
    if (!loaded) return;
    const { result: summary } = run(importData(loaded.plan));
    setResult(summary);
    toast.success("Import complete", { description: summarize(summary) });
  }

  function startOver() {
    setLoaded(null);
    setResult(null);
  }

  async function resetDemo() {
    setResetting(true);
    await reset();
    setResetting(false);
    startOver();
    toast.success("Demo data reset", { description: "Reloaded the seed workbook." });
  }

  const createdProperty = useMemo(() => {
    if (!result || !loaded) return null;
    const row = loaded.plan.rows.properties.find((r) => r.action === "create" && r.data);
    if (!row?.data) return null;
    return store.properties.find((p) => p.code === row.data!.code) ?? null;
  }, [result, loaded, store.properties]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Import"
        description="Bring in buildings, units, tenants and contracts from the template. Preview first — nothing is written until you confirm."
        crumbs={[{ label: "Settings", href: "/settings" }, { label: "Import" }]}
        actions={
          <Button
            variant="outline"
            onClick={() => downloadArrayBuffer(workbookToArrayBuffer(buildTemplateWorkbook()), "rental-import-template.xlsx")}
          >
            <Download className="size-4" />
            Download template
          </Button>
        }
      />

      <Steps step={step} />

      {step === "upload" && (
        <SectionCard title="1 · Upload" description="Accepted: .xlsx following the template (Properties, Units, Tenants, Contracts, Documents).">
          <Dropzone onFile={readFile} busy={busy} disabled={busy || status.state !== "ready"} />
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            <span>Rehearsing?</span>
            <button type="button" onClick={loadSample} disabled={busy || status.state !== "ready"} className="font-medium text-foreground hover:underline disabled:opacity-50">
              Use the sample file (cedar-residence.xlsx)
            </button>
          </div>
        </SectionCard>
      )}

      {step === "review" && loaded && (
        <>
          <SectionCard
            title="2 · Column mapping"
            description="This version reads the template headers directly. The mapping is shown for transparency."
            action={
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileSpreadsheet className="size-3.5" /> {loaded.parsed.fileName}
              </span>
            }
          >
            <MappingTable parsed={loaded.parsed} />
            {loaded.parsed.hasPaymentsSheet && (
              <p className="mt-3 text-xs text-muted-foreground">A Payments tab is present — it is ignored in this version; schedules are generated from contracts.</p>
            )}
            {loaded.parsed.unknownSheets.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Ignored tabs: {loaded.parsed.unknownSheets.join(", ")}.</p>
            )}
          </SectionCard>

          <SectionCard title="3 · Preview & validate" description={<PlanSummary plan={loaded.plan} />}>
            <PlanPreview plan={loaded.plan} />
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={startOver}>
                Choose another file
              </Button>
              <Button onClick={confirm} disabled={busy}>
                Import{" "}
                {Object.values(loaded.plan.counts).reduce((n, c) => n + c.create + c.update, 0)} rows
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </SectionCard>
        </>
      )}

      {step === "done" && result && (
        <SectionCard>
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-muted text-success">
              <CheckCircle2 className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Import complete</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {summarize(result)} {result.paymentsGenerated > 0 && `${result.paymentsGenerated} payment rows scheduled.`} Took {result.durationMs} ms.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {createdProperty && (
                  <Button asChild>
                    <Link href={`/properties/${createdProperty.id}`}>
                      Open {createdProperty.name}
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href="/properties">All properties</Link>
                </Button>
                <Button variant="ghost" onClick={startOver}>
                  Import another file
                </Button>
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Demo data"
        description={
          seed
            ? `Seed loaded ${formatDateTime(seed.loadedAt)} · ${store.properties.length} buildings · ${store.units.length} units · ${store.tenants.length} tenants · ${store.contracts.length} contracts`
            : "Loading seed workbook…"
        }
        action={
          <Button variant="outline" size="sm" onClick={resetDemo} disabled={resetting || status.state !== "ready"}>
            <RotateCcw className={cn("size-3.5", resetting && "animate-spin")} />
            Reset demo data
          </Button>
        }
      >
        <p className="text-xs text-muted-foreground">
          The demo runs entirely in memory. Reset reloads <code className="font-mono">/seed/portfolio.xlsx</code> through this same importer and discards every change made in this session.
        </p>
      </SectionCard>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "review", label: "Map & preview" },
    { key: "done", label: "Import" },
  ];
  const order = items.findIndex((i) => i.key === step);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((item, i) => {
        const state = i < order ? "done" : i === order ? "current" : "todo";
        return (
          <li key={item.key} className="flex items-center gap-2">
            <span
              className={cn(
                "tabular flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                state === "done" && "bg-success text-success-foreground",
                state === "current" && "bg-primary text-primary-foreground",
                state === "todo" && "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className={cn(state === "todo" ? "text-muted-foreground" : "font-medium")}>{item.label}</span>
            {i < items.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
