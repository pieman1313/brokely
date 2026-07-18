// Core data model shared across the app.

/** Which side of the ledger a transaction lands on. */
export type Direction = "in" | "out" | "internal";

/**
 * How a group participates in the money flow — this (not the group id) decides
 * which side of the ledger a transaction lands on:
 * - income    : money arriving (inflow side)
 * - spend     : discretionary/non-discretionary spending (outflow side)
 * - transfers : money sent to other people (outflow, but not a "merchant")
 * - savings   : moves between the user's own accounts (internal)
 */
export type GroupKind = "income" | "spend" | "transfers" | "savings";

/** A top-level group. Built-in or user-defined; identified by a stable id. */
export type Group = string;

export interface GroupDef {
  id: string;
  label: string;
  kind: GroupKind;
  /** CSS colour slot: resolved as var(--g-<colorVar>). */
  colorVar: string;
  /** true for the five built-in groups (cannot be deleted). */
  builtin?: boolean;
}

/** One parsed + tagged transaction. Amounts are always positive numbers in the statement currency. */
export interface Txn {
  id: string;
  /** ISO date YYYY-MM-DD (settlement / booking date). */
  date: string;
  /** YYYY-MM month bucket, derived from date. */
  month: string;
  /** Raw bank transaction type, e.g. "Cumparare POS". */
  type: string;
  /** Debit amount (money out), >= 0. */
  debit: number;
  /** Credit amount (money in), >= 0. */
  credit: number;
  /** Signed convenience amount: credit for income, otherwise the debit. */
  amount: number;
  /** Cleaned counterparty / merchant name shown to the user. */
  who: string;
  group: Group;
  /** Denormalised group kind (from the group config) so aggregators never hardcode ids. */
  kind: GroupKind;
  /** Fine-grained category, e.g. "Groceries". */
  category: string;
  direction: Direction;
  /** Settlement state, when the source distinguishes it (Revolut: COMPLETED / PENDING /
   *  REVERTED). Non-completed rows are excluded from computations until reconciled. */
  state?: string;
  /** Auto-derived hashtags, e.g. ["#groceries", "#recurring", "#weekend"]. */
  tags: string[];
  /** Which rule matched (for transparency / debugging the tagging). */
  rule: string;
  /** Original raw detail key/value lines from the statement, for the detail drawer. */
  details: Record<string, string>;
}

/** Which parser recognised the file. */
export type StatementFormat = "bt-ing-block" | "revolut" | "generic-flat";

/**
 * Enough of the *original* file to re-emit it faithfully. We keep each row's raw
 * source (keyed by the transaction id it produced) so an export can reproduce the
 * uploaded statement's exact shape — same columns / block layout — for just the
 * transactions in the current filtered view, so re-importing looks identical.
 */
export interface OriginalSource {
  format: StatementFormat;
  /** delimiter + linebreak detected in the original, reused on re-emit. */
  delimiter: string;
  newline: string;
  /** Flat formats (revolut / generic): parsed header names, used to align row data. */
  columns?: string[];
  /** Flat formats: the header row exactly as in the source (papaparse renames/trims
   *  `columns`, so this preserves blank / duplicate / whitespace-padded names verbatim). */
  headerRow?: string[];
  /** Flat formats: original row object per transaction id. */
  flatById?: Record<string, Record<string, string>>;
  /** BT block format: rows that precede the first transaction (holder, header). */
  preamble?: string[][];
  /** BT block format: the raw source rows (date row + detail rows) per transaction id. */
  blockById?: Record<string, string[][]>;
}

/** Result of parsing a file: the transactions plus metadata about the parse. */
export interface ParseResult {
  txns: Txn[];
  /** Currency guessed from the statement, e.g. "RON". */
  currency: string;
  /** Account holder if the statement exposes one. */
  accountHolder?: string;
  /** Format the parser recognised. */
  format: StatementFormat;
  /** Non-fatal notes to surface to the user (e.g. rows skipped). */
  warnings: string[];
  /** Raw source kept for a faithful "export as original" round-trip. */
  original?: OriginalSource;
}

export const BUILTIN_GROUPS: GroupDef[] = [
  { id: "income", label: "Income", kind: "income", colorVar: "income", builtin: true },
  { id: "required", label: "Required", kind: "spend", colorVar: "required", builtin: true },
  { id: "optional", label: "Optional", kind: "spend", colorVar: "optional", builtin: true },
  { id: "transfers", label: "To people", kind: "transfers", colorVar: "transfers", builtin: true },
  { id: "savings", label: "Savings & own accounts", kind: "savings", colorVar: "savings", builtin: true },
];

export const BUILTIN_KIND: Record<string, GroupKind> = Object.fromEntries(
  BUILTIN_GROUPS.map((g) => [g.id, g.kind])
);

export const GROUP_ORDER: Group[] = BUILTIN_GROUPS.map((g) => g.id);

export const GROUP_LABELS: Record<string, string> = Object.fromEntries(
  BUILTIN_GROUPS.map((g) => [g.id, g.label])
);

/** Number of custom colour slots defined in styles.css (--g-custom-1 … --g-custom-N). */
export const CUSTOM_COLOR_SLOTS = 8;
