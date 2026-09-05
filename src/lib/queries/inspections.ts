import { indexStore } from "@/lib/data/store";
import { daysUntil, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import type { Contract, ID, ISODate, Inspection, InspectionItem, ItemResult, Property, SecurityDeposit, StoredDocument, Store, Tenant, Unit } from "@/types";

import { getInspections, getKeys, getMeters, getParking, getWorkOrders, inspectionRow, type InspectionRow, type KeyRow, type MeterRow, type ParkingRow, type WorkOrderRow } from "./operations";

export interface ComparisonRow {
  area: string;
  item: string;
  before: ItemResult | null;
  beforeNotes: string | null;
  after: ItemResult;
  afterNotes: string | null;
  /** Condition got worse since the reference inspection. */
  deteriorated: boolean;
}

export interface InspectionDetails extends InspectionRow {
  contract: Contract | null;
  deposit: SecurityDeposit | null;
  /** Reference inspection for comparison (move-in for a move-out, otherwise the previous completed one for the same unit or asset). */
  reference: InspectionRow | null;
  comparison: ComparisonRow[];
  keys: KeyRow[];
  meters: MeterRow[];
  parking: ParkingRow[];
  workOrders: WorkOrderRow[];
  photos: StoredDocument[];
  progress: { recorded: number; total: number; pass: number; attention: number; fail: number };
}

const RANK: Record<ItemResult, number> = { na: 0, pass: 1, attention: 2, fail: 3 };

export function getInspectionDetails(store: Store, id: ID, base: ISODate = today()): InspectionDetails | null {
  const idx = indexStore(store);
  const i = store.inspections.find((x) => x.id === id);
  if (!i) return null;
  const row = inspectionRow(store, i, base);
  if (!row) return null;
  const contract = i.contractId ? idx.contractById.get(i.contractId) ?? null : null;
  const deposit = i.depositId ? idx.depositById.get(i.depositId) ?? null : contract ? store.deposits.find((d) => d.contractId === contract.id) ?? null : null;

  let reference: Inspection | null = null;
  if (i.type === "move_out" && contract) {
    reference = store.inspections.find((x) => x.contractId === contract.id && x.type === "move_in" && x.status === "completed") ?? null;
  }
  if (!reference) {
    const candidates = store.inspections.filter((x) => x.id !== i.id && x.status === "completed" && (i.unitId ? x.unitId === i.unitId : i.assetId ? x.assetId === i.assetId : x.propertyId === i.propertyId && !x.unitId && !x.assetId) && (x.completedDate ?? x.scheduledDate) <= (i.completedDate ?? i.scheduledDate));
    reference = candidates.sort((a, b) => ((a.completedDate ?? a.scheduledDate) < (b.completedDate ?? b.scheduledDate) ? 1 : -1))[0] ?? null;
  }
  const refItems = new Map<string, InspectionItem>();
  for (const it of reference?.items ?? []) refItems.set(`${it.area.toLowerCase()}|${it.item.toLowerCase()}`, it);
  const comparison: ComparisonRow[] = i.items.map((it) => {
    const before = refItems.get(`${it.area.toLowerCase()}|${it.item.toLowerCase()}`) ?? null;
    return { area: it.area, item: it.item, before: before?.result ?? null, beforeNotes: before?.notes ?? null, after: it.result, afterNotes: it.notes, deteriorated: before !== null && it.result !== "na" && RANK[it.result] > RANK[before.result] && before.result !== "na" };
  });

  return {
    ...row,
    contract,
    deposit,
    reference: reference ? inspectionRow(store, reference, base) : null,
    comparison,
    keys: i.unitId ? getKeys(store, { unitId: i.unitId }) : i.tenantId ? getKeys(store, { tenantId: i.tenantId }) : [],
    meters: i.unitId ? getMeters(store, { unitId: i.unitId }) : [],
    parking: i.unitId ? getParking(store, { unitId: i.unitId }) : [],
    workOrders: getWorkOrders(store, {}, base).filter((w) => w.workOrder.inspectionId === i.id),
    photos: store.documents.filter((d) => d.inspectionId === i.id && !d.deleted),
    progress: {
      recorded: i.items.filter((it) => it.result !== "na").length,
      total: i.items.length,
      pass: i.items.filter((it) => it.result === "pass").length,
      attention: i.items.filter((it) => it.result === "attention").length,
      fail: i.items.filter((it) => it.result === "fail").length,
    },
  };
}

export interface MoveRow {
  kind: "move_in" | "move_out";
  contract: Contract;
  tenant: Tenant;
  unit: Unit;
  property: Property;
  date: ISODate;
  daysUntil: number;
  inspection: InspectionRow | null;
  keysOut: number;
  deposit: SecurityDeposit | null;
  /** Steps done for the move-out / move-in checklist. */
  steps: { label: string; done: boolean }[];
}

/** Upcoming and recent move-ins / move-outs with their checklist status (plan §Phase 10). */
export function getMoves(store: Store, base: ISODate = today()): MoveRow[] {
  const idx = indexStore(store);
  const t = store.settings.thresholds;
  const out: MoveRow[] = [];
  for (const c of store.contracts) {
    const tenant = idx.tenantById.get(c.tenantId);
    const unit = idx.unitById.get(c.unitId);
    const property = unit ? idx.propertyById.get(unit.propertyId) : undefined;
    if (!tenant || !unit || !property) continue;
    const deposit = store.deposits.find((d) => d.contractId === c.id) ?? null;
    const keysOut = store.keys.filter((k) => k.tenantId === c.tenantId && k.status === "issued").length;
    const find = (type: "move_in" | "move_out") => getInspections(store, { unitId: c.unitId, type }, base).find((r) => r.inspection.contractId === c.id && r.inspection.status !== "cancelled") ?? null;

    if (isOccupying(c) && c.renewalDecision !== "renew") {
      const end = c.moveOutDate ?? c.endDate;
      const d = daysUntil(end);
      const leaving = c.status === "notice_given" || c.renewalDecision === "do_not_renew";
      if (leaving || (d <= t.moveOutInspectionLeadDays && d >= -60)) {
        const insp = find("move_out");
        out.push({
          kind: "move_out",
          contract: c,
          tenant,
          unit,
          property,
          date: end,
          daysUntil: d,
          inspection: insp,
          keysOut,
          deposit,
          steps: [
            { label: "Inspection scheduled", done: insp !== null },
            { label: "Inspection completed", done: insp?.inspection.status === "completed" },
            { label: "Keys returned", done: keysOut === 0 },
            { label: "Closing readings", done: insp?.inspection.items.some((it) => it.area === "Meters" && it.result === "pass") ?? false },
            { label: "Deposit settled", done: deposit?.status === "settled" },
          ],
        });
      }
    }
    const dIn = daysUntil(c.startDate);
    if (c.status === "active" && dIn <= t.moveInInspectionLeadDays && dIn >= -30) {
      const insp = find("move_in");
      out.push({
        kind: "move_in",
        contract: c,
        tenant,
        unit,
        property,
        date: c.startDate,
        daysUntil: dIn,
        inspection: insp,
        keysOut,
        deposit,
        steps: [
          { label: "Deposit received", done: deposit !== null && deposit.amountReceived >= deposit.amountExpected },
          { label: "Inspection scheduled", done: insp !== null },
          { label: "Condition report done", done: insp?.inspection.status === "completed" },
          { label: "Keys issued", done: keysOut > 0 },
          { label: "Opening readings", done: insp?.inspection.items.some((it) => it.area === "Meters" && it.result === "pass") ?? false },
        ],
      });
    }
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Simple counters for the key register page. */
export function getKeyStats(store: Store, propertyId?: ID): { total: number; issued: number; available: number; lost: number } {
  const keys = store.keys.filter((k) => !propertyId || k.propertyId === propertyId);
  return { total: keys.length, issued: keys.filter((k) => k.status === "issued").length, available: keys.filter((k) => k.status === "in_office" || k.status === "returned").length, lost: keys.filter((k) => k.status === "lost").length };
}

/** Occupancy and fee summary for parking. */
export function getParkingStats(store: Store, propertyId?: ID): { total: number; assigned: number; free: number; reserved: number; unavailable: number; monthlyFees: number; unpaidAssigned: number } {
  const spaces = store.parking.filter((p) => !propertyId || p.propertyId === propertyId);
  const assigned = spaces.filter((p) => p.status === "assigned");
  return {
    total: spaces.length,
    assigned: assigned.length,
    free: spaces.filter((p) => p.status === "free").length,
    reserved: spaces.filter((p) => p.status === "reserved").length,
    unavailable: spaces.filter((p) => p.status === "unavailable").length,
    monthlyFees: assigned.filter((p) => p.paid).reduce((n, p) => n + p.monthlyFee, 0),
    unpaidAssigned: assigned.filter((p) => !p.paid).length,
  };
}
