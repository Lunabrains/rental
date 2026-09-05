"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSearch, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AssetSelect, EnumSelect, PropertySelect, SupplierSelect, TenantSelect, UnitSelect } from "@/components/common/entity-select";
import { DocumentBody } from "@/components/documents/document-preview";
import { Field, FlowDialog } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { extractDocument, FIELD_LABELS, type DocumentExtraction, type ExtractedKey } from "@/lib/ai/documents";
import { markDocumentReviewed, updateAsset, updateDocument } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DOCUMENT_CATEGORIES, type DocumentCategory, type ExpenseCategory } from "@/types";

function Confidence({ value }: { value: number }) {
  const label = value >= 0.75 ? "High" : value >= 0.5 ? "Medium" : "Guess";
  return <span className={cn("rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide", value >= 0.75 ? "bg-success-muted text-success" : value >= 0.5 ? "bg-warning-muted text-warning-foreground" : "bg-muted text-muted-foreground")}>{label}</span>;
}

const EXPENSE_CATEGORY_FOR: Partial<Record<string, ExpenseCategory>> = { elevator: "elevator", generator: "generator", hvac: "hvac", plumbing: "plumbing", electrical: "electrical", cleaning: "cleaning", security: "security", insurance: "insurance", municipality: "municipality" };

/**
 * Review screen (plan §Phase 15): the file stays as uploaded; the app suggests
 * what it is, what it says and what it belongs to, and nothing is written
 * until the owner confirms. Financial and contract records are never created
 * silently — they open their own form prefilled.
 */
export function DocumentReviewDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const { addExpense, editContractTerms } = useActions();
  const doc = useMemo(() => indexStore(store).documentById.get(documentId) ?? null, [store, documentId]);
  const [extraction, setExtraction] = useState<DocumentExtraction | null>(null);
  const [status, setStatus] = useState<string | null>("Reading…");
  const [category, setCategory] = useState<DocumentCategory>(doc?.category ?? "other");
  const [title, setTitle] = useState(doc?.title ?? "");
  const [tenantId, setTenantId] = useState<string | null>(doc?.tenantId ?? null);
  const [propertyId, setPropertyId] = useState<string | null>(doc?.propertyId ?? null);
  const [unitId, setUnitId] = useState<string | null>(doc?.unitId ?? null);
  const [supplierId, setSupplierId] = useState<string | null>(doc?.supplierId ?? null);
  const [assetId, setAssetId] = useState<string | null>(doc?.assetId ?? null);
  const [issued, setIssued] = useState(doc?.issuedDate ?? "");
  const [expiry, setExpiry] = useState(doc?.expiryDate ?? "");
  const [values, setValues] = useState<Partial<Record<ExtractedKey, string>>>({});
  const [createExpense, setCreateExpense] = useState(false);
  const [reviewContract, setReviewContract] = useState(false);
  const [setWarranty, setSetWarranty] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    extractDocument(store, doc, (s) => !cancelled && setStatus(s)).then((x) => {
      if (cancelled) return;
      setExtraction(x);
      setStatus(null);
      const v: Partial<Record<ExtractedKey, string>> = {};
      for (const f of x.fields) v[f.key] = f.value;
      setValues(v);
      if (x.typeConfidence >= 0.5) setCategory(x.docType);
      if (x.links.tenantId) setTenantId(x.links.tenantId);
      if (x.links.propertyId) setPropertyId(x.links.propertyId);
      if (x.links.unitId) setUnitId(x.links.unitId);
      if (x.links.supplierId) setSupplierId(x.links.supplierId);
      if (x.links.assetId) setAssetId(x.links.assetId);
      if (v.expiryDate) setExpiry(v.expiryDate);
      if (v.issuedDate) setIssued(v.issuedDate);
      const money = v.amount ? Number(v.amount) : 0;
      setCreateExpense((x.docType === "invoice" || x.docType === "receipt") && money > 0 && !doc.expenseId);
      setReviewContract(x.docType === "lease" && !!(x.links.contractId ?? doc.contractId) && x.fields.some((f) => f.key === "rent" || f.key === "startDate" || f.key === "endDate"));
      setSetWarranty(x.docType === "warranty" && !!x.links.assetId && !!v.expiryDate);
    });
    return () => {
      cancelled = true;
    };
    // Re-run only on demand (runId) or when the document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, runId]);

  if (!doc) return null;
  const idx = indexStore(store);
  const contractId = doc.contractId ?? extraction?.links.contractId ?? (tenantId ? (idx.contractsByTenant.get(tenantId) ?? []).slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0]?.id ?? null : null);
  const contract = contractId ? idx.contractById.get(contractId) ?? null : null;
  const amount = values.amount ? Number(values.amount) : 0;
  const asset = assetId ? idx.assetById.get(assetId) ?? null : null;
  const visibleKeys: ExtractedKey[] = category === "lease" ? ["tenantName", "rent", "deposit", "startDate", "endDate", "paymentFrequency", "increaseClause", "specialTerms"] : category === "invoice" || category === "receipt" || category === "quotation" ? ["supplierName", "amount", "date", "dueDate", "invoiceNumber"] : ["issuedDate", "expiryDate", "reference", "assetName"];
  const confidenceOf = (key: ExtractedKey) => extraction?.fields.find((f) => f.key === key)?.confidence ?? null;

  function apply() {
    if (!doc) return;
    try {
      const { undo } = run(updateDocument(doc.id, { category, title: title.trim() || doc.title, tenantId, contractId: category === "lease" || tenantId ? contractId : doc.contractId, propertyId, unitId, supplierId, assetId, issuedDate: issued || null, expiryDate: expiry || null }));
      if (extraction) run(markDocumentReviewed(doc.id, { source: extraction.source, at: new Date().toISOString().slice(0, 10), docType: category, fields: extraction.fields.map((f) => ({ key: f.key, value: values[f.key] ?? f.value, confidence: f.confidence })) }));
      const side: string[] = [];
      if (setWarranty && asset && expiry) {
        run(updateAsset(asset.id, { warrantyExpiry: expiry }));
        side.push(`${asset.name} warranty → ${formatDate(expiry)}`);
      }
      toast.success(`${title || doc.title} filed as ${labelize(category)}`, { description: side.length > 0 ? side.join(" · ") : `${extraction?.source === "model" ? "Read by Claude" : "Read by rules"} · reviewed by you`, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
      if (createExpense && propertyId) {
        const supplier = supplierId ? idx.supplierById.get(supplierId) : null;
        addExpense({ propertyId, unitId, supplierId, assetId, amount, expenseDate: values.date, dueDate: values.dueDate, invoiceNumber: values.invoiceNumber, category: (supplier && EXPENSE_CATEGORY_FOR[supplier.category]) ?? (category === "invoice" ? "maintenance" : "other"), description: `${supplier?.name ?? title}${values.invoiceNumber ? ` · ${values.invoiceNumber}` : ""}`, documentId: doc.id, classification: "operating" });
      } else if (reviewContract && contractId) {
        editContractTerms(contractId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not file the document");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title="Review document" description={`${doc.fileName} · ${doc.sizeKb} KB · the original file is kept as uploaded`} wide footer={<><Button variant="ghost" onClick={onClose}>Later</Button><Button onClick={apply} disabled={status !== null}>Apply{createExpense ? " & book expense" : reviewContract ? " & review contract" : ""}</Button></>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="max-h-[60vh] overflow-auto rounded-lg bg-muted/60 p-3">
          <DocumentBody doc={doc} />
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {status ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground"><RefreshCw className="size-3.5 animate-spin" /> {status}</span>
            ) : extraction ? (
              <>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", extraction.source === "model" ? "bg-brand-muted text-brand" : "bg-muted text-muted-foreground")}>
                  {extraction.source === "model" ? <Sparkles className="size-3" /> : <FileSearch className="size-3" />}
                  {extraction.source === "model" ? `Read by Claude${extraction.model ? ` (${extraction.model})` : ""}` : "Read by rules"}
                </span>
                <span className="text-muted-foreground">Looks like <strong className="text-foreground">{labelize(extraction.docType)}</strong></span>
                <Confidence value={extraction.typeConfidence} />
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setStatus("Reading…"); setRunId((n) => n + 1); }}><RefreshCw className="size-3" /> Re-read</Button>
              </>
            ) : null}
          </div>
          {extraction?.notes.map((n, i) => (
            <p key={i} className="rounded-md bg-warning-muted/40 px-3 py-2 text-xs text-warning-foreground">{n}</p>
          ))}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="rv-category"><EnumSelect id="rv-category" values={DOCUMENT_CATEGORIES} value={category} onChange={(v) => v && setCategory(v)} labels={{ tenant_id: "Tenant ID" }} /></Field>
            <Field label="Title" htmlFor="rv-title"><Input id="rv-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Building" htmlFor="rv-property" hint={extraction?.linkConfidence.propertyId !== undefined ? <Confidence value={extraction.linkConfidence.propertyId} /> : undefined}><PropertySelect id="rv-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); }} allowNone /></Field>
            <Field label="Unit" htmlFor="rv-unit" hint={extraction?.linkConfidence.unitId !== undefined ? <Confidence value={extraction.linkConfidence.unitId} /> : undefined}><UnitSelect id="rv-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone /></Field>
            <Field label="Tenant" htmlFor="rv-tenant" hint={extraction?.linkConfidence.tenantId !== undefined ? <Confidence value={extraction.linkConfidence.tenantId} /> : undefined}><TenantSelect id="rv-tenant" value={tenantId} onChange={setTenantId} allowNone /></Field>
            <Field label="Supplier" htmlFor="rv-supplier" hint={extraction?.linkConfidence.supplierId !== undefined ? <Confidence value={extraction.linkConfidence.supplierId} /> : undefined}><SupplierSelect id="rv-supplier" value={supplierId} onChange={setSupplierId} allowNone /></Field>
            {(category === "warranty" || category === "certificate" || category === "maintenance_report" || assetId) && <Field label="Asset" htmlFor="rv-asset" hint={extraction?.linkConfidence.assetId !== undefined ? <Confidence value={extraction.linkConfidence.assetId} /> : undefined}><AssetSelect id="rv-asset" propertyId={propertyId} value={assetId} onChange={setAssetId} allowNone /></Field>}
            <Field label="Issued" htmlFor="rv-issued"><Input id="rv-issued" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} /></Field>
            <Field label="Expiry" htmlFor="rv-expiry" hint="Raises an alert before it lapses"><Input id="rv-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
          </div>

          {extraction && (
            <div className="rounded-md border">
              <p className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">What the document says</p>
              <ul className="divide-y">
                {visibleKeys.map((key) => {
                  const c = confidenceOf(key);
                  const f = extraction.fields.find((x) => x.key === key);
                  const current = key === "rent" && contract ? formatMoney(contract.monthlyRent) : key === "deposit" && contract ? formatMoney(contract.deposit) : key === "startDate" && contract ? formatDate(contract.startDate) : key === "endDate" && contract ? formatDate(contract.endDate) : null;
                  const differs = current !== null && values[key] !== undefined && values[key] !== "" && String(values[key]) !== String(key === "rent" ? contract?.monthlyRent : key === "deposit" ? contract?.deposit : key === "startDate" ? contract?.startDate : contract?.endDate);
                  return (
                    <li key={key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="w-28 shrink-0 text-xs text-muted-foreground">{FIELD_LABELS[key]}</span>
                      <Input value={values[key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} placeholder="—" className="h-7 flex-1 text-xs" />
                      {c !== null && <Confidence value={c} />}
                      {f?.evidence && <span className="hidden max-w-32 truncate text-[10px] text-muted-foreground sm:inline" title={f.evidence}>{f.evidence}</span>}
                      {current !== null && <span className={cn("shrink-0 text-[10px]", differs ? "text-warning-foreground" : "text-muted-foreground")}>{differs ? `contract: ${current}` : "matches contract"}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
            {(category === "invoice" || category === "receipt" || category === "quotation") && (
              <label className="flex items-center gap-3">
                <Switch checked={createExpense} onCheckedChange={setCreateExpense} disabled={!propertyId || amount <= 0} />
                <span>Book an expense of <strong>{amount > 0 ? formatMoney(amount) : "—"}</strong> from this {labelize(category).toLowerCase()} <span className="text-xs text-muted-foreground">(opens the expense form for review)</span></span>
              </label>
            )}
            {category === "lease" && (
              <label className="flex items-center gap-3">
                <Switch checked={reviewContract} onCheckedChange={setReviewContract} disabled={!contractId} />
                <span>Review the contract terms against this lease{contract ? ` (${formatDate(contract.startDate)} → ${formatDate(contract.endDate)})` : " — link a tenant first"} <span className="text-xs text-muted-foreground">(nothing changes without your confirmation)</span></span>
              </label>
            )}
            {category === "warranty" && (
              <label className="flex items-center gap-3">
                <Switch checked={setWarranty} onCheckedChange={setSetWarranty} disabled={!asset || !expiry} />
                <span>Set {asset?.name ?? "the asset"}&apos;s warranty expiry to {expiry ? formatDate(expiry) : "—"}</span>
              </label>
            )}
            <p className="text-xs text-muted-foreground">Filing records the category, links and dates on the document and marks it reviewed. The upload itself is never altered.</p>
          </div>
        </div>
      </div>
    </FlowDialog>
  );
}
