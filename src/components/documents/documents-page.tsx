"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { FolderOpen, Search, Sparkles } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { Chips } from "@/components/common/chips";
import { EnumSelect, PropertySelect, SupplierSelect, TenantSelect, UnitSelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { DocumentPreview } from "@/components/documents/document-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentRow } from "@/components/units/documents-tab";
import { useStore } from "@/lib/data/store-context";
import { daysUntil } from "@/lib/date";
import { labelize } from "@/lib/format";
import { getDocuments, type DocumentRow as DocRow } from "@/lib/queries";
import { DOCUMENT_CATEGORIES, type DocumentCategory, type StoredDocument } from "@/types";

type ViewChip = "all" | "review" | "expiring" | "photos";

/** Document centre (plan §12 + §Phase 15): one record per file, filed against the entities it belongs to, with a review queue. */
export function DocumentsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { reviewDocument } = useActions();
  const [preview, setPreview] = useState<StoredDocument | null>(null);
  const [query, setQuery] = useState("");
  const view = (params.get("view") as ViewChip | null) ?? "all";
  const category = params.get("category") as DocumentCategory | null;
  const propertyId = params.get("property");
  const unitId = params.get("unit");
  const tenantId = params.get("tenant");
  const supplierId = params.get("supplier");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/documents${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const all = useMemo(() => getDocuments(store), [store]);
  const docs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return getDocuments(store, { category: category ?? undefined, propertyId: propertyId ?? undefined, unitId: unitId ?? undefined, tenantId: tenantId ?? undefined, supplierId: supplierId ?? undefined, from: from || undefined, to: to || undefined }).filter((d) => {
      if (view === "review" && !d.needsReview) return false;
      if (view === "expiring" && !(d.expiryDate && daysUntil(d.expiryDate) <= 90)) return false;
      if (view === "photos" && d.category !== "photo") return false;
      if (q && !`${d.title} ${d.fileName} ${d.tenant?.fullName ?? ""} ${d.property?.name ?? ""} ${d.unit?.unitNumber ?? ""} ${d.supplier?.name ?? ""} ${d.asset?.name ?? ""} ${d.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [store, view, category, propertyId, unitId, tenantId, supplierId, from, to, query]);

  const kpis = { total: all.length, review: all.filter((d) => d.needsReview).length, expiring: all.filter((d) => d.expiryDate && daysUntil(d.expiryDate) <= 90).length, expired: all.filter((d) => d.expiryDate && daysUntil(d.expiryDate) < 0).length };
  const groups = useMemo(() => {
    const map = new Map<string, { title: string; subtitle: string; docs: DocRow[] }>();
    for (const d of docs) {
      const key = d.tenant ? `t-${d.tenant.id}` : d.supplier ? `s-${d.supplier.id}` : d.asset ? `a-${d.asset.id}` : d.property ? `p-${d.property.id}` : "portfolio";
      const g = map.get(key) ?? { title: d.tenant?.fullName ?? d.supplier?.name ?? d.asset?.name ?? d.property?.name ?? "Portfolio", subtitle: d.tenant ? `Tenant${d.property ? ` · ${d.property.name}${d.unit ? ` ${d.unit.unitNumber}` : ""}` : ""}` : d.supplier ? "Supplier" : d.asset ? `Asset · ${d.property?.name ?? ""}` : d.property ? "Building" : "Unfiled", docs: [] };
      g.docs.push(d);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [docs]);

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description={`${kpis.total} on file · leases, IDs, invoices, certificates, warranties, photos — each linked to what it belongs to`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Needs review" value={kpis.review} tone={kpis.review > 0 ? "warning" : "success"} sublabel="Unfiled or uncategorised uploads" href="/documents?view=review" icon={Sparkles} />
        <KpiCard label="Expiring in 90 days" value={kpis.expiring} tone={kpis.expiring > 0 ? "warning" : "default"} sublabel={`${kpis.expired} already expired`} href="/documents?view=expiring" />
        <KpiCard label="Leases on file" value={all.filter((d) => d.category === "lease").length} sublabel={`${store.contracts.filter((c) => c.status === "active" || c.status === "notice_given").length} live contracts`} href="/documents?category=lease" />
        <KpiCard label="Invoices & receipts" value={all.filter((d) => d.category === "invoice" || d.category === "receipt").length} sublabel="Linked to expenses and payments" href="/documents?category=invoice" />
      </div>

      <AttachmentUploader links={{ propertyId: propertyId ?? undefined, unitId: unitId ?? undefined, tenantId: tenantId ?? undefined, supplierId: supplierId ?? undefined }} label="Drop a file to file it" review />

      <div className="flex flex-wrap items-center gap-3">
        <Chips<ViewChip> aria-label="View" value={view} onChange={(v) => setParams({ view: v })} options={[{ value: "all", label: "All", count: all.length }, { value: "review", label: "Needs review", count: kpis.review }, { value: "expiring", label: "Expiring", count: kpis.expiring }, { value: "photos", label: "Photos" }]} />
        <div className="w-40">
          <EnumSelect values={DOCUMENT_CATEGORIES} value={category} onChange={(v) => setParams({ category: v })} allowAll allLabel="All categories" labels={{ tenant_id: "Tenant ID" }} />
        </div>
        <div className="w-44">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id, unit: null })} allowAll />
        </div>
        {propertyId && (
          <div className="w-32">
            <UnitSelect propertyId={propertyId} value={unitId} onChange={(id) => setParams({ unit: id })} allowAll />
          </div>
        )}
        <div className="w-44">
          <TenantSelect value={tenantId} onChange={(id) => setParams({ tenant: id })} allowAll />
        </div>
        <div className="w-40">
          <SupplierSelect value={supplierId} onChange={(id) => setParams({ supplier: id })} allowAll />
        </div>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From <Input type="date" value={from} onChange={(e) => setParams({ from: e.target.value })} className="h-9 w-36" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          To <Input type="date" value={to} onChange={(e) => setParams({ to: e.target.value })} className="h-9 w-36" />
        </label>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, file, tenant, supplier…" className="h-9 w-56 rounded-md border border-input bg-card pl-8 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20" />
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={FolderOpen} title={view === "review" ? "Nothing waiting for review" : "No documents match"} description={view === "review" ? "Every upload is filed." : undefined} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.title + g.subtitle} className="overflow-hidden rounded-lg border bg-card shadow-xs">
              <header className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
                <span className="text-sm font-medium">{g.title}</span>
                <span className="text-xs text-muted-foreground">{g.subtitle} · {g.docs.length} file{g.docs.length === 1 ? "" : "s"}</span>
              </header>
              <ul className="divide-y">
                {g.docs.map((d) => (
                  <DocumentRow key={d.id} doc={d} onPreview={setPreview} onReview={reviewDocument} badge={d.needsReview ? "Review" : labelize(d.category)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {kpis.review > 0 && view !== "review" && (
        <Button variant="outline" size="sm" onClick={() => setParams({ view: "review" })}><Sparkles className="size-4" /> Review {kpis.review} unfiled document{kpis.review === 1 ? "" : "s"}</Button>
      )}
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
