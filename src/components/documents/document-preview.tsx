"use client";

import { Download, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { indexStore } from "@/lib/data/store";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatMonth, labelize, ordinal } from "@/lib/format";
import type { Store, StoredDocument } from "@/types";

/**
 * Documents in the demo are rendered, not stored: each one is generated from
 * the record it belongs to (tenant, contract, payment) so previews always
 * agree with the data. "Open" prints the same markup in a new tab; "Download"
 * saves it as a self-contained HTML file.
 */

interface DocContext {
  tenantName: string;
  tenantId: string;
  nationality: string;
  idType: string;
  idNumber: string;
  phone: string;
  propertyName: string;
  address: string;
  unitNumber: string;
  companyName: string;
  ownerName: string;
  contractNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  rent: number | null;
  deposit: number | null;
  paymentDay: number | null;
  method: string | null;
  paymentAmount: number | null;
  paymentPeriod: string | null;
  paymentDate: string | null;
  paymentReference: string | null;
}

function contextFor(doc: StoredDocument, store: Store): DocContext {
  const idx = indexStore(store);
  const tenant = doc.tenantId ? idx.tenantById.get(doc.tenantId) : undefined;
  const contract =
    (doc.contractId ? idx.contractById.get(doc.contractId) : undefined) ??
    (tenant ? (idx.contractsByTenant.get(tenant.id) ?? []).slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] : undefined);
  const unit = contract ? idx.unitById.get(contract.unitId) : doc.unitId ? idx.unitById.get(doc.unitId) : undefined;
  const property = unit ? idx.propertyById.get(unit.propertyId) : undefined;
  const payment = doc.paymentId ? idx.paymentById.get(doc.paymentId) : undefined;
  return {
    tenantName: tenant?.fullName ?? "—",
    tenantId: tenant?.id ?? "",
    nationality: tenant?.nationality ?? "—",
    idType: tenant ? labelize(tenant.idType) : "—",
    idNumber: tenant?.idNumber || "—",
    phone: tenant?.phone ?? "—",
    propertyName: property?.name ?? "—",
    address: property ? `${property.address}, ${property.district}, ${property.city}` : "—",
    unitNumber: unit?.unitNumber ?? "—",
    companyName: store.settings.companyName,
    ownerName: store.settings.ownerName,
    contractNumber: contract?.contractNumber ?? null,
    startDate: contract?.startDate ?? null,
    endDate: contract?.endDate ?? null,
    rent: contract?.monthlyRent ?? null,
    deposit: contract?.deposit ?? null,
    paymentDay: contract?.paymentDay ?? null,
    method: contract ? labelize(contract.paymentMethod) : null,
    paymentAmount: payment?.amountPaid ?? null,
    paymentPeriod: payment?.periodMonth ?? null,
    paymentDate: payment?.paidDate ?? null,
    paymentReference: payment?.reference ?? null,
  };
}

/* ------------------------------ React preview ----------------------------- */

function IdCard({ ctx, passport }: { ctx: DocContext; passport: boolean }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border bg-gradient-to-br from-slate-50 to-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        <span>{passport ? "Passport" : "National identity card"}</span>
        <span>Republic of Lebanon</span>
      </div>
      <div className="mt-4 flex gap-4">
        <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-md bg-slate-300 text-2xl font-semibold text-slate-600">
          {ctx.tenantName
            .split(" ")
            .slice(0, 2)
            .map((s) => s[0])
            .join("")}
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div className="col-span-2">
            <dt className="text-[10px] uppercase text-slate-500">Name</dt>
            <dd className="font-semibold text-slate-800">{ctx.tenantName}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-slate-500">Number</dt>
            <dd className="font-mono text-slate-800">{ctx.idNumber}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-slate-500">Nationality</dt>
            <dd className="text-slate-800">{ctx.nationality}</dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 font-mono text-[10px] tracking-widest text-slate-500">
        {"<<<<".repeat(3)}
        {ctx.idNumber.replace(/[^A-Z0-9]/gi, "")}
        {"<<<<".repeat(4)}
      </div>
    </div>
  );
}

function ContractPage({ ctx, doc }: { ctx: DocContext; doc: StoredDocument }) {
  return (
    <div className="mx-auto w-full max-w-lg rounded-md border bg-white p-8 text-[13px] leading-relaxed text-slate-800 shadow-sm">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">{ctx.companyName}</div>
        <h2 className="mt-1 text-lg font-semibold">Residential Lease Agreement</h2>
        <div className="font-mono text-xs text-slate-500">{ctx.contractNumber ?? doc.fileName}</div>
      </div>
      <p className="mt-5">
        This agreement is made between <strong>{ctx.companyName}</strong> (the Landlord) and <strong>{ctx.tenantName}</strong> (the Tenant) for the premises at{" "}
        <strong>
          {ctx.propertyName}, unit {ctx.unitNumber}
        </strong>
        , {ctx.address}.
      </p>
      <table className="mt-4 w-full text-xs">
        <tbody>
          {[
            ["Term", ctx.startDate && ctx.endDate ? `${formatDate(ctx.startDate)} to ${formatDate(ctx.endDate)}` : "—"],
            ["Monthly rent", ctx.rent !== null ? formatMoney(ctx.rent) : "—"],
            ["Security deposit", ctx.deposit !== null ? formatMoney(ctx.deposit) : "—"],
            ["Rent due", ctx.paymentDay !== null ? `${ordinal(ctx.paymentDay)} of each month by ${ctx.method}` : "—"],
          ].map(([k, v]) => (
            <tr key={k} className="border-t">
              <td className="py-1.5 pr-3 text-slate-500">{k}</td>
              <td className="py-1.5 font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-slate-600">
        The Tenant shall use the premises solely as a private residence, keep them in good condition and give the Landlord not less than 60 days notice of intent to vacate. The deposit is refundable within 30 days of hand-over less any deductions for damage beyond normal wear.
      </p>
      <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
        <div>
          <div className="h-8 border-b border-slate-400 font-[cursive] text-lg text-slate-700">{ctx.ownerName}</div>
          <div className="mt-1 text-slate-500">Landlord · {ctx.companyName}</div>
        </div>
        <div>
          <div className="h-8 border-b border-slate-400 font-[cursive] text-lg text-slate-700">{ctx.tenantName}</div>
          <div className="mt-1 text-slate-500">Tenant</div>
        </div>
      </div>
    </div>
  );
}

function ReceiptPage({ ctx, doc }: { ctx: DocContext; doc: StoredDocument }) {
  return (
    <div className="mx-auto w-full max-w-sm rounded-md border bg-white p-6 text-[13px] text-slate-800 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">{ctx.companyName}</div>
          <h2 className="mt-1 text-base font-semibold">Rent receipt</h2>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div className="font-mono">{ctx.paymentReference ?? doc.fileName}</div>
          <div>{formatDate(ctx.paymentDate ?? doc.uploadedAt)}</div>
        </div>
      </div>
      <table className="mt-4 w-full text-xs">
        <tbody>
          {[
            ["Received from", ctx.tenantName],
            ["For", `${ctx.propertyName}, unit ${ctx.unitNumber}`],
            ["Period", ctx.paymentPeriod ? formatMonth(ctx.paymentPeriod) : "—"],
            ["Method", ctx.method ?? "—"],
          ].map(([k, v]) => (
            <tr key={k} className="border-t">
              <td className="py-1.5 pr-3 text-slate-500">{k}</td>
              <td className="py-1.5 font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-baseline justify-between border-t pt-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">Amount received</span>
        <span className="text-xl font-semibold">{ctx.paymentAmount !== null ? formatMoney(ctx.paymentAmount) : "—"}</span>
      </div>
      <div className="mt-5 text-[11px] text-slate-500">Thank you. This receipt was generated automatically when the payment was recorded.</div>
    </div>
  );
}

export function DocumentBody({ doc }: { doc: StoredDocument }) {
  const store = useStore();
  const ctx = contextFor(doc, store);
  if (doc.kind === "id" || doc.kind === "passport") return <IdCard ctx={ctx} passport={doc.kind === "passport"} />;
  if (doc.kind === "receipt") return <ReceiptPage ctx={ctx} doc={doc} />;
  return <ContractPage ctx={ctx} doc={doc} />;
}

export function DocumentPreview({ doc, onClose }: { doc: StoredDocument | null; onClose: () => void }) {
  const store = useStore();
  return (
    <Dialog open={doc !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {doc && (
          <>
            <DialogHeader>
              <DialogTitle>{doc.title}</DialogTitle>
              <DialogDescription>
                {doc.fileName} · {doc.sizeKb} KB · added {formatDate(doc.uploadedAt)}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg bg-muted/60 p-4 sm:p-6">
              <DocumentBody doc={doc} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => openDocument(buildDocumentHtml(doc, store))}>
                <ExternalLink className="size-4" /> Open
              </Button>
              <Button onClick={() => downloadDocument(doc, buildDocumentHtml(doc, store))}>
                <Download className="size-4" /> Download
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------- Printable / downloadable ----------------------- */

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function buildDocumentHtml(doc: StoredDocument, store: Store): string {
  const ctx = contextFor(doc, store);
  const rows = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");

  let body = "";
  if (doc.kind === "id" || doc.kind === "passport") {
    body = `<div class="card"><div class="eyebrow">${doc.kind === "passport" ? "Passport" : "National identity card"} · Republic of Lebanon</div>
      <h1>${esc(ctx.tenantName)}</h1>
      <table>${rows([
        ["Number", ctx.idNumber],
        ["Nationality", ctx.nationality],
        ["Phone", ctx.phone],
      ])}</table></div>`;
  } else if (doc.kind === "receipt") {
    body = `<div class="card"><div class="eyebrow">${esc(ctx.companyName)}</div><h1>Rent receipt</h1>
      <table>${rows([
        ["Reference", ctx.paymentReference ?? doc.fileName],
        ["Date", formatDate(ctx.paymentDate ?? doc.uploadedAt)],
        ["Received from", ctx.tenantName],
        ["For", `${ctx.propertyName}, unit ${ctx.unitNumber}`],
        ["Period", ctx.paymentPeriod ? formatMonth(ctx.paymentPeriod) : "—"],
        ["Method", ctx.method ?? "—"],
        ["Amount received", ctx.paymentAmount !== null ? formatMoney(ctx.paymentAmount) : "—"],
      ])}</table></div>`;
  } else {
    body = `<div class="card"><div class="eyebrow">${esc(ctx.companyName)}</div><h1>Residential Lease Agreement</h1>
      <p class="mono">${esc(ctx.contractNumber ?? doc.fileName)}</p>
      <p>This agreement is made between <b>${esc(ctx.companyName)}</b> (the Landlord) and <b>${esc(ctx.tenantName)}</b> (the Tenant) for the premises at <b>${esc(ctx.propertyName)}, unit ${esc(ctx.unitNumber)}</b>, ${esc(ctx.address)}.</p>
      <table>${rows([
        ["Term", ctx.startDate && ctx.endDate ? `${formatDate(ctx.startDate)} to ${formatDate(ctx.endDate)}` : "—"],
        ["Monthly rent", ctx.rent !== null ? formatMoney(ctx.rent) : "—"],
        ["Security deposit", ctx.deposit !== null ? formatMoney(ctx.deposit) : "—"],
        ["Rent due", ctx.paymentDay !== null ? `${ordinal(ctx.paymentDay)} of each month by ${ctx.method}` : "—"],
      ])}</table>
      <p class="small">The Tenant shall use the premises solely as a private residence, keep them in good condition and give the Landlord not less than 60 days notice of intent to vacate.</p>
      <div class="sign"><div><div class="line">${esc(ctx.ownerName)}</div>Landlord</div><div><div class="line">${esc(ctx.tenantName)}</div>Tenant</div></div></div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f6;margin:0;padding:32px;color:#1f2937}
.card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:32px}
.eyebrow{font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:#6b7280}h1{font-size:20px;margin:6px 0 12px}
table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0}td{padding:6px 0;border-top:1px solid #e5e7eb}td.k{color:#6b7280;width:40%}
p{font-size:13px;line-height:1.6}.small{font-size:12px;color:#4b5563}.mono{font-family:ui-monospace,monospace;font-size:12px;color:#6b7280}
.sign{display:flex;gap:32px;margin-top:32px;font-size:12px;color:#6b7280}.sign>div{flex:1}.line{border-bottom:1px solid #9ca3af;height:28px;font-family:cursive;font-size:18px;color:#374151;margin-bottom:4px}
@media print{body{background:#fff;padding:0}.card{border:0}}</style></head><body>${body}</body></html>`;
}

export function openDocument(html: string): void {
  const w = window.open("", "_blank", "noopener,noreferrer,width=820,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function downloadDocument(doc: StoredDocument, html: string): void {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.fileName.replace(/\.[a-z0-9]+$/i, "") + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
