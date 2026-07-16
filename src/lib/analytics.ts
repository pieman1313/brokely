// Derived aggregates for the stat tiles and supporting charts.
// All functions take an already-filtered transaction set.

import type { Group, Txn } from "../types";
import { merchantLabel, merchantStem } from "./tagging";

/**
 * An *incoming* internal leg — money returning to this account from the user's
 * own savings/deposits/other accounts (a deposit maturity, an own-account
 * transfer in). It is neither income nor spending, so it must be excluded from
 * every money-flow aggregation (otherwise it double-counts against the matching
 * outgoing leg). It still appears in the transaction table.
 */
export function isInternalInflow(t: Txn): boolean {
  return t.direction === "internal" && t.credit > 0;
}

export interface Stats {
  totalIn: number;
  totalOut: number; // everything that is not income (spend + transfers + savings)
  net: number;
  savings: number; // savings group only
  spend: number; // required + optional + transfers (i.e. out excluding savings)
  savingsRate: number; // savings / totalIn
  avgMonthlySpend: number;
  months: number;
  txCount: number;
  topCategory: { category: string; total: number } | null;
  topMerchant: { who: string; total: number } | null;
}

export function computeStats(txns: Txn[]): Stats {
  let totalIn = 0;
  let totalOut = 0;
  let savings = 0;
  const catTotals = new Map<string, number>();
  const merchTotals = new Map<string, number>();
  let minDate = "9999";
  let maxDate = "0000";

  for (const t of txns) {
    if (t.date < minDate) minDate = t.date;
    if (t.date > maxDate) maxDate = t.date;
    if (isInternalInflow(t)) continue; // returning own money — not in/out
    if (t.group === "income") {
      totalIn += t.amount;
    } else {
      totalOut += t.amount;
      if (t.group === "savings") savings += t.amount;
      else catTotals.set(t.category, (catTotals.get(t.category) ?? 0) + t.amount);
      // "merchants" = places you spent at; person-to-person transfers aren't merchants
      if (t.direction === "out" && t.who && t.group !== "transfers") {
        merchTotals.set(t.who, (merchTotals.get(t.who) ?? 0) + t.amount);
      }
    }
  }

  const spend = totalOut - savings;
  // Use the true elapsed duration (fractional months), not the inclusive
  // calendar-bucket count — a 5-Jun-to-5-Jun year spans 12 months, not 13.
  const days = txns.length ? (Date.parse(maxDate) - Date.parse(minDate)) / 86_400_000 : 0;
  const fracMonths = Math.max(1, days / 30.437);
  const months = Math.max(1, Math.round(fracMonths));

  const topCat = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const topMerch = [...merchTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    savings,
    spend,
    savingsRate: totalIn > 0 ? savings / totalIn : 0,
    avgMonthlySpend: spend / fracMonths,
    months,
    txCount: txns.length,
    topCategory: topCat ? { category: topCat[0], total: topCat[1] } : null,
    topMerchant: topMerch ? { who: topMerch[0], total: topMerch[1] } : null,
  };
}

export interface MonthPoint {
  month: string;
  in: number;
  out: number;
  net: number;
}

/** Continuous monthly series across the span, filling empty months with zeros. */
export function monthlySeries(txns: Txn[]): MonthPoint[] {
  const map = new Map<string, MonthPoint>();
  for (const t of txns) {
    if (isInternalInflow(t)) continue; // returning own money isn't an outflow
    let p = map.get(t.month);
    if (!p) {
      p = { month: t.month, in: 0, out: 0, net: 0 };
      map.set(t.month, p);
    }
    if (t.group === "income") p.in += t.amount;
    else p.out += t.amount;
  }
  const pts = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (pts.length === 0) return pts;

  // fill gaps so the axis is continuous
  const filled: MonthPoint[] = [];
  let [y, m] = pts[0].month.split("-").map(Number);
  const [ey, em] = pts[pts.length - 1].month.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const p = map.get(key) ?? { month: key, in: 0, out: 0, net: 0 };
    p.net = p.in - p.out;
    filled.push(p);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return filled;
}

export interface CategoryTotal {
  group: Group;
  category: string;
  total: number;
  count: number;
}

export function topCategories(txns: Txn[], limit = 12): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const t of txns) {
    // spending categories only — income and own-account savings live elsewhere
    // (the Sankey + table). Keeps this list consistent with the "Top category" tile.
    if (t.group === "income" || t.group === "savings") continue;
    const key = `${t.group}::${t.category}`;
    let c = map.get(key);
    if (!c) {
      c = { group: t.group, category: t.category, total: 0, count: 0 };
      map.set(key, c);
    }
    c.total += t.amount;
    c.count++;
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export interface MerchantTotal {
  who: string;
  total: number;
  count: number;
  category: string;
}

export function topMerchants(txns: Txn[], limit = 12): MerchantTotal[] {
  const map = new Map<string, MerchantTotal>();
  for (const t of txns) {
    if (t.direction !== "out" || !t.who || t.group === "transfers") continue;
    let mt = map.get(t.who);
    if (!mt) {
      mt = { who: t.who, total: 0, count: 0, category: t.category };
      map.set(t.who, mt);
    }
    mt.total += t.amount;
    mt.count++;
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export interface Recurring {
  who: string;
  category: string;
  months: number;
  total: number;
  perMonth: number;
}

/** Likely recurring commitments: same counterparty seen across >= 3 distinct months. */
export function recurring(txns: Txn[], limit = 12): Recurring[] {
  // key on a normalised merchant stem so branch/case variants merge into one row
  const map = new Map<string, { display: string; months: Set<string>; total: number; category: string }>();
  for (const t of txns) {
    if (t.group === "income" || t.group === "savings" || t.direction === "internal" || !t.who) continue;
    const key = merchantStem(t.who);
    let r = map.get(key);
    if (!r) {
      // label by the chain (store code stripped), consistent with the merge key
      r = { display: merchantLabel(t.who), months: new Set(), total: 0, category: t.category };
      map.set(key, r);
    }
    r.months.add(t.month);
    r.total += t.amount;
  }
  return [...map.values()]
    .filter((r) => r.months.size >= 3)
    .map((r) => ({
      who: r.display,
      category: r.category,
      months: r.months.size,
      total: r.total,
      perMonth: r.total / r.months.size,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
