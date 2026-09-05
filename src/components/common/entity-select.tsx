"use client";

import { useMemo } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/data/store-context";
import { indexStore } from "@/lib/data/store";
import { isOccupying } from "@/lib/derived/occupancy";
import { labelize } from "@/lib/format";
import type { ID } from "@/types";

/**
 * Entity pickers used by every form and filter bar. `allowAll` renders an
 * "All …" option (value "all") for filters; forms leave it off and pass
 * `placeholder` instead. Values are ids; "none" clears an optional link.
 */

const NONE = "none";
const ALL = "all";

interface BaseProps {
  value: ID | null;
  onChange: (id: ID | null) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  /** Show an "All" option that maps to null. */
  allowAll?: boolean;
  /** Show a "None" option that maps to null. */
  allowNone?: boolean;
  disabled?: boolean;
}

function Picker({ value, onChange, id, className, placeholder, allowAll, allowNone, disabled, options, allLabel }: BaseProps & { options: { value: string; label: string; hint?: string }[]; allLabel?: string }) {
  const current = value ?? (allowAll ? ALL : allowNone ? NONE : "");
  return (
    <Select value={current} onValueChange={(v) => onChange(v === ALL || v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger id={id} className={className ?? "w-full"}>
        <SelectValue placeholder={placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>{allLabel ?? "All"}</SelectItem>}
        {allowNone && <SelectItem value={NONE}>None</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {o.hint && <span className="ml-1.5 text-xs text-muted-foreground">{o.hint}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PropertySelect(props: BaseProps) {
  const store = useStore();
  const options = useMemo(() => store.properties.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label)), [store.properties]);
  return <Picker {...props} options={options} allLabel="All buildings" placeholder={props.placeholder ?? "Building"} />;
}

export function UnitSelect({ propertyId, ...props }: BaseProps & { propertyId: ID | null }) {
  const store = useStore();
  const options = useMemo(() => {
    const idx = indexStore(store);
    return store.units
      .filter((u) => !propertyId || u.propertyId === propertyId)
      .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }))
      .map((u) => {
        const c = idx.activeContractByUnit.get(u.id) ?? (idx.contractsByUnit.get(u.id) ?? []).find(isOccupying);
        const tenant = c ? idx.tenantById.get(c.tenantId)?.fullName : null;
        return { value: u.id, label: propertyId ? u.unitNumber : `${idx.propertyById.get(u.propertyId)?.name ?? ""} ${u.unitNumber}`, hint: tenant ?? labelize(u.status) };
      });
  }, [store, propertyId]);
  return <Picker {...props} options={options} allLabel="All units" placeholder={props.placeholder ?? "Unit"} />;
}

export function TenantSelect({ currentOnly, ...props }: BaseProps & { currentOnly?: boolean }) {
  const store = useStore();
  const options = useMemo(() => {
    const idx = indexStore(store);
    return store.tenants
      .filter((t) => !currentOnly || (idx.contractsByTenant.get(t.id) ?? []).some(isOccupying))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((t) => {
        const c = (idx.contractsByTenant.get(t.id) ?? []).find(isOccupying);
        const unit = c ? idx.unitById.get(c.unitId) : undefined;
        return { value: t.id, label: t.fullName, hint: unit ? unit.unitNumber : undefined };
      });
  }, [store, currentOnly]);
  return <Picker {...props} options={options} allLabel="All tenants" placeholder={props.placeholder ?? "Tenant"} />;
}

export function SupplierSelect({ category, ...props }: BaseProps & { category?: string | null }) {
  const store = useStore();
  const options = useMemo(
    () =>
      store.suppliers
        .filter((s) => s.active)
        .sort((a, b) => (category ? Number(b.category === category) - Number(a.category === category) : 0) || a.name.localeCompare(b.name))
        .map((s) => ({ value: s.id, label: s.name, hint: labelize(s.category) })),
    [store.suppliers, category],
  );
  return <Picker {...props} options={options} allLabel="All suppliers" placeholder={props.placeholder ?? "Supplier"} />;
}

export function AssetSelect({ propertyId, ...props }: BaseProps & { propertyId: ID | null }) {
  const store = useStore();
  const options = useMemo(() => {
    const idx = indexStore(store);
    return store.assets
      .filter((a) => !propertyId || a.propertyId === propertyId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ value: a.id, label: propertyId ? a.name : `${idx.propertyById.get(a.propertyId)?.name ?? ""} · ${a.name}`, hint: labelize(a.assetType) }));
  }, [store, propertyId]);
  return <Picker {...props} options={options} allLabel="All assets" placeholder={props.placeholder ?? "Asset"} />;
}

/** Generic enum picker for the many status / category fields. */
export function EnumSelect<T extends string>({ value, onChange, values, id, className, placeholder, allowAll, allLabel, labels, disabled }: { value: T | null; onChange: (v: T | null) => void; values: readonly T[]; id?: string; className?: string; placeholder?: string; allowAll?: boolean; allLabel?: string; labels?: Partial<Record<T, string>>; disabled?: boolean }) {
  const options = values.map((v) => ({ value: v, label: labels?.[v] ?? labelize(v) }));
  return <Picker value={value} onChange={(v) => onChange((v as T) ?? null)} id={id} className={className} placeholder={placeholder} allowAll={allowAll} allLabel={allLabel} options={options} disabled={disabled} />;
}
