// Round-trip fidelity check: parse a statement → export in the ORIGINAL format →
// re-parse the export → assert the transactions are identical. Covers all three
// formats, plus a FILTERED subset (the real use case: export only some rows).
//
//   npx esbuild scripts/roundtrip.ts --bundle --platform=node --format=esm --outfile=/tmp/rt.mjs && node /tmp/rt.mjs

import { readFileSync } from "node:fs";
import { parseStatement } from "../src/lib/parse";
import { toOriginalCsv } from "../src/lib/export-csv";
import type { Txn } from "../src/types";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
};

// #recurring and #large are aggregates over the *visible* set (a merchant seen in
// 3+ months / an amount in the top percentile), so a filtered subset legitimately
// recomputes them. Everything else is per-row and must survive verbatim.
const stableTags = (t: Txn) => t.tags.filter((x) => x !== "#recurring" && x !== "#large").sort().join(" ");
// full fidelity: raw data + category + ALL tags (only valid for a whole-file round-trip)
const canonFull = (t: Txn) =>
  JSON.stringify([t.date, t.type, t.who, t.debit, t.credit, t.amount, t.group, t.category, t.direction, t.state ?? "", [...t.tags].sort().join(" ")]);
// core fidelity: raw data + category + per-row tags (valid for any subset)
const canonCore = (t: Txn) =>
  JSON.stringify([t.date, t.type, t.who, t.debit, t.credit, t.amount, t.group, t.category, t.direction, t.state ?? "", stableTags(t)]);
const sameBy = (f: (t: Txn) => string) => (a: Txn[], b: Txn[]) => a.length === b.length && a.every((t, i) => f(t) === f(b[i]));
const sameTxns = sameBy(canonFull);
const sameCore = sameBy(canonCore);

function roundtrip(label: string, text: string, subsetPick: (t: Txn, i: number) => boolean) {
  const parsed = parseStatement(text);
  check(`${label}: parsed some txns`, parsed.txns.length > 0, `${parsed.txns.length} txns, format=${parsed.format}`);
  check(`${label}: original source captured`, !!parsed.original, `format=${parsed.original?.format}`);
  if (!parsed.original) return;

  // FULL round-trip
  const full = toOriginalCsv(parsed.txns, parsed.original);
  const re = parseStatement(full);
  check(`${label}: re-parse detects same format`, re.format === parsed.format, `${parsed.format} → ${re.format}`);
  check(`${label}: FULL round-trip identical`, sameTxns(parsed.txns, re.txns), `${parsed.txns.length} vs ${re.txns.length}`);

  // FILTERED round-trip (export only a subset, as the app does with active filters).
  // Raw data + category + per-row tags must be identical; set-relative aggregate tags
  // (#recurring/#large) legitimately recompute over the smaller set.
  const subset = parsed.txns.filter(subsetPick);
  const subCsv = toOriginalCsv(subset, parsed.original);
  const reSub = parseStatement(subCsv);
  check(`${label}: FILTERED re-parse detects same format`, reSub.format === parsed.format);
  check(`${label}: FILTERED round-trip preserves data + category`, sameCore(subset, reSub.txns), `${subset.length} vs ${reSub.txns.length}`);
}

// ---- BT / ING block format (the bundled sample) ----
try {
  const bt = readFileSync(`${process.cwd()}/public/sample-statement.csv`, "utf8");
  roundtrip("BT", bt, (_t, i) => i % 3 === 0); // keep every 3rd txn
} catch (e) {
  check("BT: sample-statement.csv present", false, (e as Error).message);
}

// ---- Revolut flat CSV ----
const revolut = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
Card Payment,Current,2024-01-02 10:00:00,2024-01-02 12:00:00,Lidl,-42.50,0.00,EUR,COMPLETED,957.50
Topup,Current,2024-01-03 09:00:00,2024-01-03 09:05:00,Apple Pay Top-Up,100.00,0.00,EUR,COMPLETED,1057.50
Card Payment,Current,2024-01-04 20:00:00,2024-01-04 21:00:00,"Restaurant, The Corner",-30.00,0.50,EUR,COMPLETED,1027.00
Transfer,Current,2024-01-05 08:00:00,,To John,-15.00,0.00,EUR,PENDING,1027.00
Exchange,Current,2024-01-06 08:00:00,2024-01-06 08:00:00,Exchanged to USD,-20.00,0.20,EUR,COMPLETED,1006.80`;
roundtrip("Revolut", revolut, (t) => t.direction === "out");

// ---- Generic flat CSV (debit/credit columns) ----
const generic = `Date,Description,Debit,Credit
2024-02-01,Coffee Shop,3.50,
2024-02-02,Salary Corp,,2500.00
2024-02-03,"Grocery, Big Store",88.20,
2024-02-04,Refund Amazon,,19.99`;
roundtrip("Generic", generic, (t) => t.credit > 0);

// ---- header fidelity: tricky headers must survive byte-for-byte ----
// (whitespace-padded, duplicate, and trailing-blank column names)
function headerFidelity(label: string, text: string) {
  const parsed = parseStatement(text);
  if (!parsed.original) return check(`${label}: original captured`, false);
  const out = toOriginalCsv(parsed.txns, parsed.original);
  const srcHeader = text.split(/\r?\n/)[0];
  const outHeader = out.split(/\r?\n/)[0];
  check(`${label}: header line byte-identical`, outHeader === srcHeader, `src="${srcHeader}" out="${outHeader}"`);
}
headerFidelity(
  "Header (whitespace + duplicate)",
  `Date, Description ,Amount,Note,Note\n2024-03-01,Coffee,-3.50,a,b\n2024-03-02,Salary,2500,c,d`
);
headerFidelity(
  "Header (trailing blanks)",
  `Date,Description,Amount,,\n2024-03-01,Coffee,-3.50,x,y\n2024-03-02,Salary,2500,p,q`
);

console.log(failures === 0 ? "\nALL ROUND-TRIP TESTS PASS" : `\n${failures} ROUND-TRIP FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
