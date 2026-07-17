// Manual reclassification rules.
//
// The user can assign a chosen group + category to an entire merchant (every
// transaction whose counterparty matches). Overrides win over the automatic
// tagging and are applied BEFORE any aggregation, so the Sankey, tiles, charts,
// grouped table and totals all reflect them. Persisted per-browser (localStorage).

import type { Direction, Group, GroupDef, Txn } from "../types";
import { baseTags } from "./tagging";
import { groupMap } from "./groups";

export interface Override {
  group: Group;
  category: string;
}
/** merchant `who` -> assignment */
export type Overrides = Record<string, Override>;

const LS_KEY = "spend.overrides.v1";

export function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Overrides) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(o: Overrides): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable — overrides just won't persist */
  }
}

/**
 * Re-tag any transaction whose merchant has a manual override. 1:1, order-preserving.
 *
 * A transaction's ledger side (in / out) is set by its own credit/debit sign, NOT by the
 * chosen group. So an override only reclassifies legs whose natural sign matches the target
 * group's side: a spend/transfers group applies to *outgoing* legs, an income group to
 * *incoming* legs, and savings to either (an internal move). This means a refund (credit)
 * at a merchant you reclassify to "Shopping" stays income rather than being counted as
 * spend, and an incoming own-account leg reclassified to a spend group is not double-counted.
 */
export function applyOverrides(txns: Txn[], overrides: Overrides, groups: GroupDef[] = []): Txn[] {
  if (Object.keys(overrides).length === 0) return txns;
  const gmap = groupMap(groups);
  return txns.map((t) => {
    const ov = t.who ? overrides[t.who] : undefined; // never key off an empty merchant
    if (!ov) return t;
    const kind = gmap.get(ov.group)?.kind ?? "spend"; // group may have been deleted → treat as spend

    const incoming = t.credit > 0; // this leg's real money direction
    let direction: Direction;
    if (kind === "savings") {
      direction = "internal";
    } else if (kind === "income") {
      if (!incoming) return t; // an outgoing leg can't become income
      direction = "in";
    } else {
      if (incoming) return t; // don't sweep a refund/incoming leg onto the outflow side
      direction = "out";
    }

    const cat = { group: ov.group, category: ov.category, who: t.who, direction, rule: "override:manual" };
    // rebuild group/category tags; preserve the cross-transaction & cash behavioural tags
    const behavioural = t.tags.filter((x) => x === "#recurring" || x === "#large" || x === "#cash");
    const tags = [...new Set([...baseTags(cat, t.date), ...behavioural])];
    return { ...t, group: ov.group, kind, category: ov.category, direction, rule: "override:manual", tags };
  });
}

/** Distinct counterparties in a set, most-frequent first (for the merchant picker). */
export function distinctMerchants(txns: Txn[]): string[] {
  const count = new Map<string, number>();
  for (const t of txns) if (t.who) count.set(t.who, (count.get(t.who) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

/** Distinct categories with the group they currently roll up to (for the category picker). */
export function categoriesWithGroup(txns: Txn[]): { name: string; group: Group }[] {
  const map = new Map<string, Group>();
  for (const t of txns) if (!map.has(t.category)) map.set(t.category, t.group);
  return [...map.entries()]
    .map(([name, group]) => ({ name, group }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
