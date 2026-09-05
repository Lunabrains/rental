import { isOccupying } from "@/lib/derived/recompute";
import { indexStore } from "@/lib/data/store";
import type { Store, Tenant } from "@/types";

/**
 * Arabic understanding for the demo brain. Spoken or typed Arabic (Lebanese
 * or standard) is normalised, its words and phrases mapped to the English
 * keywords the intent router already knows, and tenant names are matched
 * phonetically ("كريم ضاهر" → Karim Daher) since the data is in Latin
 * script. No model involved.
 */

/* ------------------------------ Normalisation ----------------------------- */

const DIACRITICS = /[ً-ْٰـ]/g;
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeArabic(text: string): string {
  let s = text.replace(DIACRITICS, "");
  s = s.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  s = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
  s = s.replace(/[،؛؟!.,?:;"'()«»[\]{}]/g, " ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/* -------------------------------- Lexicon --------------------------------- */

/** Multi-word phrases first (longest match wins), then single words. */
const PHRASES: [string, string][] = [
  ["ما دفع", "hasnt paid"], ["ما دفعوا", "hasnt paid"], ["ما دفعت", "hasnt paid"], ["لم يدفع", "hasnt paid"], ["لم يدفعوا", "hasnt paid"], ["لم تدفع", "hasnt paid"],
  ["مادفع", "hasnt paid"], ["ما دافع", "hasnt paid"], ["ما دافعين", "hasnt paid"], ["مش دافع", "hasnt paid"], ["مش دافعين", "hasnt paid"], ["لسا ما دفع", "hasnt paid"], ["بعد ما دفع", "hasnt paid"], ["ما سدد", "hasnt paid"], ["لم يسدد", "hasnt paid"],
  ["بيتاخر بالدفع", "pays late"], ["يتاخر بالدفع", "pays late"], ["بيتاخروا بالدفع", "pay late"], ["يتاخرون بالدفع", "pay late"], ["دفع متاخر", "pays late"], ["بيدفع متاخر", "pays late"], ["بيدفعوا متاخر", "pay late"],
  ["الشهر الجاي", "next month"], ["الشهر القادم", "next month"], ["الشهر المقبل", "next month"], ["الشهر الجايه", "next month"],
  ["هالشهر", "this month"], ["هذا الشهر", "this month"], ["الشهر الحالي", "this month"], ["هذه الشهر", "this month"],
  ["هالاسبوع", "this week"], ["هذا الاسبوع", "this week"], ["الاسبوع الحالي", "this week"],
  ["الاسبوع الجاي", "next week"], ["الاسبوع القادم", "next week"], ["الاسبوع المقبل", "next week"],
  ["الشهر الماضي", "last month"], ["الشهر الفايت", "last month"], ["الشهر اللي فات", "last month"], ["الشهر السابق", "last month"],
  ["الاسبوع الماضي", "last week"], ["الاسبوع الفايت", "last week"], ["الاسبوع السابق", "last week"], ["الاسبوع اللي فات", "last week"],
  ["شو صار", "what changed"], ["شو صار اليوم", "what changed today"], ["ماذا حدث", "what changed"], ["شو الجديد", "what changed"], ["اخر التغييرات", "what changed"], ["شو تغير", "what changed"], ["ماذا تغير", "what changed"],
  ["بحاجه لانتباه", "needs attention"], ["بحاجه انتباه", "needs attention"], ["بحاجه لاهتمام", "needs attention"], ["لازم انتبه", "needs attention"], ["لازم انتبهله", "needs attention"], ["لازم انتبهلها", "needs attention"], ["بدو انتباه", "needs attention"], ["بدها انتباه", "needs attention"], ["يحتاج انتباه", "needs attention"], ["تحتاج انتباه", "needs attention"], ["يحتاج اهتمام", "needs attention"], ["محتاج انتباه", "needs attention"],
  ["شو لازم اعمل", "what needs my attention"], ["شو لازم اعمله", "what needs my attention"], ["ماذا يجب ان افعل", "what needs my attention"], ["شو الاولويات", "what needs my attention"], ["ما هي الاولويات", "what needs my attention"], ["شو الاهم", "what needs my attention"], ["شو المستعجل", "what needs my attention"],
  ["كيف الوضع", "how is"], ["كيف الامور", "how is"], ["كيف الحال", "how is"], ["كيف الشغل", "how is"], ["كيف ماشي الشغل", "how is"], ["كيف وضع", "how is"], ["كيف حال", "how is"], ["كيف اداء", "how is"], ["شو وضع", "how is"], ["شو حال", "how is"],
  ["كل شي", "everything"], ["كل شيء", "everything"], ["بشكل عام", "overall"], ["نظره عامه", "overview"], ["الصوره العامه", "overview"],
  ["وسط البلد", "downtown"], ["داون تاون", "downtown"], ["داونتاون", "downtown"], ["داون تاون تاور", "downtown"],
  ["بيروت هايتس", "beirut"], ["مارينا ريزيدنس", "marina"], ["مارينا رزيدنس", "marina"], ["روشه غاردنز", "raouche"], ["روشه جاردنز", "raouche"], ["الروشه غاردنز", "raouche"],
  ["ووترفرونت ريزيدنس", "waterfront"], ["واترفرونت ريزيدنس", "waterfront"], ["فردان بلازا", "verdun"], ["ماونتن فيو", "mountain"], ["ماونتين فيو", "mountain"], ["سيدر ريزيدنس", "cedar"], ["سيدر رزيدنس", "cedar"],
  ["جواز سفر", "passport"], ["جواز السفر", "passport"], ["جوازات سفر", "passports"], ["بطاقه هويه", "id"], ["بطاقات هويه", "ids"],
  ["دايما بيتاخر", "regularly late"], ["دائما يتاخر", "regularly late"], ["عاده يتاخر", "regularly late"], ["دايما متاخر", "regularly late"], ["دايما بيتاخروا", "regularly late"], ["بشكل متكرر", "regularly"], ["كل مره", "regularly"],
  ["بكير", "early"], ["مبكرا", "early"], ["بشكل مبكر", "early"], ["على بكير", "early"],
  ["لمين لازم جدد", "who should i renew"], ["لمين جدد", "who should i renew"], ["مين لازم جدد", "who should i renew"], ["لمن اجدد", "who should i renew"], ["من يستحق التجديد", "who should i renew"], ["مين بيستاهل تجديد", "who should i renew"],
  ["شو بتعرف تعمل", "what can you do"], ["شو فيك تعمل", "what can you do"], ["شو بتقدر تعمل", "what can you do"], ["ماذا تستطيع ان تفعل", "what can you do"], ["كيف بتقدر تساعدني", "what can you do"], ["كيف تساعدني", "what can you do"], ["ساعدني", "help"],
  ["صباح الخير", "hello"], ["مساء الخير", "hello"], ["مساء النور", "hello"], ["صباح النور", "hello"], ["يعطيك العافيه", "hello"],
  ["اكتر من", "more than"], ["اكثر من", "more than"], ["ازيد من", "more than"], ["على الاقل", "at least"], ["اقل من", "less than"],
  ["مين ساكن", "who rents"], ["من يسكن", "who rents"], ["مين قاعد", "who rents"], ["من الساكن", "who rents"], ["مين المستاجر", "who is the tenant"], ["من المستاجر", "who is the tenant"],
  ["ما في", "no"], ["ما فيه", "no"], ["ولا حدا", "anyone"], ["ولا واحد", "anyone"], ["حدا", "anyone"], ["احد", "anyone"],
  ["نسبه الاشغال", "occupancy"], ["نسبه الإشغال", "occupancy"], ["معدل الاشغال", "occupancy"],
  ["كم عدد", "how many"], ["كم مبنى", "how many buildings"], ["كم شقه", "how many units"], ["كم مستاجر", "how many tenants"], ["قديش عدد", "how many"], ["اديش عدد", "how many"],
  ["كم المبلغ", "how much"], ["قديش المبلغ", "how much"], ["قديش المتبقي", "how much outstanding"], ["كم المتبقي", "how much outstanding"], ["قديش الباقي", "how much outstanding"], ["كم الباقي", "how much outstanding"], ["قديش علينا", "how much outstanding"], ["كم علينا", "how much outstanding"], ["قديش الهم", "how much outstanding"],
  ["مين متاخر", "who is late"], ["من المتاخر", "who is late"], ["مين المتاخرين", "who is late"], ["من المتاخرين", "who is late"],
  ["مين عليه", "who owes"], ["مين عليهم", "who owes"], ["من عليه", "who owes"], ["مين مديون", "who owes"], ["مين بدو يدفع", "who owes"],
  ["خلص العقد", "contract expires"], ["ينتهي عقده", "contract expires"], ["بيخلص عقده", "contract expires"], ["بينتهي عقده", "contract expires"], ["عقده بيخلص", "contract expires"], ["عقدها بيخلص", "contract expires"],
  ["مين طالع", "who is moving out"], ["مين رح يطلع", "who is moving out"], ["مين مغادر", "who is moving out"], ["من سيغادر", "who is moving out"], ["مين رايح", "who is moving out"],
  ["الايجار المطلوب", "asking rent"], ["ايجار الشقه", "rent"], ["بدل الايجار", "rent"],
  ["نسبه التحصيل", "collection rate"], ["معدل التحصيل", "collection rate"], ["التدفق النقدي", "cash flow"], ["تدفق نقدي", "cash flow"], ["التوقعات الماليه", "cash flow forecast"],
  ["قرار التجديد", "renewal decision"], ["قرارات التجديد", "renewal decisions"], ["بانتظار التجديد", "waiting renewal decision"], ["بانتظار قرار", "waiting decision"],
  ["امر عمل", "work order"], ["اوامر العمل", "work orders"], ["اوامر عمل", "work orders"], ["طلب صيانه", "work order"],
  ["ذكرني", "remind me"], ["ذكريني", "remind me"], ["حطلي تذكير", "set a reminder"], ["ضيف تذكير", "set a reminder"], ["تذكير", "reminder"],
  ["ملخص اليوم", "briefing"], ["ملخص الصباح", "briefing"], ["الملخص اليومي", "briefing"], ["ابدا يومي", "briefing"],
  ["الاكثر ربحيه", "most profitable"], ["الاعلى ربحيه", "most profitable"], ["الاقل اشغالا", "lowest occupancy"], ["الاقل اشغال", "lowest occupancy"], ["الاطول شغورا", "vacant longest"], ["فاضيه من زمان", "vacant longest"],
  ["مشاكل متكرره", "recurring problems"], ["اعطال متكرره", "recurring issues"], ["بتتكرر", "recurring"], ["كل شوي", "recurring"],
  ["كم دفعنا", "how much did i pay"], ["قديش دفعنا", "how much did i pay"], ["كم صرفنا", "how much did i spend"], ["قديش صرفنا", "how much did i spend"], ["كم صرفت", "how much did i spend"],
  ["بحاجه صيانه", "need service"], ["بدها صيانه", "need service"], ["بدهن صيانه", "need service"], ["بحاجه خدمه", "need service"],
  ["فئات المصاريف", "expense categories"], ["اي مصاريف زادت", "which categories increased"],
  ["اكثر من 30 يوم", "more than 30 days"], ["اكثر من 60 يوم", "more than 60 days"], ["اكثر من 90 يوم", "more than 90 days"],
  ["الاسبوع الجاي", "next week"], ["90 يوم الجايه", "next 90 days"], ["الـ 90 يوم", "90 days"],
];

const WORDS: Record<string, string> = {
  // question words
  مين: "who", من: "who", لمين: "who", شو: "what", ماذا: "what", ما: "what", ايش: "what", شنو: "what", كيف: "how", وين: "where", اين: "where", ليش: "why", لماذا: "why",
  كم: "how many", قديش: "how much", اديش: "how much", كام: "how many", اي: "which", ايا: "which", انو: "which", ايه: "which", هل: "", عدد: "how many", رقم: "", الرقم: "",
  // glue
  عندي: "we have", عنا: "we have", لدي: "we have", لدينا: "we have", عندنا: "we have", في: "in", فيه: "in", فيها: "in", فيهم: "in", عن: "about", حول: "about", بخصوص: "about", خبرني: "tell me", احكيلي: "tell me", قلي: "tell me", قللي: "tell me",
  اعطيني: "show", عرض: "show", اعرض: "show", فرجيني: "show", ورجيني: "show", بدي: "i want", اريد: "i want", ابحث: "find", دور: "find", دورلي: "find", اللي: "", التي: "", الذي: "", الي: "", يلي: "",
  له: "", لها: "", لهم: "", الو: "", الها: "", الن: "", هو: "", هي: "", هم: "", انا: "i", نحن: "we", احنا: "we", الان: "now", هلق: "now", حاليا: "now", لي: "", الي2: "",
  // time
  اليوم: "today", بكرا: "tomorrow", بكره: "tomorrow", غدا: "tomorrow", امبارح: "yesterday", مبارح: "yesterday", امس: "yesterday", شهر: "month", الشهر: "month", اشهر: "months", شهور: "months", الاشهر: "months",
  اسبوع: "week", الاسبوع: "week", اسابيع: "weeks", الاسابيع: "weeks", يوم: "day", اليوم2: "today", ايام: "days", الايام: "days", سنه: "year", السنه: "year", سنوات: "years", ربع: "quarter", فصل: "quarter",
  جاي: "next", جايه: "next", الجاي: "next", الجايه: "next", القادم: "next", القادمه: "next", المقبل: "next", المقبله: "next", خلال: "within", ضمن: "within", بعد: "in", قبل: "ago",
  الماضي: "last", الماضيه: "last", الفايت: "last", الفايته: "last", السابق: "last", السابقه: "last", اخر: "last", آخر: "last", الاخير: "last", الاخيره: "last",
  // numbers
  واحد: "1", وحده: "1", اتنين: "2", اثنين: "2", تنين: "2", اثنان: "2", تلاته: "3", ثلاثه: "3", تلات: "3", ثلاث: "3", اربعه: "4", اربع: "4", خمسه: "5", خمس: "5", سته: "6", ست: "6", سبعه: "7", سبع: "7",
  تمانيه: "8", ثمانيه: "8", تمان: "8", ثماني: "8", تسعه: "9", تسع: "9", عشره: "10", عشر: "10", عشرين: "20", تلاتين: "30", ثلاثين: "30", اربعين: "40", خمسين: "50", ستين: "60", سبعين: "70", تمانين: "80", ثمانين: "80", تسعين: "90", ميه: "100", مايه: "100", مائه: "100",
  نص: "half", نصف: "half",
  // people
  مستاجر: "tenant", المستاجر: "tenant", ساكن: "tenant", الساكن: "tenant", ساكنه: "tenant", مستاجرين: "tenants", المستاجرين: "tenants", مستاجرون: "tenants", المستاجرون: "tenants", سكان: "tenants", السكان: "tenants", زبون: "tenant", زباين: "tenants", الزباين: "tenants", ناس: "people", الناس: "people",
  يسكن: "rents", بيسكن: "rents", تسكن: "rents", بتسكن: "rents", قاعد: "rents", قاعده: "rents", يقعد: "rents",
  // money
  دفع: "paid", دفعوا: "paid", دفعت: "paid", دافع: "paid", دافعين: "paid", سدد: "paid", سددوا: "paid", بيدفع: "pays", يدفع: "pays", بيدفعوا: "pay", يدفعون: "pay", بتدفع: "pays",
  دفعه: "payment", الدفعه: "payment", دفعات: "payments", الدفعات: "payments", مدفوعات: "payments", المدفوعات: "payments", تسديد: "payment", التسديد: "payment",
  ايجار: "rent", الايجار: "rent", اجار: "rent", الاجار: "rent", ايجارات: "rent", الايجارات: "rent", اجارات: "rent",
  متاخر: "late", متاخره: "late", متاخرين: "late", المتاخرين: "late", المتاخر: "late", المتاخره: "late", متاخرون: "late", تاخير: "late", التاخير: "late", تاخر: "late", يتاخر: "late", بيتاخر: "late", يتاخرون: "late", بيتاخروا: "late", تاخروا: "late", متاخرات: "outstanding", المتاخرات: "outstanding",
  دايما: "regularly", دائما: "regularly", عاده: "regularly", باستمرار: "regularly", متكرر: "regularly", متكرره: "regularly",
  مستحق: "due", مستحقه: "due", المستحق: "due", المستحقه: "due", مستحقات: "due", المستحقات: "due", استحقاق: "due", الاستحقاق: "due",
  متبقي: "outstanding", المتبقي: "outstanding", باقي: "outstanding", الباقي: "outstanding", ذمم: "outstanding", الذمم: "outstanding", دين: "outstanding", الدين: "outstanding", ديون: "outstanding", الديون: "outstanding", رصيد: "balance", الرصيد: "balance",
  عليه: "owes", عليهم: "owe", عليها: "owes", مديون: "owes", مديونين: "owe",
  تامين: "deposit", التامين: "deposit", تامينات: "deposits", التامينات: "deposits", ضمان: "deposit", الضمان: "deposit", ضمانات: "deposits",
  ايراد: "revenue", ايرادات: "revenue", الايرادات: "revenue", الايراد: "revenue", دخل: "revenue", الدخل: "revenue", مدخول: "revenue", المدخول: "revenue", عائدات: "revenue", العائدات: "revenue", ارباح: "revenue", الارباح: "revenue",
  تحصيل: "collected", التحصيل: "collected", محصل: "collected", حصلنا: "collected", حصلت: "collected", قبضنا: "collected", قبضت: "collected",
  مجموع: "total", اجمالي: "total", الاجمالي: "total", المجموع: "total", كامل: "total", قيمه: "amount", القيمه: "amount", مبلغ: "amount", المبلغ: "amount", فلوس: "money", مصاري: "money", مال: "money", المال: "money", دولار: "dollars",
  // contracts
  عقد: "contract", العقد: "contract", عقده: "contract", عقدها: "contract", عقود: "contracts", العقود: "contracts", عقودهم: "contracts",
  ينتهي: "expire", تنتهي: "expire", بينتهي: "expire", بتنتهي: "expire", بيخلص: "expire", بتخلص: "expire", بيخلصوا: "expire", بتخلصوا: "expire", منتهي: "expired", منتهيه: "expired", خالص: "expire", ينتهون: "expire", خلص: "expire", خلصت: "expired",
  انتهاء: "expiry", الانتهاء: "expiry", نهايه: "end", النهايه: "end",
  تجديد: "renew", التجديد: "renew", جدد: "renew", نجدد: "renew", اجدد: "renew", بجدد: "renew", يجدد: "renew", تجدد: "renew", جددلي: "renew",
  طالع: "moving out", طالعين: "moving out", مغادر: "moving out", مغادرين: "moving out", يغادر: "moving out", سيغادر: "moving out", رايح: "moving out", رايحين: "moving out", اشعار: "notice",
  // buildings & units
  مبنى: "building", المبنى: "building", بنايه: "building", البنايه: "building", عماره: "building", العماره: "building", بناء: "building", البناء: "building",
  مباني: "buildings", المباني: "buildings", بنايات: "buildings", البنايات: "buildings", عمارات: "buildings", العمارات: "buildings",
  شقه: "unit", الشقه: "unit", وحده2: "unit", الوحده: "unit", شقق: "units", الشقق: "units", وحدات: "units", الوحدات: "units", طابق: "floor", الطابق: "floor", غرفه: "bedroom", غرف: "bedrooms",
  شاغر: "vacant", شاغره: "vacant", الشاغر: "vacant", الشاغره: "vacant", فاضي: "vacant", فاضيه: "vacant", الفاضي: "vacant", الفاضيه: "vacant", فارغ: "vacant", فارغه: "vacant", الفارغ: "vacant", الفارغه: "vacant",
  فاضيين: "vacant", فارغين: "vacant", شاغرين: "vacant", الشاغرين: "vacant", الفاضيين: "vacant", الفارغين: "vacant", شغور: "vacant", الشغور: "vacant", فضيت: "vacant", فضيوا: "vacant",
  اشغال: "occupancy", الاشغال: "occupancy", ماجور: "rented", ماجوره: "rented", مؤجر: "rented", مؤجره: "rented", مأجور: "rented", مأجوره: "rented", مسكون: "rented", مسكونه: "rented",
  // alerts & documents
  تنبيه: "alert", التنبيه: "alert", تنبيهات: "alerts", التنبيهات: "alerts", انذار: "alert", انذارات: "alerts", الانذارات: "alerts", تحذير: "warning", تحذيرات: "warnings", التحذيرات: "warnings",
  حرج: "critical", حرجه: "critical", طارئ: "critical", طارئه: "critical", عاجل: "critical", عاجله: "critical", مستعجل: "critical", مستعجله: "critical", خطير: "critical", خطيره: "critical",
  مهم: "important", مهمه: "important", انتباه: "attention", الانتباه: "attention", اهتمام: "attention", الاهتمام: "attention",
  لازم: "needs", بدو: "needs", بدها: "needs", بحاجه: "needs", يحتاج: "needs", تحتاج: "needs", محتاج: "needs", محتاجه: "needs", ضروري: "needs", يجب: "needs",
  مشكله: "problems", مشاكل: "problems", المشاكل: "problems", خطر: "risks", مخاطر: "risks", المخاطر: "risks",
  مستند: "document", مستندات: "documents", المستندات: "documents", وثيقه: "document", وثائق: "documents", الوثائق: "documents", اوراق: "documents", الاوراق: "documents", ورق: "documents", ملفات: "documents", الملفات: "documents",
  هويه: "id", الهويه: "id", هويات: "ids", الهويات: "ids", جواز: "passport", الجواز: "passport", جوازات: "passports",
  // status & analysis
  وضع: "status", الوضع: "status", حاله: "status", الحاله: "status", ملخص: "summary", الملخص: "summary", خلاصه: "summary", تقرير: "summary", اداء: "performance", الاداء: "performance",
  محفظه: "portfolio", المحفظه: "portfolio", الشركه: "portfolio", الاملاك: "portfolio", املاك: "portfolio", العقارات: "portfolio", عقارات: "portfolio", كلها: "all", كلهم: "all", الكل: "all", جميع: "all",
  افضل: "best", احسن: "best", الافضل: "best", الاحسن: "best", اسوا: "worst", الاسوا: "worst", اضعف: "worst", الاضعف: "worst", اعلى: "highest", الاعلى: "highest", اقل: "lowest", الاقل: "lowest", ادنى: "lowest",
  ترتيب: "rank", رتب: "rank", رتبلي: "rank", قارن: "compare", مقارنه: "compare", قارنلي: "compare", الترتيب: "rank",
  صار: "changed", حصل: "changed", حدث: "changed", تغير: "changed", تغيرت: "changed", تغيرات: "changes", التغييرات: "changes", تغييرات: "changes", جديد: "changed", الجديد: "changed", اخبار: "news", الاخبار: "news",
  نشاط: "activity", النشاط: "activity", سجل: "activity", السجل: "activity", حركه: "activity", الحركه: "activity",
  موثوق: "reliable", موثوقين: "reliable", الموثوقين: "reliable", منتظم: "reliable", منتظمين: "reliable", ملتزم: "reliable", ملتزمين: "reliable", الملتزمين: "reliable", منيح: "good", مناح: "good", كويس: "good", كويسين: "good", جيد: "good", جيدين: "good",
  مبكر: "early", باكرا: "early",
  // control
  توقف: "stop", وقف: "stop", بس: "stop", كفى: "stop", يكفي: "stop", شكرا: "thanks", يسلمو: "thanks", مرسي: "thanks", تسلم: "thanks", مرحبا: "hello", اهلا: "hello", هاي: "hello", هلا: "hello", كيفك: "hello", مساعده: "help", المساعده: "help",
  // building tokens
  بيروت: "beirut", هايتس: "", مارينا: "marina", ريزيدنس: "", رزيدنس: "", ريزيدانس: "", تاور: "", روشه: "raouche", الروشه: "raouche", غاردنز: "", جاردنز: "", غاردن: "",
  ووترفرونت: "waterfront", واترفرونت: "waterfront", وترفرونت: "waterfront", فردان: "verdun", بلازا: "", ماونتن: "mountain", ماونتين: "mountain", فيو: "", سيدر: "cedar", الارز: "cedar", بي: "b",
  // assistant 2.0: finance, maintenance, suppliers, forecast, actions
  صيانه: "maintenance",
  الصيانه: "maintenance",
  مصلح: "technician",
  مصلحين: "technicians",
  مورد: "supplier",
  الموردين: "suppliers",
  موردين: "suppliers",
  المورد: "supplier",
  مقاول: "contractor",
  المقاول: "contractor",
  مقاولين: "contractors",
  معلقه: "pending",
  المعلقه: "pending",
  اصول: "assets",
  الاصول: "assets",
  معدات: "equipment",
  المعدات: "equipment",
  مصعد: "elevator",
  المصعد: "elevator",
  المصاعد: "elevators",
  مصاعد: "elevators",
  مولد: "generator",
  المولد: "generator",
  المولدات: "generators",
  سباكه: "plumbing",
  السباكه: "plumbing",
  كهربا: "electrical",
  الكهربا: "electrical",
  كهرباء: "electrical",
  الكهرباء: "electrical",
  تكييف: "hvac",
  التكييف: "hvac",
  تنظيف: "cleaning",
  التنظيف: "cleaning",
  خدمه: "service",
  الخدمه: "service",
  خدمات: "services",
  الخدمات: "services",
  وقائيه: "preventive",
  الوقائيه: "preventive",
  ربحيه: "profitable",
  الربحيه: "profitable",
  ربح: "profit",
  الربح: "profit",
  مربح: "profitable",
  مصاريف: "expenses",
  المصاريف: "expenses",
  مصروف: "expense",
  المصروف: "expense",
  فئه: "category",
  الفئه: "category",
  فئات: "categories",
  الفئات: "categories",
  زادت: "increased",
  ارتفعت: "increased",
  زاد: "increased",
  ارتفع: "increased",
  توقعات: "forecast",
  التوقعات: "forecast",
  توقع: "forecast",
  المتوقع: "expected",
  متوقع: "expected",
  المتوقعه: "expected",
  الاطول: "longest",
  اطول: "longest",
  الاكثر: "most",
  اكثر: "most",
  دفعنا: "paid",
  صرفنا: "spent",
  صرفت: "spent",
  كلفه: "cost",
  الكلفه: "cost",
  كلف: "cost",
  تكلف: "cost",
  غاليه: "expensive",
  الاغلى: "most expensive",
  تتكرر: "recurring",
  يتكرر: "recurring",
  تكرار: "repeat",
  التكرار: "repeat",
  بتحتاج: "need",
  بدهن: "need",
  تذكير: "reminder",
  التذكير: "reminder",
  ذكرني: "remind me",
  نسبه: "rate",
  النسبه: "rate",
  معدل: "rate",
  المعدل: "rate",
  اطلب: "create",
  افتح: "open",
  انشئ: "create",
  ضيف: "create",
  اعمل: "create",
};

const NORMALIZED_PHRASES: [string, string][] = PHRASES.map(([a, e]): [string, string] => [normalizeArabic(a), e]).sort((x, y) => y[0].length - x[0].length);
const NORMALIZED_WORDS = new Map<string, string>(Object.entries(WORDS).map(([a, e]) => [normalizeArabic(a.replace(/\d$/, "")), e]));

const PREFIXES = ["وبال", "وال", "بال", "لل", "فال", "كال", "هال", "عال", "ال", "و", "ب", "ل", "ف", "ك", "ع"];

function lookupWord(token: string): string | null {
  if (/^\d+$/.test(token)) return token;
  const direct = NORMALIZED_WORDS.get(token);
  if (direct !== undefined) return direct;
  for (const p of PREFIXES) {
    if (token.length > p.length + 1 && token.startsWith(p)) {
      const rest = token.slice(p.length);
      if (/^\d+$/.test(rest)) return rest;
      const hit = NORMALIZED_WORDS.get(rest);
      if (hit !== undefined) return hit;
      // "بال" = "in the …" — keep the object, drop the preposition.
      const withAl = NORMALIZED_WORDS.get(`ال${rest}`);
      if (withAl !== undefined) return withAl;
    }
  }
  return null;
}

export function isArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

/**
 * Turn an Arabic question into the English keyword sentence the router
 * understands. Unknown words (tenant names) are kept so the phonetic matcher
 * can still see them.
 */
export function arabicToEnglish(text: string): string {
  let s = normalizeArabic(text);
  for (const [a, e] of NORMALIZED_PHRASES) {
    if (!s.includes(a)) continue;
    s = s.replace(new RegExp(`(^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g"), `$1 ${e} `);
  }
  const out: string[] = [];
  for (const token of s.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9]+$/.test(token)) {
      out.push(token);
      continue;
    }
    const hit = lookupWord(token);
    out.push(hit === null ? token : hit);
  }
  let english = out.join(" ").replace(/\s+/g, " ").trim();
  // "5 and 20" → 25 ; "b 304" → b304 ; "half month" → 15 days
  english = english.replace(/\b([1-9]) and ([2-9]0)\b/g, (_, u, t) => String(Number(u) + Number(t)));
  english = english.replace(/\b([2-9]0) and ([1-9])\b/g, (_, t, u) => String(Number(u) + Number(t)));
  english = english.replace(/\bb (\d{3,4})\b/g, "b$1");
  english = english.replace(/\bhalf (month|week)\b/g, (_, w) => (w === "month" ? "15 days" : "3 days"));
  return english;
}

/* --------------------------- Phonetic name match --------------------------- */

const AR_CONSONANTS: Record<string, string> = {
  ب: "b", ت: "t", ث: "t", ج: "j", ح: "h", خ: "k", د: "d", ذ: "d", ر: "r", ز: "z", س: "s", ش: "s", ص: "s", ض: "d", ط: "t", ظ: "z",
  غ: "g", ف: "f", ق: "k", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", پ: "b", چ: "j", ڤ: "f", گ: "g",
};

/** Consonant skeleton of an Arabic token: كريم → krm, ضاهر → dhr, ميشال → msl. */
export function arabicSkeleton(token: string): string {
  let out = "";
  for (const ch of normalizeArabic(token)) {
    const c = AR_CONSONANTS[ch];
    if (c) out += c;
  }
  return out.replace(/(.)\1+/g, "$1");
}

/** Consonant skeleton of a Latin name with the same conventions: Khoury → kr, Michel → msl. */
export function latinSkeleton(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z]/g, "");
  s = s.replace(/kh/g, "k").replace(/sh/g, "s").replace(/th/g, "t").replace(/dh/g, "d").replace(/gh/g, "g").replace(/ch/g, "s").replace(/ph/g, "f").replace(/ck/g, "k");
  s = s.replace(/q/g, "k").replace(/c/g, "k").replace(/x/g, "ks").replace(/v/g, "f").replace(/p/g, "b");
  s = s.replace(/[aeiouyw]/g, "");
  return s.replace(/(.)\1+/g, "$1");
}

/** Tenants whose first/last names sound like Arabic tokens in the question. */
export function findTenantsArabic(store: Store, text: string): Tenant[] {
  const tokens = normalizeArabic(text)
    .split(/\s+/)
    .filter((t) => /[؀-ۿ]/.test(t) && lookupWord(t) === null)
    .map((t) => arabicSkeleton(t.replace(/^(ال|و|ل|ب|ع)/, "")))
    .filter((sk) => sk.length >= 2);
  if (tokens.length === 0) return [];
  const idx = indexStore(store);
  const scored: { t: Tenant; score: number }[] = [];
  for (const t of store.tenants) {
    const first = latinSkeleton(t.firstName);
    const lastParts = t.lastName.split(/\s+/).map(latinSkeleton).filter((p) => p.length >= 2);
    const hasFirst = first.length >= 2 && tokens.includes(first);
    const hasLast = lastParts.length > 0 && lastParts.every((p) => tokens.includes(p));
    let score = 0;
    if (hasFirst && hasLast) score = 3;
    else if (hasLast && lastParts.join("").length >= 3) score = 2;
    else if (hasFirst && first.length >= 3) score = 1;
    if (score > 0) scored.push({ t, score });
  }
  if (scored.length === 0) return [];
  const top = Math.max(...scored.map((s) => s.score));
  const current = (t: Tenant) => (idx.contractsByTenant.get(t.id) ?? []).some(isOccupying);
  const kept = scored.filter((s) => s.score === top);
  if (top === 1 && kept.length > 1) return kept.map((s) => s.t);
  return kept.sort((a, b) => Number(current(b.t)) - Number(current(a.t)) || a.t.fullName.localeCompare(b.t.fullName)).map((s) => s.t);
}

/** Spoken phrases (normalised) that end a voice conversation. */
export const ARABIC_END_PHRASES = ["وقف", "توقف", "خلص", "بس", "كفى", "يكفي", "شكرا", "شكرا لك", "شكرا كتير", "يسلمو", "مرسي", "خلصنا", "بس هيك", "هيك بس", "كفايه"].map(normalizeArabic);
