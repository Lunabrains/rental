# Rental Portfolio Command Center — demo

A polished, fully connected demo of a multi-building rental management system, built to the
"Rental Portfolio Command Center — Implementation Plan". Everything runs in the browser against an
in-memory store loaded from an Excel seed, so the demo is self-contained and resets on reload.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. The seed workbook (`public/seed/portfolio.xlsx`) loads through the
same importer the UI exposes; **Reset demo data** (Settings, or Settings → Import) reloads it.

### AI assistant

The six rehearsed questions answer instantly from the query layer and need no key. Free-form
questions call Claude with a read-only tool layer; to enable them:

```bash
cp .env.example .env.local   # then set ANTHROPIC_API_KEY
```

## The demo script (~6 minutes)

1. **Dashboard** — greeting, Portfolio Intelligence, 4 KPIs, Karim Daher at the top of *Needs attention*, Marina Residence at the bottom of the ranking.
2. **Properties** — 7 cards → open **Beirut Heights**.
3. **Grid** — 27 red / 5 white squares with names; search "Karim" → 403 highlights.
4. **Drawer** — Contract (ends in 28 days), Payments (current month overdue 8 days), Documents (open the ID and the contract).
5. **Record Payment** — $1,500 → alert resolves, bell drops by one, dashboard outstanding drops by $1,500, receipt appears in Documents. Undo from the toast.
6. **Alerts** — Michel Saab repeat late payer, B304 vacant 87 days, Marina below 75%, 8 contracts ending in 30 days → **Renew** one (Nadine Khoury gets +5%).
7. **AI** — "What needs my attention today?" then "Which contracts should I worry about in the next 30 days?" — available on every page from the floating **Ask** button.
8. **Import** — Settings → Import → drop `public/seed/cedar-residence.xlsx` (or click *Use the sample file*) → preview → 18 units → open Cedar Residence.

## Seed data

All dates in the seed are relative tokens (`today-8d`, `today+28d`) resolved at import time, so the
story is the same on any calendar day. Regenerate the workbooks and check the numbers:

```bash
npx tsx scripts/generate-seed.ts   # writes public/seed/*.xlsx
npx tsx scripts/check-seed.ts      # KPIs, alerts, idempotent re-import, Cedar import timing
```

## Architecture

```
src/types            entity model
src/lib/data         in-memory store, indexes, StoreProvider (run(command) / reset())
src/lib/import       xlsx template, parser, validation, idempotent apply, payment schedules
src/lib/derived      recompute(): contract → payment → unit derivation, alert engine, intelligence brief
src/lib/queries      read-only query layer (the only way screens and AI tools read data)
src/lib/commands     the only write path; every command ends with recompute() and returns an undo
src/lib/ai           tool definitions, scripted answers, client loop; src/app/api/ai relays to Claude
src/components       shell, dashboard, properties/grid, unit drawer, flows (dialogs), pages
```

The query/command interface is deliberately narrow so a persistent backend can replace the
in-memory store without touching the UI.

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint`, `npx tsc --noEmit`
