// Auto-tagging engine.
//
// Two phases:
//   1. categorize()   — per-transaction: group, category, counterparty, base tags.
//   2. enrichTags()   — cross-transaction: #recurring and #large need the whole set.
//
// The merchant ruleset is seeded from a hand-tuned set fitted to a real Romanian
// (Banca Transilvania / ING) statement, then broadened with common merchants so a
// fresh statement still gets most rows tagged. Everything unmatched falls to "Other"
// and is surfaced in the UI so the ruleset can be extended.

import type { Direction, Group, Txn } from "../types";

export interface CategorizeInput {
  type: string;
  debit: number;
  credit: number;
  details: Record<string, string>;
}

export interface CatResult {
  group: Group;
  category: string;
  who: string;
  direction: Direction;
  rule: string;
}

/** A regex that never matches — used when the account holder is unknown. */
const NEVER_RE = /(?!)/;

/** Title/honorific tokens to drop when deriving a self-name matcher. */
const TITLE_TOKENS = new Set(["dl", "dna", "dra", "dnul", "dna", "mr", "mrs", "ms", "sc", "srl"]);

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // strip diacritics
}

/**
 * Build a matcher for the account holder's own name (from the statement's
 * "Titular cont:" line), so transfers to/from their OWN accounts read as
 * internal savings rather than payments to other people. Derived per-file, so
 * the app works for any account holder — not just one hardcoded name.
 * Requires every significant name token to be present (in any order).
 */
export function buildSelfMatcher(holder?: string): RegExp {
  if (!holder) return NEVER_RE;
  const tokens = normalizeName(holder)
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3 && !TITLE_TOKENS.has(t));
  if (tokens.length === 0) return NEVER_RE;
  const lookaheads = tokens
    .slice(0, 3)
    .map((t) => `(?=.*\\b${t}\\b)`)
    .join("");
  return new RegExp(lookaheads);
}

/** "MEGAIMAGE 0986 Giroc3  RO  Giroc" -> "MEGAIMAGE 0986 Giroc3" */
export function cleanMerchant(raw: string): string {
  return raw.split(/\s{2,}/)[0].trim();
}

/**
 * The leading, case-preserving part of a merchant name up to the first token
 * that contains a digit (a store / location code): "MEGAIMAGE 0986 Giroc3"
 * -> "MEGAIMAGE". Used as the human-facing label for a merged chain.
 */
export function merchantLabel(who: string): string {
  const head: string[] = [];
  for (const tok of who.trim().split(/\s+/)) {
    if (/\d/.test(tok)) break;
    head.push(tok);
  }
  return head.join(" ").trim() || who.trim();
}

/**
 * A normalised merchant "stem" (uppercased label) for grouping branches of the
 * same chain: "MEGAIMAGE 0986 Giroc3" and "MEGAIMAGE 0710 …" both -> "MEGAIMAGE".
 */
export function merchantStem(who: string): string {
  return merchantLabel(who).toUpperCase();
}

type Rule = [pattern: RegExp, group: Group, category: string];

// Matched against the UPPERCASED merchant/counterparty name.
const MERCHANT_RULES: Rule[] = [
  // ---- Required: utilities & bills ----
  [/SOC DE PRODUCERE A ENERG|HIDROELECTRICA|IHIDRO|ENEL|E-?DISTRIBUTIE/, "required", "Electricity"],
  [/EON\.?RO|E\.ON|ENGIE|\bGAZ\b|GAZ NATURAL|DISTRIGAZ/, "required", "Gas"],
  [/AQUATIM|APA NOVA|APA CANAL|APAVITAL/, "required", "Water"],
  [/RETIM|SALUBR|BRAI-?CATA|GARBAGE/, "required", "Garbage"],
  [/DIGI ROMANIA|RCS|RDS|VODAFONE.*NET|TELEKOM.*NET/, "required", "Internet & TV"],
  [/ORANGE\.?RO|ORANGE ROMANIA|VODAFONE|TELEKOM|DIGI MOBIL/, "required", "Mobile"],
  [/E-?BLOC|ASOCIATIA DE PROPRIET|ADMINISTRA(RE|TIE)/, "required", "Building admin"],
  [/ALLIANZ-?TIRIAC|GENERALI|GROUPAMA|OMNIASIG|ASIROM|CITY INSURANCE|SAFETY BROKER/, "required", "Insurance"],
  [/GHISEUL\.?RO|COMUNA GIROC|CJT-?DIR|ANCPI|ANAF|PRIMARIA|DIRECTIA/, "required", "Taxes & gov"],
  [/HELP NET|CATENA|FARMADO|PHARMA VIE|TIA KIDS MED|ORTOREX|SENSIBLU|DR\.?MAX|\bDONA\b|ALPHEGA|MEDLIFE|REGINA MARIA|SYNEVO|SANADOR/, "required", "Health & pharmacy"],
  [/MEGA ?IMAGE|KAUFLAND|LIDL|AUCHAN|PENNY|DARINA COM|^PIATA |PROFI|CARREFOUR|SELGROS|METRO|CORA|MEGA MALL FOOD|LA DOI PASI|ANNABELLA|SUPERMARKET|MINIMARKET/, "required", "Groceries"],
  [/GRADINITA|KINDERGARTEN|CRESA|AFTER ?SCHOOL/, "required", "Childcare"],

  // ---- Own accounts: internal movement, not spending ----
  [/REVOLUT/, "savings", "Revolut top-ups (own)"],

  // ---- Optional: discretionary ----
  [
    /BBQ RIBS|BELLA ITALIA|BERARIA|BISTRO|BOOM PUB|BREWNO|CHINESE FAST FOOD|CURTEA BERII|IRISH PUBLIC|LERA S MAR|PEPPER-?STEAK|PLATANO TAPAS|SEGAR FOOD|STAROPRAMEN|VINERI 15|TASTE OF BALI|DOME COFFEE|Q COFFEE|ZONE CAFE|MAKRA LANGOS|MASINA CU CLATITE|CRAZY DONUT|ADRIENNS|KOVACS|SWEETS TRUCK|FORESTGRILL|GRUPER CATERING|FOODIEBUCATARUL|LEONAALEX|COPOS HORECA|NCA DRINKS|RED HAT EVENTS|BUORMO|RESTAURANT|PIZZA|KFC|MCDONALD|BURGER|STARBUCKS|COFFEE|CAFE|GLOVO|TAZZ|FOOD ?PANDA|BOLT ?FOOD|WOLT|5 TO GO/,
    "optional",
    "Eating out & cafés",
  ],
  [
    /DINO PARK|DINO LIFE|ENERGY ?GAMES|SET FUNSHOP|SET IULLIUS|FUND LAND|LIZERA PARK|AMUSAMENT|INTERTOY|NORIEL|GRADINA ZOO|AQUACLUB|HOUSE OF POOL|SIX LAKES|MINA TIMISOARA|FUNIDELIA|CHEERFUL PLACE|JUMBO|TOYS|KIDS|PLAYGROUND|CINEMA|CINEMA CITY|HAPPY CINEMA/,
    "optional",
    "Kids & fun",
  ],
  [/HORNBACH|DEDEMAN|LEROY MERLIN|IKEA|JYSK|MOEMAX|DEPOZIT MIRCEA|BRICO|ARABESQUE|AMBIENT|MOBEXPERT/, "optional", "Home & DIY"],
  [/ALTEX|MEDIA GALAXY|EMAG|EVOMAG|F64|LIBRISTO|PEPCO|TEDI|SM OFFICE|DIAGOLD|FLANCO|PC GARAGE|CEL\.?RO|NOTINO|DOUGLAS|SEPHORA|H ?& ?M|ZARA|C&A|LC WAIKIKI|SINSAY|RESERVED|DEICHMANN|CCC|ABOUT YOU|ANSWEAR|FASHION DAYS|LIBRARIE|CARTURESTI/, "optional", "Shopping & retail"],
  [/OMV|LUKOIL|MOL |SAFARIWASH|1MINUTEAERO|ALLMONDOCAR|ROVIGNETA|VROOM|PAUL MOTO|ATV CENTER|MOTO MUS|AMANO|ALPHA PARKING|BOLT\.EU|IULIUS MALL|ATTRIUS|ADP|PETROM|ROMPETROL|SOCAR|GAZPROM|MOTORPARK|UBER|FREE ?NOW|CFR|TAROM|WIZZ|BLUE ?AIR|RYANAIR|AUTOSTRADA|PARKING|PARCARE|CARWASH|SPALATORIE/, "optional", "Car & transport"],
  [/DECATHLON|ROUMASPORT|PADFORCE|WORLD CLASS|SEVEN FITNESS|FITNESS|\bGYM\b|\bSALA\b|SALA SPORT|SALA FITNESS|STADION/, "optional", "Sports & hobbies"],
  [/DERTOUR|BOOKING|AIRBNB|HOTEL|HOSTEL|EXPEDIA|ESKY|VOLA|CHRISTIAN TOUR/, "optional", "Travel"],
  [/LOTO\.?RO|LOTERIA|BETANO|SUPERBET|GAMING|CASINO/, "optional", "Lottery & gaming"],
  [/CARGUS|FAN COURIER|SAMEDAY|DPD|GLS|POSTA ROMANA/, "optional", "Couriers"],
  [/SANPET|PET ?SHOP|ANIMAL|VETERINAR|ZOOLAND|ANIMAX/, "optional", "Pets"],
  [/NETFLIX|SPOTIFY|HBO|DISNEY|YOUTUBE ?PREMIUM|GOOGLE ?(STORAGE|ONE|\*)|APPLE\.?COM|ICLOUD|MICROSOFT|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|AMAZON PRIME|PATREON|AUDIBLE|STORYTEL|LINKEDIN/, "optional", "Subscriptions & digital"],
];

/** Category -> emoji, purely for display. Missing categories fall back to a dot. */
export const CATEGORY_ICON: Record<string, string> = {
  Electricity: "⚡", Gas: "🔥", Water: "💧", Garbage: "🗑️",
  "Internet & TV": "📶", Mobile: "📱", "Building admin": "🏢",
  Insurance: "🛡️", "Taxes & gov": "🏛️", "Health & pharmacy": "💊",
  Groceries: "🛒", Childcare: "🧸",
  "Eating out & cafés": "🍽️", "Kids & fun": "🎠", "Home & DIY": "🔨",
  "Shopping & retail": "🛍️", "Car & transport": "🚗", "Sports & hobbies": "🏋️",
  Travel: "✈️", "Lottery & gaming": "🎰", Couriers: "📦", Pets: "🐾",
  "Subscriptions & digital": "💻", Cash: "💵", Other: "❓",
  "Salary": "💼", "From partner": "💞", "Deposit interest": "📈",
  "Deposits (own)": "🏦", "Own account transfer": "🔁", "Revolut top-ups (own)": "💳",
  "Transfers to people": "👥", "Credit card payment": "💳",
  "Other income": "➕", "Insurance payouts": "🛡️", "From family": "👨‍👩‍👧",
};

export function iconFor(category: string): string {
  return CATEGORY_ICON[category] ?? "•";
}

/** Slugify a category into a hashtag fragment: "Eating out & cafés" -> "eating-out-cafes". */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Classify a single transaction into (group, category, counterparty, direction).
 * `self` matches the account holder's own name (see buildSelfMatcher); pass one
 * derived from the statement so own-account transfers are recognised for any user.
 */
export function categorize(tx: CategorizeInput, self: RegExp = NEVER_RE): CatResult {
  const t = tx.type;
  const d = tx.details;
  const merchant = cleanMerchant(d["Tranzactie la"] ?? "");
  const ordonator = d["Ordonator"] ?? "";
  const beneficiar = d["Beneficiar"] ?? "";

  // --- internal savings movement (own accounts, deposits) ---
  // Exclude "Dobanda aferenta depozitului" — that is interest *income*, handled below.
  if (/depozit/i.test(t) && !/dobanda/i.test(t)) {
    return { group: "savings", category: "Deposits (own)", who: "Bank deposit", direction: "internal", rule: "type:deposit" };
  }
  if (self.test(normalizeName(beneficiar))) {
    return { group: "savings", category: "Own account transfer", who: beneficiar, direction: "internal", rule: "self:beneficiary" };
  }
  if (tx.credit > 0 && self.test(normalizeName(ordonator))) {
    return { group: "savings", category: "Own account transfer", who: ordonator, direction: "internal", rule: "self:ordonator" };
  }

  // --- income ---
  if (tx.credit > 0) {
    if (/dobanda/i.test(t)) {
      return { group: "income", category: "Deposit interest", who: "Bank", direction: "in", rule: "type:interest" };
    }
    const up = ordonator.toUpperCase();
    if (/PAYROLL|SALAR|SALARIU|WAGE|SALARY/.test(up)) return { group: "income", category: "Salary", who: ordonator, direction: "in", rule: "income:salary" };
    if (/ALLIANZ|GENERALI|ASIG|GROUPAMA|OMNIASIG/.test(up)) return { group: "income", category: "Insurance payouts", who: ordonator, direction: "in", rule: "income:insurance" };
    // Personalise: add your own recurring senders here, e.g.
    //   if (/EMPLOYER NAME/.test(up)) return { group: "income", category: "Salary", who: ordonator, direction: "in", rule: "income:salary" };
    //   if (/PARTNER NAME/.test(up))  return { group: "income", category: "From partner", who: ordonator, direction: "in", rule: "income:partner" };
    return { group: "income", category: "Other income", who: ordonator || merchant || t, direction: "in", rule: "income:other" };
  }

  // --- outgoing ---
  if (/retragere numerar|cash withdrawal|atm/i.test(t)) {
    return { group: "optional", category: "Cash", who: merchant || "ATM", direction: "out", rule: "type:cash" };
  }
  if (/card credit/i.test(t)) {
    return { group: "transfers", category: "Credit card payment", who: "Credit card", direction: "internal", rule: "type:cc-payment" };
  }
  if (merchant) {
    const up = merchant.toUpperCase();
    for (const [rx, group, category] of MERCHANT_RULES) {
      if (rx.test(up)) return { group, category, who: merchant, direction: group === "savings" ? "internal" : "out", rule: `merchant:${category}` };
    }
    return { group: "optional", category: "Other", who: merchant, direction: "out", rule: "merchant:unmatched" };
  }
  if (beneficiar) {
    // a bill paid by bank transfer (insurance, kindergarten, utility) still has a
    // recognisable beneficiary — try the merchant rules before calling it a transfer.
    // Only honour *institutional* matches (required/savings); discretionary tokens
    // must not hijack a genuine person-to-person transfer (e.g. a surname like KOVACS).
    const up = beneficiar.toUpperCase();
    for (const [rx, group, category] of MERCHANT_RULES) {
      if ((group === "required" || group === "savings") && rx.test(up)) {
        return { group, category, who: beneficiar, direction: group === "savings" ? "internal" : "out", rule: `beneficiary:${category}` };
      }
    }
    return { group: "transfers", category: "Transfers to people", who: beneficiar, direction: "out", rule: "beneficiary:transfer" };
  }
  return { group: "optional", category: "Other", who: t, direction: "out", rule: "fallback:other" };
}

/** Base per-transaction tags (before the cross-transaction enrichment pass). */
export function baseTags(cat: CatResult, dateISO: string): string[] {
  const tags = new Set<string>();
  tags.add(`#${cat.group}`);
  tags.add(`#${slug(cat.category)}`);
  if (cat.direction === "internal") tags.add("#internal");
  if (cat.rule === "type:cash") tags.add("#cash");

  // weekend spend (Sat/Sun) — a cheap behavioural signal
  const dow = new Date(dateISO + "T00:00:00").getDay();
  if ((dow === 0 || dow === 6) && cat.direction === "out") tags.add("#weekend");

  return [...tags];
}

/**
 * Cross-transaction enrichment. Mutates each txn's tag list in place.
 *  - #recurring : counterparty seen in >= 3 distinct months (bills, subscriptions).
 *  - #large     : amount in the top 5% of its direction.
 */
export function enrichTags(txns: Txn[]): void {
  // recurring: distinct months per (direction, who)
  const monthsByWho = new Map<string, Set<string>>();
  for (const tx of txns) {
    if (!tx.who) continue;
    const key = `${tx.direction}::${merchantStem(tx.who)}`;
    if (!monthsByWho.has(key)) monthsByWho.set(key, new Set());
    monthsByWho.get(key)!.add(tx.month);
  }

  // large: 95th percentile per direction
  const p95: Record<Direction, number> = {
    in: percentile(txns.filter((t) => t.direction === "in").map((t) => t.amount), 0.95),
    out: percentile(txns.filter((t) => t.direction === "out").map((t) => t.amount), 0.95),
    internal: percentile(txns.filter((t) => t.direction === "internal").map((t) => t.amount), 0.95),
  };

  for (const tx of txns) {
    const set = new Set(tx.tags);
    const key = `${tx.direction}::${merchantStem(tx.who)}`;
    if ((monthsByWho.get(key)?.size ?? 0) >= 3) set.add("#recurring");
    if (tx.amount >= p95[tx.direction] && tx.amount > 0) set.add("#large");
    tx.tags = [...set];
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
