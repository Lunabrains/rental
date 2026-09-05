"use client";

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { EnumSelect } from "@/components/common/entity-select";
import { Field, FlowDialog } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addSupplier, updateSupplier } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { cn } from "@/lib/utils";
import { SUPPLIER_CATEGORIES, type SupplierCategory } from "@/types";

/** Five-star picker used for the manual supplier rating. */
export function StarRating({ value, onChange, size = "md" }: { value: number | null; onChange?: (v: number | null) => void; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(value === n ? null : n)}
          className={cn("rounded p-0.5 disabled:cursor-default", onChange && "hover:bg-accent")}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          aria-pressed={value !== null && n <= value}
        >
          <Star className={cn(size === "sm" ? "size-3.5" : "size-4", value !== null && n <= value ? "fill-warning text-warning" : "text-muted-foreground/40")} />
        </button>
      ))}
    </span>
  );
}

/** Add or edit a supplier (contact, category, services, rating). */
export function SupplierDialog({ supplierId, defaultCategory, onClose }: { supplierId?: string; defaultCategory?: SupplierCategory; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (supplierId ? indexStore(store).supplierById.get(supplierId) ?? null : null), [store, supplierId]);
  const [name, setName] = useState(existing?.name ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");
  const [category, setCategory] = useState<SupplierCategory>(existing?.category ?? defaultCategory ?? "general_contractor");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [services, setServices] = useState(existing?.services.join(", ") ?? "");
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [active, setActive] = useState(existing?.active ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = name.trim().length > 0;

  function submit() {
    if (!valid) return;
    try {
      const fields = { name: name.trim(), company: company || null, category, phone, email, services: services.split(",").map((s) => s.trim()).filter(Boolean), rating, active, notes: notes || null };
      const { result, undo } = existing ? run(updateSupplier(existing.id, fields)) : run(addSupplier(fields));
      toast.success(`${existing ? "Supplier updated" : "Supplier added"} — ${result.name}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the supplier");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.name}` : "Add supplier"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : "Add supplier"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="sp-name"><Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Schindler Lebanon" autoFocus={!existing} /></Field>
        <Field label="Company" htmlFor="sp-company"><Input id="sp-company" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Category" htmlFor="sp-category"><EnumSelect id="sp-category" values={SUPPLIER_CATEGORIES} value={category} onChange={(v) => v && setCategory(v)} labels={{ hvac: "HVAC" }} /></Field>
        <Field label="Services" htmlFor="sp-services" hint="Comma separated"><Input id="sp-services" value={services} onChange={(e) => setServices(e.target.value)} placeholder="Elevator service, safety certification" /></Field>
        <Field label="Phone" htmlFor="sp-phone"><Input id="sp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Email" htmlFor="sp-email"><Input id="sp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Your rating" htmlFor="sp-rating" hint="Manual 1–5; the performance score is computed separately">
          <div className="flex h-9 items-center">
            <StarRating value={rating} onChange={setRating} />
          </div>
        </Field>
        <div className="flex items-center gap-3 self-end pb-2">
          <Switch id="sp-active" checked={active} onCheckedChange={setActive} />
          <label htmlFor="sp-active" className="text-sm">Active — suggested on new work orders</label>
        </div>
        <Field label="Notes" htmlFor="sp-notes" className="sm:col-span-2"><Textarea id="sp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contract terms, response expectations, who to call…" /></Field>
      </div>
    </FlowDialog>
  );
}
