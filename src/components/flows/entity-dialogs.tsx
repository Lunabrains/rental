"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EnumSelect, PropertySelect, TenantSelect, UnitSelect } from "@/components/common/entity-select";
import { Field, FlowDialog, MethodSelect, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addProperty, addTenant, addUnit, createContract, suggestPropertyCode, updateProperty, updateTenant, updateUnit } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { addDaysISO, addMonthsISO, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { PAYMENT_FREQUENCIES, PROPERTY_STATUSES, PROPERTY_TYPES, UNIT_CONDITIONS, type IdDocumentType, type PaymentFrequency, type PaymentMethod, type PropertyStatus, type PropertyType, type UnitCondition } from "@/types";

const ID_TYPES: IdDocumentType[] = ["national_id", "passport", "residency_permit"];
const OVERRIDES = ["", "maintenance", "reserved", "renovation", "unavailable"] as const;
type Override = (typeof OVERRIDES)[number];

export interface PropertyPrefill {
  name?: string;
  code?: string;
  address?: string;
  district?: string;
  city?: string;
  country?: string;
  floors?: number;
  unitsPerFloor?: number;
  type?: PropertyType;
  yearBuilt?: number;
  generateUnits?: boolean;
  askingRent?: number;
  bedrooms?: number;
}

export interface UnitPrefill {
  propertyId?: string | null;
  unitNumber?: string;
  floor?: number;
  bedrooms?: number;
  bathrooms?: number;
  sizeSqm?: number;
  furnished?: boolean;
  askingRent?: number;
  askingDeposit?: number;
  condition?: UnitCondition;
}

export interface TenantPrefill {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  nationality?: string;
  idType?: IdDocumentType;
  idNumber?: string;
  occupation?: string;
  /** When set, the contract form opens right after the tenant is saved. */
  unitId?: string | null;
  rent?: number;
  startDate?: string;
  months?: number;
}

export interface ContractPrefill {
  unitId?: string | null;
  tenantId?: string | null;
  propertyId?: string | null;
  startDate?: string;
  months?: number;
  rent?: number;
  deposit?: number;
  paymentDay?: number;
  method?: PaymentMethod;
  frequency?: PaymentFrequency;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/* ------------------------------- Property --------------------------------- */

export function PropertyDialog({ propertyId, prefill, onClose, onCreated }: { propertyId?: string; prefill?: PropertyPrefill; onClose: () => void; onCreated?: (id: string) => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (propertyId ? indexStore(store).propertyById.get(propertyId) ?? null : null), [store, propertyId]);
  const [name, setName] = useState(existing?.name ?? prefill?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? prefill?.code ?? "");
  const [address, setAddress] = useState(existing?.address ?? prefill?.address ?? "");
  const [district, setDistrict] = useState(existing?.district ?? prefill?.district ?? "");
  const [city, setCity] = useState(existing?.city ?? prefill?.city ?? "Beirut");
  const [country, setCountry] = useState(existing?.country ?? prefill?.country ?? "Lebanon");
  const [type, setType] = useState<PropertyType>(existing?.type ?? prefill?.type ?? "residential");
  const [status, setStatus] = useState<PropertyStatus>(existing?.status ?? "active");
  const [floors, setFloors] = useState(String(existing?.floors ?? prefill?.floors ?? ""));
  const [perFloor, setPerFloor] = useState(String(existing?.unitsPerFloor ?? prefill?.unitsPerFloor ?? ""));
  const [yearBuilt, setYearBuilt] = useState(String(existing?.yearBuilt ?? prefill?.yearBuilt ?? ""));
  const [acqDate, setAcqDate] = useState(existing?.acquisitionDate ?? "");
  const [acqCost, setAcqCost] = useState(existing?.acquisitionCost ?? 0);
  const [value, setValue] = useState(existing?.estimatedValue ?? 0);
  const [insurer, setInsurer] = useState(existing?.insuranceProvider ?? "");
  const [policy, setPolicy] = useState(existing?.insurancePolicyNumber ?? "");
  const [insuranceExpiry, setInsuranceExpiry] = useState(existing?.insuranceExpiry ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [generate, setGenerate] = useState(prefill?.generateUnits ?? true);
  const [gBedrooms, setGBedrooms] = useState(String(prefill?.bedrooms ?? 2));
  const [gBathrooms, setGBathrooms] = useState("1");
  const [gSize, setGSize] = useState("100");
  const [gRent, setGRent] = useState(prefill?.askingRent ?? 0);
  const [gFurnished, setGFurnished] = useState(false);
  const floorsN = num(floors) ?? 0;
  const perFloorN = num(perFloor) ?? 0;
  const suggested = useMemo(() => (name.trim() && !existing ? suggestPropertyCode(store, name) : ""), [store, name, existing]);
  const valid = name.trim().length > 0 && floorsN >= 1 && perFloorN >= 1;
  const unitCount = floorsN * perFloorN;

  function submit() {
    if (!valid) return;
    try {
      if (existing) {
        const { result, undo } = run(updateProperty(existing.id, { name, address, district, city, country, type, status, floors: floorsN, unitsPerFloor: perFloorN, yearBuilt: num(yearBuilt), acquisitionDate: acqDate || null, acquisitionCost: acqCost > 0 ? acqCost : null, estimatedValue: value > 0 ? value : null, insuranceProvider: insurer || null, insurancePolicyNumber: policy || null, insuranceExpiry: insuranceExpiry || null, notes: notes || null }));
        toast.success(`${result.name} updated`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
        onClose();
        return;
      }
      const { result, undo } = run(addProperty({ code: code || undefined, name, address, district, city, country, type, status, floors: floorsN, unitsPerFloor: perFloorN, yearBuilt: num(yearBuilt), acquisitionDate: acqDate || null, acquisitionCost: acqCost > 0 ? acqCost : null, estimatedValue: value > 0 ? value : null, insuranceProvider: insurer || null, insurancePolicyNumber: policy || null, insuranceExpiry: insuranceExpiry || null, notes: notes || null, generateUnits: generate ? { bedrooms: num(gBedrooms) ?? 1, bathrooms: num(gBathrooms) ?? 1, sizeSqm: num(gSize) ?? 0, askingRent: gRent, askingDeposit: gRent, furnished: gFurnished } : null }));
      toast.success(`${result.property.name} added${result.units.length > 0 ? ` with ${result.units.length} units` : ""}`, { description: `Code ${result.property.code} · ${floorsN} floors × ${perFloorN}`, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
      onCreated?.(result.property.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the building");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.name}` : "Add building"} description={existing ? undefined : "Name, layout and the paperwork that raises alerts — units can be generated in one go"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : `Add building${generate && unitCount > 0 ? ` + ${unitCount} units` : ""}`}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="pr-name"><Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marina Residence" autoFocus={!existing} /></Field>
        <Field label="Code" htmlFor="pr-code" hint={existing ? "Used to match imports — cannot change" : suggested ? `Suggested: ${suggested}` : "Short unique code, e.g. MR"}><Input id="pr-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={suggested || "MR"} disabled={!!existing} maxLength={6} /></Field>
        <Field label="Address" htmlFor="pr-address" className="sm:col-span-2"><Input id="pr-address" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="District" htmlFor="pr-district"><Input id="pr-district" value={district} onChange={(e) => setDistrict(e.target.value)} /></Field>
        <Field label="City" htmlFor="pr-city"><Input id="pr-city" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label="Country" htmlFor="pr-country"><Input id="pr-country" value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
        <Field label="Type" htmlFor="pr-type"><EnumSelect id="pr-type" values={PROPERTY_TYPES} value={type} onChange={(v) => v && setType(v)} /></Field>
        <Field label="Floors" htmlFor="pr-floors"><Input id="pr-floors" type="number" min={1} value={floors} onChange={(e) => setFloors(e.target.value)} className="tabular" /></Field>
        <Field label="Units per floor" htmlFor="pr-per"><Input id="pr-per" type="number" min={1} value={perFloor} onChange={(e) => setPerFloor(e.target.value)} className="tabular" /></Field>
        <Field label="Year built" htmlFor="pr-year"><Input id="pr-year" type="number" min={1800} max={2100} value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} className="tabular" /></Field>
        {existing && <Field label="Status" htmlFor="pr-status"><EnumSelect id="pr-status" values={PROPERTY_STATUSES} value={status} onChange={(v) => v && setStatus(v)} /></Field>}
        <Field label="Acquired on" htmlFor="pr-acq"><Input id="pr-acq" type="date" value={acqDate} onChange={(e) => setAcqDate(e.target.value)} /></Field>
        <Field label="Acquisition cost" htmlFor="pr-cost"><MoneyInput id="pr-cost" value={acqCost} onChange={setAcqCost} /></Field>
        <Field label="Estimated value" htmlFor="pr-value"><MoneyInput id="pr-value" value={value} onChange={setValue} /></Field>
        <Field label="Insurer" htmlFor="pr-insurer"><Input id="pr-insurer" value={insurer} onChange={(e) => setInsurer(e.target.value)} /></Field>
        <Field label="Policy number" htmlFor="pr-policy"><Input id="pr-policy" value={policy} onChange={(e) => setPolicy(e.target.value)} /></Field>
        <Field label="Insurance expiry" htmlFor="pr-exp" hint="Raises an alert before it lapses"><Input id="pr-exp" type="date" value={insuranceExpiry} onChange={(e) => setInsuranceExpiry(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="pr-notes" className="sm:col-span-2"><Textarea id="pr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {!existing && (
        <div className="mt-4 rounded-md border p-3">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={generate} onCheckedChange={setGenerate} />
            <span>Create the units now{unitCount > 0 ? ` — ${unitCount} units, numbered 101, 102 … per floor` : ""}</span>
          </label>
          {generate && (
            <div className="mt-3 grid gap-3 sm:grid-cols-5">
              <Field label="Bedrooms" htmlFor="pr-gbr"><Input id="pr-gbr" type="number" min={0} value={gBedrooms} onChange={(e) => setGBedrooms(e.target.value)} className="tabular" /></Field>
              <Field label="Bathrooms" htmlFor="pr-gba"><Input id="pr-gba" type="number" min={0} value={gBathrooms} onChange={(e) => setGBathrooms(e.target.value)} className="tabular" /></Field>
              <Field label="Size m²" htmlFor="pr-gsz"><Input id="pr-gsz" type="number" min={0} value={gSize} onChange={(e) => setGSize(e.target.value)} className="tabular" /></Field>
              <Field label="Asking rent" htmlFor="pr-grent"><MoneyInput id="pr-grent" value={gRent} onChange={setGRent} /></Field>
              <div className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={gFurnished} onCheckedChange={setGFurnished} /> Furnished</div>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Every unit can be edited afterwards; add odd ones (penthouse, shop) one by one from the building page.</p>
        </div>
      )}
    </FlowDialog>
  );
}

/* --------------------------------- Unit ----------------------------------- */

export function UnitDialog({ unitId, prefill, onClose, onCreated }: { unitId?: string; prefill?: UnitPrefill; onClose: () => void; onCreated?: (id: string) => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (unitId ? indexStore(store).unitById.get(unitId) ?? null : null), [store, unitId]);
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? prefill?.propertyId ?? store.properties[0]?.id ?? null);
  const [unitNumber, setUnitNumber] = useState(existing?.unitNumber ?? prefill?.unitNumber ?? "");
  const [floor, setFloor] = useState(String(existing?.floor ?? prefill?.floor ?? (prefill?.unitNumber ? prefill.unitNumber.replace(/\D/g, "").slice(0, -2) || "" : "")));
  const [bedrooms, setBedrooms] = useState(String(existing?.bedrooms ?? prefill?.bedrooms ?? 1));
  const [bathrooms, setBathrooms] = useState(String(existing?.bathrooms ?? prefill?.bathrooms ?? 1));
  const [size, setSize] = useState(String(existing?.sizeSqm ?? prefill?.sizeSqm ?? ""));
  const [furnished, setFurnished] = useState(existing?.furnished ?? prefill?.furnished ?? false);
  const [askingRent, setAskingRent] = useState(existing?.askingRent ?? prefill?.askingRent ?? 0);
  const [askingDeposit, setAskingDeposit] = useState(existing?.askingDeposit ?? prefill?.askingDeposit ?? prefill?.askingRent ?? 0);
  const [marketRent, setMarketRent] = useState(existing?.marketRent ?? 0);
  const [condition, setCondition] = useState<UnitCondition>(existing?.condition ?? prefill?.condition ?? "good");
  const [override, setOverride] = useState<Override>(existing && OVERRIDES.includes(existing.status as Override) ? (existing.status as Override) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const property = propertyId ? indexStore(store).propertyById.get(propertyId) : null;
  const occupied = existing ? (indexStore(store).contractsByUnit.get(existing.id) ?? []).some(isOccupying) : false;
  const valid = propertyId !== null && unitNumber.trim().length > 0 && (num(floor) ?? -1) >= 0;

  function submit() {
    if (!valid || !propertyId) return;
    try {
      if (existing) {
        const { result, undo } = run(updateUnit(existing.id, { bedrooms: num(bedrooms) ?? existing.bedrooms, bathrooms: num(bathrooms) ?? existing.bathrooms, sizeSqm: num(size) ?? existing.sizeSqm, furnished, askingRent, askingDeposit, marketRent: marketRent > 0 ? marketRent : null, condition, notes: notes || null, ...(occupied ? {} : { status: override === "" ? "available" : override }) }));
        toast.success(`Unit ${result.unitNumber} updated`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
        onClose();
        return;
      }
      const { result, undo } = run(addUnit({ propertyId, unitNumber, floor: num(floor) ?? 0, bedrooms: num(bedrooms) ?? 1, bathrooms: num(bathrooms) ?? 1, sizeSqm: num(size) ?? 0, furnished, askingRent, askingDeposit, marketRent: marketRent > 0 ? marketRent : null, condition, status: override === "" ? null : override, notes: notes || null }));
      toast.success(`Unit ${result.unitNumber} added to ${property?.name ?? "the building"}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
      onCreated?.(result.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the unit");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit unit ${existing.unitNumber}` : "Add unit"} description={existing ? `${property?.name ?? ""} · rented / available is derived from contracts` : "One unit — for a whole floor plan use Add building"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : "Add unit"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Building" htmlFor="un-property" className="sm:col-span-2"><PropertySelect id="un-property" value={propertyId} onChange={setPropertyId} disabled={!!existing} /></Field>
        <Field label="Unit number" htmlFor="un-number"><Input id="un-number" value={unitNumber} onChange={(e) => { setUnitNumber(e.target.value); if (!floor && /^\d{3,4}$/.test(e.target.value)) setFloor(e.target.value.slice(0, -2)); }} placeholder="403" disabled={!!existing} autoFocus={!existing} /></Field>
        <Field label="Floor" htmlFor="un-floor" hint="0 = ground"><Input id="un-floor" type="number" min={0} value={floor} onChange={(e) => setFloor(e.target.value)} className="tabular" disabled={!!existing} /></Field>
        <Field label="Bedrooms" htmlFor="un-br"><Input id="un-br" type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="tabular" /></Field>
        <Field label="Bathrooms" htmlFor="un-ba"><Input id="un-ba" type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className="tabular" /></Field>
        <Field label="Size m²" htmlFor="un-size"><Input id="un-size" type="number" min={0} value={size} onChange={(e) => setSize(e.target.value)} className="tabular" /></Field>
        <Field label="Asking rent" htmlFor="un-rent"><MoneyInput id="un-rent" value={askingRent} onChange={(v) => { setAskingRent(v); if (!existing && askingDeposit === 0) setAskingDeposit(v); }} /></Field>
        <Field label="Asking deposit" htmlFor="un-dep"><MoneyInput id="un-dep" value={askingDeposit} onChange={setAskingDeposit} /></Field>
        <Field label="Market rent" htmlFor="un-market" hint="Reference for vacancy-loss estimates"><MoneyInput id="un-market" value={marketRent} onChange={setMarketRent} /></Field>
        <Field label="Condition" htmlFor="un-cond"><EnumSelect id="un-cond" values={UNIT_CONDITIONS} value={condition} onChange={(v) => v && setCondition(v)} /></Field>
        <Field label="Status override" htmlFor="un-status" hint={occupied ? "Rented — derived from the contract" : "Blank = available"}><EnumSelect id="un-status" values={OVERRIDES} value={override} onChange={(v) => setOverride(v ?? "")} labels={{ "": "None (available)" }} disabled={occupied} /></Field>
        <div className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={furnished} onCheckedChange={setFurnished} /> Furnished</div>
        <Field label="Notes" htmlFor="un-notes" className="sm:col-span-3"><Textarea id="un-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </FlowDialog>
  );
}

/* -------------------------------- Tenant ---------------------------------- */

export function TenantDialog({ tenantId, prefill, onClose, onCreated, onContract }: { tenantId?: string; prefill?: TenantPrefill; onClose: () => void; onCreated?: (id: string) => void; onContract?: (prefill: ContractPrefill) => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (tenantId ? indexStore(store).tenantById.get(tenantId) ?? null : null), [store, tenantId]);
  const [firstName, setFirstName] = useState(existing?.firstName ?? prefill?.firstName ?? "");
  const [lastName, setLastName] = useState(existing?.lastName ?? prefill?.lastName ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? prefill?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? prefill?.email ?? "");
  const [nationality, setNationality] = useState(existing?.nationality ?? prefill?.nationality ?? "Lebanese");
  const [idType, setIdType] = useState<IdDocumentType>(existing?.idType ?? prefill?.idType ?? "national_id");
  const [idNumber, setIdNumber] = useState(existing?.idNumber ?? prefill?.idNumber ?? "");
  const [occupation, setOccupation] = useState(existing?.occupation ?? prefill?.occupation ?? "");
  const [ecName, setEcName] = useState(existing?.emergencyContactName ?? "");
  const [ecPhone, setEcPhone] = useState(existing?.emergencyContactPhone ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [withContract, setWithContract] = useState(!!prefill?.unitId);
  const [unitId, setUnitId] = useState<string | null>(prefill?.unitId ?? null);
  const [propertyId, setPropertyId] = useState<string | null>(prefill?.unitId ? indexStore(store).unitById.get(prefill.unitId)?.propertyId ?? null : null);
  const valid = firstName.trim().length > 0 && phone.trim().length > 0 && (!withContract || unitId !== null);

  function submit() {
    if (!valid) return;
    try {
      if (existing) {
        const { result, undo } = run(updateTenant(existing.id, { firstName, lastName, phone, email, nationality, idType, idNumber, occupation: occupation || null, emergencyContactName: ecName || null, emergencyContactPhone: ecPhone || null, notes: notes || null }));
        toast.success(`${result.fullName} updated`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
        onClose();
        return;
      }
      const { result, undo } = run(addTenant({ firstName, lastName, phone, email, nationality, idType, idNumber, occupation: occupation || null, emergencyContactName: ecName || null, emergencyContactPhone: ecPhone || null, notes: notes || null }));
      toast.success(`${result.fullName} added`, { description: withContract ? "Now the contract." : "No contract yet — add one from the tenant page or a vacant unit.", action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
      if (withContract && unitId) onContract?.({ unitId, tenantId: result.id, rent: prefill?.rent, startDate: prefill?.startDate, months: prefill?.months });
      else onCreated?.(result.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the tenant");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.fullName}` : "Add tenant"} description={existing ? undefined : "Contact and identity details — the contract can follow right away"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : withContract ? "Save & continue to contract" : "Add tenant"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="tn-first"><Input id="tn-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus={!existing} /></Field>
        <Field label="Last name" htmlFor="tn-last"><Input id="tn-last" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
        <Field label="Phone" htmlFor="tn-phone" hint="Used to match imports and reminders"><Input id="tn-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961 3 123 456" /></Field>
        <Field label="Email" htmlFor="tn-email"><Input id="tn-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Nationality" htmlFor="tn-nat"><Input id="tn-nat" value={nationality} onChange={(e) => setNationality(e.target.value)} /></Field>
        <Field label="Occupation" htmlFor="tn-occ"><Input id="tn-occ" value={occupation} onChange={(e) => setOccupation(e.target.value)} /></Field>
        <Field label="ID type" htmlFor="tn-idtype"><EnumSelect id="tn-idtype" values={ID_TYPES} value={idType} onChange={(v) => v && setIdType(v)} labels={{ national_id: "National ID" }} /></Field>
        <Field label="ID number" htmlFor="tn-idno"><Input id="tn-idno" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></Field>
        <Field label="Emergency contact" htmlFor="tn-ec"><Input id="tn-ec" value={ecName} onChange={(e) => setEcName(e.target.value)} /></Field>
        <Field label="Emergency phone" htmlFor="tn-ecp"><Input id="tn-ecp" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="tn-notes" className="sm:col-span-2"><Textarea id="tn-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {!existing && (
        <div className="mt-4 rounded-md border p-3">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={withContract} onCheckedChange={setWithContract} />
            <span>Sign a contract right away</span>
          </label>
          {withContract && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Building" htmlFor="tn-prop"><PropertySelect id="tn-prop" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); }} /></Field>
              <Field label="Unit" htmlFor="tn-unit"><UnitSelect id="tn-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} /></Field>
            </div>
          )}
        </div>
      )}
    </FlowDialog>
  );
}

/* -------------------------------- Contract -------------------------------- */

export function ContractDialog({ prefill, onClose }: { prefill?: ContractPrefill; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const idx = indexStore(store);
  const prefUnit = prefill?.unitId ? idx.unitById.get(prefill.unitId) ?? null : null;
  const [propertyId, setPropertyId] = useState<string | null>(prefUnit?.propertyId ?? prefill?.propertyId ?? store.properties[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(prefill?.unitId ?? null);
  const [tenantId, setTenantId] = useState<string | null>(prefill?.tenantId ?? null);
  const unit = unitId ? idx.unitById.get(unitId) ?? null : null;
  const [startDate, setStartDate] = useState(prefill?.startDate ?? today());
  const [months, setMonths] = useState(String(prefill?.months ?? 12));
  const [rent, setRent] = useState(prefill?.rent ?? unit?.askingRent ?? unit?.lastRent ?? 0);
  const [deposit, setDeposit] = useState(prefill?.deposit ?? unit?.askingDeposit ?? unit?.askingRent ?? 0);
  const [paymentDay, setPaymentDay] = useState(String(prefill?.paymentDay ?? Math.min(28, Number((prefill?.startDate ?? today()).slice(8, 10)))));
  const [method, setMethod] = useState<PaymentMethod>(prefill?.method ?? "bank_transfer");
  const [frequency, setFrequency] = useState<PaymentFrequency>(prefill?.frequency ?? "monthly");
  const [clause, setClause] = useState("");
  const [terms, setTerms] = useState("");
  const [pastAsPaid, setPastAsPaid] = useState(false);
  const [depositReceived, setDepositReceived] = useState(false);
  const monthsN = num(months) ?? 0;
  const dayN = num(paymentDay) ?? 0;
  const endDate = startDate.length === 10 && monthsN >= 1 ? addDaysISO(addMonthsISO(startDate, monthsN), -1) : "";
  const occupant = unit ? (idx.contractsByUnit.get(unit.id) ?? []).find(isOccupying) : null;
  const historical = startDate.length === 10 && startDate < today();
  const valid = unitId !== null && tenantId !== null && startDate.length === 10 && monthsN >= 1 && rent > 0 && dayN >= 1 && dayN <= 28 && !occupant;

  function pickUnit(id: string | null) {
    setUnitId(id);
    const u = id ? idx.unitById.get(id) : null;
    if (u && !prefill?.rent) {
      setRent(u.askingRent || u.lastRent || 0);
      setDeposit(u.askingDeposit || u.askingRent || 0);
    }
  }

  function submit() {
    if (!valid || !unitId || !tenantId) return;
    try {
      const { result, undo } = run(createContract({ unitId, tenantId, startDate, months: monthsN, rent, deposit, paymentDay: dayN, method, frequency, rentIncreaseClause: clause || null, specialTerms: terms || null, pastAsPaid, depositReceivedOn: depositReceived ? startDate : null }));
      const tenant = idx.tenantById.get(tenantId);
      toast.success(`Contract ${result.contract.contractNumber} created`, { description: `${tenant?.fullName ?? "Tenant"} · ${formatMoney(rent)}/month · ${result.paymentsScheduled} instalments scheduled${pastAsPaid ? " (past ones marked paid)" : ""}`, action: undo ? { label: "Undo", onClick: undo } : undefined, duration: 8000 });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the contract");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title="New contract" description="An existing tenant moving into a unit — for a brand-new tenant use Add tenant" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Create contract</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="ct-prop"><PropertySelect id="ct-prop" value={propertyId} onChange={(id) => { setPropertyId(id); pickUnit(null); }} /></Field>
        <Field label="Unit" htmlFor="ct-unit" hint={occupant ? `Occupied by ${idx.tenantById.get(occupant.tenantId)?.fullName ?? "another tenant"} until ${formatDate(occupant.moveOutDate ?? occupant.endDate)}` : unit ? `${labelize(unit.status)} · asking ${formatMoney(unit.askingRent)}` : undefined}><UnitSelect id="ct-unit" propertyId={propertyId} value={unitId} onChange={pickUnit} /></Field>
        <Field label="Tenant" htmlFor="ct-tenant" className="sm:col-span-2"><TenantSelect id="ct-tenant" value={tenantId} onChange={setTenantId} /></Field>
        <Field label="Start date" htmlFor="ct-start"><Input id="ct-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="Duration (months)" htmlFor="ct-months" hint={endDate ? `Ends ${formatDate(endDate)}` : undefined}><Input id="ct-months" type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} className="tabular" /></Field>
        <Field label="Monthly rent" htmlFor="ct-rent"><MoneyInput id="ct-rent" value={rent} onChange={setRent} /></Field>
        <Field label="Deposit" htmlFor="ct-deposit"><MoneyInput id="ct-deposit" value={deposit} onChange={setDeposit} /></Field>
        <Field label="Payment day" htmlFor="ct-day" hint="1–28"><Input id="ct-day" type="number" min={1} max={28} value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)} className="tabular" /></Field>
        <Field label="Payment method" htmlFor="ct-method"><MethodSelect id="ct-method" value={method} onChange={setMethod} /></Field>
        <Field label="Billing" htmlFor="ct-freq"><EnumSelect id="ct-freq" values={PAYMENT_FREQUENCIES} value={frequency} onChange={(v) => v && setFrequency(v)} labels={{ semi_annual: "Every 6 months" }} /></Field>
        <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
          <label className="flex items-center gap-2"><Switch checked={depositReceived} onCheckedChange={setDepositReceived} /> Deposit already received</label>
          {historical && <label className="flex items-center gap-2"><Switch checked={pastAsPaid} onCheckedChange={setPastAsPaid} /> Instalments before today were paid on time</label>}
        </div>
        <Field label="Rent increase clause" htmlFor="ct-clause"><Input id="ct-clause" value={clause} onChange={(e) => setClause(e.target.value)} placeholder="5% on renewal" /></Field>
        <Field label="Special terms" htmlFor="ct-terms"><Input id="ct-terms" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Pets allowed, parking P-12…" /></Field>
      </div>
      {unit && tenantId && (
        <div className="mt-4">
          <Summary rows={[["Tenant", idx.tenantById.get(tenantId)?.fullName ?? "—"], ["Unit", `${idx.propertyById.get(unit.propertyId)?.name ?? ""} ${unit.unitNumber}`], ["Term", endDate ? `${formatDate(startDate)} → ${formatDate(endDate)}` : "—"], ["Rent", `${formatMoney(rent)} / month${frequency !== "monthly" ? ` · billed ${labelize(frequency).toLowerCase()}` : ""}`]]} />
        </div>
      )}
    </FlowDialog>
  );
}
