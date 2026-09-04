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

The assistant works fully offline for the demo: a local intent router (`src/lib/ai/demo-engine.ts`)
answers questions about payments, contracts, buildings, units, tenants, vacancies, alerts, revenue
and recent activity straight from the query layer — instantly, with the same numbers as the
screens. It is available on every page from the floating **Ask** button and on `/ai`.

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
router cannot place fall through to Claude with a read-only tool layer. Without a key they get an
honest "I can't answer that from the portfolio data" plus suggestions.

Try the battery: `npx tsx scripts/check-assistant.ts` (or pass your own questions as arguments).

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
