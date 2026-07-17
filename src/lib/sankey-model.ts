// Build the money-flow Sankey graph from a filtered transaction set.
//
// Shape (left -> right):
//   income sources  ->  "Available"  ->  spend groups  ->  categories
//                                    ->  "Left over"  (when income > outflow)
//   "Reserves"      ->  "Available"                   (when outflow > income)
//
// The hub is balanced (inflow == outflow) so the diagram reads as a true flow.
// The income/outflow split is by group KIND, so custom groups work too.

import type { GroupDef, Txn } from "../types";
import { groupMap } from "./groups";

export type NodeKind = "income" | "hub" | "group" | "category" | "surplus" | "deficit";

export interface SNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** css-variable colour slot: resolved as var(--g-<colorKey>) */
  colorKey: string;
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

export function buildSankey(txns: Txn[], minFlowPct = 0, groups: GroupDef[] = []): SankeyModel {
  const gmap = groupMap(groups);
  const colorOf = (groupId: string, fallback: string) => gmap.get(groupId)?.colorVar ?? fallback;

  const incomeByCat = new Map<string, { value: number; colorVar: string }>();
  const outByGroup = new Map<string, number>();
  const outByGroupCat = new Map<string, number>(); // key: `${group}::${cat}`

  let totalIn = 0;
  let totalOut = 0;

  for (const t of txns) {
    // returning own money (internal credit legs) is neither income nor an outflow
    if (t.direction === "internal" && t.credit > 0) continue;
    if (t.kind === "income") {
      const prev = incomeByCat.get(t.category);
      incomeByCat.set(t.category, { value: (prev?.value ?? 0) + t.amount, colorVar: prev?.colorVar ?? colorOf(t.group, "income") });
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
    const merged = new Map<string, { value: number; colorVar: string }>();
    for (const [cat, { value, colorVar }] of incomeByCat) {
      const small = value < threshold && cat !== "Salary";
      const key = small ? "Other income" : cat;
      const prev = merged.get(key);
      merged.set(key, { value: (prev?.value ?? 0) + value, colorVar: prev?.colorVar ?? (small ? "income" : colorVar) });
    }
    for (const [cat, { value, colorVar }] of merged) {
      if (value <= 0) continue;
      const ni = addNode({ id: `inc::${cat}`, label: cat, kind: "income", colorKey: colorVar, value });
      links.push({ source: ni, target: hub, value, colorKey: colorVar });
    }
  }

  // ---- balancing source / sink ----
  if (totalOut > totalIn) {
    const label = totalIn === 0 ? "Money out" : "Reserves / balance";
    const di = addNode({ id: "deficit", label, kind: "deficit", colorKey: "deficit", value: totalOut - totalIn });
    links.push({ source: di, target: hub, value: totalOut - totalIn, colorKey: "deficit" });
  }

  // ---- hub -> groups -> categories (outflow = every non-income group, in config order) ----
  const outGroups = groups.filter((g) => g.kind !== "income" && (outByGroup.get(g.id) ?? 0) > 0);
  // include any groups present in data but missing from config (safety)
  for (const id of outByGroup.keys()) if (!gmap.has(id)) outGroups.push({ id, label: id, kind: "spend", colorVar: id });

  for (const g of outGroups) {
    const gTotal = outByGroup.get(g.id) ?? 0;
    if (gTotal <= 0) continue;
    const color = g.colorVar;
    const gi = addNode({ id: `grp::${g.id}`, label: g.label, kind: "group", colorKey: color, value: gTotal });
    links.push({ source: hub, target: gi, value: gTotal, colorKey: color });

    let collapsed = 0;
    const kept: [string, number][] = [];
    for (const [k, v] of outByGroupCat) {
      if (!k.startsWith(`${g.id}::`)) continue;
      const cat = k.slice(g.id.length + 2);
      if (v < threshold) collapsed += v;
      else kept.push([cat, v]);
    }
    for (const [cat, v] of kept) {
      if (v <= 0) continue;
      const ci = addNode({ id: `cat::${g.id}::${cat}`, label: cat, kind: "category", colorKey: color, value: v });
      links.push({ source: gi, target: ci, value: v, colorKey: color });
    }
    if (collapsed > 0) {
      const ci = addNode({ id: `cat::${g.id}::__other`, label: "Other (small)", kind: "category", colorKey: color, value: collapsed });
      links.push({ source: gi, target: ci, value: collapsed, colorKey: color });
    }
  }

  // ---- surplus (unspent income) ----
  if (totalIn > totalOut) {
    const si = addNode({ id: "surplus", label: "Left over / saved", kind: "surplus", colorKey: "surplus", value: totalIn - totalOut });
    links.push({ source: hub, target: si, value: totalIn - totalOut, colorKey: "surplus" });
  }

  return { nodes, links, totalIn, totalOut, net: totalIn - totalOut };
}
