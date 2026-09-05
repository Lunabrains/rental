"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { cn } from "@/lib/utils";

/**
 * Renders the stable QR label for an asset. The code points at
 * `/assets/scan/<qrCode>` on this deployment, which resolves the asset inside
 * the authenticated app — the label itself carries no private data.
 */
export function AssetQr({ code, size = 128, className }: { code: string; size?: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const target = `${window.location.origin}/assets/scan/${encodeURIComponent(code)}`;
    let cancelled = false;
    QRCode.toDataURL(target, { width: size * 2, margin: 1, errorCorrectionLevel: "M" })
      .then((data) => {
        if (!cancelled) setUrl(data);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, size]);

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`QR code for ${code}`} width={size} height={size} className="rounded-md border bg-white" />
      ) : (
        <div className="rounded-md border bg-muted" style={{ width: size, height: size }} />
      )}
      <span className="font-mono text-[10px] text-muted-foreground">{code}</span>
    </div>
  );
}

/** Opens a print-ready label sheet for one or more assets. */
export async function printQrLabels(items: { code: string; name: string; building: string; type: string }[]): Promise<void> {
  const origin = window.location.origin;
  const cards = await Promise.all(
    items.map(async (i) => {
      const svg = await QRCode.toString(`${origin}/assets/scan/${encodeURIComponent(i.code)}`, { type: "svg", margin: 1, width: 180 });
      return `<div class="card">${svg}<div class="name">${escapeHtml(i.name)}</div><div class="meta">${escapeHtml(i.building)} · ${escapeHtml(i.type)}</div><div class="code">${escapeHtml(i.code)}</div></div>`;
    }),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Asset labels</title><style>
    body{font-family:system-ui,sans-serif;margin:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    .card{border:1px solid #ccc;border-radius:8px;padding:12px;text-align:center;page-break-inside:avoid}
    .card svg{width:160px;height:160px}
    .name{font-weight:600;margin-top:6px}.meta{font-size:12px;color:#555}.code{font-family:ui-monospace,monospace;font-size:11px;color:#777;margin-top:4px}
    @media print{body{margin:0}}
  </style></head><body>${cards.join("")}<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const w = window.open("", "_blank", "noopener,width=900,height=700");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
