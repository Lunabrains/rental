"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Info, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Dropzone } from "@/components/import/dropzone";
import { MappingEditor } from "@/components/import/mapping-editor";
import { PlanPreview, PlanSummary } from "@/components/import/preview";
import { Button } from "@/components/ui/button";
import { importData } from "@/lib/commands";
import { CEDAR_SEED_URL, useStoreContext } from "@/lib/data/store-context";
import { formatDateTime } from "@/lib/format";
import {
  buildParsedWorkbook,
  buildTemplateWorkbook,
  downloadArrayBuffer,
  isTemplateShaped,
  mappingIssues,
  planImport,
  rememberMappings,
  scanWorkbook,
  suggestMappings,
  summarize,
  workbookToArrayBuffer,
  SHEET_NAMES,
  type ImportPlan,
  type ImportSummary,
  type SheetMapping,
  type WorkbookScan,
} from "@/lib/import";
import { cn } from "@/lib/utils";

type Step = "upload" | "map" | "review" | "done";

interface Loaded {
  scan: WorkbookScan;
  mappings: SheetMapping[];
}

interface Planned {
  plan: ImportPlan;
  notes: string[];
}

export function ImportPage() {
  const { store, run, reset, seed, status } = useStoreContext();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [resetting, setResetting] = useState(false);

  const step: Step = result ? "done" : planned ? "review" : loaded ? "map" : "upload";

  const buildPlan = useCallback(
    (l: Loaded): Planned | null => {
      const { parsed, notes } = buildParsedWorkbook(l.scan, l.mappings, store);
      const plan = planImport(parsed, store);
      if (plan.empty) return null;
      return { plan, notes };
    },
    [store],
  );

  const readFile = useCallback(
    async (file: File | { name: string; buffer: ArrayBuffer }) => {
      setBusy(true);
      setResult(null);
      setPlanned(null);
      try {
        const buffer = "buffer" in file ? file.buffer : await file.arrayBuffer();
        const scan = scanWorkbook(buffer, file.name);
        if (scan.sheets.length === 0) {
          toast.error("No data found", { description: "The workbook has no tabs with rows." });
          setLoaded(null);
          return;
        }
        const mappings = suggestMappings(scan);
        const l = { scan, mappings };
        const clean = mappingIssues(mappings).every((i) => i.level !== "error") && (isTemplateShaped(scan, mappings) || mappings.every((m) => m.detected === "preset" || m.detected === "name"));
        setLoaded(l);
        if (clean) {
          const p = buildPlan(l);
          if (p) setPlanned(p);
          else toast.error("No data found", { description: "The workbook has no rows in any recognised tab." });
        }
      } catch (err) {
        toast.error("Could not read the file", { description: err instanceof Error ? err.message : String(err) });
        setLoaded(null);
      } finally {
        setBusy(false);
      }
    },
    [buildPlan],
  );

  const loadLegacy = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/seed/legacy-example.xlsx", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await readFile({ name: "legacy-example.xlsx", buffer: await res.arrayBuffer() });
    } catch (err) {
      toast.error("Sample file unavailable", { description: err instanceof Error ? err.message : String(err) });
      setBusy(false);
    }
  }, [readFile]);

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

  function continueToReview() {
    if (!loaded) return;
    const errors = mappingIssues(loaded.mappings).filter((i) => i.level === "error");
    if (errors.length > 0) {
      toast.error("Mapping incomplete", { description: errors[0].message });
      return;
    }
    const p = buildPlan(loaded);
    if (!p) {
      toast.error("Nothing to import", { description: "No tab is mapped to anything with rows." });
      return;
    }
    setPlanned(p);
  }

  function confirm() {
    if (!loaded || !planned) return;
    const { result: summary } = run(importData(planned.plan));
    rememberMappings(loaded.scan, loaded.mappings);
    setResult(summary);
    toast.success("Import complete", { description: summarize(summary) });
  }

  function startOver() {
    setLoaded(null);
    setPlanned(null);
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
    if (!result || !planned) return null;
    const row = planned.plan.rows.properties.find((r) => r.action === "create" && r.data);
    if (!row?.data) return null;
    return store.properties.find((p) => p.code === row.data!.code) ?? null;
  }, [result, planned, store.properties]);

  const mappedSummary = useMemo(() => {
    if (!loaded) return [];
    return loaded.mappings
      .filter((m) => m.entity)
      .map((m) => ({ sheet: m.sheet, entity: SHEET_NAMES[m.entity!], mapped: m.columns.filter((c) => c.target).length, total: m.columns.length }));
  }, [loaded]);

  const rowCount = planned ? Object.values(planned.plan.counts).reduce((n, c) => n + c.create + c.update, 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import data"
        description="Bring in your existing records — buildings, units, tenants, contracts, suppliers, assets, expenses and more — from the template or from the spreadsheets you already keep. Preview first; nothing is written until you confirm."
        crumbs={[{ label: "Settings", href: "/settings" }, { label: "Import" }]}
        actions={
          <Button variant="outline" onClick={() => downloadArrayBuffer(workbookToArrayBuffer(buildTemplateWorkbook()), "rental-import-template.xlsx")}>
            <Download className="size-4" />
            Download template
          </Button>
        }
      />

      <Steps step={step} />

      {step === "upload" && (
        <SectionCard title="1 · Upload" description="Any .xlsx — one tab per kind of record. Columns are matched to the system by their headers (English or Arabic); you can adjust the match before anything is imported.">
          <Dropzone onFile={readFile} busy={busy} disabled={busy || status.state !== "ready"} />
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            <span>Rehearsing?</span>
            <button type="button" onClick={loadSample} disabled={busy || status.state !== "ready"} className="font-medium text-foreground hover:underline disabled:opacity-50">
              Use the sample file (cedar-residence.xlsx)
            </button>
            <span>·</span>
            <button type="button" onClick={loadLegacy} disabled={busy || status.state !== "ready"} className="font-medium text-foreground hover:underline disabled:opacity-50">
              Try a messy legacy file (legacy-example.xlsx)
            </button>
          </div>
        </SectionCard>
      )}

      {step === "map" && loaded && (
        <SectionCard
          title="2 · Map columns"
          description="Say what each tab contains and where each column goes. Required fields the file lacks are derived where possible — building codes from names, floors from the units listed, contract numbers and end dates from start and duration."
          action={
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileSpreadsheet className="size-3.5" /> {loaded.scan.fileName}
            </span>
          }
        >
          <MappingEditor scan={loaded.scan} mappings={loaded.mappings} onChange={(mappings) => setLoaded({ ...loaded, mappings })} />
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={startOver}>
              Choose another file
            </Button>
            <Button onClick={continueToReview} disabled={busy || mappingIssues(loaded.mappings).some((i) => i.level === "error")}>
              Check the data
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </SectionCard>
      )}

      {step === "review" && loaded && planned && (
        <>
          <SectionCard
            title="2 · Column mapping"
            description={mappedSummary.map((m) => `${m.sheet} → ${m.entity} (${m.mapped}/${m.total} columns)`).join(" · ") || "No tab mapped."}
            action={
              <Button variant="outline" size="sm" onClick={() => setPlanned(null)}>
                <ArrowLeft className="size-3.5" /> Adjust mapping
              </Button>
            }
          >
            {planned.notes.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {planned.notes.map((n, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Every column matched a system field; nothing had to be derived.</p>
            )}
            {planned.plan.unknownSheets.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Skipped tabs: {planned.plan.unknownSheets.join(", ")}.</p>}
          </SectionCard>

          <SectionCard title="3 · Preview & validate" description={<PlanSummary plan={planned.plan} />}>
            <PlanPreview plan={planned.plan} />
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={startOver}>
                Choose another file
              </Button>
              <Button onClick={confirm} disabled={busy || rowCount === 0}>
                Import {rowCount} rows
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
                {summarize(result)} {result.paymentsGenerated > 0 && `${result.paymentsGenerated} payment rows scheduled.`} Took {result.durationMs} ms. The column mapping is remembered for the next file with the same headers.
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
    { key: "map", label: "Map columns" },
    { key: "review", label: "Check & preview" },
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
