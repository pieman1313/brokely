// Group configuration: the full ordered list of top-level groups (built-ins +
// user-defined), persisted per-browser. A group's `kind` decides its side of the
// money flow. Built-ins can be renamed/recoloured but not deleted, and their kind
// is fixed (so the automatic tagging keeps working).

import type { GroupDef, GroupKind } from "../types";
import { BUILTIN_GROUPS, BUILTIN_KIND, CUSTOM_COLOR_SLOTS } from "../types";

const LS_KEY = "spend.groups.v2";
const KINDS: GroupKind[] = ["income", "spend", "transfers", "savings"];

function isValid(g: unknown): g is GroupDef {
  const d = g as GroupDef;
  return !!d && typeof d.id === "string" && typeof d.label === "string" && KINDS.includes(d.kind) && typeof d.colorVar === "string";
}

/** Merge saved config over the built-ins: keep saved label/colour, force built-in kind, append customs. */
export function normalizeGroups(saved: GroupDef[]): GroupDef[] {
  const byId = new Map(saved.map((g) => [g.id, g]));
  const result: GroupDef[] = [];
  for (const b of BUILTIN_GROUPS) {
    const s = byId.get(b.id);
    result.push({ id: b.id, label: s?.label || b.label, kind: b.kind, colorVar: s?.colorVar || b.colorVar, builtin: true });
  }
  for (const g of saved) {
    if (BUILTIN_KIND[g.id]) continue; // built-in, already added
    result.push({ ...g, builtin: false });
  }
  return result;
}

export function loadGroups(): GroupDef[] {
  let saved: GroupDef[] = [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) saved = parsed.filter(isValid);
    }
  } catch {
    /* ignore */
  }
  return normalizeGroups(saved);
}

export function saveGroups(list: GroupDef[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function groupMap(groups: GroupDef[]): Map<string, GroupDef> {
  return new Map(groups.map((g) => [g.id, g]));
}

/** Next unused custom colour slot (cycles once all are taken). */
export function nextColorVar(groups: GroupDef[]): string {
  const used = new Set(groups.filter((g) => !g.builtin).map((g) => g.colorVar));
  for (let i = 1; i <= CUSTOM_COLOR_SLOTS; i++) {
    const v = `custom-${i}`;
    if (!used.has(v)) return v;
  }
  // all slots taken → rotate by the number of custom groups so it advances, not sticks
  return `custom-${(groups.filter((g) => !g.builtin).length % CUSTOM_COLOR_SLOTS) + 1}`;
}

/** A stable, unique id derived from a label. */
export function slugId(label: string, existing: Set<string>): string {
  const base =
    "grp-" +
    (label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group");
  let id = base;
  let i = 2;
  while (existing.has(id)) id = `${base}-${i++}`;
  return id;
}
