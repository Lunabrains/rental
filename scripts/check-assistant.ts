/**
 * Runs a battery of owner questions through the local demo brain and prints
 * what each one gets — so we can see coverage and wrong turns without a UI.
 *
 *   npx tsx scripts/check-assistant.ts            # built-in battery
 *   npx tsx scripts/check-assistant.ts "custom question" "another one"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { answerLocally } from "../src/lib/ai/demo-engine";
import type { PageContext } from "../src/lib/ai/types";
import { importData } from "../src/lib/commands";
import { createEmptyStore } from "../src/lib/data/store";
import { parseWorkbook } from "../src/lib/import/parse";
import { planImport } from "../src/lib/import/validate";

const buffer = readFileSync(join(process.cwd(), "public", "seed", "portfolio.xlsx"));
const parsed = parseWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "portfolio.xlsx");
const store = importData(planImport(parsed, createEmptyStore()))(createEmptyStore()).store;

const portfolio: PageContext = { pathname: "/dashboard" };
const beirut: PageContext = { pathname: "/properties/beirut-heights", propertyId: "beirut-heights", propertyName: "Beirut Heights" };

const BATTERY: [string, PageContext][] = [
  // the six
  ["What needs my attention today?", portfolio],
  ["Who hasn't paid this month?", portfolio],
  ["Which contracts expire in the next 30 days?", portfolio],
  ["Which building needs attention?", portfolio],
  ["Who is renting 403 in Beirut Heights?", portfolio],
  ["Which tenants regularly pay late?", portfolio],
  // variants
  ["Which contracts should I worry about in the next 30 days?", portfolio],
  ["who owes me money", portfolio],
  ["anyone late on rent?", portfolio],
  ["how much is outstanding", portfolio],
  ["who hasn't paid", beirut],
  ["who's in 502", beirut],
  ["tell me about Nadine Khoury", portfolio],
  ["karim daher", portfolio],
  ["Michel Saab payment history", portfolio],
  ["how is Marina Residence doing", portfolio],
  ["how is the portfolio doing", portfolio],
  ["how many units do we have", portfolio],
  ["what's our occupancy", portfolio],
  ["rank the buildings", portfolio],
  ["which building is doing best", portfolio],
  ["which units are vacant", portfolio],
  ["any empty apartments in Marina?", portfolio],
  ["units vacant for more than 45 days", portfolio],
  ["what's due this week", portfolio],
  ["what payments are coming in the next 7 days", beirut],
  ["revenue last month", portfolio],
  ["why did revenue drop two months ago", portfolio],
  ["how much do we hold in deposits", portfolio],
  ["any document issues", portfolio],
  ["show me all warnings", portfolio],
  ["what changed today", portfolio],
  ["what happened this week", portfolio],
  ["contracts expiring in 60 days", portfolio],
  ["who should I renew early", portfolio],
  ["leases ending next month in Marina", portfolio],
  ["what can you do", portfolio],
  ["hello", portfolio],
  ["thanks", portfolio],
  ["B304", portfolio],
  ["who lives in 704 marina", portfolio],
  ["is 803 available", beirut],
  ["tell me about Cedar Residence", portfolio],
  ["what's the weather like", portfolio],
  ["book me a flight", portfolio],
  ["who is Rami", portfolio],
];

const custom = process.argv.slice(2);
const items: [string, PageContext][] = custom.length > 0 ? custom.map((q) => [q, portfolio]) : BATTERY;

let hits = 0;
for (const [q, ctx] of items) {
  const a = answerLocally(q, store, ctx);
  const scope = ctx.propertyName ? ` [${ctx.propertyName}]` : "";
  if (!a) {
    console.log(`MISS  ${q}${scope}`);
    continue;
  }
  hits++;
  const bits = [
    a.text.replace(/\s+/g, " ").slice(0, 110),
    a.table ? `table ${a.table.rows.length}×${a.table.columns.length}` : null,
    a.cards ? `cards ${a.cards.length}` : null,
    a.actions?.length ? `actions ${a.actions.map((x) => x.label).join(" / ")}` : null,
  ].filter(Boolean);
  console.log(`${a.source.padEnd(9)} ${q}${scope}\n      → ${bits.join(" · ")}`);
}
console.log(`\n${hits}/${items.length} answered locally`);
