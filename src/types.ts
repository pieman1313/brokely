// Core data model shared across the app.

/** Which side of the ledger a transaction lands on. */
export type Direction = "in" | "out" | "internal";

/**
 * Top-level bucket a transaction rolls up to in the Sankey.
 * - income      : money arriving (salary, transfers in, interest)
 * - required    : non-discretionary spend (bills, groceries, health)
 * - optional    : discretionary spend (eating out, shopping, fun)
 * - transfers   : money sent to other people (not spending on goods)
 * - savings     : money moved into your own savings/deposits/other accounts
 */
export type Group =
  | "income"
  | "required"
  | "optional"
  | "transfers"
  | "savings";

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
  /** Fine-grained category, e.g. "Groceries". */
  category: string;
  direction: Direction;
  /** Auto-derived hashtags, e.g. ["#groceries", "#recurring", "#weekend"]. */
  tags: string[];
  /** Which rule matched (for transparency / debugging the tagging). */
  rule: string;
  /** Original raw detail key/value lines from the statement, for the detail drawer. */
  details: Record<string, string>;
}

/** Result of parsing a file: the transactions plus metadata about the parse. */
export interface ParseResult {
  txns: Txn[];
  /** Currency guessed from the statement, e.g. "RON". */
  currency: string;
  /** Account holder if the statement exposes one. */
  accountHolder?: string;
  /** Format the parser recognised. */
  format: "bt-ing-block" | "generic-flat";
  /** Non-fatal notes to surface to the user (e.g. rows skipped). */
  warnings: string[];
}

export const GROUP_ORDER: Group[] = [
  "income",
  "required",
  "optional",
  "transfers",
  "savings",
];

export const GROUP_LABELS: Record<Group, string> = {
  income: "Income",
  required: "Required",
  optional: "Optional",
  transfers: "To people",
  savings: "Savings & own accounts",
};
