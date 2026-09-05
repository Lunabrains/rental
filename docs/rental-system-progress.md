# Rental system — progress checklist

Master plan: `CLAUDE_RENTAL_SYSTEM_IMPLEMENTATION_PLAN.md` (Property Intelligence & Operations System).
Validation after each phase: `npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build`.

- [x] Phase 0 — repository audit (`docs/implementation-notes.md`)
- [x] Phase 1 — data foundation & shared infrastructure
- [x] Phase 2 — buildings & unit 360°
- [x] Phase 3 — tenant 360° & contract intelligence
- [x] Phase 4 — rent roll & payment intelligence
- [x] Phase 5 — expenses & profitability
- [ ] Phase 6 — budgets, deposits, utilities, common charges
- [ ] Phase 7 — maintenance work orders
- [ ] Phase 8 — preventive maintenance & assets (QR)
- [ ] Phase 9 — suppliers
- [ ] Phase 10 — inspections, move-in/out, keys, parking
- [ ] Phase 11 — renovations / CapEx
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
