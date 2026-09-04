# Implementation notes — repository audit (Phase 0)

Audit of the existing Rental Command Center before extending it into the
Property Intelligence & Operations System. Written 2026-09-05; update as the
architecture evolves.

## Stack

| Concern | What exists |
| --- | --- |
| Framework | Next.js 16.3 App Router (Turbopack), React 19, TypeScript strict, `params` are Promises |
| UI | shadcn/ui (radix-nova preset) in `src/components/ui`, Tailwind 4 tokens in `src/app/globals.css` (brand red, severity + unit-grid colours), lucide icons, Recharts 3, motion, sonner toasts |
| Routing | `src/app/(app)/*` thin pages → client components in `src/components/*`; `/login` outside the shell; unit drawer addressed by `?unit=&tab=` on every page |
| Auth | Demo login page only (no real auth, single owner "George") — permissions are not modelled |
| Persistence | **In-memory `Store`** (`src/types/index.ts`, `src/lib/data/store.ts`) loaded from `public/seed/portfolio.xlsx` through the importer. No database, no server state. A persistent backend is the roadmap's Phase 2 — the query/command interfaces are the seam. |
| Reads | Pure query functions in `src/lib/queries` (portfolio, entities, lists). UI and the AI tool layer both go through them. |
| Writes | Commands in `src/lib/commands` — `Store → { store, result, undo }`, every one ends in `recompute()` |
| Derivation | `src/lib/derived/recompute.ts` (contract → payment → unit statuses → alerts), `alerts.ts` (rule engine keyed `${type}:${entityId}`), `intelligence.ts` (plain-language brief) |
| Import | xlsx template (`src/lib/import/template.ts`), parse → plan (validate, idempotent keys) → apply; relative date tokens (`today-8d`); `payment_pattern` DSL scripts demo history |
| Seed | `scripts/generate-seed.ts` (deterministic), `scripts/check-seed.ts` (KPI dump), `scripts/check-assistant.ts` (AI battery) |
| AI | `/api/ai` (Claude, tool loop run in the browser over `src/lib/ai/tools.ts`) — only if `ANTHROPIC_API_KEY` exists; otherwise the local rule-based engine (`demo-engine.ts`, EN + Arabic) answers |
| Formatting | `src/lib/format.ts` (USD money, dates via date-fns, percent), `src/lib/date.ts` (`today()` overridable, periods `YYYY-MM`) |
| Commands | `npm run dev` · `npm run build` · `npm run lint` (eslint 9 + next) · `npx tsc --noEmit` · no test runner yet |

Timezone: dates are calendar `YYYY-MM-DD` strings compared lexically; "today" is the browser's local date. Currency: USD only.

## Existing entities → target domain model

| Target (plan §4) | Status | Notes |
| --- | --- | --- |
| 4.1 Building | exists (`Property`) | add type/status, acquisition & value, insurance, health-score inputs |
| 4.2 Unit | partial | has status/rent/deposit/vacancy; add `renovation`/`unavailable` statuses, market rent, condition, parking/keys links |
| 4.3 Tenant | partial | contact/docs/history exist; reliability score, balances, late stats are derived — add query + UI |
| 4.4 Contract | partial | add payment frequency, increase clause, special terms, renewal status/decision, proposed rent |
| 4.5 Payment | exists | add `waived`, receipts/notes exist; audit history via audit log |
| 4.6 Expense | **missing** | new entity + sheet + seed |
| 4.7 Budget | missing | new |
| 4.8 Security deposit | missing | contract carries `deposit` amount only → new deposit ledger |
| 4.9 Work order | missing | new |
| 4.10 Preventive plan | missing | new |
| 4.11 Asset | missing | new |
| 4.12 Supplier | missing | new |
| 4.13/4.14 Meter / reading | missing | new |
| 4.15 Common charge | missing | new |
| 4.16/4.17 Inspection / items | missing | new (items embedded) |
| 4.18 Renovation | missing | new |
| 4.19 Parking | missing | new |
| 4.20 Key / access | missing | new |
| 4.21 Document | partial | tenant/contract/payment links exist → add category + links to every entity, soft delete |
| 4.22 Alert | partial | add `attention` severity, due date, resolved flag, generated-by, new entity types |
| 4.23 Audit log | missing | activity log exists (user-facing) → add field-level audit log |

## Feature gap map (plan phases)

- **Exists:** dashboard (KPIs, attention list, next 30 days, revenue chart, ranking, vacancy), buildings grid + unit drawer, tenants list/profile, contracts list, payments list + record flow, alerts (payment/contract/occupancy/document/portfolio rules), documents, reports, global search, xlsx import, AI assistant (EN/AR, voice).
- **Partial:** tenant 360 (no reliability score, no maintenance), contract intelligence (no renewal workflow), payments (no arrears aging/trends), building page (grid only — no tabs), timeline (units/tenants only).
- **Missing:** rent roll, expenses, budgets, deposits ledger, utilities, common charges, work orders, preventive maintenance, assets + QR, suppliers, inspections/move-in/out, renovations, parking, keys, cash-flow forecast, daily briefing, document intelligence, analytics pages, exports, tests.
- **Needs refactor:** alert engine to cover new rule families; navigation to the target structure (existing routes preserved, new sections added); dashboard KPI row (expenses, NOI).

## Migration strategy (in-memory)

"Migrations" here mean: extend `Store` + types, extend the importer with one
sheet per new entity (idempotent keys), regenerate the seed workbook, and keep
`recompute()` the single derivation pass. Every write stays a command with an
undo, and audited writes append an `AuditEntry`. Persisted data does not
exist yet, so compatibility means: the old workbook still imports (new sheets
are optional), and every existing screen keeps working.

Rules adopted from the plan: no lead/listing/marketing features; vacancy
tracking is internal only; estimates are labelled; AI never invents numbers —
it summarises query results.
