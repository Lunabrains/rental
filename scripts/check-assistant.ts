/**
 * Runs a battery of owner questions — English and Arabic — through the local
 * demo brain and prints what each one gets, so coverage and wrong turns are
 * visible without a UI.
 *
 *   npx tsx scripts/check-assistant.ts            # built-in battery
 *   npx tsx scripts/check-assistant.ts "custom question" "سؤال بالعربي"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { arabicToEnglish } from "../src/lib/ai/arabic";
import { answerLocally } from "../src/lib/ai/demo-engine";
import { detectLang } from "../src/lib/ai/i18n";
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
  ["What is the total outstanding balance by building?", portfolio],
  ["who hasn't paid", beirut],
  ["who's in 502", beirut],
  ["who's in B704", beirut],
  ["tell me about Nadine Khoury", portfolio],
  ["karim daher", portfolio],
  ["karims contract", portfolio],
  ["karim daher overdue", portfolio],
  ["Michel Saab payment history", portfolio],
  ["how is Marina Residence doing", portfolio],
  ["How is Downtown Tower doing?", portfolio],
  ["rent roll for Downtown Tower", portfolio],
  ["What is the total value of deposits held for Downtown Tower?", portfolio],
  ["any maintenance requests in Downtown Tower", portfolio],
  ["how is the portfolio doing", portfolio],
  ["Could you summarise the overall state of the portfolio, including occupancy and revenue?", portfolio],
  ["how many units do we have", portfolio],
  ["how many tenants", portfolio],
  ["what's our occupancy", portfolio],
  ["rank the buildings", portfolio],
  ["which building is doing best", portfolio],
  ["which units are vacant", portfolio],
  ["any empty apartments in Marina?", portfolio],
  ["units vacant for more than 45 days", portfolio],
  ["what's due this week", portfolio],
  ["rent due wk", portfolio],
  ["whats due tmrw", portfolio],
  ["what payments are due in the next 30 days", portfolio],
  ["what payments are coming in the next 7 days", beirut],
  ["what came in last wk", portfolio],
  ["revenue last month", portfolio],
  ["why did revenue drop two months ago", portfolio],
  ["What is the revenue for Beirut Heights?", portfolio],
  ["how much do we hold in deposits", portfolio],
  ["any document issues", portfolio],
  ["Are there any tenants whose identification documents are missing or have expired?", portfolio],
  ["show me all warnings", portfolio],
  ["what changed today", portfolio],
  ["what happened this week", portfolio],
  ["contracts expiring in 60 days", portfolio],
  ["contracts end in 2 wks", portfolio],
  ["Which contracts are ending within the next two months?", portfolio],
  ["whos moving out next month", portfolio],
  ["who should I renew early", portfolio],
  ["Which tenants have never paid late?", portfolio],
  ["who has never been late", portfolio],
  ["Which tenants should I prioritise for early renewal?", portfolio],
  ["Which tenants have been late with their rent on a recurring basis?", portfolio],
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
  // Arabic (Lebanese + standard)
  ["شو لازم انتبه له اليوم؟", portfolio],
  ["مين ما دفع هالشهر؟", portfolio],
  ["أي عقود بتنتهي خلال 30 يوم؟", portfolio],
  ["أي مبنى بحاجة لانتباه؟", portfolio],
  ["مين ساكن بـ403 بيروت هايتس؟", portfolio],
  ["مين المستأجرين اللي دايماً بيتأخروا؟", portfolio],
  ["من لم يدفع الإيجار هذا الشهر", portfolio],
  ["كيف وضع مارينا", portfolio],
  ["شو الشقق الفاضية", portfolio],
  ["كم شقة فاضية بمارينا", portfolio],
  ["خبرني عن كريم ضاهر", portfolio],
  ["كريم ضاهر", portfolio],
  ["ميشال صعب", portfolio],
  ["نادين خوري", portfolio],
  ["كيف وضع المحفظة", portfolio],
  ["رتّب المباني", portfolio],
  ["لمين لازم جدّد بكير؟", portfolio],
  ["قديش المتبقي", portfolio],
  ["شو المستحق هالأسبوع", portfolio],
  ["الإيرادات الشهر الماضي", portfolio],
  ["شو صار اليوم", portfolio],
  ["العقود اللي بتخلص الشهر الجاي", portfolio],
  ["مين ساكن ب ٧٠٤ مارينا", portfolio],
  ["هل في مشاكل بالمستندات", portfolio],
  ["كم التأمينات", portfolio],
  ["مرحبا", portfolio],
  ["شكرا", portfolio],
  ["شو الطقس اليوم", portfolio],
];

const custom = process.argv.slice(2);
const items: [string, PageContext][] = custom.length > 0 ? custom.map((q) => [q, portfolio]) : BATTERY;

let hits = 0;
for (const [q, ctx] of items) {
  const lang = detectLang(q);
  const a = answerLocally(q, store, ctx, lang);
  const scope = ctx.propertyName ? ` [${ctx.propertyName}]` : "";
  const translated = lang === "ar" ? `\n      ⇢ ${arabicToEnglish(q)}` : "";
  if (!a) {
    console.log(`MISS  ${q}${scope}${translated}`);
    continue;
  }
  hits++;
  const bits = [
    a.text.replace(/\s+/g, " ").slice(0, 120),
    a.table ? `table ${a.table.rows.length}×${a.table.columns.length}` : null,
    a.cards ? `cards ${a.cards.length}` : null,
    a.actions?.length ? `actions ${a.actions.map((x) => x.label).join(" / ")}` : null,
  ].filter(Boolean);
  console.log(`${a.source.padEnd(9)} ${lang} ${q}${scope}${translated}\n      → ${bits.join(" · ")}`);
}
console.log(`\n${hits}/${items.length} answered locally`);
