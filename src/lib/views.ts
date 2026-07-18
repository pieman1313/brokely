// Saved filter "views": a named snapshot of the whole scoping state (filters +
// group-by dimension + group exclusions), persisted per-browser and re-applyable.

import type { Filters, GroupDim } from "./filters";

export interface SavedView {
  id: string;
  name: string;
  filters: Filters;
  groupBy: GroupDim;
  excluded: string[];
}

const LS_KEY = "spend.views.v1";

function isValid(v: unknown): v is SavedView {
  const d = v as SavedView;
  const f = d?.filters as Filters | undefined;
  return (
    !!d && typeof d.id === "string" && typeof d.name === "string" && typeof d.groupBy === "string" && Array.isArray(d.excluded) &&
    !!f && typeof f === "object" &&
    typeof f.start === "string" && typeof f.end === "string" && typeof f.search === "string" &&
    Array.isArray(f.directions) && Array.isArray(f.groups) && Array.isArray(f.categories) && Array.isArray(f.tags)
  );
}

export function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

export function saveViews(views: SavedView[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(views));
  } catch {
    /* ignore */
  }
}

export function newViewId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `v-${Math.random().toString(36).slice(2, 10)}`;
}

// order-independent snapshot for equality checks (defensive against partial data)
function normFilters(f: Filters) {
  return {
    start: f?.start ?? "",
    end: f?.end ?? "",
    directions: [...(f?.directions ?? [])].sort(),
    groups: [...(f?.groups ?? [])].sort(),
    categories: [...(f?.categories ?? [])].sort(),
    tags: [...(f?.tags ?? [])].sort(),
    search: (f?.search ?? "").trim(),
    minAmount: f?.minAmount ?? null,
    maxAmount: f?.maxAmount ?? null,
  };
}

export function viewSnapshot(filters: Filters, groupBy: GroupDim, excluded: Iterable<string>): string {
  return JSON.stringify({ filters: normFilters(filters), groupBy, excluded: [...(excluded ?? [])].sort() });
}

export function matchesView(v: SavedView, filters: Filters, groupBy: GroupDim, excluded: Set<string>): boolean {
  return viewSnapshot(v.filters, v.groupBy, v.excluded) === viewSnapshot(filters, groupBy, excluded);
}
