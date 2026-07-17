// Filter state + application. Filters scope every view in the app.

import type { Direction, Group, Txn } from "../types";
import { GROUP_LABELS } from "../types";

/** Dimension the include/exclude table groups transactions by. */
export type GroupDim = "category" | "merchant" | "group";

/** Stable key for a transaction under a grouping dimension (used by the exclude set). */
export function groupKeyOf(t: Txn, dim: GroupDim): string {
  if (dim === "category") return t.category;
  if (dim === "merchant") return t.who || t.type || "—";
  return t.group;
}

/** Human label for a group key under a dimension. `labels` covers custom groups. */
export function groupLabelOf(key: string, dim: GroupDim, labels?: Record<string, string>): string {
  if (dim !== "group") return key;
  return labels?.[key] ?? GROUP_LABELS[key as Group] ?? key;
}

export interface Filters {
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
  directions: Direction[]; // which sides of the ledger to include
  groups: Group[]; // empty = all groups
  categories: string[]; // empty = all categories
  tags: string[]; // empty = all; a txn must contain ALL selected tags
  search: string; // substring over who / category / type
  minAmount: number | null;
  maxAmount: number | null;
}

/** Bounds of the loaded dataset, used to seed and clamp the date range. */
export interface DataBounds {
  minDate: string;
  maxDate: string;
}

export function boundsOf(txns: Txn[]): DataBounds {
  if (txns.length === 0) return { minDate: "1970-01-01", maxDate: "2100-01-01" };
  let min = txns[0].date;
  let max = txns[0].date;
  for (const t of txns) {
    if (t.date < min) min = t.date;
    if (t.date > max) max = t.date;
  }
  return { minDate: min, maxDate: max };
}

// Internal transfers (money between the user's own accounts — deposits, Revolut
// top-ups, own-account moves) are excluded by default: they dwarf real spending
// and aren't "spending". The "Internal" chip reveals them.
export const DEFAULT_DIRECTIONS: Direction[] = ["in", "out"];

export function defaultFilters(bounds: DataBounds): Filters {
  return {
    start: bounds.minDate,
    end: bounds.maxDate,
    directions: [...DEFAULT_DIRECTIONS],
    groups: [],
    categories: [],
    tags: [],
    search: "",
    minAmount: null,
    maxAmount: null,
  };
}

function sameDirections(a: Direction[]): boolean {
  return a.length === DEFAULT_DIRECTIONS.length && DEFAULT_DIRECTIONS.every((d) => a.includes(d));
}

export function applyFilters(txns: Txn[], f: Filters): Txn[] {
  const q = f.search.trim().toLowerCase();
  const dirs = new Set(f.directions);
  const groups = new Set(f.groups);
  const cats = new Set(f.categories);

  return txns.filter((t) => {
    if (t.date < f.start || t.date > f.end) return false;
    if (!dirs.has(t.direction)) return false;
    if (groups.size && !groups.has(t.group)) return false;
    if (cats.size && !cats.has(t.category)) return false;
    if (f.tags.length && !f.tags.every((tag) => t.tags.includes(tag))) return false;
    if (f.minAmount != null && t.amount < f.minAmount) return false;
    if (f.maxAmount != null && t.amount > f.maxAmount) return false;
    if (q) {
      const hay = `${t.who} ${t.category} ${t.type} ${t.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** True when any filter is narrowing the dataset (used to show a "clear" affordance). */
export function isFiltered(f: Filters, bounds: DataBounds): boolean {
  return (
    f.start !== bounds.minDate ||
    f.end !== bounds.maxDate ||
    !sameDirections(f.directions) ||
    f.groups.length > 0 ||
    f.categories.length > 0 ||
    f.tags.length > 0 ||
    f.search.trim() !== "" ||
    f.minAmount != null ||
    f.maxAmount != null
  );
}
