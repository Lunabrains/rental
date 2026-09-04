"use client";

import { Mail, Phone } from "lucide-react";

import { formatDate, initials, labelize } from "@/lib/format";
import type { UnitDetails } from "@/lib/queries";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children ?? "—"}</dd>
    </div>
  );
}

export function TenantTab({ details }: { details: UnitDetails }) {
  const t = details.tenant;
  if (!t) return null;
  const tenure = details.history.filter((c) => c.tenantId === t.id).reduce((n, c) => n + c.durationMonths, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {initials(t.fullName)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold leading-tight">{t.fullName}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {t.occupation ?? "Tenant"} · {t.nationality}
            {tenure > 0 && ` · ${tenure} months here`}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={`tel:${t.phone}`} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent">
              <Phone className="size-3.5" /> {t.phone}
            </a>
            {t.email && (
              <a href={`mailto:${t.email}`} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent">
                <Mail className="size-3.5" /> {t.email}
              </a>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border p-4">
        <Field label="ID type">{labelize(t.idType)}</Field>
        <Field label="ID number">{t.idNumber || <span className="text-warning-foreground">Not on file</span>}</Field>
        <Field label="Nationality">{t.nationality}</Field>
        <Field label="Tenant since">{formatDate(details.history.filter((c) => c.tenantId === t.id).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0]?.startDate)}</Field>
        <Field label="Emergency contact">{t.emergencyContactName}</Field>
        <Field label="Emergency phone">{t.emergencyContactPhone}</Field>
      </dl>

      {t.notes && <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">{t.notes}</p>}
    </div>
  );
}
