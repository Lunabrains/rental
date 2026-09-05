import { indexStore } from "@/lib/data/store";
import { daysSince, daysUntil } from "@/lib/date";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import type { Alert, Store } from "@/types";

/**
 * Answer language. Everything the demo brain says exists in English and in
 * Arabic (Lebanese-flavoured standard Arabic). Numbers, money and dates stay
 * in Latin digits — that is how Lebanese owners read them.
 */
export type Lang = "en" | "ar";

const ARABIC = /[؀-ۿ]/;

export function detectLang(text: string): Lang {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return arabic > 0 && arabic >= latin ? "ar" : "en";
}

export function isArabicText(text: string): boolean {
  return ARABIC.test(text);
}

const arDate = new Intl.DateTimeFormat("ar-LB-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
const arMonth = new Intl.DateTimeFormat("ar-LB-u-nu-latn", { month: "long", year: "numeric" });

function n(count: number, one: string, two: string, few: string, many: string): string {
  // Arabic: 1 → singular, 2 → dual, 3–10 → plural, 11+ → singular form after number.
  if (count === 1) return one;
  if (count === 2) return two;
  if (count >= 3 && count <= 10) return few;
  return many;
}

export const en = {
  date: (iso: string) => formatDate(iso),
  month: (period: string) => formatMonth(period),
  money: (v: number) => formatMoney(v),
  pct: (v: number) => formatPercent(v),
  days: (d: number) => `${d} day${d === 1 ? "" : "s"}`,
  scopeIn: (name: string | undefined) => (name ? ` in ${name}` : ""),
  none: "none",
  dash: "—",
  partial: "partial",
  alsoOverdue: (amount: string) => `also overdue (${amount})`,
  reliableNote: "reliable — renew early",
  formerTenant: "former tenant",
  paidUp: "paid up",
  overdueNow: (amount: string) => `overdue · ${amount}`,
  yes: "Yes",
  no: "No",

  cols: {
    num: "#",
    item: "Item",
    detail: "Detail",
    tenant: "Tenant",
    buildingUnit: "Building · Unit",
    period: "Period",
    outstanding: "Outstanding",
    daysOverdue: "Days overdue",
    ends: "Ends",
    days: "Days",
    rent: "Rent",
    note: "Note",
    late: "Late",
    avgDaysLate: "Avg days late",
    now: "Now",
    building: "Building",
    occupancy: "Occupancy",
    units: "Units",
    revenueMo: "Revenue / mo",
    score: "Score",
    daysVacant: "Days vacant",
    asking: "Asking",
    previousTenant: "Previous tenant",
    rentMissed: "Rent missed",
    month: "Month",
    billed: "Billed",
    collected: "Collected",
    due: "Due",
    amount: "Amount",
    depositsHeld: "Deposits held",
    severity: "Severity",
    alert: "Alert",
    when: "When",
    what: "What",
    by: "By",
    phone: "Phone",
    payments: "Payments",
    share: "Share",
    portfolio: "Portfolio",
  },

  fields: {
    unit: "Unit",
    rent: "Rent",
    contract: "Contract",
    payments: "Payments",
    outstanding: "Outstanding",
    documents: "Documents",
    withUs: "With us",
    occupancy: "Occupancy",
    available: "Available",
    monthlyRevenue: "Monthly revenue",
    contractsEnding: "Contracts ending",
    criticalAlerts: "Critical alerts",
    vacant: "Vacant",
    revenuePerMonth: "Revenue / month",
    ending60: "Ending ≤ 60 days",
    vacantUnits: "Vacant units",
    longestVacancy: "Longest vacancy",
    contractsEnding30: "Contracts ending in 30d",
  },

  /* ---- scripted six ---- */
  attentionNone: (scope: string) => `Nothing critical${scope} right now.`,
  attentionIntro: (count: number, scope: string) => `${count} critical item${count === 1 ? "" : "s"}${scope} need a decision today. Ranked by money and time at stake:`,
  unpaidNone: (scope: string) => `Everyone${scope} is paid up.`,
  unpaidIntro: (tenants: number, scope: string, total: string, payments: number) => `${tenants} tenant${tenants === 1 ? "" : "s"}${scope} owe ${total} across ${payments} payment${payments === 1 ? "" : "s"}. Most overdue first:`,
  unpaidRecommendation: (name: string, days: number) => `Start with ${name} (${days} days) — then anyone whose contract is also ending soon.`,
  recordPaymentOf: (first: string) => `Record ${first}'s payment`,
  expiringNone: (days: number, scope: string) => `No contracts end within ${days} days${scope}.`,
  expiringIntro: (count: number, days: number, scope: string, total: string) => `${count} contract${count === 1 ? "" : "s"} end within ${days} days${scope}, worth ${total}/month.`,
  settleFirst: (name: string, amount: string) => `Settle ${name}'s ${amount} before renewing.`,
  reliableRenew: (name: string, days: number, beyond: number | null) => `${beyond !== null ? `Just beyond ${beyond} days: ` : ""}${name} (never late) ends in ${days} days — renew early.`,
  renewName: (first: string) => `Renew ${first}`,
  reviewContracts: "Review contracts",
  buildingNone: "No buildings loaded yet.",
  buildingWeakest: (name: string, occ: string, vacant: number, units: number, belowTarget: string | null, share: string) => `${name}. It is the lowest-occupancy building at ${occ} (${vacant} of ${units} units vacant${belowTarget ? `, below the ${belowTarget} target` : ""}) and holds ${share} of all outstanding rent.`,
  buildingSubtitle: (district: string, city: string, score: number) => `${district}, ${city} · score ${score}`,
  longestVacancyValue: (unit: string, days: number, asking: string) => `${unit} · ${days} days · asking ${asking}`,
  buildingRecommendation: (name: string, vacant: number, outstanding: string) => `Push leasing on ${name}'s ${vacant} vacant units and chase its ${outstanding} outstanding — that is where the portfolio is leaking.`,
  openName: (name: string) => `Open ${name}`,
  viewUnit: (unit: string) => `View ${unit}`,
  unitAmbiguous: (unit: string, buildings: string) => `Unit ${unit} exists in ${buildings} — which building?`,
  unitNotFound: (unit: string, scope: string) => `I couldn't find unit ${unit}${scope}.`,
  unitAvailable: (building: string, unit: string, days: number | null, prev: string | null, asking: string) => `${building} ${unit} is available${days !== null ? ` — vacant ${days} days` : ""}${prev ? `; the previous tenant was ${prev}` : ""}. Asking ${asking}/month.`,
  openUnit: "Open unit",
  unitRented: (name: string, building: string, unit: string, br: number, rent: string, contract: string, ends: string, days: number, overdue: string | null) => `${name} rents ${building} ${unit} (${br} BR) for ${rent}/month. Contract ${contract} ends ${ends} — ${days} days away.${overdue ?? " Rent is up to date."}`,
  overdueClause: (amount: string, days: number) => ` ${amount} is overdue (${days} days).`,
  tenantSubtitle: (occupation: string | null, nationality: string, phone: string) => `${occupation ?? "Tenant"} · ${nationality} · ${phone}`,
  unitValue: (building: string, unit: string, size: number) => `${building} · ${unit} · ${size} m²`,
  rentValue: (rent: string, day: number) => `${rent}/month · due the ${day}th`,
  contractValue: (start: string, end: string, days: number) => `${start} → ${end} (${days} days left)`,
  paymentsValue: (paid: string, late: number, onTime: string) => `${paid} paid · ${late} late · ${onTime} on time`,
  noneOnFile: "None on file",
  collectBeforeRenewal: (days: number) => `Collect the overdue rent before deciding the renewal (${days} days left).`,
  renewalDue: (days: number, reliable: boolean) => `Renewal is due in ${days} days${reliable ? " — renew early, never late" : ""}.`,
  recordPayment: "Record payment",
  renewContract: "Renew contract",
  latePayersNone: (min: number, window: number, scope: string) => `No tenant${scope} has been late ${min} or more times in the last ${window} months.`,
  latePayersIntro: (count: number, min: number, window: number, scope: string) => `${count} tenant${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} a repeat late payer (late in ${min}+ of the last ${window} months)${scope}.`,
  lateOf: (late: number, window: number) => `${late} of ${window}`,
  latePayersRecommendation: (name: string) => `Call ${name} and move them to a fixed payment date; consider not renewing without a deposit top-up.`,
  remindName: (first: string) => `Remind ${first}`,
  viewName: (first: string) => `View ${first}`,

  /* ---- demo brain ---- */
  greeting: (owner: string, critical: number, outstanding: string, occ: string) => `Hello ${owner}. ${critical} critical item${critical === 1 ? "" : "s"} today, ${outstanding} outstanding, ${occ} occupied. What would you like to look at?`,
  thanks: "Anytime. Tell me what to look at next.",
  helpText: "Ask me about anything in the portfolio — I read the same data as the screens.",
  helpTitle: "Things I can answer",
  help: [
    ["Money", "who hasn't paid, what's outstanding, what's due this week, deposits held, revenue trend"],
    ["Contracts", "what expires in 30/60/90 days, who to renew early, repeat late payers"],
    ["Buildings", "how is Marina doing, rank the buildings, which building needs attention"],
    ["Units & tenants", "who rents 403 in Beirut Heights, tell me about Karim Daher, which units are vacant"],
    ["Alerts & activity", "what needs attention, any document issues, what changed today"],
  ] as [string, string][],
  overviewText: (buildings: number, units: number, occ: string, delta: string, rentRoll: string, outstanding: string, payments: number, critical: number) => `${buildings} buildings, ${units} units, ${occ} occupied (${delta} pts vs last month). Rent roll ${rentRoll}/month, ${outstanding} outstanding across ${payments} payment${payments === 1 ? "" : "s"}, ${critical} critical alert${critical === 1 ? "" : "s"}.`,
  asOf: (date: string) => `as of ${date}`,
  occupancyValue: (occ: string, occupied: number, units: number) => `${occ} · ${occupied} of ${units} units`,
  unitsValue: (count: number) => `${count} units`,
  revenueDelta: (rev: string, sign: string, delta: string) => `${rev} (${sign}${delta} vs last month)`,
  outstandingValue: (amount: string, payments: number) => `${amount} · ${payments} payments`,
  contractsEndingValue: (d30: number, d60: number) => `${d30} within 30 days · ${d60} within 60`,
  leadsTrails: (best: string, bestOcc: string, worst: string, worstOcc: string) => `${best} leads at ${bestOcc}; ${worst} trails at ${worstOcc} — that is where the upside is.`,
  buildingText: (name: string, occ: string, rented: number, units: number, rentRoll: string, outstandingClause: string, expiring: number, score: number) => `${name}: ${occ} occupied (${rented} of ${units}), ${rentRoll}/month rent roll, ${outstandingClause}, ${expiring} contract${expiring === 1 ? "" : "s"} ending within 60 days. Score ${score}.`,
  outstandingAcross: (amount: string, payments: number) => `${amount} outstanding across ${payments} payment${payments === 1 ? "" : "s"}`,
  nothingOutstanding: "nothing outstanding",
  buildingSubtitleFull: (address: string, district: string, floors: number, upf: number) => `${address}, ${district} · ${floors} floors × ${upf}`,
  occupancyBelowTarget: (occ: string, rented: number, units: number, below: boolean) => `${occ} · ${rented}/${units}${below ? " · below target" : ""}`,
  vacantValue: (count: number, unit: string, days: number) => `${count} · longest ${unit} (${days} days)`,
  outstandingShareValue: (amount: string, share: string) => `${amount} (${share} of portfolio)`,
  more: (count: number) => ` +${count}`,
  chaseFirst: (name: string, amount: string, days: number) => `Chase ${name} first (${amount}, ${days} days).`,
  fillUnit: (unit: string, days: number, asking: string) => `Fill ${unit} — ${days} days empty at ${asking}.`,
  whoHasntPaidIn: (name: string) => `Who hasn't paid in ${name}?`,
  vacantIn: (name: string) => `Which units are vacant in ${name}?`,
  expireIn: (name: string) => `Which contracts expire in ${name}?`,
  unknownBuilding: (names: string) => `I don't know a building by that name. The portfolio has ${names}.`,
  rankingText: (count: number, first: string, firstOcc: string, score: number, last: string, lastOcc: string) => `${count} buildings ranked by occupancy. ${first} leads at ${firstOcc} (score ${score}); ${last} is last at ${lastOcc}.`,
  tenantRents: (name: string, building: string, unit: string, rent: string, contract: string, ends: string, days: number) => `${name} rents ${building} ${unit} for ${rent}/month; contract ${contract} ends ${ends} (${days} days).`,
  tenantOverdue: (amount: string, days: number) => ` ${amount} is overdue (${days} days).`,
  tenantReliable: " Never late — a reliable tenant.",
  tenantLateCount: (late: number) => ` ${late} late payment${late === 1 ? "" : "s"} on record.`,
  tenantFormer: (name: string, place: string | null) => `${name} is a former tenant${place ? ` — last in ${place}` : ""}.`,
  lastIn: (building: string, unit: string, until: string) => `${building} ${unit} until ${until}`,
  unitValueBr: (building: string, unit: string, br: number) => `${building} · ${unit} · ${br} BR`,
  withUsValue: (months: number, contracts: number) => `${months} months · ${contracts} contract${contracts === 1 ? "" : "s"}`,
  openProfile: "Open profile",
  whoElseIn: (name: string) => `Who else is in ${name}?`,
  disambiguate: (count: number) => `I found ${count} tenants with that name — which one?`,
  vacancyNone: (scope: string, minDays: number) => `No vacant units${scope}${minDays > 0 ? ` empty for more than ${minDays} days` : ""}.`,
  vacancyIntro: (count: number, scope: string, minDays: number, potential: string) => `${count} vacant unit${count === 1 ? "" : "s"}${scope || " across the portfolio"}${minDays > 0 ? ` empty for more than ${minDays} days` : ""}, worth ${potential}/month at asking rents. Longest first:`,
  listFirst: (building: string, unit: string, days: number, missed: string) => `List ${building} ${unit} first — ${days} days empty is ${missed} of rent gone.`,
  mostVacancies: (name: string, count: number) => `${name} has the most vacancies (${count}).`,
  revenueText: (scope: string | null, collected: string, month: string, billed: string, trend: string, rentRoll: string | null, dip: string | null) => `${scope ? `${scope} collected` : "Collected"} ${collected} in ${month} against ${billed} billed${trend}.${rentRoll ? ` The rent roll today is ${rentRoll}/month.` : ""}${dip ?? ""}`,
  revenueTrend: (up: boolean, delta: string, prevMonth: string) => ` (${up ? "up" : "down"} ${delta} vs ${prevMonth})`,
  revenueDip: (month: string, drop: string) => ` The dip in ${month} (−${drop}) came from rent paid late that month, which landed the month after.`,
  revenueDipOccupancy: (month: string, drop: string, from: string, to: string) => ` The dip in ${month} (−${drop}) tracks occupancy falling from ${from} to ${to}.`,
  startWith: (title: string) => `Start with: ${title}.`,
  rentRollText: (scope: string, amount: string, units: number) => `The rent roll${scope} is ${amount}/month across ${units} rented unit${units === 1 ? "" : "s"}.`,
  upcomingNone: (label: string, scope: string) => `Nothing falls due ${label}${scope}.`,
  upcomingIntro: (count: number, total: string, label: string, scope: string) => `${count} payment${count === 1 ? "" : "s"} worth ${total} fall due ${label}${scope}.`,
  recordRentOf: (first: string) => `Record ${first}'s rent`,
  windowThisWeek: "this week",
  windowNextDays: (days: number) => `in the next ${days} days`,
  outstandingNoneIn: (name: string) => `Nothing is outstanding in ${name}.`,
  outstandingIn: (amount: string, name: string, payments: number, share: string, total: string) => `${amount} is outstanding in ${name} across ${payments} payment${payments === 1 ? "" : "s"} — ${share} of the portfolio total of ${total}.`,
  outstandingNone: "Nothing is outstanding — every past-due rent is settled.",
  outstandingTotal: (amount: string, payments: number, top: string | null, share: string | null) => `${amount} is outstanding across ${payments} payment${payments === 1 ? "" : "s"}.${top ? ` ${top} holds ${share} of it.` : ""}`,
  depositsText: (total: string, contracts: number, scope: string) => `${total} in deposits is held across ${contracts} active contract${contracts === 1 ? "" : "s"}${scope}.`,
  reliableNone: (scope: string) => `No never-late tenant has a contract ending within 90 days${scope}.`,
  reliableIntro: (count: number) => `${count} reliable tenant${count === 1 ? "" : "s"} (a full year, never late) ${count === 1 ? "has" : "have"} contracts ending within 90 days — lock ${count === 1 ? "them" : "these"} in early.`,
  alertsNone: (label: string, scope: string) => `No ${label}${scope}.`,
  alertsIntro: (count: number, label: string, scope: string) => `${count} ${label}${scope}. Most important first:`,
  alertsLabel: { document: "document alerts", critical: "critical alerts", warning: "warning alerts", open: "open alerts" },
  activityNone: (when: string, paid: number, amount: string) => `Nothing was changed ${when}. ${paid} payment${paid === 1 ? "" : "s"} came in (${amount}).`,
  activityIntro: (count: number, when: string, paid: number, amount: string) => `${count} thing${count === 1 ? "" : "s"} happened ${when}, newest first. ${paid} payment${paid === 1 ? "" : "s"} came in (${amount}).`,
  whenToday: "today",
  whenSince: (date: string) => `since ${date}`,
  whenRecently: "recently",
  tenantsCount: (current: number, buildings: number, former: number) => `${current} current tenants across ${buildings} buildings (${former} former tenants on record).`,
  unknown: "I can't answer that from the portfolio data. I can cover payments, contracts, buildings, units, tenants, vacancies, alerts and what changed — try one of these:",
  heard: (text: string) => `I heard “${text}”.`,
  modelUnreachable: (message: string) => `I couldn't reach the model (${message}). I can still answer from the portfolio data — try one of these:`,
  rateLimited: "The model is rate-limited right now — try again in a few seconds.",
  tooManySteps: "That took too many steps — try a more specific question.",

  v2: {
    cols: { tenant: "Tenant", where: "Building · Unit", amount: "Amount", daysLate: "Days late", ends: "Ends", rent: "Rent", decision: "Decision", building: "Building", occupancy: "Occupancy", vacant: "Vacant", unit: "Unit", days: "Days empty", asking: "Asking", income: "Income", expenses: "Expenses", noi: "NOI", margin: "Margin", maintenance: "Maintenance", jobs: "Jobs", category: "Category", month: "Month", change: "Change", inflow: "In", outflow: "Out", net: "Net", title: "Item", age: "Days open", status: "Status", supplier: "Supplier", service: "Service", asset: "Asset", due: "Due", cost: "Cost", repeat: "Repeat rate", score: "Score", spend: "Spend", date: "Date", collected: "Collected", dueAmount: "Due", rate: "Rate" },
    collection: (month: string, scope: string, rate: string, collected: string, due: string) => `Collection for ${month}${scope}: ${rate} — ${collected} collected of ${due} due.`,
    collectionTrend: (prevRate: string) => ` Last month closed at ${prevRate}.`,
    overdueBeyondNone: (days: number, scope: string) => `Nobody${scope} is more than ${days} days overdue.`,
    overdueBeyond: (count: number, days: number, scope: string, total: string) => `${count} tenant${count === 1 ? "" : "s"}${scope} ${count === 1 ? "is" : "are"} more than ${days} days overdue, owing ${total}.`,
    renewalsNone: (scope: string) => `No renewal is waiting for a decision${scope}.`,
    renewals: (count: number, scope: string, rent: string) => `${count} contract${count === 1 ? "" : "s"}${scope} ${count === 1 ? "is" : "are"} waiting for your renewal decision — ${rent}/month at stake.`,
    lowestOccupancy: (name: string, occ: string, vacant: number, units: number, next: string | null, nextOcc: string) => `${name} has the lowest occupancy at ${occ} (${vacant} of ${units} vacant)${next ? `; next is ${next} at ${nextOcc}` : ""}.`,
    longestVacant: (unit: string, days: number, count: number, scope: string) => `${unit} has been empty longest — ${days} days. ${count} vacant unit${count === 1 ? "" : "s"}${scope}, longest first:`,
    longestVacantNone: (scope: string) => `No vacant units${scope}.`,
    buildingIncome: (name: string, label: string, income: string, expenses: string, noi: string, margin: string) => `${name} ${label}: ${income} rent billed, ${expenses} operating expenses, NOI ${noi} (${margin} margin).`,
    mostProfitable: (name: string, noi: string, margin: string, worst: string, worstNoi: string, label: string) => `${name} is the most profitable ${label} with NOI ${noi} (${margin} margin); ${worst} trails at ${worstNoi}.`,
    unitMaintenance: (unit: string, cost: string, jobs: number, label: string, scope: string) => `${unit} costs the most in maintenance${scope}: ${cost} over ${jobs} job${jobs === 1 ? "" : "s"} ${label}.`,
    unitMaintenanceNone: (scope: string) => `No maintenance cost recorded${scope}.`,
    categorySpend: (category: string, label: string, amount: string, count: number, scope: string, top: string | null) => `${amount} on ${category} ${label}${scope} across ${count} expense${count === 1 ? "" : "s"}${top ? ` — most of it in ${top}` : ""}.`,
    categoriesUp: (count: number, month: string, prev: string) => `${count} categor${count === 1 ? "y" : "ies"} cost more in ${month} than in ${prev}:`,
    categoriesUpNone: (month: string, prev: string) => `No expense category rose in ${month} versus ${prev}.`,
    cashflow: (days: number, inflow: string, outflow: string, net: string, risk: string | null) => `Next ${days} days: ${inflow} expected in, ${outflow} going out — net ${net}${risk ? `, with ${risk} of rent depending on renewals` : ""}. An estimate from the schedule, open invoices and recurring costs.`,
    maintenanceOverdue: (count: number, scope: string, oldest: string, days: number) => `${count} maintenance job${count === 1 ? "" : "s"}${scope} ${count === 1 ? "is" : "are"} overdue; the oldest is "${oldest}" at ${days} days.`,
    maintenanceOverdueNone: (scope: string) => `No maintenance job${scope} is overdue.`,
    maintenanceOpen: (count: number, scope: string, oldest: string, days: number) => `${count} maintenance job${count === 1 ? " is" : "s are"} open${scope}; the oldest is "${oldest}" at ${days} days.`,
    maintenanceOpenNone: (scope: string) => `No maintenance job${scope} is open.`,
    repeatIssues: (count: number, category: string, windowDays: number) => `${count} unit${count === 1 ? "" : "s"} had repeated ${category} problems in the last ${windowDays} days:`,
    repeatIssuesNone: (category: string, windowDays: number) => `No unit had repeated ${category} problems in the last ${windowDays} days.`,
    assetsDue: (count: number, days: number, cost: string) => `${count} service${count === 1 ? "" : "s"} due within ${days} days, about ${cost}:`,
    assetsDueNone: (days: number) => `No preventive service is due within ${days} days.`,
    suppliers: (name: string, rate: string, jobs: number, best: string | null) => `${name} has the highest repeat-issue rate: ${rate} of ${jobs} jobs came back${best ? `; ${best} has the cleanest record` : ""}.`,
    suppliersNone: "No supplier has enough completed jobs to compare yet.",
    supplierPaid: (name: string, label: string, amount: string, count: number) => `${name}: ${amount} paid ${label} across ${count} expense${count === 1 ? "" : "s"}.`,
    briefing: (headline: string) => `Today's briefing: ${headline}`,
    reminderOffer: (label: string) => `I can set a reminder about ${label} — pick the date and note in the form.`,
    workOrderOffer: (where: string) => `I've prepared a work order for ${where} — review and save it.`,
    labels: { decide: "Decide", renew: "Renew", open: "Open", logService: "Log service", approve: "Approve", remind: "Set reminder", createWo: "Create work order", briefing: "Open briefing", cashflow: "Open cash flow", suppliers: "Suppliers", rentRoll: "Rent roll", openForm: "Open form" },
    thisYear: "this year",
    lastYear: "last year",
    last12: "over the last 12 months",
    entryPrepared: (what: string) => `I've opened a new ${what} form with what I understood — check it and save.`,
    entryWhat: { building: "building", unit: "unit", tenant: "tenant", contract: "contract", asset: "asset", expense: "expense", supplier: "supplier" },
    entryUnknownBuilding: (name: string) => ` I couldn't find a building called “${name}” — pick it in the form.`,
    entryNoBuilding: " Pick the building in the form.",
    entryUnknownTenant: (name: string) => ` I couldn't find a tenant called “${name}” — pick them in the form.`,
    entryUnknownUnit: (unit: string, building: string) => ` There is no unit ${unit} in ${building} — pick the unit in the form.`,
    entryUnitOccupied: (unit: string) => ` Note: unit ${unit} is occupied right now.`,
    entryFields: { field: "Field", value: "Understood as", name: "Name", floors: "Floors", perFloor: "Units per floor", city: "City", building: "Building", unit: "Unit", floor: "Floor", bedrooms: "Bedrooms", bathrooms: "Bathrooms", size: "Size", rent: "Rent", deposit: "Deposit", tenant: "Tenant", phone: "Phone", email: "Email", start: "Start", months: "Months", type: "Type", brand: "Brand", model: "Model", serial: "Serial", cost: "Cost", amount: "Amount", category: "Category", description: "Description", supplier: "Supplier", date: "Date", company: "Company" },
    ytd: "year to date",
  },

  suggestions: {
    attention: "What needs my attention today?",
    unpaid: "Who hasn't paid this month?",
    expiring: "Which contracts expire in the next 30 days?",
    building: "Which building needs attention?",
    whoRents: "Who is renting 403 in Beirut Heights?",
    latePayers: "Which tenants regularly pay late?",
    vacant: "Which units are vacant?",
    portfolio: "How is the portfolio doing?",
    rank: "Rank the buildings",
    renewEarly: "Who should I renew early?",
  },

  spoken: {
    dollars: (amount: string) => `${amount} dollars`,
    recommendation: (text: string) => `Recommendation: ${text}`,
    listed: (count: number) => `I've listed ${count} ${count === 1 ? "item" : "items"} on screen.`,
  },

  ui: {
    listening: "Listening…",
    speakNow: "speak now — pause when you're done, say “stop” to end",
    speaking: "Speaking…",
    interrupt: "tap the mic to interrupt — I'll listen again when I finish",
    tapToTalk: "Tap to talk",
    noArabicVoice: "No Arabic voice is installed in this browser.",
    noArabicVoiceHint: "The answer is on screen. Microsoft Edge has Arabic voices built in, or add Arabic text-to-speech in Windows language settings.",
    listeningPause: "Listening… pause when you're done",
    placeholder: "Ask anything about the portfolio…",
    placeholderScoped: (name: string) => `Ask about ${name}…`,
    placeholderListening: "Listening… speak now",
  },
};

export type Strings = typeof en;

const rooms = (br: number | string) => {
  const k = Number(br);
  return k === 1 ? "غرفة واحدة" : k === 2 ? "غرفتان" : `${br} غرف`;
};

export const ar: Strings = {
  date: (iso) => arDate.format(new Date(`${iso.slice(0, 10)}T12:00:00`)),
  month: (period) => arMonth.format(new Date(`${period}-01T12:00:00`)),
  money: (v) => formatMoney(v),
  pct: (v) => formatPercent(v),
  days: (d) => `${d} ${n(d, "يوم", "يومين", "أيام", "يوم")}`,
  scopeIn: (name) => (name ? ` في ${name}` : ""),
  none: "لا شيء",
  dash: "—",
  partial: "جزئي",
  alsoOverdue: (amount) => `متأخر أيضاً (${amount})`,
  reliableNote: "موثوق — جدّد له باكراً",
  formerTenant: "مستأجر سابق",
  paidUp: "مسدّد",
  overdueNow: (amount) => `متأخر · ${amount}`,
  yes: "نعم",
  no: "لا",

  cols: {
    num: "#",
    item: "البند",
    detail: "التفاصيل",
    tenant: "المستأجر",
    buildingUnit: "المبنى · الشقة",
    period: "الشهر",
    outstanding: "المتبقي",
    daysOverdue: "أيام التأخير",
    ends: "ينتهي",
    days: "الأيام",
    rent: "الإيجار",
    note: "ملاحظة",
    late: "تأخير",
    avgDaysLate: "متوسط أيام التأخير",
    now: "الآن",
    building: "المبنى",
    occupancy: "الإشغال",
    units: "الشقق",
    revenueMo: "الإيراد الشهري",
    score: "التقييم",
    daysVacant: "أيام الشغور",
    asking: "الإيجار المطلوب",
    previousTenant: "المستأجر السابق",
    rentMissed: "إيجار ضائع",
    month: "الشهر",
    billed: "المستحق",
    collected: "المحصّل",
    due: "الاستحقاق",
    amount: "المبلغ",
    depositsHeld: "التأمينات",
    severity: "الخطورة",
    alert: "التنبيه",
    when: "متى",
    what: "ماذا",
    by: "بواسطة",
    phone: "الهاتف",
    payments: "الدفعات",
    share: "الحصة",
    portfolio: "المحفظة",
  },

  fields: {
    unit: "الشقة",
    rent: "الإيجار",
    contract: "العقد",
    payments: "الدفعات",
    outstanding: "المتبقي",
    documents: "المستندات",
    withUs: "معنا منذ",
    occupancy: "الإشغال",
    available: "شاغر",
    monthlyRevenue: "الإيراد الشهري",
    contractsEnding: "عقود تنتهي",
    criticalAlerts: "تنبيهات حرجة",
    vacant: "شاغر",
    revenuePerMonth: "الإيراد / شهر",
    ending60: "تنتهي خلال 60 يوم",
    vacantUnits: "شقق شاغرة",
    longestVacancy: "أطول شغور",
    contractsEnding30: "عقود تنتهي خلال 30 يوم",
  },

  attentionNone: (scope) => `لا يوجد شيء حرج${scope} حالياً.`,
  attentionIntro: (count, scope) => `${count} ${n(count, "بند حرج", "بندان حرجان", "بنود حرجة", "بند حرج")}${scope} بحاجة إلى قرار اليوم. مرتبة حسب المبلغ والوقت:`,
  unpaidNone: (scope) => `الجميع${scope} مسدّدون.`,
  unpaidIntro: (tenants, scope, total, payments) => `${tenants} ${n(tenants, "مستأجر", "مستأجران", "مستأجرين", "مستأجر")}${scope} عليهم ${total} في ${payments} ${n(payments, "دفعة", "دفعتين", "دفعات", "دفعة")}. الأكثر تأخيراً أولاً:`,
  unpaidRecommendation: (name, days) => `ابدأ بـ${name} (${days} يوم) — ثم كل من ينتهي عقده قريباً أيضاً.`,
  recordPaymentOf: (first) => `تسجيل دفعة ${first}`,
  expiringNone: (days, scope) => `لا توجد عقود تنتهي خلال ${days} يوم${scope}.`,
  expiringIntro: (count, days, scope, total) => `${count} ${n(count, "عقد ينتهي", "عقدان ينتهيان", "عقود تنتهي", "عقد ينتهي")} خلال ${days} يوم${scope}، بقيمة ${total} شهرياً.`,
  settleFirst: (name, amount) => `حصّل ${amount} من ${name} قبل التجديد.`,
  reliableRenew: (name, days, beyond) => `${beyond !== null ? `بعد ${beyond} يوم بقليل: ` : ""}${name} (لم يتأخر أبداً) ينتهي عقده خلال ${days} يوم — جدّد له باكراً.`,
  renewName: (first) => `تجديد ${first}`,
  reviewContracts: "مراجعة العقود",
  buildingNone: "لا توجد مبانٍ محمّلة بعد.",
  buildingWeakest: (name, occ, vacant, units, belowTarget, share) => `${name}. هو المبنى الأقل إشغالاً بنسبة ${occ} (${vacant} من ${units} شقة شاغرة${belowTarget ? `، دون الهدف ${belowTarget}` : ""}) ويحمل ${share} من كل الإيجارات المتأخرة.`,
  buildingSubtitle: (district, city, score) => `${district}، ${city} · التقييم ${score}`,
  longestVacancyValue: (unit, days, asking) => `${unit} · ${days} يوم · المطلوب ${asking}`,
  buildingRecommendation: (name, vacant, outstanding) => `ركّز على تأجير الشقق الـ${vacant} الشاغرة في ${name} وتحصيل ${outstanding} المتأخرة — هنا تتسرب أموال المحفظة.`,
  openName: (name) => `فتح ${name}`,
  viewUnit: (unit) => `عرض ${unit}`,
  unitAmbiguous: (unit, buildings) => `الشقة ${unit} موجودة في ${buildings} — أي مبنى تقصد؟`,
  unitNotFound: (unit, scope) => `لم أجد الشقة ${unit}${scope}.`,
  unitAvailable: (building, unit, days, prev, asking) => `${building} ${unit} شاغرة${days !== null ? ` — منذ ${days} يوم` : ""}${prev ? `؛ المستأجر السابق ${prev}` : ""}. الإيجار المطلوب ${asking} شهرياً.`,
  openUnit: "فتح الشقة",
  unitRented: (name, building, unit, br, rent, contract, ends, days, overdue) => `الشقة ${unit} في ${building} مستأجرة باسم ${name} (${rooms(br)}) بـ${rent} شهرياً. العقد ${contract} ينتهي في ${ends} — بعد ${days} يوم.${overdue ?? " الإيجار مسدّد."}`,
  overdueClause: (amount, days) => ` ${amount} متأخرة (${days} يوم).`,
  tenantSubtitle: (occupation, nationality, phone) => `${occupation ?? "مستأجر"} · ${nationality} · ${phone}`,
  unitValue: (building, unit, size) => `${building} · ${unit} · ${size} م²`,
  rentValue: (rent, day) => `${rent} شهرياً · يستحق يوم ${day}`,
  contractValue: (start, end, days) => `${start} ← ${end} (باقي ${days} يوم)`,
  paymentsValue: (paid, late, onTime) => `${paid} مدفوعة · ${late} تأخير · ${onTime} في الوقت`,
  noneOnFile: "لا شيء في الملف",
  collectBeforeRenewal: (days) => `حصّل الإيجار المتأخر قبل قرار التجديد (باقي ${days} يوم).`,
  renewalDue: (days, reliable) => `التجديد مستحق خلال ${days} يوم${reliable ? " — جدّد باكراً، لم يتأخر أبداً" : ""}.`,
  recordPayment: "تسجيل دفعة",
  renewContract: "تجديد العقد",
  latePayersNone: (min, window, scope) => `لا يوجد مستأجر${scope} تأخر ${min} مرات أو أكثر خلال آخر ${window} أشهر.`,
  latePayersIntro: (count, min, window, scope) => `${count} ${n(count, "مستأجر", "مستأجران", "مستأجرين", "مستأجر")} ${n(count, "يتأخر", "يتأخران", "يتأخرون", "يتأخرون")} بشكل متكرر (تأخير في ${min}+ من آخر ${window} أشهر)${scope}.`,
  lateOf: (late, window) => `${late} من ${window}`,
  latePayersRecommendation: (name) => `اتصل بـ${name} وثبّت له موعد دفع محدد؛ فكّر بعدم التجديد دون زيادة التأمين.`,
  remindName: (first) => `تذكير ${first}`,
  viewName: (first) => `عرض ${first}`,

  greeting: (owner, critical, outstanding, occ) => `أهلاً ${owner}. ${critical} ${n(critical, "بند حرج", "بندان حرجان", "بنود حرجة", "بند حرج")} اليوم، ${outstanding} متأخرة، الإشغال ${occ}. ماذا تريد أن ترى؟`,
  thanks: "على الرحب. قل لي ماذا تريد أن ترى بعد.",
  helpText: "اسألني عن أي شيء في المحفظة — أقرأ نفس البيانات التي تراها على الشاشات.",
  helpTitle: "ما يمكنني الإجابة عنه",
  help: [
    ["المال", "من لم يدفع، كم المتبقي، ما المستحق هذا الأسبوع، التأمينات، اتجاه الإيرادات"],
    ["العقود", "ما ينتهي خلال 30/60/90 يوم، من أجدّد له باكراً، المتأخرون بشكل متكرر"],
    ["المباني", "كيف وضع مارينا، رتّب المباني، أي مبنى بحاجة لانتباه"],
    ["الشقق والمستأجرون", "من يسكن في 403 بيروت هايتس، خبّرني عن كريم ضاهر، أي شقق شاغرة"],
    ["التنبيهات والنشاط", "ما يحتاج انتباهي، مشاكل مستندات، ماذا تغيّر اليوم"],
  ],
  overviewText: (buildings, units, occ, delta, rentRoll, outstanding, payments, critical) => `${buildings} مبانٍ، ${units} شقة، الإشغال ${occ} (${delta} نقطة عن الشهر الماضي). الإيجار الشهري ${rentRoll}، ${outstanding} متأخرة في ${payments} ${n(payments, "دفعة", "دفعتين", "دفعات", "دفعة")}، ${critical} ${n(critical, "تنبيه حرج", "تنبيهان حرجان", "تنبيهات حرجة", "تنبيه حرج")}.`,
  asOf: (date) => `بتاريخ ${date}`,
  occupancyValue: (occ, occupied, units) => `${occ} · ${occupied} من ${units} شقة`,
  unitsValue: (count) => `${count} شقة`,
  revenueDelta: (rev, sign, delta) => `${rev} (${sign}${delta} عن الشهر الماضي)`,
  outstandingValue: (amount, payments) => `${amount} · ${payments} دفعة`,
  contractsEndingValue: (d30, d60) => `${d30} خلال 30 يوم · ${d60} خلال 60`,
  leadsTrails: (best, bestOcc, worst, worstOcc) => `${best} في الصدارة بـ${bestOcc}؛ ${worst} في المؤخرة بـ${worstOcc} — هنا فرصة التحسين.`,
  buildingText: (name, occ, rented, units, rentRoll, outstandingClause, expiring, score) => `${name}: الإشغال ${occ} (${rented} من ${units})، الإيجار الشهري ${rentRoll}، ${outstandingClause}، ${expiring} ${n(expiring, "عقد ينتهي", "عقدان ينتهيان", "عقود تنتهي", "عقد ينتهي")} خلال 60 يوم. التقييم ${score}.`,
  outstandingAcross: (amount, payments) => `${amount} متأخرة في ${payments} ${n(payments, "دفعة", "دفعتين", "دفعات", "دفعة")}`,
  nothingOutstanding: "لا متأخرات",
  buildingSubtitleFull: (address, district, floors, upf) => `${address}، ${district} · ${floors} طوابق × ${upf}`,
  occupancyBelowTarget: (occ, rented, units, below) => `${occ} · ${rented}/${units}${below ? " · دون الهدف" : ""}`,
  vacantValue: (count, unit, days) => `${count} · الأطول ${unit} (${days} يوم)`,
  outstandingShareValue: (amount, share) => `${amount} (${share} من المحفظة)`,
  more: (count) => ` +${count}`,
  chaseFirst: (name, amount, days) => `ابدأ بـ${name} (${amount}، ${days} يوم).`,
  fillUnit: (unit, days, asking) => `أجّر ${unit} — شاغرة منذ ${days} يوم بـ${asking}.`,
  whoHasntPaidIn: (name) => `من لم يدفع في ${name}؟`,
  vacantIn: (name) => `ما الشقق الشاغرة في ${name}؟`,
  expireIn: (name) => `ما العقود التي تنتهي في ${name}؟`,
  unknownBuilding: (names) => `لا أعرف مبنى بهذا الاسم. المحفظة تضم ${names}.`,
  rankingText: (count, first, firstOcc, score, last, lastOcc) => `${count} مبانٍ مرتبة حسب الإشغال. ${first} في الصدارة بـ${firstOcc} (التقييم ${score})؛ ${last} في المؤخرة بـ${lastOcc}.`,
  tenantRents: (name, building, unit, rent, contract, ends, days) => `${name} في ${building} ${unit} بإيجار ${rent} شهرياً؛ العقد ${contract} ينتهي في ${ends} (${days} يوم).`,
  tenantOverdue: (amount, days) => ` ${amount} متأخرة (${days} يوم).`,
  tenantReliable: " لم يتأخر أبداً — مستأجر موثوق.",
  tenantLateCount: (late) => ` ${late} ${n(late, "دفعة متأخرة", "دفعتان متأخرتان", "دفعات متأخرة", "دفعة متأخرة")} في السجل.`,
  tenantFormer: (name, place) => `${name} مستأجر سابق${place ? ` — آخر سكن في ${place}` : ""}.`,
  lastIn: (building, unit, until) => `${building} ${unit} حتى ${until}`,
  unitValueBr: (building, unit, br) => `${building} · ${unit} · ${rooms(br)}`,
  withUsValue: (months, contracts) => `${months} شهر · ${contracts} ${n(contracts, "عقد", "عقدان", "عقود", "عقد")}`,
  openProfile: "فتح الملف",
  whoElseIn: (name) => `من أيضاً في ${name}؟`,
  disambiguate: (count) => `وجدت ${count} مستأجرين بهذا الاسم — أيهم تقصد؟`,
  vacancyNone: (scope, minDays) => `لا شقق شاغرة${scope}${minDays > 0 ? ` منذ أكثر من ${minDays} يوم` : ""}.`,
  vacancyIntro: (count, scope, minDays, potential) => `${count} ${n(count, "شقة شاغرة", "شقتان شاغرتان", "شقق شاغرة", "شقة شاغرة")}${scope || " في كل المحفظة"}${minDays > 0 ? ` منذ أكثر من ${minDays} يوم` : ""}، بقيمة ${potential} شهرياً حسب الإيجار المطلوب. الأطول أولاً:`,
  listFirst: (building, unit, days, missed) => `اعرض ${building} ${unit} أولاً — ${days} يوم شغور تعني ${missed} إيجار ضائع.`,
  mostVacancies: (name, count) => `${name} فيه أكبر عدد من الشقق الشاغرة (${count}).`,
  revenueText: (scope, collected, month, billed, trend, rentRoll, dip) => `${scope ? `حصّل ${scope}` : "حصّلنا"} ${collected} في ${month} مقابل ${billed} مستحقة${trend}.${rentRoll ? ` الإيجار الشهري اليوم ${rentRoll}.` : ""}${dip ?? ""}`,
  revenueTrend: (up, delta, prevMonth) => ` (${up ? "زيادة" : "انخفاض"} ${delta} عن ${prevMonth})`,
  revenueDip: (month, drop) => ` الانخفاض في ${month} (−${drop}) سببه إيجارات دُفعت متأخرة ذلك الشهر ووصلت في الشهر التالي.`,
  revenueDipOccupancy: (month, drop, from, to) => ` الانخفاض في ${month} (−${drop}) يعكس تراجع الإشغال من ${from} إلى ${to}.`,
  startWith: (title) => `ابدأ بـ: ${title}.`,
  rentRollText: (scope, amount, units) => `الإيجار الشهري${scope} ${amount} من ${units} ${n(units, "شقة مؤجرة", "شقتين مؤجرتين", "شقق مؤجرة", "شقة مؤجرة")}.`,
  upcomingNone: (label, scope) => `لا شيء يستحق ${label}${scope}.`,
  upcomingIntro: (count, total, label, scope) => `${count} ${n(count, "دفعة", "دفعتان", "دفعات", "دفعة")} بقيمة ${total} تستحق ${label}${scope}.`,
  recordRentOf: (first) => `تسجيل إيجار ${first}`,
  windowThisWeek: "هذا الأسبوع",
  windowNextDays: (days) => `خلال ${days} يوم`,
  outstandingNoneIn: (name) => `لا متأخرات في ${name}.`,
  outstandingIn: (amount, name, payments, share, total) => `${amount} متأخرة في ${name} في ${payments} ${n(payments, "دفعة", "دفعتين", "دفعات", "دفعة")} — ${share} من إجمالي المحفظة البالغ ${total}.`,
  outstandingNone: "لا متأخرات — كل الإيجارات المستحقة مسدّدة.",
  outstandingTotal: (amount, payments, top, share) => `${amount} متأخرة في ${payments} ${n(payments, "دفعة", "دفعتين", "دفعات", "دفعة")}.${top ? ` ${top} يحمل ${share} منها.` : ""}`,
  depositsText: (total, contracts, scope) => `${total} تأمينات محتفظ بها عبر ${contracts} ${n(contracts, "عقد فعّال", "عقدين فعّالين", "عقود فعّالة", "عقد فعّال")}${scope}.`,
  reliableNone: (scope) => `لا يوجد مستأجر لم يتأخر أبداً وينتهي عقده خلال 90 يوم${scope}.`,
  reliableIntro: (count) => `${count} ${n(count, "مستأجر موثوق", "مستأجران موثوقان", "مستأجرين موثوقين", "مستأجر موثوق")} (سنة كاملة دون تأخير) تنتهي عقودهم خلال 90 يوم — جدّد لهم باكراً.`,
  alertsNone: (label, scope) => `لا ${label}${scope}.`,
  alertsIntro: (count, label, scope) => `${count} ${label}${scope}. الأهم أولاً:`,
  alertsLabel: { document: "تنبيهات مستندات", critical: "تنبيهات حرجة", warning: "تحذيرات", open: "تنبيهات مفتوحة" },
  activityNone: (when, paid, amount) => `لم يتغير شيء ${when}. وصلت ${paid} ${n(paid, "دفعة", "دفعتان", "دفعات", "دفعة")} (${amount}).`,
  activityIntro: (count, when, paid, amount) => `${count} ${n(count, "حدث", "حدثان", "أحداث", "حدث")} ${when}، الأحدث أولاً. وصلت ${paid} ${n(paid, "دفعة", "دفعتان", "دفعات", "دفعة")} (${amount}).`,
  whenToday: "اليوم",
  whenSince: (date) => `منذ ${date}`,
  whenRecently: "مؤخراً",
  tenantsCount: (current, buildings, former) => `${current} مستأجر حالي في ${buildings} مبانٍ (${former} مستأجر سابق في السجل).`,
  unknown: "لا أستطيع الإجابة عن ذلك من بيانات المحفظة. أستطيع الإجابة عن الدفعات والعقود والمباني والشقق والمستأجرين والشواغر والتنبيهات وما تغيّر — جرّب إحدى هذه:",
  heard: (text) => `سمعت «${text}».`,
  modelUnreachable: (message) => `تعذّر الوصول إلى النموذج (${message}). ما زلت أستطيع الإجابة من بيانات المحفظة — جرّب إحدى هذه:`,
  rateLimited: "النموذج مشغول حالياً — حاول بعد ثوانٍ.",
  tooManySteps: "استغرق ذلك خطوات كثيرة — جرّب سؤالاً أكثر تحديداً.",

  v2: {
    cols: { tenant: "المستأجر", where: "المبنى · الشقة", amount: "المبلغ", daysLate: "أيام التأخير", ends: "ينتهي", rent: "الإيجار", decision: "القرار", building: "المبنى", occupancy: "الإشغال", vacant: "شاغرة", unit: "الشقة", days: "أيام الشغور", asking: "المطلوب", income: "الدخل", expenses: "المصاريف", noi: "صافي الدخل", margin: "الهامش", maintenance: "الصيانة", jobs: "الأعمال", category: "الفئة", month: "الشهر", change: "التغيّر", inflow: "داخل", outflow: "خارج", net: "الصافي", title: "البند", age: "أيام مفتوح", status: "الحالة", supplier: "المورد", service: "الخدمة", asset: "الأصل", due: "الاستحقاق", cost: "الكلفة", repeat: "نسبة التكرار", score: "التقييم", spend: "الإنفاق", date: "التاريخ", collected: "المحصّل", dueAmount: "المستحق", rate: "النسبة" },
    collection: (month, scope, rate, collected, due) => `نسبة التحصيل لشهر ${month}${scope}: ${rate} — حُصّل ${collected} من أصل ${due}.`,
    collectionTrend: (prevRate) => ` الشهر الماضي أُقفل على ${prevRate}.`,
    overdueBeyondNone: (days, scope) => `لا أحد${scope} متأخر أكثر من ${days} يوم.`,
    overdueBeyond: (count, days, scope, total) => `${count} ${count === 1 ? "مستأجر" : "مستأجرين"}${scope} متأخرون أكثر من ${days} يوم، وعليهم ${total}.`,
    renewalsNone: (scope) => `لا يوجد تجديد بانتظار قرار${scope}.`,
    renewals: (count, scope, rent) => `${count} ${count === 1 ? "عقد" : "عقود"}${scope} بانتظار قرارك بالتجديد — ${rent} شهرياً على المحك.`,
    lowestOccupancy: (name, occ, vacant, units, next, nextOcc) => `${name} هو الأقل إشغالاً بنسبة ${occ} (${vacant} من ${units} شاغرة)${next ? `؛ يليه ${next} بنسبة ${nextOcc}` : ""}.`,
    longestVacant: (unit, days, count, scope) => `${unit} هي الأطول شغوراً — ${days} يوم. ${count} ${count === 1 ? "شقة شاغرة" : "شقق شاغرة"}${scope}، الأطول أولاً:`,
    longestVacantNone: (scope) => `لا شقق شاغرة${scope}.`,
    buildingIncome: (name, label, income, expenses, noi, margin) => `${name} ${label}: ${income} إيجارات مستحقة، ${expenses} مصاريف تشغيلية، صافي الدخل ${noi} (هامش ${margin}).`,
    mostProfitable: (name, noi, margin, worst, worstNoi, label) => `${name} هو الأكثر ربحية ${label} بصافي دخل ${noi} (هامش ${margin})؛ ${worst} الأدنى بـ${worstNoi}.`,
    unitMaintenance: (unit, cost, jobs, label, scope) => `${unit} الأعلى كلفة صيانة${scope}: ${cost} على ${jobs} ${jobs === 1 ? "عمل" : "أعمال"} ${label}.`,
    unitMaintenanceNone: (scope) => `لا كلفة صيانة مسجّلة${scope}.`,
    categorySpend: (category, label, amount, count, scope, top) => `${amount} على ${category} ${label}${scope} عبر ${count} ${count === 1 ? "مصروف" : "مصاريف"}${top ? ` — معظمها في ${top}` : ""}.`,
    categoriesUp: (count, month, prev) => `${count} ${count === 1 ? "فئة كلّفت" : "فئات كلّفت"} أكثر في ${month} مقارنة بـ${prev}:`,
    categoriesUpNone: (month, prev) => `لم ترتفع أي فئة مصاريف في ${month} مقارنة بـ${prev}.`,
    cashflow: (days, inflow, outflow, net, risk) => `خلال ${days} يوم القادمة: ${inflow} متوقع دخولها، ${outflow} خارجة — الصافي ${net}${risk ? `، منها ${risk} إيجارات تعتمد على التجديد` : ""}. تقدير من جدول الدفعات والفواتير المفتوحة والمصاريف المتكررة.`,
    maintenanceOverdue: (count, scope, oldest, days) => `${count} ${count === 1 ? "عمل صيانة" : "أعمال صيانة"}${scope} متأخرة؛ الأقدم «${oldest}» منذ ${days} يوم.`,
    maintenanceOverdueNone: (scope) => `لا أعمال صيانة متأخرة${scope}.`,
    maintenanceOpen: (count, scope, oldest, days) => `${count} ${count === 1 ? "عمل صيانة مفتوح" : "أعمال صيانة مفتوحة"}${scope}؛ الأقدم «${oldest}» منذ ${days} يوم.`,
    maintenanceOpenNone: (scope) => `لا أعمال صيانة مفتوحة${scope}.`,
    repeatIssues: (count, category, windowDays) => `${count} ${count === 1 ? "شقة" : "شقق"} تكررت فيها مشاكل ${category} خلال آخر ${windowDays} يوم:`,
    repeatIssuesNone: (category, windowDays) => `لم تتكرر مشاكل ${category} في أي شقة خلال آخر ${windowDays} يوم.`,
    assetsDue: (count, days, cost) => `${count} ${count === 1 ? "خدمة" : "خدمات"} مستحقة خلال ${days} يوم، بنحو ${cost}:`,
    assetsDueNone: (days) => `لا خدمة وقائية مستحقة خلال ${days} يوم.`,
    suppliers: (name, rate, jobs, best) => `${name} لديه أعلى نسبة تكرار للأعطال: ${rate} من ${jobs} عملاً عادت${best ? `؛ ${best} صاحب السجل الأنظف` : ""}.`,
    suppliersNone: "لا يوجد مورد لديه أعمال منجزة كافية للمقارنة بعد.",
    supplierPaid: (name, label, amount, count) => `${name}: دُفع ${amount} ${label} عبر ${count} ${count === 1 ? "مصروف" : "مصاريف"}.`,
    briefing: (headline) => `ملخص اليوم: ${headline}`,
    reminderOffer: (label) => `أستطيع ضبط تذكير بخصوص ${label} — اختر التاريخ والملاحظة في النموذج.`,
    workOrderOffer: (where) => `جهّزت أمر عمل لـ${where} — راجعه واحفظه.`,
    labels: { decide: "قرّر", renew: "جدّد", open: "افتح", logService: "سجّل الخدمة", approve: "وافق", remind: "ضبط تذكير", createWo: "إنشاء أمر عمل", briefing: "افتح الملخص", cashflow: "افتح التدفق النقدي", suppliers: "الموردون", rentRoll: "جدول الإيجارات", openForm: "افتح النموذج" },
    thisYear: "هذه السنة",
    lastYear: "السنة الماضية",
    last12: "خلال آخر 12 شهراً",
    entryPrepared: (what) => `فتحت نموذج ${what} جديد بما فهمته — راجعه واحفظه.`,
    entryWhat: { building: "مبنى", unit: "شقة", tenant: "مستأجر", contract: "عقد", asset: "أصل", expense: "مصروف", supplier: "مورد" },
    entryUnknownBuilding: (name) => ` لم أجد مبنى باسم «${name}» — اختره في النموذج.`,
    entryNoBuilding: " اختر المبنى في النموذج.",
    entryUnknownTenant: (name) => ` لم أجد مستأجراً باسم «${name}» — اختره في النموذج.`,
    entryUnknownUnit: (unit, building) => ` لا توجد شقة ${unit} في ${building} — اختر الشقة في النموذج.`,
    entryUnitOccupied: (unit) => ` ملاحظة: الشقة ${unit} مشغولة حالياً.`,
    entryFields: { field: "الحقل", value: "ما فهمته", name: "الاسم", floors: "الطوابق", perFloor: "شقق لكل طابق", city: "المدينة", building: "المبنى", unit: "الشقة", floor: "الطابق", bedrooms: "غرف النوم", bathrooms: "الحمامات", size: "المساحة", rent: "الإيجار", deposit: "التأمين", tenant: "المستأجر", phone: "الهاتف", email: "البريد", start: "البداية", months: "الأشهر", type: "النوع", brand: "الماركة", model: "الموديل", serial: "الرقم التسلسلي", cost: "الكلفة", amount: "المبلغ", category: "الفئة", description: "الوصف", supplier: "المورد", date: "التاريخ", company: "الشركة" },
    ytd: "منذ بداية السنة",
  },

  suggestions: {
    attention: "شو لازم انتبه له اليوم؟",
    unpaid: "مين ما دفع هالشهر؟",
    expiring: "أي عقود بتنتهي خلال 30 يوم؟",
    building: "أي مبنى بحاجة لانتباه؟",
    whoRents: "مين ساكن بـ403 بيروت هايتس؟",
    latePayers: "مين المستأجرين اللي دايماً بيتأخروا؟",
    vacant: "شو الشقق الفاضية؟",
    portfolio: "كيف وضع المحفظة؟",
    rank: "رتّب المباني",
    renewEarly: "لمين لازم جدّد بكير؟",
  },

  spoken: {
    dollars: (amount) => `${amount} دولار`,
    recommendation: (text) => `التوصية: ${text}`,
    listed: (count) => `عرضت ${count} ${n(count, "بند", "بندين", "بنود", "بند")} على الشاشة.`,
  },

  ui: {
    listening: "أسمعك…",
    speakNow: "تكلم الآن — توقف قليلاً عندما تنتهي، قل «وقف» للإنهاء",
    speaking: "أتكلم…",
    interrupt: "اضغط الميكروفون للمقاطعة — سأسمعك مجدداً عندما أنتهي",
    tapToTalk: "اضغط وتكلم",
    noArabicVoice: "لا يوجد صوت عربي مثبّت في هذا المتصفح.",
    noArabicVoiceHint: "الجواب على الشاشة. متصفح Microsoft Edge يتضمن أصواتاً عربية، أو أضف صوت النطق العربي من إعدادات اللغة في ويندوز.",
    listeningPause: "أسمعك… توقف عندما تنتهي",
    placeholder: "اسأل عن أي شيء في المحفظة…",
    placeholderScoped: (name) => `اسأل عن ${name}…`,
    placeholderListening: "أسمعك… تكلم الآن",
  },
};

export function strings(lang: Lang): Strings {
  return lang === "ar" ? ar : en;
}

/* ------------------------- Alerts in the answer language ------------------ */

/** Alert titles/messages are generated in English; rebuild the common ones in Arabic from the store. */
export function localizeAlert(alert: Alert, store: Store, lang: Lang): { title: string; message: string } {
  if (lang === "en") return { title: alert.title, message: alert.message };
  const idx = indexStore(store);
  const s = ar;
  const tenant = alert.tenantId ? idx.tenantById.get(alert.tenantId) : undefined;
  const unit = alert.unitId ? idx.unitById.get(alert.unitId) : undefined;
  const property = alert.propertyId ? idx.propertyById.get(alert.propertyId) : undefined;
  const where = unit && property ? `${property.name} · ${unit.unitNumber}` : property?.name ?? "";
  const name = tenant?.fullName ?? "";

  switch (alert.type) {
    case "payment_overdue": {
      const p = idx.paymentById.get(alert.entityId);
      if (!p) break;
      return { title: `إيجار متأخر — ${name}`, message: `${where} · ${s.money(p.amountDue - p.amountPaid)} عن ${s.month(p.periodMonth)} · متأخر ${p.daysLate} يوم` };
    }
    case "payment_partial": {
      const p = idx.paymentById.get(alert.entityId);
      if (!p) break;
      return { title: `دفعة جزئية — ${name}`, message: `${where} · دُفع ${s.money(p.amountPaid)} من ${s.money(p.amountDue)} · المتبقي ${s.money(p.amountDue - p.amountPaid)} · ${p.daysLate} يوم` };
    }
    case "payment_repeat_late": {
      const m = /late (\d+) of the last (\d+) months · avg (\d+)/.exec(alert.message);
      return { title: `يتأخر بشكل متكرر — ${name}`, message: m ? `${where} · تأخر ${m[1]} من آخر ${m[2]} أشهر · متوسط ${m[3]} يوم تأخير` : where };
    }
    case "payment_due_today":
      return { title: `إيجار مستحق اليوم — ${name}`, message: where };
    case "payment_due_soon": {
      const m = /in (\d+) day/.exec(alert.title);
      return { title: `إيجار مستحق خلال ${m?.[1] ?? ""} يوم — ${name}`, message: where };
    }
    case "contract_expired_occupied":
      return { title: `عقد منتهٍ — ${name} ما زال في الشقة`, message: where };
    case "contract_expires_7d":
    case "contract_expires_30d":
    case "contract_expires_60d":
    case "contract_expires_90d": {
      const c = idx.contractById.get(alert.entityId);
      const d = c ? daysUntil(c.endDate) : null;
      return { title: `العقد ينتهي خلال ${d ?? ""} يوم — ${name}`, message: c ? `${where} · ${s.money(c.monthlyRent)} شهرياً · ينتهي ${s.date(c.endDate)}${alert.message.includes("also has overdue") ? " · لديه إيجار متأخر أيضاً" : ""}` : where };
    }
    case "occupancy_vacant_long":
    case "occupancy_vacant_critical": {
      const d = unit?.availableSince ? daysSince(unit.availableSince) : null;
      return { title: `شاغرة منذ ${d ?? ""} يوم — ${where}`, message: unit ? `الإيجار المطلوب ${s.money(unit.askingRent || unit.lastRent || 0)} شهرياً` : "" };
    }
    case "occupancy_building_low":
      return { title: `إشغال منخفض — ${property?.name ?? ""}`, message: alert.message.replace("occupied", "إشغال").replace("vacant", "شاغرة").replace("below the", "دون هدف").replace("target", "") };
    case "occupancy_unit_available":
      return { title: `أصبحت شاغرة — ${where}`, message: "" };
    case "document_missing_id":
      return { title: `لا هوية في الملف — ${name}`, message: where };
    case "document_missing_contract":
      return { title: `العقد غير مرفوع — ${name}`, message: where };
    case "document_id_expiring":
      return { title: `هوية/جواز على وشك الانتهاء — ${name}`, message: where };
    case "portfolio_outstanding_high":
      return { title: `المتأخرات فوق الحد`, message: alert.message };
    case "portfolio_expiry_cluster":
      return { title: `موجة تجديد قادمة`, message: alert.title };
    case "portfolio_revenue_down":
      return { title: `الإيراد الشهري أقل من الشهر الماضي`, message: alert.message };
  }
  return { title: alert.title, message: alert.message };
}
