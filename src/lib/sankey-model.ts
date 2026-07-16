// Build the money-flow Sankey graph from a filtered transaction set.
//
// Shape (left -> right):
//   income sources  ->  "Available"  ->  spend groups  ->  categories
//                                    ->  "Unspent"  (when income > outflow)
//   "Reserves"      ->  "Available"                   (when outflow > income)
//
// The hub is balanced (inflow == outflow) so the diagram reads as a true flow.

import type { Group, Txn } from "../types";
import { GROUP_LABELS } from "../types";

export type NodeKind = "income" | "hub" | "group" | "category" | "surplus" | "deficit";

export interface SNode {
  /** stable unique id */
  id: string;
  label: string;
  kind: NodeKind;
  /** css-variable colour key: income|required|optional|transfers|savings|hub|surplus|deficit */
  colorKey: string;
  /** total value flowing through this node (for tooltip) */
  value: number;
}

export interface SLink {
  source: number;
  target: number;
  value: number;
  colorKey: string;
}

export interface SankeyModel {
  nodes: SNode[];
  links: SLink[];
  totalIn: number;
  totalOut: number;
  net: number;
}

const HUB_LABEL = "Available";

/** group -> css colour key (categories inherit their group's colour). */
function colorKeyForGroup(g: Group): string {
  return g; // css vars are named --g-income, --g-required, ...
}

export function buildSankey(txns: Txn[], minFlowPct = 0): SankeyModel {
  const incomeByCat = new Map<string, number>();
  const outByGroup = new Map<Group, number>();
  const outByGroupCat = new Map<string, number>(); // key: `${group}::${cat}`

  let totalIn = 0;
  let totalOut = 0;

  for (const t of txns) {
    // returning own money (internal credit legs) is neither income nor an
    // outflow — skip it so it doesn't double-count against its outgoing leg.
    if (t.direction === "internal" && t.credit > 0) continue;
    if (t.group === "income") {
      incomeByCat.set(t.category, (incomeByCat.get(t.category) ?? 0) + t.amount);
      totalIn += t.amount;
    } else {
      outByGroup.set(t.group, (outByGroup.get(t.group) ?? 0) + t.amount);
      const k = `${t.group}::${t.category}`;
      outByGroupCat.set(k, (outByGroupCat.get(k) ?? 0) + t.amount);
      totalOut += t.amount;
    }
  }

  const grand = Math.max(totalIn, totalOut);
  const threshold = grand * minFlowPct;

  const nodes: SNode[] = [];
  const links: SLink[] = [];
  const index = new Map<string, number>();

  const addNode = (n: SNode): number => {
    if (index.has(n.id)) return index.get(n.id)!;
    const i = nodes.length;
    nodes.push(n);
    index.set(n.id, i);
    return i;
  };

  if (grand === 0) return { nodes, links, totalIn, totalOut, net: 0 };

  const hub = addNode({ id: "hub", label: HUB_LABEL, kind: "hub", colorKey: "hub", value: grand });

  // ---- income sources -> hub (collapse tiny sources into "Other income") ----
  {
    const merged = new Map<string, number>();
    for (const [cat, v] of incomeByCat) {
      const key = v < threshold && cat !== "Salary" ? "Other income" : cat;
      merged.set(key, (merged.get(key) ?? 0) + v);
    }
    for (const [cat, v] of merged) {
      if (v <= 0) continue;
      const ni = addNode({ id: `inc::${cat}`, label: cat, kind: "income", colorKey: "income", value: v });
      links.push({ source: ni, target: hub, value: v, colorKey: "income" });
    }
  }

  // ---- balancing source / sink ----
  if (totalOut > totalIn) {
    // deficit: money came from reserves / prior balance
    const label = totalIn === 0 ? "Money out" : "Reserves / balance";
    const di = addNode({ id: "deficit", label, kind: "deficit", colorKey: "deficit", value: totalOut - totalIn });
    links.push({ source: di, target: hub, value: totalOut - totalIn, colorKey: "deficit" });
  }

  // ---- hub -> groups -> categories ----
  const GROUP_RENDER_ORDER: Group[] = ["required", "optional", "transfers", "savings"];
  for (const g of GROUP_RENDER_ORDER) {
    const gTotal = outByGroup.get(g) ?? 0;
    if (gTotal <= 0) continue;
    const gi = addNode({ id: `grp::${g}`, label: GROUP_LABELS[g], kind: "group", colorKey: colorKeyForGroup(g), value: gTotal });
    links.push({ source: hub, target: gi, value: gTotal, colorKey: colorKeyForGroup(g) });

    // categories within this group
    let collapsed = 0;
    const kept: [string, number][] = [];
    for (const [k, v] of outByGroupCat) {
      if (!k.startsWith(`${g}::`)) continue;
      const cat = k.slice(g.length + 2);
      if (v < threshold) collapsed += v;
      else kept.push([cat, v]);
    }
    for (const [cat, v] of kept) {
      if (v <= 0) continue;
      const ci = addNode({ id: `cat::${g}::${cat}`, label: cat, kind: "category", colorKey: colorKeyForGroup(g), value: v });
      links.push({ source: gi, target: ci, value: v, colorKey: colorKeyForGroup(g) });
    }
    if (collapsed > 0) {
      const ci = addNode({ id: `cat::${g}::__other`, label: "Other (small)", kind: "category", colorKey: colorKeyForGroup(g), value: collapsed });
      links.push({ source: gi, target: ci, value: collapsed, colorKey: colorKeyForGroup(g) });
    }
  }

  // ---- surplus (unspent income) ----
  if (totalIn > totalOut) {
    const si = addNode({ id: "surplus", label: "Left over / saved", kind: "surplus", colorKey: "surplus", value: totalIn - totalOut });
    links.push({ source: hub, target: si, value: totalIn - totalOut, colorKey: "surplus" });
  }

  return { nodes, links, totalIn, totalOut, net: totalIn - totalOut };
}
