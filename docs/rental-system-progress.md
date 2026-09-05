# Rental system — progress checklist

Master plan: `CLAUDE_RENTAL_SYSTEM_IMPLEMENTATION_PLAN.md` (Property Intelligence & Operations System).
Validation after each phase: `npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build`.

- [x] Phase 0 — repository audit (`docs/implementation-notes.md`)
- [x] Phase 1 — data foundation & shared infrastructure
- [x] Phase 2 — buildings & unit 360°
- [x] Phase 3 — tenant 360° & contract intelligence
- [x] Phase 4 — rent roll & payment intelligence
- [x] Phase 5 — expenses & profitability
- [x] Phase 6 — budgets, deposits, utilities, common charges
- [x] Phase 7 — maintenance work orders
- [x] Phase 8 — preventive maintenance & assets (QR)
- [x] Phase 9 — suppliers
- [x] Phase 10 — inspections, move-in/out, keys, parking
- [x] Phase 11 — renovations / CapEx
- [ ] Phase 12 — smart alerts engine
- [ ] Phase 13 — cash flow & forecasting
- [ ] Phase 14 — daily owner briefing
- [ ] Phase 15 — AI document intelligence
- [ ] Phase 16 — AI assistant 2.0
- [ ] Phase 17 — analytics & reporting
- [ ] Cross-cutting — dashboard redesign, search & command palette, document center, timeline, integrity rules, audit & safety, seed data

## Phase 0 — repository audit
- Files: `docs/implementation-notes.md`
- Unresolved: none — existing app runs, production build succeeds.

## Phase 1 — data foundation & shared infrastructure
- Domain model (`src/types/index.ts`): expenses, budgets, security deposits, work orders, preventive plans, assets (QR ids), suppliers, meters/readings, common charges, inspections (+items), renovations (+tasks), parking, keys, reminders, audit log; unit statuses `renovation`/`unavailable`, market rent, condition; contract payment frequency, increase clause, special terms, renewal decision/status, proposed rent; payment `waived`; document categories + links to every entity + soft delete; alert `attention` severity, due date, resolved flag, origin (rule / ai / manual).
- Store & indexes (`src/lib/data/store.ts`), id helpers, thresholds for every new rule.
- Derivation (`src/lib/derived/`): `occupancy.ts` (shared), `metrics.ts` (§5 formulas, §6 tenant reliability, §7 building health, §8 unit health), `recompute.ts` (renewal status, waived rent, deposits, expenses, readings, asset service dates, renovation cost/progress), `alerts.ts` (full rules engine incl. maintenance, preventive, finance, inspection, renovation, reminders — Phase 12 rules brought forward).
- Importer: 14 new tabs (Suppliers, Assets, WorkOrders, PreventivePlans, Expenses, Budgets, Deposits, Meters, Readings, CommonCharges, Inspections, Renovations, Parking, Keys), extended Properties/Units/Contracts/Documents columns, idempotent keys, validation rules (§14: negative amounts, backwards dates, refund > held, decreasing readings), auto-created deposit per contract, renewal-chain linking.
- Seed (`scripts/generate-seed.ts`): suppliers with varied performance, assets + plans (overdue/due/out-of-service), 65 work orders incl. a repeat plumbing issue and an emergency, 500 expenses (recurring + invoices + CapEx), budgets with scripted over-budget lines, meters/readings, common charges, inspections with a failed item, renovations (over budget + delayed), parking, keys, certificates/insurance documents.
- Read queries (`src/lib/queries/operations.ts`): expenses, budgets, deposits, work orders (+details, summary), assets (+details, QR lookup), suppliers (+transparent performance score), plans, meters, charges, inspections, renovations, parking, keys, reminders, audit.
- Commands: audit helper (`appendAudit`, `auditChanges`), documents (add / soft delete / restore), reminders, alert resolve.
- Shared UI: `StatusBadge`, `Timeline`, entity selects, `AttachmentUploader`, `DataTable` (sort / search / paging / CSV / Excel), `ScoreBadge`/`ScoreBreakdown`, export helpers (`src/lib/export.ts`).
- Tests: `npm test` (node:test + tsx) — 40 tests over formulas, derivation, alerts, schedules, allocation, import round-trips and validation.
- Unresolved: uploaded files live as object URLs for the session only (no storage backend); AI tool layer not yet extended (Phase 16).

## Phase 2 — buildings & unit 360°
- Building page (`src/components/properties/building-page.tsx`, `building-tabs.tsx`): tabs Overview / Units / Financials / Maintenance / Assets / Documents / Timeline addressed by `?view=`; the elevation grid stays the landing view; Units tab gains a list layout (`unit-list.tsx`) with tenant, rent, expiry, outstanding, maintenance and condition; header shows the decomposable health score.
- Queries: `src/lib/queries/buildings.ts` (overview, financials with NOI/budget/category breakdown, building timeline), `src/lib/queries/units.ts` (`getUnit360`: deposit, reliability, health, work orders, inspections, meters, keys, parking, renovations, vacancy history, timeline).
- Unit 360° page at `/units/[id]` (`src/components/units/unit-page.tsx`): Overview / Tenant & contract / Payments / Maintenance / Inspections / Utilities / Documents / History; drawer links to it.
- Documents: real uploads through `AttachmentUploader` (drawer tab, building documents); uploaded files preview from their object URL.
- Unresolved: work-order / asset rows do not open detail pages yet (Phases 7–8); the timeline is not yet on tenants/contracts/assets (§13 continues with those modules).

## Phase 3 — tenant 360° & contract intelligence
- Tenant profile (`src/components/tenants/tenant-page.tsx`) rebuilt as Tenant 360°: KPIs (lifetime paid, outstanding, late payments, reliability score with breakdown, deposit held, maintenance), tabs Overview / Payments (late-payment history + full ledger) / Contracts (renewal chain with decisions) / Maintenance (requests + inspections) / Documents (uploader) / Notes & reminders / Timeline. Tenants list shows the reliability label.
- Contract intelligence: `setRenewalDecision`, `updateContractTerms`, `updateTenantNotes` commands (audited, undoable); renewal-decision, contract-terms and reminder dialogs wired into the actions provider and the unit drawer's contract tab; increase clause → suggested renewal rent.
- Expiring-contracts screen: Contracts › Renewals (`src/components/contracts/renewals-board.tsx`) with tenant, building, unit, rent, expiry, days left, reliability, renewal status, proposed rent, notes and one-click renew / do-not-renew / awaiting / reminder / open tenant / run renewal.
- Queries: `src/lib/queries/tenants.ts` (`getTenant360`, `getRenewals`, `suggestFromClause`).
- Unresolved: historical contract "versions" are the renewal chain (no separate version table); reminders are the follow-up/task mechanism.

## Phase 4 — rent roll & payment intelligence
- Rent roll (`/finance/rent-roll`, `src/components/finance/rent-roll-page.tsx`, `getRentRoll`): one row per rentable unit for any month — building, unit, tenant, rent, due date, amount due, paid, outstanding, status, days overdue, deposit, contract expiry; filters for status, arrears age (30/60/90+), occupancy, expiring contracts and building; summary header (expected, collected, outstanding, collection rate, overdue tenants); month navigation; CSV/Excel export; totals row.
- Payments dashboard (Payments › Overview, `payments-dashboard.tsx`, `getPaymentsDashboard`): expected vs collected this month, cash received, outstanding, partial payments, arrears aging buckets, 12-month collection trend with rate, tenants requiring attention (reasons, reliability, record / remind).
- Payment detail dialog (`payment-detail-dialog.tsx`, `getPaymentDetail`): due period, amounts, method, reference, notes, receipts, ledger context, audit history; edit details (audited), waive balance with a reason (confirmed, reversible), record payment. `recordPayment` now writes an audit entry.
- Commands: `updatePayment`, `waivePayment`, `unwaivePayment` (`src/lib/commands/payments.ts`); Finance navigation group.
- Tests: `tests/finance.test.ts` (rent roll rows/filters/quarterly billing, dashboard, record/waive/validation).

## Phase 5 — expenses & profitability
- Expense management (`/finance/expenses`, `expenses-page.tsx`, `expense-dialog.tsx`): add/edit with building, unit, supplier, asset, category, operating/CapEx, dates, status, recurrence, invoice number; mark paid, attach invoice, schedule next occurrence, soft delete with restore; filters by period, status, category, type, supplier, building; by-category and by-supplier breakdowns; exports. Commands in `src/lib/commands/expenses.ts` (validated, audited, undoable).
- Building profitability: Financials tab gains a profitability table (income, collected, operating expenses with maintenance and utilities, NOI, margin, CapEx, vacancy-loss estimate) for YTD and trailing 12 months.
- Unit profitability: unit page › Profitability tab (`getUnitProfitability`): rent billed/collected, attributed expenses, work-order costs, CapEx apart, vacancy loss, net contribution, month by month.
- Portfolio comparison (`/analytics/performance`, `getPortfolioComparison`, `getUnitRankings`): revenue, collection, expenses, maintenance, NOI, margin, NOI per unit, outstanding, vacancy loss, health; unit ranking by net contribution.
- Tests: `tests/expenses.test.ts`.

## Phase 6 — budgets, deposits, utilities, common charges
- Budgets (`/finance/budgets`): monthly or yearly lines per building and category with actual, difference, variance %, usage bar and over-budget flag; set/edit/remove lines; "spend without a budget line" prompts. Commands `setBudget` / `deleteBudget`.
- Security deposits (`/finance/deposits`, `deposit-dialog.tsx`): received / held / deductions / settlement / refund; move-out settlement UI shows outstanding rent and move-out inspection findings; refunds above the amount held need an explicit, audited override. Commands `receiveDeposit`, `addDeduction`, `removeDeduction`, `settleDeposit`; alert actions open the dialog.
- Utilities (`/finance/utilities`): meters (building or unit level), readings with consumption and cost, decreasing readings refused unless a reset is declared, optional booking of the amount as a utility expense. Commands `addMeter`, `recordReading`.
- Common charges (`/finance/charges`): create a charge for a month with a configurable allocation (equal / by area / by bedrooms), per-unit shares with paid toggles, collection progress. Commands `addCommonCharge`, `setAllocationPaid`, `deleteCommonCharge`.
- Finance navigation now: Rent roll, Payments, Expenses, Budgets, Deposits, Utilities, Common charges. Tests in `tests/finance-ops.test.ts`.

## Phase 7 — maintenance work orders
- Work-order board (`/maintenance`, `work-orders-page.tsx`): table and Kanban views, filters for building, category, priority, supplier, status and "open too long", KPIs (open/emergency, awaiting approval, spend, repeat issues), exports.
- Work-order detail (`/maintenance/[id]`, `work-order-page.tsx`): issue, building/unit/asset, supplier, quote and approval, estimated vs actual cost, status timeline, before/after photos, invoice attachment and linked expenses, related previous issues with "raise a permanent fix", audit trail, originating inspection / preventive plan.
- Dialogs (`work-order-dialogs.tsx`): create/edit with supplier suggestions by category and approval flag from $500; status change with guarded transitions, completion cost, optional preventive-plan roll-forward. Commands in `src/lib/commands/maintenance.ts` (work orders, plans incl. `logService`, assets, suppliers) — audited and undoable.
- Repeat-issue detection is rule-based in the alert engine (same unit/asset + category, N in the window) and surfaced on the board, the detail page and unit health.
- Cross-links: building Maintenance tab, unit Maintenance tab and tenant Maintenance tab open details and create requests; alert actions (view / approve / create work order) wired.
- Tests: `tests/maintenance.test.ts`.

## Phase 8 — preventive maintenance & asset registry
- Asset registry (`/assets`, `assets-page.tsx`): every piece of equipment with type, building/unit, status, next/last service, warranty, supplier, open work orders, lifetime spend and QR code; filters by service state, type, status, building; "Print QR labels" for the filtered set.
- Asset page (`/assets/[id]`, `asset-page.tsx`): status and service KPIs, preventive plans with log-service / work-order / edit actions, work-order history, 12-month cost history, QR label, details, manuals & certificates (upload), timeline.
- QR: stable code per asset (`qrCode`), rendered with `qrcode` (`qr-code.tsx`); the label encodes `/assets/scan/<code>`, which resolves inside the app (`asset-scan.tsx`) and redirects to the asset. Demo-only auth — the code carries no data.
- Preventive maintenance (`/maintenance/preventive`, `preventive-page.tsx`): overdue / due soon / scheduled / paused states, 90-day service budget, log service, raise work order, edit; new plan dialog with recurrence, reminder window, supplier and estimated cost. Paused plans raise no alerts.
- Dialogs (`asset-dialogs.tsx`): register/edit asset, add/edit plan, log service (rolls the plan forward, books the cost as an expense, undoable). Alert actions `view_asset`, `view_plan`, `schedule_service` wired.
- Nav: Assets (top group), Maintenance › Preventive. Building Assets tab opens asset pages and registers assets; building Maintenance tab logs services and adds plans.
- Tests: plan/service/asset commands already covered in `tests/maintenance.test.ts`.

## Phase 9 — suppliers
- Directory (`/suppliers`, `suppliers-page.tsx`): category and active filters, transparent performance score (popover breakdown), manual star rating, jobs done/open, average response and completion days, repeat-issue rate, cost vs quote, total spend, last job; under-performers highlighted; exports.
- Supplier page (`/suppliers/[id]`, `supplier-page.tsx`): score breakdown with every input visible, one-click star rating (audited, undoable), contact card, work orders, assets and preventive plans assigned (log service inline), booked expenses, spend by year, contracts & insurance documents (expiry alerts via the document rules), history.
- Dialog (`supplier-dialog.tsx`): add/edit with services list, rating and active flag; inactive suppliers are excluded from suggestions on new work orders.
- Nav: Maintenance › Suppliers. Alert action `view_supplier` wired; work-order and asset pages link to supplier pages.
- Scoring lives in `supplierRow` (`src/lib/queries/operations.ts`) and is covered by `tests/maintenance.test.ts`.

## Phase 10 — inspections, move-in / move-out, keys, parking
- Commands (`src/lib/commands/inspections.ts`): checklist templates per type (`CHECKLIST_TEMPLATES`), `scheduleInspection` (resolves tenant / contract / deposit from the unit), `recordInspectionItem` (first record → in progress, fail flags a follow-up), `addInspectionItem` / `removeInspectionItem`, `completeInspection` (derived overall result, override allowed, no future dates), `cancelInspection`, `startMoveOut` / `startMoveIn` (one per contract); keys `addKey`, `updateKey`, `issueKey`, `returnKey`, `markKeyLost`, `returnAllKeys`; parking `addParkingSpace`, `updateParkingSpace`, `assignParking` (resolves the occupant, refuses double assignment), `releaseParking`. Audited and undoable.
- Work orders can now be raised for one checklist item (`inspectionItemId`), keeping the other follow-ups open.
- Queries (`src/lib/queries/inspections.ts`): `getInspectionDetails` (reference report — the move-in for a move-out, otherwise the previous completed one — with item-by-item comparison and "deteriorated" flags, keys, meters, parking, deposit, work orders, photos, progress), `getMoves` (move-in / move-out checklists with step status), `getKeyStats`, `getParkingStats`.
- Alerts: `move_out_unplanned` (leaving, or two weeks from the end without a renewal, and no move-out inspection), `move_in_unplanned` (contract starting within the lead window, no condition report), `key_lost` (with "change the lock" work-order action). Thresholds `moveOutInspectionLeadDays` (30) and `moveInInspectionLeadDays` (14).
- UI: `/inspections` board (KPIs, move checklists with step progress, filters, table), `/inspections/[id]` (grouped checklist with pass / attention / fail toggles, notes, add / remove items, raise or open the work order per item, comparison with the reference report, move-out steps: keys back, closing readings via the reading dialog, parking, deposit settlement; photos), `/keys` register (issue / return / lost / found), `/parking` register (assign / release). Dialogs in `src/components/operations/*`.
- Cross-links: unit Inspections tab opens inspection pages and schedules annual / move-out checklists; unit Keys & parking card links to the registers; tenant page offers "Schedule move-out" / opens the existing checklist; building Maintenance tab lists inspections; alert actions `view_inspection`, `schedule_inspection`, `view_keys` wired.
- Nav: Operations › Inspections, Keys, Parking. Tests: `tests/operations.test.ts`.

## Phase 11 — renovations / CapEx
- Commands (`src/lib/commands/renovations.ts`): `createRenovation` (status from the start date, optional "renovation" flag on a vacant unit, task list), `updateRenovation`, `setRenovationStatus` (guarded transitions; cancelling frees the unit, resuming flags it), `completeRenovation` (actual end date, unit condition and new asking rent, unit released), `addRenovationTask` / `toggleRenovationTask` / `removeRenovationTask` (progress follows the task list). Audited and undoable.
- Queries (`src/lib/queries/renovations.ts`): `getRenovationImpact` (rent before / after or projected asking rent, monthly and annual uplift, payback months, annual return, empty days and rent forgone during the works, schedule slip, cost per unit for building projects), `getCapexSummary` (live / planned / completed, over-budget and delayed counts, committed vs spent, CapEx this year vs last, by building, by year).
- CapEx stays out of NOI: costs are booked as `capex` expenses linked by `renovationId` and roll up into the project's actual cost (derived in `recompute`).
- UI: `/renovations` (KPIs, by-building table, status chips, project table with progress bars and variance), `/renovations/[id]` (budget vs spent, progress, schedule, return; tasks checklist; CapEx expenses with "Book cost"; unit impact card; contractor; before / after photos; history; Start / Hold / Resume / Complete / Cancel). Dialogs in `renovation-dialogs.tsx`.
- Cross-links: unit Maintenance tab lists projects and offers "Plan renovation"; building overview links live projects; alert action `view_renovation` wired. Nav: Operations › Renovations.
- Tests: `tests/renovations.test.ts`.
