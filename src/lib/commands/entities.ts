import { ids, normalizePhone } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addDaysISO, addMonthsISO, isAfter, today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatMoney } from "@/lib/format";
import { generateSchedule } from "@/lib/import/apply";
import type { Contract, ID, IdDocumentType, ISODate, PaymentFrequency, PaymentMethod, Property, PropertyStatus, PropertyType, SecurityDeposit, Store, Tenant, Unit, UnitCondition, UnitStatus } from "@/types";

import { appendActivity, appendAudit, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";
import { nextContractNumber } from "./writes";

/**
 * Manual data entry for the core entities (plan §data entry): buildings,
 * units, tenants and contracts can be created and edited from the screens,
 * from the importer's forms and from the assistant — all through these
 * validated, audited, undoable commands.
 */

/** Lebanese numbers are typed as "03 222 222", "+961 3 222 222" or "9613222222" — compare the subscriber digits. */
export function samePhone(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  return da.length >= 7 && db.length >= 7 && da.slice(-7) === db.slice(-7);
}

const uniqueId = (base: ID, taken: (id: ID) => boolean): ID => {
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};

/** "Beirut Heights" → BH, "Marina" → MAR; unique across the store. */
export function suggestPropertyCode(store: Store, name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9؀-ۿ ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let code = words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 3).toUpperCase() : (words[0] ?? "BLD").slice(0, 3).toUpperCase();
  if (!code) code = "BLD";
  const taken = new Set(store.properties.map((p) => p.code.toUpperCase()));
  if (!taken.has(code)) return code;
  let n = 2;
  while (taken.has(`${code}${n}`)) n++;
  return `${code}${n}`;
}

/* -------------------------------- Property -------------------------------- */

export interface PropertyInput {
  code?: string;
  name: string;
  address?: string;
  district?: string;
  city?: string;
  country?: string;
  floors: number;
  unitsPerFloor: number;
  type?: PropertyType;
  status?: PropertyStatus;
  yearBuilt?: number | null;
  acquisitionDate?: ISODate | null;
  acquisitionCost?: number | null;
  estimatedValue?: number | null;
  insuranceProvider?: string | null;
  insurancePolicyNumber?: string | null;
  insuranceExpiry?: ISODate | null;
  notes?: string | null;
  /** Create the whole grid of units at once (floors × units per floor). */
  generateUnits?: { bedrooms: number; bathrooms: number; sizeSqm: number; askingRent: number; askingDeposit: number; furnished: boolean; groundFloorIsZero?: boolean } | null;
}

export interface AddPropertyResult {
  property: Property;
  units: Unit[];
}

export function addProperty(input: PropertyInput): Command<AddPropertyResult> {
  return (store) => {
    const idx = indexStore(store);
    const name = input.name.trim();
    if (!name) throw new Error("Give the building a name");
    if (!Number.isInteger(input.floors) || input.floors < 1) throw new Error("Floors must be at least 1");
    if (!Number.isInteger(input.unitsPerFloor) || input.unitsPerFloor < 1) throw new Error("Units per floor must be at least 1");
    const code = (input.code?.trim() || suggestPropertyCode(store, name)).toUpperCase();
    if (store.properties.some((p) => p.code.toUpperCase() === code)) throw new Error(`Code ${code} is already used by another building`);
    if (store.properties.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error("A building with this name already exists");
    for (const [label, v] of [["Year built", input.yearBuilt], ["Acquisition cost", input.acquisitionCost], ["Estimated value", input.estimatedValue]] as const) if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) throw new Error(`${label} cannot be negative`);
    const base = today();
    const property: Property = {
      id: uniqueId(ids.property(name), (id) => idx.propertyById.has(id)),
      code,
      name,
      address: input.address?.trim() ?? "",
      district: input.district?.trim() ?? "",
      city: input.city?.trim() ?? "",
      country: input.country?.trim() || "Lebanon",
      yearBuilt: input.yearBuilt ?? null,
      floors: input.floors,
      unitsPerFloor: input.unitsPerFloor,
      type: input.type ?? "residential",
      status: input.status ?? "active",
      acquisitionDate: input.acquisitionDate ?? null,
      acquisitionCost: input.acquisitionCost ?? null,
      estimatedValue: input.estimatedValue ?? null,
      insuranceProvider: input.insuranceProvider?.trim() || null,
      insurancePolicyNumber: input.insurancePolicyNumber?.trim() || null,
      insuranceExpiry: input.insuranceExpiry ?? null,
      imageUrl: null,
      notes: input.notes?.trim() || null,
      createdAt: base,
    };
    const units: Unit[] = [];
    if (input.generateUnits) {
      const g = input.generateUnits;
      const firstFloor = g.groundFloorIsZero ? 0 : 1;
      for (let f = 0; f < input.floors; f++) {
        const floor = firstFloor + f;
        for (let i = 1; i <= input.unitsPerFloor; i++) {
          const unitNumber = `${floor}${String(i).padStart(2, "0")}`;
          units.push({ id: ids.unit(property.id, unitNumber), propertyId: property.id, unitNumber, floor, bedrooms: g.bedrooms, bathrooms: g.bathrooms, sizeSqm: g.sizeSqm, furnished: g.furnished, status: "available", askingRent: g.askingRent, askingDeposit: g.askingDeposit, marketRent: g.askingRent > 0 ? g.askingRent : null, condition: "good", availableSince: base, lastRent: null, previousTenantId: null, notes: null });
        }
      }
    }
    const audited = appendAudit({ ...store, properties: [...store.properties, property], units: [...store.units, ...units] }, { action: "create", entityType: "property", entityId: property.id, entityLabel: property.name, newValue: `${code} · ${input.floors} floors × ${input.unitsPerFloor}` });
    const { store: logged, entry } = appendActivity(audited.store, { type: "property_added", message: `Building added — ${property.name} (${code})${units.length > 0 ? ` with ${units.length} units` : ""}`, entityType: "property", entityId: property.id, propertyId: property.id });
    const unitIds = new Set(units.map((u) => u.id));
    return finish(logged, { property, units }, (s) => recompute(removeAudit({ ...s, properties: s.properties.filter((p) => p.id !== property.id), units: s.units.filter((u) => !unitIds.has(u.id)), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export type PropertyPatch = Partial<Pick<Property, "name" | "address" | "district" | "city" | "country" | "yearBuilt" | "floors" | "unitsPerFloor" | "type" | "status" | "acquisitionDate" | "acquisitionCost" | "estimatedValue" | "insuranceProvider" | "insurancePolicyNumber" | "insuranceExpiry" | "notes">>;

export function updateProperty(propertyId: ID, patch: PropertyPatch): Command<Property> {
  return (store) => {
    const prev = indexStore(store).propertyById.get(propertyId);
    if (!prev) throw new Error("Building not found");
    const next: Property = { ...prev, ...patch, name: patch.name === undefined ? prev.name : patch.name.trim() || prev.name };
    if (next.floors < 1 || next.unitsPerFloor < 1) throw new Error("Floors and units per floor must be at least 1");
    if (store.properties.some((p) => p.id !== prev.id && p.name.toLowerCase() === next.name.toLowerCase())) throw new Error("A building with this name already exists");
    const maxFloor = Math.max(0, ...store.units.filter((u) => u.propertyId === prev.id).map((u) => u.floor));
    if (next.floors < maxFloor) throw new Error(`Units exist up to floor ${maxFloor}`);
    const audited = auditChanges({ ...store, properties: replaceById(store.properties, next) }, "property", next.id, next.name, prev, next);
    const { store: logged, entry } = appendActivity(audited.store, { type: "property_updated", message: `${next.name} details updated`, entityType: "property", entityId: next.id, propertyId: next.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, properties: replaceById(s.properties, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

/* ---------------------------------- Unit ---------------------------------- */

export interface UnitInput {
  propertyId: ID;
  unitNumber: string;
  floor: number;
  bedrooms?: number;
  bathrooms?: number;
  sizeSqm?: number;
  furnished?: boolean;
  askingRent?: number;
  askingDeposit?: number;
  marketRent?: number | null;
  condition?: UnitCondition;
  /** Owner override; rented / available are derived. */
  status?: Extract<UnitStatus, "maintenance" | "reserved" | "renovation" | "unavailable"> | null;
  notes?: string | null;
}

export function addUnit(input: UnitInput): Command<Unit> {
  return (store) => {
    const idx = indexStore(store);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    const unitNumber = input.unitNumber.trim();
    if (!unitNumber) throw new Error("Give the unit a number");
    if (store.units.some((u) => u.propertyId === property.id && u.unitNumber.toLowerCase() === unitNumber.toLowerCase())) throw new Error(`Unit ${unitNumber} already exists in ${property.name}`);
    if (!Number.isInteger(input.floor) || input.floor < 0) throw new Error("Floor must be 0 or more");
    for (const [label, v] of [["Asking rent", input.askingRent], ["Asking deposit", input.askingDeposit], ["Size", input.sizeSqm], ["Market rent", input.marketRent]] as const) if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) throw new Error(`${label} cannot be negative`);
    const unit: Unit = {
      id: uniqueId(ids.unit(property.id, unitNumber), (id) => idx.unitById.has(id)),
      propertyId: property.id,
      unitNumber,
      floor: input.floor,
      bedrooms: input.bedrooms ?? 1,
      bathrooms: input.bathrooms ?? 1,
      sizeSqm: input.sizeSqm ?? 0,
      furnished: input.furnished ?? false,
      status: input.status ?? "available",
      askingRent: input.askingRent ?? 0,
      askingDeposit: input.askingDeposit ?? input.askingRent ?? 0,
      marketRent: input.marketRent ?? (input.askingRent && input.askingRent > 0 ? input.askingRent : null),
      condition: input.condition ?? "good",
      availableSince: input.status ? null : today(),
      lastRent: null,
      previousTenantId: null,
      notes: input.notes?.trim() || null,
    };
    let next: Store = { ...store, units: [...store.units, unit] };
    // Growing the building when a higher floor appears keeps the grid consistent.
    const grown = input.floor + 1 > property.floors ? { ...property, floors: input.floor + 1 } : null;
    if (grown) next = { ...next, properties: replaceById(next.properties, grown) };
    const audited = appendAudit(next, { action: "create", entityType: "unit", entityId: unit.id, entityLabel: `${property.name} ${unit.unitNumber}`, newValue: `floor ${unit.floor} · ${unit.bedrooms} BR · asking ${formatMoney(unit.askingRent)}` });
    const { store: logged, entry } = appendActivity(audited.store, { type: "unit_added", message: `Unit ${unit.unitNumber} added to ${property.name}`, entityType: "unit", entityId: unit.id, propertyId: property.id, unitId: unit.id });
    return finish(logged, unit, (s) => recompute(removeAudit({ ...s, units: s.units.filter((u) => u.id !== unit.id), properties: grown ? replaceById(s.properties, property) : s.properties, activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

/* --------------------------------- Tenant --------------------------------- */

export interface TenantInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  nationality?: string;
  idType?: IdDocumentType;
  idNumber?: string;
  occupation?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
}

/** A tenant record on its own — the contract comes separately (or never, for a prospect in the file). */
export function addTenant(input: TenantInput): Command<Tenant> {
  return (store) => {
    const idx = indexStore(store);
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName) throw new Error("Give the tenant a first name");
    const phone = normalizePhone(input.phone.trim());
    if (!phone) throw new Error("A phone number is required");
    const clash = store.tenants.find((t) => samePhone(t.phone, phone));
    if (clash) throw new Error(`${clash.fullName} already has this phone number`);
    const fullName = `${firstName} ${lastName}`.trim();
    const tenant: Tenant = {
      id: uniqueId(ids.tenant(fullName, phone), (id) => idx.tenantById.has(id)),
      firstName,
      lastName,
      fullName,
      phone: input.phone.trim(),
      email: input.email?.trim() ?? "",
      nationality: input.nationality?.trim() || "Lebanese",
      idType: input.idType ?? "national_id",
      idNumber: input.idNumber?.trim() ?? "",
      photoUrl: null,
      occupation: input.occupation?.trim() || null,
      emergencyContactName: input.emergencyContactName?.trim() || null,
      emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
      notes: input.notes?.trim() || null,
      createdAt: today(),
    };
    const audited = appendAudit({ ...store, tenants: [...store.tenants, tenant] }, { action: "create", entityType: "tenant", entityId: tenant.id, entityLabel: tenant.fullName, newValue: tenant.phone });
    const { store: logged, entry } = appendActivity(audited.store, { type: "tenant_added", message: `Tenant added — ${tenant.fullName}`, entityType: "tenant", entityId: tenant.id, tenantId: tenant.id });
    return finish(logged, tenant, (s) => recompute(removeAudit({ ...s, tenants: s.tenants.filter((t) => t.id !== tenant.id), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

/* -------------------------------- Contract -------------------------------- */

export interface ContractInput {
  unitId: ID;
  tenantId: ID;
  startDate: ISODate;
  months: number;
  rent: number;
  deposit: number;
  paymentDay: number;
  method: PaymentMethod;
  frequency?: PaymentFrequency;
  rentIncreaseClause?: string | null;
  specialTerms?: string | null;
  notes?: string | null;
  /** Historical entry: instalments due before today are recorded as paid on time. */
  pastAsPaid?: boolean;
  /** Deposit already collected. */
  depositReceivedOn?: ISODate | null;
}

export interface CreateContractResult {
  contract: Contract;
  deposit: SecurityDeposit;
  paymentsScheduled: number;
}

export function createContract(input: ContractInput): Command<CreateContractResult> {
  return (store) => {
    const idx = indexStore(store);
    const unit = idx.unitById.get(input.unitId);
    if (!unit) throw new Error("Unit not found");
    const property = idx.propertyById.get(unit.propertyId);
    if (!property) throw new Error("Building not found");
    const tenant = idx.tenantById.get(input.tenantId);
    if (!tenant) throw new Error("Tenant not found");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new Error("Pick a start date");
    if (!Number.isInteger(input.months) || input.months < 1) throw new Error("Duration must be at least one month");
    if (!Number.isFinite(input.rent) || input.rent <= 0) throw new Error("Rent must be more than zero");
    if (!Number.isFinite(input.deposit) || input.deposit < 0) throw new Error("Deposit cannot be negative");
    if (!Number.isInteger(input.paymentDay) || input.paymentDay < 1 || input.paymentDay > 28) throw new Error("Payment day must be between 1 and 28");
    const endDate = addDaysISO(addMonthsISO(input.startDate, input.months), -1);
    const clash = (idx.contractsByUnit.get(unit.id) ?? []).find((c) => isOccupying(c) && !isAfter(input.startDate, c.moveOutDate ?? c.endDate) && !isAfter(c.startDate, endDate));
    if (clash) throw new Error(`${idx.tenantById.get(clash.tenantId)?.fullName ?? "Another tenant"} occupies ${unit.unitNumber} until ${clash.moveOutDate ?? clash.endDate}`);
    const base = today();
    const contractNumber = nextContractNumber(store, `${property.code}-${unit.unitNumber}`);
    const contract: Contract = {
      id: uniqueId(ids.contract(contractNumber), (id) => idx.contractById.has(id)),
      contractNumber,
      propertyId: property.id,
      unitId: unit.id,
      tenantId: tenant.id,
      startDate: input.startDate,
      endDate,
      durationMonths: input.months,
      monthlyRent: input.rent,
      deposit: input.deposit,
      paymentDay: input.paymentDay,
      paymentFrequency: input.frequency ?? "monthly",
      paymentMethod: input.method,
      status: "active",
      moveOutDate: null,
      renewedFromContractId: null,
      renewedToContractId: null,
      rentIncreaseClause: input.rentIncreaseClause?.trim() || null,
      specialTerms: input.specialTerms?.trim() || null,
      renewalDecision: null,
      renewalStatus: "not_due",
      proposedRent: null,
      renewalNotes: null,
      notes: input.notes?.trim() || null,
      createdAt: base,
    };
    const schedule = generateSchedule(contract, [], base, input.pastAsPaid ?? false);
    const deposit: SecurityDeposit = {
      id: ids.deposit(contract.id),
      contractId: contract.id,
      tenantId: tenant.id,
      unitId: unit.id,
      propertyId: property.id,
      amountExpected: input.deposit,
      amountReceived: input.depositReceivedOn ? input.deposit : 0,
      receivedDate: input.depositReceivedOn ?? null,
      deductions: [],
      finalRefund: null,
      settlementDate: null,
      settlementNotes: null,
      status: "pending",
      amountHeld: 0,
    };
    const next: Store = { ...store, contracts: [...store.contracts, contract], payments: [...store.payments, ...schedule], deposits: [...store.deposits, deposit] };
    const audited = appendAudit(next, { action: "create", entityType: "contract", entityId: contract.id, entityLabel: `${contractNumber} · ${tenant.fullName}`, newValue: `${input.startDate} → ${endDate} · ${formatMoney(input.rent)}/month` });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "contract_created",
      message: `Contract ${contractNumber} — ${tenant.fullName} in ${property.name} ${unit.unitNumber}, ${formatMoney(input.rent)}/month for ${input.months} months from ${input.startDate}`,
      entityType: "contract",
      entityId: contract.id,
      propertyId: property.id,
      unitId: unit.id,
      tenantId: tenant.id,
      contractId: contract.id,
    });
    const scheduled = new Set(schedule.map((p) => p.id));
    return finish(logged, { contract, deposit, paymentsScheduled: schedule.length }, (s) => recompute(removeAudit({ ...s, contracts: s.contracts.filter((c) => c.id !== contract.id), payments: s.payments.filter((p) => !scheduled.has(p.id)), deposits: s.deposits.filter((d) => d.id !== deposit.id), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}
