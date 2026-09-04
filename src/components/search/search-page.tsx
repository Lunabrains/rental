"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Building2, FileText, Search, Users } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { NeutralPill, UnitStatusBadge } from "@/components/common/badges";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { useStore } from "@/lib/data/store-context";
import { initials } from "@/lib/format";
import { searchAll } from "@/lib/queries";

export function SearchPage() {
  const store = useStore();
  const params = useSearchParams();
  const { openUnit } = useActions();
  const q = params.get("q") ?? "";
  const results = useMemo(() => searchAll(store, q, 20), [store, q]);

  return (
    <div className="space-y-6">
      <PageHeader title={q ? `Results for “${q}”` : "Search"} description={q ? `${results.total} match${results.total === 1 ? "" : "es"} across tenants, units, buildings and contracts` : "Use the search box above to find a tenant, phone number, unit or building."} />

      {!q ? null : results.total === 0 ? (
        <EmptyState icon={Search} title="Nothing found" description="Try a name, part of a phone number, a unit number or a building." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {results.tenants.length > 0 && (
            <SectionCard title="Tenants" description={`${results.tenants.length}`} flush>
              <ul className="divide-y">
                {results.tenants.map(({ tenant, unit, property }) => (
                  <li key={tenant.id}>
                    <Link href={`/tenants/${tenant.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/60">
                      <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(tenant.fullName)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{tenant.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {tenant.phone}
                          {unit && property ? ` · ${property.name} ${unit.unitNumber}` : " · former tenant"}
                        </span>
                      </span>
                      {!unit && <NeutralPill>former</NeutralPill>}
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {results.units.length > 0 && (
            <SectionCard title="Units" description={`${results.units.length}`} flush>
              <ul className="divide-y">
                {results.units.map(({ unit, property, tenant }) => (
                  <li key={unit.id}>
                    <button type="button" onClick={() => openUnit(unit.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/60">
                      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Building2 className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {property.name} · {unit.unitNumber}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{tenant ? tenant.fullName : "Available"}</span>
                      </span>
                      <UnitStatusBadge status={unit.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {results.properties.length > 0 && (
            <SectionCard title="Buildings" description={`${results.properties.length}`} flush>
              <ul className="divide-y">
                {results.properties.map((p) => (
                  <li key={p.id}>
                    <Link href={`/properties/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/60">
                      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Building2 className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.district}, {p.city}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {results.contracts.length > 0 && (
            <SectionCard title="Contracts" description={`${results.contracts.length}`} flush>
              <ul className="divide-y">
                {results.contracts.map(({ contract, tenant, unit }) => (
                  <li key={contract.id}>
                    <button type="button" onClick={() => unit && openUnit(unit.id, "contract")} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/60">
                      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm">{contract.contractNumber}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {tenant?.fullName ?? "—"} · {unit?.unitNumber ?? "—"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      )}
      {!q && <EmptyState icon={Users} title="Search the portfolio" description="Tenants by name, phone or ID · units by number · buildings by name · contracts by number." />}
    </div>
  );
}
