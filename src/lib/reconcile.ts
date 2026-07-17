// Reconciliation of non-completed (pending / reverted) transactions.
//
// Some statements (Revolut) include rows that haven't settled (PENDING) or were
// cancelled/refunded (REVERTED). They're parsed but kept OUT of every computation
// until the user decides, per row, to "adopt" (count it) or "remove" (ignore it).
// Undecided rows stay excluded and are surfaced for reconciliation.

import type { Txn } from "../types";

export type Decision = "adopt" | "dismiss";
export type Reconcile = Record<string, Decision>;

const LS_KEY = "spend.reconcile.v1";

/** True for a non-final row (pending/reverted). Stateless sources count as completed. */
export function isNonCompleted(t: Txn): boolean {
  return !!t.state && t.state.toUpperCase() !== "COMPLETED";
}

/**
 * Per-row decision key. Includes the content (so a decision doesn't bleed across a
 * different file's coincidentally-identical row) AND the row id (so two identical
 * pending rows in the same file get independent decisions and stable React keys).
 */
export function reconcileKey(t: Txn): string {
  return [t.date, t.type, t.amount, t.who, (t.state ?? "").toUpperCase(), t.id].join("|");
}

/** Whether a transaction should feed charts/totals. */
export function isCounted(t: Txn, r: Reconcile): boolean {
  if (!isNonCompleted(t)) return true; // completed / final → always counted
  return r[reconcileKey(t)] === "adopt"; // pending/reverted only once adopted
}

export function loadReconcile(): Reconcile {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Reconcile = {};
    for (const [k, v] of Object.entries(parsed)) if (v === "adopt" || v === "dismiss") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveReconcile(r: Reconcile): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}
