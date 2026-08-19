// Deterministic checks for the generic-CSV parser edge cases raised in review.
import { parseStatement } from "../src/lib/parse";
import { applyOverrides } from "../src/lib/overrides";
import { computeStats } from "../src/lib/analytics";
import { buildSankey } from "../src/lib/sankey-model";
import { isCounted, reconcileKey } from "../src/lib/reconcile";
import { defaultFilters } from "../src/lib/filters";
import { matchesView } from "../src/lib/views";
import { keyRows } from "../src/lib/row-exclude";
import { BUILTIN_GROUPS } from "../src/types";

let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) fail++;
}
const dirs = (csv: string) => parseStatement(csv).txns.map((t) => `${t.who || "?"}:${t.direction}:${t.amount}`);

// 1) explicit negative amounts must NOT be flipped by a misleading "Type" column
{
  const csv = `Date,Description,Amount,Type
2026-06-05,Coffee shop,-12.50,Online
2026-06-06,Restaurant,-40.00,Dining
2026-06-07,Gym,-30.00,Card Payment
2026-06-08,Salary,3000.00,Incoming`;
  const r = parseStatement(csv).txns;
  const out = r.filter((t) => t.direction === "out").length;
  const inc = r.filter((t) => t.direction === "in").length;
  check("signed amounts: 3 out / 1 in (Online/Dining not flipped)", out === 3 && inc === 1, dirs(csv).join(", "));
}

// 2) DR/CR sign column with unsigned amounts
{
  const csv = `Date,Description,Amount,DrCr
2026-06-05,Shop,12.50,DR
2026-06-06,Refund,40.00,CR`;
  const r = parseStatement(csv).txns;
  check("DR/CR: Shop=out, Refund=in", r[0].direction === "out" && r[1].direction === "in", dirs(csv).join(", "));
}

// 3) Romanian headers where a merchant col ("Magazin") must not be taken as date
{
  const csv = `Magazin,Data,Suma
Kaufland,2026-06-05,-50.00
Salary Corp,2026-06-06,3000.00`;
  const r = parseStatement(csv).txns;
  check("Magazin not date; Suma parsed; Kaufland=out", r.length === 2 && r[0].direction === "out" && r[0].who.includes("Kaufland"), dirs(csv).join(", "));
}

// 4) Date,Time,Amount,Note — description must be Note, not Time
{
  const csv = `Date,Time,Amount,Note
2026-06-05,10:00,-20,Groceries at Lidl`;
  const r = parseStatement(csv).txns;
  check("desc=Note not Time", r.length === 1 && /Groceries/.test(r[0].who), `who="${r[0]?.who}"`);
}

// 5) "Value Date" must be the date col, real "Amount" must be the amount
{
  const csv = `Value Date,Description,Amount
2026-06-05,Shop,-10`;
  const r = parseStatement(csv).txns;
  check("Value Date handled, Amount used", r.length === 1 && r[0].amount === 10 && r[0].direction === "out", dirs(csv).join(", "));
}

// 6) all-positive single amount, no sign info -> warning present
{
  const csv = `Date,Description,Amount
2026-06-05,Shop,10
2026-06-06,Other,20`;
  const res = parseStatement(csv);
  check("all-positive warning present", res.warnings.some((w) => /treated as incoming/.test(w)), res.warnings.join(" | "));
}

// 7) date range validation: reject 2026-13-40
{
  const csv = `Date,Description,Amount
2026-13-40,Bad,-5
2026-06-06,Good,-5`;
  const r = parseStatement(csv).txns;
  check("bogus date row skipped", r.length === 1, `${r.length} rows`);
}

// 8) DIFFERENT account holder (wife-simulation): own-name derived from the
//    statement, so her own-account transfer is savings, a real person is a transfer.
{
  const csv = [
    "Titular cont: DNA Maria Ionescu,,,,,,",
    "Data,,,Detalii tranzactie,,Debit,Credit",
    `05 iunie 2026,,,Transfer Home'Bank,,"600,00",`,
    ",,,Beneficiar:Maria Ionescu,,,",
    ",,,In contul:RO12BTRL0000000000000000,,,",
    `04 iunie 2026,,,Transfer Home'Bank,,"200,00",`,
    ",,,Beneficiar:Andrei Georgescu,,,",
    ",,,In contul:RO99BTRL0000000000000001,,,",
  ].join("\n");
  const r = parseStatement(csv).txns;
  const own = r.find((t) => t.who.includes("Maria"));
  const other = r.find((t) => t.who.includes("Andrei"));
  check(
    "different holder: own transfer→savings, person→transfers",
    !!own && own.group === "savings" && !!other && other.group === "transfers",
    `${own?.group}/${other?.group}`
  );
}

// 9) manual override must respect each leg's sign: reclassifying a merchant with a
//    purchase (debit) AND a refund (credit) to a spend group must NOT count the refund as spend.
{
  const csv = [
    "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
    "Card Payment,Current,2026-01-05 10:00:00,2026-01-05 10:00:00,ACME Store,-100,0,RON,COMPLETED,0",
    "Card Payment,Current,2026-01-06 10:00:00,2026-01-06 10:00:00,ACME Store,40,0,RON,COMPLETED,0",
    "Card Payment,Current,2026-01-07 10:00:00,2026-01-07 10:00:00,ACME Store,-30,0,RON,COMPLETED,0",
  ].join("\n");
  const base = parseStatement(csv).txns;
  const eff = applyOverrides(base, { "ACME Store": { group: "optional", category: "Shopping & retail" } }, BUILTIN_GROUPS);
  const s = computeStats(eff);
  const shopping = eff.filter((t) => t.category === "Shopping & retail");
  const refund = eff.find((t) => t.credit > 0);
  check(
    "override respects sign: purchases→spend, refund stays income",
    shopping.length === 2 && shopping.every((t) => t.direction === "out") &&
      !!refund && refund.group === "income" && refund.direction === "in" &&
      Math.round(s.totalOut) === 130 && Math.round(s.totalIn) === 40,
    `out=${s.totalOut} in=${s.totalIn} shopping=${shopping.length} refundGroup=${refund?.group}`
  );
}

// 10) a CUSTOM top-level group works end-to-end (override → kind → Sankey node)
{
  const csv = "Date,Description,Amount\n2026-01-05,Acme Broker,-500\n2026-01-06,Acme Broker,-250";
  const base = parseStatement(csv).txns;
  const groups = [...BUILTIN_GROUPS, { id: "grp-invest", label: "Investments", kind: "spend" as const, colorVar: "custom-1", builtin: false }];
  const eff = applyOverrides(base, { "Acme Broker": { group: "grp-invest", category: "Brokerage" } }, groups);
  const model = buildSankey(eff, 0, groups);
  const groupNode = model.nodes.find((n) => n.kind === "group" && n.label === "Investments");
  check(
    "custom group: assigned, spend-kind, own Sankey node with its colour",
    eff.every((t) => t.group === "grp-invest" && t.kind === "spend" && t.direction === "out") &&
      !!groupNode && groupNode.colorKey === "custom-1" && Math.round(model.totalOut) === 750,
    `group=${eff[0]?.group} kind=${eff[0]?.kind} node=${groupNode?.label}/${groupNode?.colorKey}`
  );
}

// 11) reconciliation: pending/reverted parsed but excluded until adopted
{
  const csv = [
    "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
    "Card Payment,Current,2026-01-05 10:00:00,2026-01-05 10:00:00,Shop A,-100,0,RON,COMPLETED,0",
    "Card Payment,Current,2026-01-06 10:00:00,2026-01-06 10:00:00,Shop B,-50,0,RON,PENDING,0",
    "Card Payment,Current,2026-01-07 10:00:00,2026-01-07 10:00:00,Shop C,-30,0,RON,REVERTED,0",
  ].join("\n");
  const all = parseStatement(csv).txns;
  const pendingRow = all.find((t) => t.state === "PENDING")!;
  const countedDefault = all.filter((t) => isCounted(t, {}));
  const countedAdopted = all.filter((t) => isCounted(t, { [reconcileKey(pendingRow)]: "adopt" }));
  check(
    "reconcile: 3 parsed, only COMPLETED counts by default, adopting PENDING includes it",
    all.length === 3 && countedDefault.length === 1 && computeStats(countedDefault).totalOut === 100 &&
      countedAdopted.length === 2 && computeStats(countedAdopted).totalOut === 150,
    `parsed=${all.length} default=${countedDefault.length} adopted=${countedAdopted.length}`
  );
}

// 12) saved-view equality: matches identical state (order-independent), not a changed one
{
  const f = defaultFilters({ minDate: "2025-01-01", maxDate: "2025-12-31" });
  const v = { id: "x", name: "n", filters: { ...f, groups: ["required", "optional"] }, groupBy: "category" as const, excluded: ["savings"] };
  const same = matchesView(v, { ...f, groups: ["optional", "required"] }, "category", new Set(["savings"])); // reordered groups + set
  const diffSearch = matchesView(v, { ...f, groups: ["required", "optional"], search: "coffee" }, "category", new Set(["savings"]));
  const diffExcl = matchesView(v, { ...f, groups: ["required", "optional"] }, "category", new Set());
  check("saved view: order-independent match; detects changes", same === true && diffSearch === false && diffExcl === false, `same=${same} diffSearch=${diffSearch} diffExcl=${diffExcl}`);
}

// 13) BT/ING export variant where extra columns (spacer + trailing "Balanta")
//     shift Debit from col 5 to col 4 — debit/credit indices must be read from the
//     header, not hardcoded, or every spend row reads 0 and looks like all-income.
{
  const csv = `Titular cont: DL Test,,,,,,,
Data,,,Detalii tranzactie,Debit,,Credit,Balanta
05 iunie 2026,,,Cumparare POS,"680,00",,,"1.815,17"
,,,Tranzactie la:MEGA IMAGE  RO  TIMISOARA,,,,
05 iunie 2026,,,Incasare,,,"1.000,00","2.815,17"
,,,Ordonator:Someone Else,,,,`;
  const r = parseStatement(csv).txns;
  const pos = r.find((t) => t.type === "Cumparare POS");
  const inc = r.find((t) => t.type === "Incasare");
  check(
    "BT shifted columns (Balanta): POS is a real outflow, Incasare is inflow",
    !!pos && pos.debit === 680 && pos.direction === "out" && !!inc && inc.credit === 1000,
    `pos.debit=${pos?.debit} pos.dir=${pos?.direction} inc.credit=${inc?.credit}`
  );
}

// 14) per-row exclusion keys: the two legs of an internal transfer (-10 / +10 on the
//     same day, same description) must get DIFFERENT keys, so the inflow leg can be
//     dropped on its own; and excluding it must remove it from the totals.
{
  const csv = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
Card Payment,Current,2026-01-02 10:00:00,2026-01-02 12:00:00,Lidl,-42.50,0.00,RON,COMPLETED,900.00
Transfer,Current,2026-01-03 09:00:00,2026-01-03 09:00:00,To Emergency Fund,-10.00,0.00,RON,COMPLETED,890.00
Transfer,Savings,2026-01-03 09:00:00,2026-01-03 09:00:00,To Emergency Fund,10.00,0.00,RON,COMPLETED,10.00`;
  const txns = parseStatement(csv).txns;
  const keys = keyRows(txns);
  const out = txns.find((t) => t.debit === 10)!;
  const inn = txns.find((t) => t.credit === 10)!;
  check(
    "row keys: the -10 and +10 legs of one transfer are independently selectable",
    keys.get(out.id) !== keys.get(inn.id),
    `${keys.get(out.id)} vs ${keys.get(inn.id)}`
  );

  const before = computeStats(txns);
  const kept = txns.filter((t) => keys.get(t.id) !== keys.get(inn.id));
  const after = computeStats(kept);
  check(
    "excluding the +10 leg drops it from income but keeps the -10 outflow",
    before.totalIn === 10 && after.totalIn === 0 && after.totalOut === before.totalOut,
    `in ${before.totalIn}→${after.totalIn}, out ${before.totalOut}→${after.totalOut}`
  );
}

// 15) row keys must disambiguate genuine duplicates, and must NOT change when a
//     merchant is re-tagged by an override (or every exclusion would be orphaned).
{
  const csv = `Date,Description,Debit,Credit
2026-02-01,Coffee Bar,5.00,
2026-02-01,Coffee Bar,5.00,
2026-02-02,Lidl,20.00,`;
  const txns = parseStatement(csv).txns;
  const keys = keyRows(txns);
  const dupes = txns.filter((t) => t.who === "Coffee Bar");
  check(
    "row keys: two identical same-day rows get distinct keys",
    dupes.length === 2 && keys.get(dupes[0].id) !== keys.get(dupes[1].id),
    [...keys.values()].join("  ")
  );

  const retagged = applyOverrides(txns, { "Coffee Bar": { group: "required", category: "Groceries" } }, BUILTIN_GROUPS);
  const keys2 = keyRows(retagged);
  const stable = txns.every((t) => keys.get(t.id) === keys2.get(t.id));
  check("row keys survive re-tagging a merchant (override-invariant)", stable);
}

// 16) two rows identical except for the statement's own detail lines (authorisation
//     number) must get distinct keys, and removing one must NOT shift the other's key —
//     otherwise exporting the filtered view silently deletes the surviving sibling.
{
  const csv = `Titular cont: DL Test,,,,,,
Data,,,Detalii tranzactie,,Debit,Credit
10 mai 2026,,,Cumparare POS,,"10,00",
,,,Tranzactie la:ENERGY GAMES  RO  TIMISOARA,,,
,,,Numar autorizare:250035,,,
10 mai 2026,,,Cumparare POS,,"10,00",
,,,Tranzactie la:ENERGY GAMES  RO  TIMISOARA,,,
,,,Numar autorizare:367826,,,`;
  const txns = parseStatement(csv).txns;
  const keys = keyRows(txns);
  check("row keys: same-day same-amount rows differ by authorisation number", txns.length === 2 && keys.get(txns[0].id) !== keys.get(txns[1].id), [...keys.values()].join(" "));
  check("row keys: no positional fallback needed for those rows", ![...keys.values()].some((k) => k.includes("#")));

  // drop the first row (what an export of the filtered view does) → survivor keeps its key
  const survivorKeyBefore = keys.get(txns[1].id);
  const afterKeys = keyRows([txns[1]]);
  check("row keys: removing a sibling does not change the survivor's key", afterKeys.get(txns[1].id) === survivorKeyBefore, `${survivorKeyBefore} vs ${afterKeys.get(txns[1].id)}`);
}

// 17) keys are opaque hashes — no readable merchant/amount is persisted to localStorage
{
  const csv = `Date,Description,Debit,Credit
2026-02-01,SECRET MERCHANT NAME,123.45,`;
  const keys = [...keyRows(parseStatement(csv).txns).values()];
  check(
    "row keys leak no plaintext transaction data",
    keys.length === 1 && !/SECRET|123\.45|2026-02-01/.test(keys[0]),
    keys[0]
  );
}

console.log(fail === 0 ? "\nALL GENERIC TESTS PASS" : `\n${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
