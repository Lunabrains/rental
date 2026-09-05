# Rental Portfolio Command Center — demo

A polished, fully connected demo of a private property intelligence and operations system for a
multi-building rental portfolio. Everything runs in the browser against an in-memory store loaded
from an Excel seed, so the demo is self-contained and resets on reload.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. The seed workbook (`public/seed/portfolio.xlsx`) loads through the
same importer the UI exposes; **Reset demo data** (Settings, or Settings → Import) reloads it.

## What's inside

Built phase by phase from `docs/rental-system-progress.md` (the checklist with per-phase notes;
`docs/implementation-notes.md` holds the initial audit and gap map). Every number on every screen
comes from the query layer, every write goes through an audited, undoable command, and CapEx never
enters operating results.

- **Dashboard & briefing** — six KPIs against last month, an attention strip (overdue, expiring,
  urgent maintenance, services due, vacancies), computed insights that link to their screen, the
  next 30 days, a twelve-month financial trend and a building comparison. `/briefing` is the daily
  owner briefing (decide today, money, this week, operations, good news) with copy and print.
- **Properties, units, tenants, contracts** — building 360 (overview, financials, maintenance,
  assets, documents, timeline), unit 360 with health score and profitability, tenant 360 with a
  reliability score, renewals board with decisions and contract terms.
- **Finance** — rent roll, payments dashboard with arrears aging, expenses with recurring patterns,
  budgets vs actual, security deposits with deductions and settlement, utilities and readings,
  common charges with allocation, and a cash-flow forecast with vacancy cost (`/finance/cash-flow`).
- **Maintenance** — work orders (board and detail, approvals, repeat-issue detection), preventive
  plans with due states, an asset registry with printable QR labels (`/assets/scan/<code>` opens
  the asset inside the app), and suppliers with a transparent performance score.
- **Operations** — inspections from checklist templates, move-in / move-out checklists that tie
  together the condition report, keys, closing readings and the deposit, keys and parking registers,
  renovation / CapEx projects with return estimates.
- **Alerts** — a rule book (`/alerts/rules`) with thresholds and mute switches, snooze / resolve /
  dismiss, and status filters; every alert is actionable.
- **Documents** — an entity-aware document centre with a review queue: uploads are read by rules
  (or by Claude when a key exists), suggestions carry a confidence, and nothing is filed or created
  without the owner confirming.
- **Analytics & reports** — portfolio trends, expense and maintenance analytics, building
  comparison, and a report catalogue (rent roll, tenant balances, payment history, expenses, P&L,
  maintenance history, expiring contracts, asset register, supplier performance) with CSV, Excel
  and print exports.
- **Search** — ⌘K / Ctrl+K opens a command palette over tenants, units, buildings, contracts,
  suppliers, work orders, assets and documents, plus quick actions.

Out of scope by design: leads, listings, applicant funnels, tenant-acquisition CRM, marketing,
public pages. Vacancy is tracked internally only.

### AI assistant

The assistant works fully offline for the demo: a local intent router (`src/lib/ai/answers-v2.ts`
first, then `src/lib/ai/demo-engine.ts`) answers questions about payments and collection, contracts
and renewals, buildings, units, tenants, vacancies, profitability, expenses, cash flow, maintenance,
preventive services, suppliers, alerts, the daily briefing and recent activity straight from the
query layer — instantly, with the same numbers as the screens. It can also set a reminder or draft
a work order; anything that changes data opens a form or asks for confirmation. It is available on
every page from the floating **Ask** button and on `/ai`.

**Voice:** tap the mic and talk — the browser's Web Speech API (Chrome / Edge) listens until you
pause, answers aloud, then listens again so the conversation keeps going; say "stop" (or "خلص") to
end it. The speaker toggle reads typed answers aloud too. No keys or services involved.

**Arabic:** flip the **EN / عربي** toggle next to the mic. Questions are recognised in Lebanese /
standard Arabic (`ar-LB`), understood by the same local router through an Arabic lexicon
(`src/lib/ai/arabic.ts`, with phonetic matching for tenant names), and answered in Arabic on screen
and aloud (`src/lib/ai/i18n.ts` holds every answer template in both languages). Typed Arabic works
without the toggle. Spoken Arabic answers need an Arabic voice in the browser — Microsoft Edge ships
them; Chrome uses the voices installed in Windows (Settings → Time & Language → Language & region →
add Arabic with Text-to-speech). Without one the answer stays on screen and the assistant says so.

Optional: with `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`), questions the local
router cannot place fall through to Claude with a read-only tool layer (`src/lib/ai/tools.ts`),
and uploaded documents are read by the model through `/api/ai/extract`. Without a key the assistant
gives an honest "I can't answer that from the portfolio data" plus suggestions, and documents are
read by rules.

Try the battery: `npx tsx scripts/check-assistant.ts` (or pass your own questions as arguments).

## The demo script (~6 minutes)

1. **Dashboard** — greeting, six KPIs, the attention strip, insights, Karim Daher at the top of *Needs attention*.
2. **Properties** — 7 cards → open **Beirut Heights**.
3. **Grid** — 27 red / 5 white squares with names; search "Karim" → 403 highlights.
4. **Drawer** — Contract (ends in 28 days), Payments (current month overdue 8 days), Documents (open the ID and the contract).
5. **Record Payment** — $1,500 → alert resolves, bell drops by one, dashboard outstanding drops by $1,500, receipt appears in Documents. Undo from the toast.
6. **Alerts** — Michel Saab repeat late payer, B304 vacant 87 days, Marina below 75%, 8 contracts ending in 30 days → **Renew** one (Nadine Khoury gets +5%).
7. **Maintenance** — the generator emergency at Waterfront Residence, the repeat plumbing on Marina B402, the overdue elevator certification (log the service), the lobby project over budget.
8. **Move-out** — Inspections → schedule Amin Hammoud's move-out checklist, record items, return keys, settle the deposit.
9. **AI** — "What needs my attention today?", "What is my collection rate this month?", "Which supplier has the highest repeat-issue rate?" — on every page from the floating **Ask** button.
10. **Reports** — export the rent roll to Excel, or the whole workbook.
11. **Import** — Settings → Import → drop `public/seed/cedar-residence.xlsx` (or click *Use the sample file*) → preview → 18 units → open Cedar Residence.

## Seed data

All dates in the seed are relative tokens (`today-8d`, `today+28d`) resolved at import time, so the
story is the same on any calendar day. Regenerate the workbooks and check the numbers:

```bash
npm run seed          # writes public/seed/*.xlsx
npm run check:seed    # KPIs, alerts, idempotent re-import, Cedar import timing
```

## Architecture

```
src/types            entity model (buildings … documents, alerts, audit)
src/lib/data         in-memory store, indexes, StoreProvider (run(command) / reset())
src/lib/import       xlsx template (19 tabs), parser, validation, idempotent apply, payment schedules
src/lib/derived      recompute(): contracts → payments → units → deposits, expenses, assets, renovations → alerts;
                     metrics (occupancy, collection, NOI, vacancy loss, scores), alert engine + catalog,
                     intelligence brief, daily briefing, dashboard insights
src/lib/queries      read-only query layer (the only way screens and AI tools read data)
src/lib/commands     the only write path; validated, audited, every command returns an undo
src/lib/ai           local routers, tool layer, document extraction, Arabic lexicon, i18n; src/app/api/ai relays to Claude
src/components       shell (nav, palette), dashboard, properties, units, tenants, finance, maintenance,
                     operations, analytics, reports, documents, alerts, flows (dialogs)
tests                node test runner: metrics, derivation, import, finance, maintenance, operations,
                     renovations, alerts, forecast, briefing, documents, assistant, analytics, search
```

The query/command interface is deliberately narrow so a persistent backend can replace the
in-memory store without touching the UI.

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint`, `npx tsc --noEmit`, `npm test`
- `npm run seed`, `npm run check:seed`, `npm run check:assistant`
