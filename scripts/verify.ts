// Headless end-to-end check of the core pipeline against the real statement.
// Bundled with esbuild and run under node (no DOM needed — the lib is pure).
import { readFileSync } from "node:fs";
import { parseStatement } from "../src/lib/parse";
import { buildSankey } from "../src/lib/sankey-model";
import { computeStats, monthlySeries, topCategories, topMerchants, recurring } from "../src/lib/analytics";
import { applyFilters, defaultFilters, boundsOf, groupKeyOf } from "../src/lib/filters";
import { applyOverrides } from "../src/lib/overrides";
import { BUILTIN_GROUPS } from "../src/types";

const path = process.argv[2] ?? "public/sample-statement.csv";
const text = readFileSync(path, "utf8");

const res = parseStatement(text);
const t = res.txns;
console.log("== PARSE ==");
console.log("format:", res.format, "| currency:", res.currency, "| holder:", res.accountHolder);
console.log("txns:", t.length);
const dates = t.map((x) => x.date).sort();
console.log("range:", dates[0], "->", dates[dates.length - 1]);
console.log("warnings:", res.warnings);

const stats = computeStats(t);
console.log("\n== STATS ==");
console.log("in:", stats.totalIn.toFixed(2), "| out:", stats.totalOut.toFixed(2), "| net:", stats.net.toFixed(2));
console.log("savings:", stats.savings.toFixed(2), "| spend:", stats.spend.toFixed(2), "| savingsRate:", (stats.savingsRate * 100).toFixed(1) + "%");
console.log("avg/mo:", stats.avgMonthlySpend.toFixed(0), "| months:", stats.months);
console.log("topCategory:", stats.topCategory, "| topMerchant:", stats.topMerchant);

console.log("\n== GROUPS ==");
const byGroup: Record<string, number> = {};
const byDir: Record<string, number> = {};
for (const x of t) {
  byGroup[x.group] = (byGroup[x.group] ?? 0) + x.amount;
  byDir[x.direction] = (byDir[x.direction] ?? 0) + 1;
}
console.log("group totals:", Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, v.toFixed(0)])));
console.log("direction counts:", byDir);

const uncateg = t.filter((x) => x.category === "Other");
console.log("uncategorised:", uncateg.length, `(${((uncateg.length / t.length) * 100).toFixed(1)}%)`);

console.log("\n== SANKEY FLOW CONSERVATION ==");
const m = buildSankey(t, 0, BUILTIN_GROUPS);
console.log("nodes:", m.nodes.length, "| links:", m.links.length);
console.log("totalIn:", m.totalIn.toFixed(2), "| totalOut:", m.totalOut.toFixed(2));
// hub balance
const hubIdx = m.nodes.findIndex((n) => n.id === "hub");
let intoHub = 0;
let outOfHub = 0;
let badLinks = 0;
for (const l of m.links) {
  if (!isFinite(l.value) || l.value <= 0) badLinks++;
  if (l.target === hubIdx) intoHub += l.value;
  if (l.source === hubIdx) outOfHub += l.value;
}
console.log("into hub:", intoHub.toFixed(2), "| out of hub:", outOfHub.toFixed(2), "| balanced:", Math.abs(intoHub - outOfHub) < 0.01);
console.log("non-positive/NaN links:", badLinks);
// value conservation: sum of category leaf values == totalOut ; income sources == totalIn
const leafSum = m.nodes.filter((n) => n.kind === "category").reduce((s, n) => s + n.value, 0);
const incSum = m.nodes.filter((n) => n.kind === "income").reduce((s, n) => s + n.value, 0);
console.log("category leaves sum:", leafSum.toFixed(2), "(== totalOut?", Math.abs(leafSum - m.totalOut) < 0.5, ")");
console.log("income sources sum:", incSum.toFixed(2), "(== totalIn?", Math.abs(incSum - m.totalIn) < 0.5, ")");

console.log("\n== TOP CATEGORIES ==");
for (const c of topCategories(t, 8)) console.log(`  ${c.total.toFixed(0).padStart(10)}  ${c.group}/${c.category} (${c.count})`);

console.log("\n== MONTHLY (first & last) ==");
const ms = monthlySeries(t);
console.log("months:", ms.length, "| first:", ms[0], "| last:", ms[ms.length - 1]);

console.log("\n== RECURRING (top 6) ==");
for (const r of recurring(t, 6)) console.log(`  ${r.who} — ${r.months}mo — ${r.total.toFixed(0)} total`);

console.log("\n== DEFAULT VIEW (internal excluded) ==");
const df = applyFilters(t, defaultFilters(boundsOf(t)));
const ds = computeStats(df);
console.log("txns in view:", df.length);
console.log("in:", ds.totalIn.toFixed(0), "| out:", ds.totalOut.toFixed(0), "| net(left over):", ds.net.toFixed(0));
const dm = buildSankey(df, 0, BUILTIN_GROUPS);
console.log("sankey nodes:", dm.nodes.length, "| surplus/deficit node:", dm.nodes.filter((n) => n.kind === "surplus" || n.kind === "deficit").map((n) => `${n.label}=${n.value.toFixed(0)}`));
console.log("top merchants:", topMerchants(df, 5).map((m) => `${m.who}(${m.total.toFixed(0)})`));
console.log("top categories:", topCategories(df, 6).map((c) => `${c.category}(${c.total.toFixed(0)})`));

console.log("\n== GROUP EXCLUSION (simulate unticking a category) ==");
{
  const base = ds; // default-view stats
  const topCat = topCategories(df, 1)[0];
  if (topCat) {
    const kept = df.filter((x) => groupKeyOf(x, "category") !== topCat.category);
    const after = computeStats(kept);
    const dropOut = base.totalOut - after.totalOut;
    console.log(`exclude "${topCat.category}" (total ${topCat.total.toFixed(0)}):`);
    console.log(`  out ${base.totalOut.toFixed(0)} -> ${after.totalOut.toFixed(0)} (dropped ${dropOut.toFixed(0)})`);
    console.log(`  recompute correct: ${Math.abs(dropOut - topCat.total) < 0.5}`);
    console.log(`  txns ${df.length} -> ${kept.length}`);
  }
}

console.log("\n== MANUAL OVERRIDE (reassign a merchant) ==");
{
  const top = require("../src/lib/analytics").topMerchants(t, 1)[0];
  if (top) {
    const eff = applyOverrides(t, { [top.who]: { group: "required", category: "ZZ Custom Cat" } }, BUILTIN_GROUPS);
    const changed = eff.filter((x: any) => x.category === "ZZ Custom Cat");
    const origCount = t.filter((x) => x.who === top.who).length;
    const allRequired = changed.every((x: any) => x.group === "required" && x.direction === "out");
    console.log(`override "${top.who}" -> required / "ZZ Custom Cat"`);
    console.log(`  matched txns: ${changed.length} (merchant had ${origCount}) — correct: ${changed.length === origCount}`);
    console.log(`  all reassigned to required/out: ${allRequired}`);
    console.log(`  1:1 length preserved: ${eff.length === t.length}`);
    console.log(`  tags updated: ${changed[0] ? changed[0].tags.includes("#required") && changed[0].tags.includes("#zz-custom-cat") : "n/a"}`);
  }
}

console.log("\n== 'Other' merchants (unmatched, top 12 by spend) ==");
const otherTot: Record<string, number> = {};
for (const x of uncateg) otherTot[x.who] = (otherTot[x.who] ?? 0) + x.amount;
Object.entries(otherTot).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([w, v]) => console.log(`  ${v.toFixed(0).padStart(8)}  ${w}`));
