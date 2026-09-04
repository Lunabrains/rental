"use client";

import { Download, ExternalLink, Eye, FileText, IdCard, Receipt, Upload } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/states";
import { buildDocumentHtml, openDocument, downloadDocument } from "@/components/documents/document-preview";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { daysUntil } from "@/lib/date";
import { formatDate } from "@/lib/format";
import type { UnitDetails } from "@/lib/queries";
import type { DocumentKind, StoredDocument } from "@/types";

const ICON: Record<DocumentKind, typeof FileText> = {
  id: IdCard,
  passport: IdCard,
  contract: FileText,
  receipt: Receipt,
  other: FileText,
};

const KIND_LABEL: Record<DocumentKind, string> = {
  id: "ID",
  passport: "Passport",
  contract: "Contract",
  receipt: "Receipt",
  other: "Document",
};

export function DocumentRow({ doc, onPreview }: { doc: StoredDocument; onPreview: (doc: StoredDocument) => void }) {
  const store = useStore();
  const Icon = ICON[doc.kind];
  const expiring = doc.expiryDate !== null && daysUntil(doc.expiryDate) <= 60;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{doc.title}</span>
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABEL[doc.kind]}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {doc.fileName} · {doc.sizeKb} KB
          {doc.expiryDate && <span className={expiring ? " text-warning-foreground" : ""}> · expires {formatDate(doc.expiryDate)}</span>}
          {!doc.expiryDate && doc.issuedDate && ` · ${doc.generated ? "generated" : "added"} ${formatDate(doc.uploadedAt)}`}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        <Button size="icon" variant="ghost" className="size-8" aria-label="Preview" onClick={() => onPreview(doc)}>
          <Eye className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" aria-label="Open" onClick={() => openDocument(buildDocumentHtml(doc, store))}>
          <ExternalLink className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" aria-label="Download" onClick={() => downloadDocument(doc, buildDocumentHtml(doc, store))}>
          <Download className="size-4" />
        </Button>
      </span>
    </li>
  );
}

export function DocumentsTab({ details, onPreview }: { details: UnitDetails; onPreview: (doc: StoredDocument) => void }) {
  const docs = details.documents.slice().sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  function upload() {
    toast("Upload is not wired in this demo", { description: "Documents come in through the import template." });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" variant="outline" onClick={upload}>
          <Upload className="size-4" /> Upload
        </Button>
      </div>
      {docs.length === 0 ? (
        <EmptyState compact icon={FileText} title="No documents yet" description="ID, passport, signed contract and receipts will appear here." />
      ) : (
        <ul className="divide-y rounded-md border">
          {docs.map((d) => (
            <DocumentRow key={d.id} doc={d} onPreview={onPreview} />
          ))}
        </ul>
      )}
    </div>
  );
}
