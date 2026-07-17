// Statement parsing.
//
// Primary target: the Banca Transilvania / ING Romania "Tranzactii" export — a
// multi-line block format where each transaction is a header row (date, type,
// debit, credit) followed by indented "key:value" detail rows.
//
// Fallback: a generic flat CSV (one row per transaction) with heuristic column
// detection for date / amount / description, so an arbitrary statement still works.

import Papa from "papaparse";
import type { ParseResult, Txn } from "../types";
import { BUILTIN_KIND } from "../types";
import { baseTags, buildSelfMatcher, categorize, categorizeRevolut, cleanMerchant, enrichTags } from "./tagging";

const RO_MONTHS: Record<string, number> = {
  ianuarie: 1, februarie: 2, martie: 3, aprilie: 4, mai: 5, iunie: 6,
  iulie: 7, august: 8, septembrie: 9, octombrie: 10, noiembrie: 11, decembrie: 12,
};
const RO_DATE_RE = /^\s*(\d{1,2})\s+([a-zăâîșţț]+)\s+(\d{4})\s*$/i;

/** European amount: "1.234,56" -> 1234.56; "87,35" -> 87.35 */
function parseAmountEuro(s: string): number {
  const t = s.trim().replace(/"/g, "");
  if (!t) return 0;
  return Number(t.replace(/\./g, "").replace(",", ".")) || 0;
}

/** Best-effort amount parse for arbitrary CSVs (US or EU decimal separators). */
function parseAmountSmart(raw: string): number {
  let s = raw.trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // whichever comes last is the decimal separator
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma > -1) {
    // only comma: decimal if 1-2 digits follow, else thousands
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.split(",").join("");
  }
  return Number(s) || 0;
}

function toRows(text: string): string[][] {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return (res.data as string[][]).filter((r) => Array.isArray(r));
}

function looksLikeRevolut(rows: string[][]): boolean {
  const h = (rows[0] ?? []).map((c) => (c ?? "").trim().toLowerCase());
  return (
    h.includes("type") &&
    h.includes("amount") &&
    h.includes("state") &&
    (h.includes("completed date") || h.includes("started date"))
  );
}

function looksLikeBT(rows: string[][]): boolean {
  // scan a generous window — some exports carry extra preamble rows
  return rows.slice(0, 40).some(
    (r) =>
      r.some((c) => /Detalii tranzactie/i.test(c ?? "")) &&
      r.some((c) => /Debit/i.test(c ?? "")) &&
      r.some((c) => /Credit/i.test(c ?? ""))
  );
}

// ---------------------------------------------------------------------------
// Banca Transilvania / ING block parser
// ---------------------------------------------------------------------------
function parseBT(rows: string[][]): ParseResult {
  const warnings: string[] = [];
  let accountHolder: string | undefined;

  interface Cur {
    dateISO: string;
    type: string;
    debit: number;
    credit: number;
    details: Record<string, string>;
  }

  const blocks: Cur[] = [];
  let cur: Cur | null = null;
  let lastKey = ""; // most-recent detail key, so wrapped values can be appended

  for (const row of rows) {
    const c0 = (row[0] ?? "").trim();
    if (/^Titular cont:/i.test(c0)) {
      accountHolder = c0.replace(/^Titular cont:\s*/i, "").trim();
      continue;
    }
    if (c0 === "Data" || /^Sold/i.test(c0)) continue; // header / balance rows

    const m = c0.match(RO_DATE_RE);
    const monthNum = m ? RO_MONTHS[m[2].toLowerCase()] : undefined;

    if (m && monthNum) {
      if (cur) blocks.push(cur);
      lastKey = "";
      const day = +m[1];
      const year = +m[3];
      cur = {
        dateISO: `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        type: (row[3] ?? "").trim(),
        debit: parseAmountEuro(row[5] ?? ""),
        credit: parseAmountEuro(row[6] ?? ""),
        details: {},
      };
    } else if (cur && c0 === "") {
      // continuation detail line, e.g. "Tranzactie la:DIGI ROMANIA SA  RO  BUCURESTI"
      const detail = (row[3] ?? "").trim();
      if (!detail) continue;
      const idx = detail.indexOf(":");
      if (idx > -1) {
        const key = detail.slice(0, idx).trim();
        const val = detail.slice(idx + 1).trim();
        cur.details[key] = cur.details[key] ? `${cur.details[key]} ${val}` : val;
        lastKey = key;
      } else if (lastKey) {
        // wrapped value (no colon): append to the previous key rather than dropping it
        cur.details[lastKey] = `${cur.details[lastKey]} ${detail}`.trim();
      }
    }
  }
  if (cur) blocks.push(cur);

  // derive the "own name" matcher from the statement's account holder, so
  // transfers to/from the user's own accounts are recognised for any holder
  const self = buildSelfMatcher(accountHolder);
  const txns: Txn[] = blocks.map((b, i) => {
    const cat = categorize(b, self);
    return {
      id: `bt-${i}`,
      date: b.dateISO,
      month: b.dateISO.slice(0, 7),
      type: b.type,
      debit: b.debit,
      credit: b.credit,
      // amount is the transaction's magnitude, taken from whichever column is
      // populated (a BT row never has both). Do NOT key this off direction —
      // incoming *internal* rows (own-account transfers in, deposit maturities)
      // are credit-side and would otherwise be silently zeroed.
      amount: b.credit > 0 ? b.credit : b.debit,
      who: cat.who,
      group: cat.group,
      kind: BUILTIN_KIND[cat.group] ?? "spend",
      category: cat.category,
      direction: cat.direction,
      tags: baseTags(cat, b.dateISO),
      rule: cat.rule,
      details: b.details,
    };
  });

  enrichTags(txns);
  if (txns.length === 0) warnings.push("No transactions were recognised in this file.");
  return { txns, currency: "RON", accountHolder, format: "bt-ing-block", warnings };
}

// ---------------------------------------------------------------------------
// Revolut account-statement parser
// ---------------------------------------------------------------------------
function parseRevolut(text: string): ParseResult {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const data = (res.data as Record<string, string>[]).filter((r) => r && Object.keys(r).length);
  const warnings: string[] = [];

  const curCount = new Map<string, number>();
  let skippedState = 0;
  const txns: Txn[] = [];

  data.forEach((row, i) => {
    const state = (row["State"] ?? "").trim().toUpperCase();
    if (state && state !== "COMPLETED") { skippedState++; return; } // ignore reverted/pending
    // `||` (not `??`) so a present-but-blank Completed Date falls back to Started Date
    const dateISO = parseDateGuess((row["Completed Date"] || row["Started Date"] || "").trim());
    if (!dateISO) return;

    // Net the fee into the movement so each row is a single value and fees always
    // reduce the balance — a fee-only "Charge" (amount 0, fee>0) becomes an outflow,
    // and a fee on an inflow row is not silently dropped.
    const gross = parseAmountSmart(row["Amount"] ?? "0"); // signed: +in / -out
    const fee = Math.abs(parseAmountSmart(row["Fee"] ?? "0"));
    const net = gross - fee;
    const debit = net < 0 ? -net : 0;
    const credit = net > 0 ? net : 0;
    if (debit === 0 && credit === 0) return; // net-zero rows

    const cur = (row["Currency"] ?? "").trim();
    if (cur) curCount.set(cur, (curCount.get(cur) ?? 0) + 1);

    const cat = categorizeRevolut(row["Type"] ?? "", row["Description"] ?? "", credit, debit);
    txns.push({
      id: `rev-${i}`,
      date: dateISO,
      month: dateISO.slice(0, 7),
      type: row["Type"] ?? "",
      debit,
      credit,
      amount: credit > 0 ? credit : debit,
      // never leave a blank counterparty — it must round-trip as an override key
      who: cat.who || (row["Type"] ?? "").trim() || "Unknown",
      group: cat.group,
      kind: BUILTIN_KIND[cat.group] ?? "spend",
      category: cat.category,
      direction: cat.direction,
      tags: baseTags(cat, dateISO),
      rule: cat.rule,
      details: {
        Type: row["Type"] ?? "",
        Description: row["Description"] ?? "",
        Fee: row["Fee"] ?? "",
        Currency: cur,
        State: row["State"] ?? "",
      },
    });
  });

  enrichTags(txns);
  // dominant currency
  let currency = "";
  let best = 0;
  for (const [c, n] of curCount) if (n > best) { best = n; currency = c; }
  if (curCount.size > 1) warnings.push(`This export mixes ${curCount.size} currencies; amounts are shown as-is without conversion.`);
  if (skippedState > 0) warnings.push(`Skipped ${skippedState} non-completed (reverted/pending) transactions.`);
  if (txns.length === 0) warnings.push("No completed transactions were recognised in this file.");
  return { txns, currency, format: "revolut", warnings };
}

// ---------------------------------------------------------------------------
// Generic flat-CSV parser
// ---------------------------------------------------------------------------
function isoDate(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null; // reject bogus components
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateGuess(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // ISO-ish
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // DD-MM-YYYY (EU default)
  if (m) {
    let d = +m[1];
    let mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // was MM-DD
    return isoDate(+m[3], mo, d);
  }
  const parsed = new Date(t);
  // read LOCAL components — toISOString() would shift the day in UTC+ zones
  if (!isNaN(parsed.getTime())) return isoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  return null;
}

function parseGeneric(text: string): ParseResult {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const data = (res.data as Record<string, string>[]).filter((r) => r && Object.keys(r).length);
  const warnings: string[] = [];
  if (data.length === 0) return { txns: [], currency: "", format: "generic-flat", warnings: ["Could not read any rows from this file."] };

  const headers = Object.keys(data[0]);
  // once a header is claimed for a role it can't be reused for another
  const used = new Set<string>();
  const find = (...names: RegExp[]) => headers.find((h) => !used.has(h) && names.some((rx) => rx.test(h)));
  const claim = <T extends string | undefined>(h: T): T => { if (h) used.add(h); return h; };

  // date/description tokens are word-boundary anchored so they don't match as
  // substrings of unrelated headers (e.g. "zi" inside the Romanian "Magazin").
  const dateCol = claim(find(/\b(date|data|ziua|zi|time)\b/i)) ?? claim(headers[0]);
  const descCol =
    claim(find(/desc|detai|narrat|memo|reference|payee|merchant|name|beneficiar|note|info|title|comment/i)) ??
    // fallback: first unclaimed header that clearly isn't a date/amount/sign column
    claim(headers.find((h) => !used.has(h) && !/\b(date|data|zi|time|amount|suma|value|total|sum|debit|credit|sign|type|dr|cr)\b/i.test(h))) ??
    "";
  // A combined "Debit/Credit" indicator is a SIGN column, not an amount column —
  // claim the sign column first so it isn't grabbed as a debit amount.
  const signCol = claim(find(/^(type|sign|direction|dr.?cr|debit.?credit|d\/c)$/i));
  const debitCol = claim(find(/debit|withdraw|paid ?out|plata/i));
  const creditCol = claim(find(/credit|deposit|paid ?in|incasare/i));
  // exact names first, then a loose fallback — never the date/desc/sign column
  const amountCol = claim(find(/^(amount|suma|value|total|sum)$/i)) ?? claim(find(/amount|suma|value|total|sum/i));

  const txns: Txn[] = [];
  let usedAmountPath = false;
  let sawDebit = false;
  data.forEach((row, i) => {
    const dateISO = parseDateGuess(row[dateCol] ?? "");
    if (!dateISO) return;
    let debit = 0;
    let credit = 0;
    if (debitCol || creditCol) {
      debit = debitCol ? Math.abs(parseAmountSmart(row[debitCol] ?? "")) : 0;
      credit = creditCol ? Math.abs(parseAmountSmart(row[creditCol] ?? "")) : 0;
    } else if (amountCol) {
      usedAmountPath = true;
      const raw = row[amountCol] ?? "";
      let v = parseAmountSmart(raw);
      const explicitlySigned = /^\s*[-(]/.test(raw) || v < 0;
      // Only let a sign column decide direction when the number isn't already
      // signed, and match the sign token as a WHOLE value (not a substring, so
      // "Online"/"Dining" can't masquerade as a credit/debit marker).
      if (signCol && !explicitlySigned) {
        const sig = (row[signCol] ?? "").trim().toLowerCase();
        if (/^(d|dr|db|debit|withdrawal|out|expense|payment)$/.test(sig)) v = -Math.abs(v);
        else if (/^(c|cr|credit|deposit|in|income)$/.test(sig)) v = Math.abs(v);
      }
      if (v >= 0) credit = v;
      else { debit = -v; sawDebit = true; }
    }
    if (debit === 0 && credit === 0) return;
    if (debitCol && debit > 0) sawDebit = true;

    const desc = cleanMerchant(row[descCol] ?? "");
    const details: Record<string, string> = credit > 0 ? { Ordonator: desc } : { "Tranzactie la": desc };
    const input = {
      type: credit > 0 ? "Incasare" : "Cumparare POS",
      debit,
      credit,
      details,
    };
    const cat = categorize(input);
    txns.push({
      id: `gen-${i}`,
      date: dateISO,
      month: dateISO.slice(0, 7),
      type: input.type,
      debit,
      credit,
      amount: credit > 0 ? credit : debit,
      who: cat.who || desc,
      group: cat.group,
      kind: BUILTIN_KIND[cat.group] ?? "spend",
      category: cat.category,
      direction: cat.direction,
      tags: baseTags(cat, dateISO),
      rule: cat.rule,
      details: { Description: row[descCol] ?? "" },
    });
  });

  enrichTags(txns);
  if (txns.length === 0) warnings.push("Found rows but couldn't extract dated amounts — check the column names.");
  else {
    warnings.push(`Read as a generic CSV (date="${dateCol}", description="${descCol || "—"}"). Categorisation may be rough.`);
    if (usedAmountPath && !sawDebit) {
      warnings.push(`No spending was detected — every amount came out positive with no debit/credit split or usable sign column, so it's all treated as incoming. If this file mixes income and spending, split it into debit/credit columns or use signed amounts.`);
    }
  }
  return { txns, currency: "", format: "generic-flat", warnings };
}

/** Entry point: sniff the format and parse. */
export function parseStatement(text: string): ParseResult {
  const rows = toRows(text);
  if (looksLikeRevolut(rows)) return parseRevolut(text);
  if (looksLikeBT(rows)) return parseBT(rows);
  return parseGeneric(text);
}
