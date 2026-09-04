"use client";

import { useMemo, useState } from "react";
import { FolderOpen, Search } from "lucide-react";

import { Chips } from "@/components/common/chips";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { DocumentPreview } from "@/components/documents/document-preview";
import { DocumentRow } from "@/components/units/documents-tab";
import { useStore } from "@/lib/data/store-context";
import { getDocuments } from "@/lib/queries";
import type { DocumentKind, StoredDocument } from "@/types";

type KindFilter = "all" | DocumentKind;

export function DocumentsPage() {
  const store = useStore();
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  const docs = useMemo(() => getDocuments(store), [store]);
  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: docs.length, id: 0, passport: 0, contract: 0, receipt: 0, other: 0 };
    for (const d of docs) c[d.kind]++;
    return c;
  }, [docs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => (kind === "all" || d.kind === kind) && (!q || `${d.title} ${d.fileName} ${d.tenant?.fullName ?? ""} ${d.property?.name ?? ""}`.toLowerCase().includes(q)));
  }, [docs, kind, query]);

  const byTenant = useMemo(() => {
    const groups = new Map<string, { name: string; property: string | null; docs: typeof filtered }>();
    for (const d of filtered) {
      const key = d.tenantId ?? "none";
      const g = groups.get(key) ?? { name: d.tenant?.fullName ?? "Unassigned", property: d.property?.name ?? null, docs: [] };
      g.docs.push(d);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description={`${docs.length} documents across ${new Set(docs.map((d) => d.tenantId)).size} tenants · IDs, passports, contracts and receipts`} />

      <div className="flex flex-wrap items-center gap-3">
        <Chips<KindFilter>
          aria-label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "id", label: "IDs", count: counts.id },
            { value: "passport", label: "Passports", count: counts.passport },
            { value: "contract", label: "Contracts", count: counts.contract },
            { value: "receipt", label: "Receipts", count: counts.receipt },
          ]}
        />
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tenant, file, building…"
            className="h-9 w-56 rounded-md border border-input bg-card pl-8 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          />
        </div>
      </div>

      {byTenant.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No documents match" />
      ) : (
        <div className="space-y-4">
          {byTenant.map((g) => (
            <section key={g.name} className="overflow-hidden rounded-lg border bg-card shadow-xs">
              <header className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
                <span className="text-sm font-medium">{g.name}</span>
                <span className="text-xs text-muted-foreground">
                  {g.property ? `${g.property} · ` : ""}
                  {g.docs.length} file{g.docs.length === 1 ? "" : "s"}
                </span>
              </header>
              <ul className="divide-y">
                {g.docs.map((d) => (
                  <DocumentRow key={d.id} doc={d} onPreview={setPreview} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
