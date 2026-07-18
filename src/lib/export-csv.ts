// CSV export builders.
//
// Two flavours:
//  - original: reproduces the uploaded statement's exact shape (same columns /
//    block layout, delimiter and line-break) for just the transactions in the
//    current filtered view — so re-importing the file looks identical.
//  - tagged: the app's own flat view (date/who/group/category/…), handy for
//    spreadsheets but NOT round-trippable.

import Papa from "papaparse";
import type { OriginalSource, Txn } from "../types";

/**
 * Rebuild the original file for exactly the given (already filtered) transactions.
 * Order follows `active`, so a re-import reproduces the same rows in the same order.
 */
export function toOriginalCsv(active: Txn[], src: OriginalSource): string {
  const opts = { delimiter: src.delimiter || ",", newline: src.newline || "\n" };

  if (src.format === "bt-ing-block") {
    const rows: string[][] = [...(src.preamble ?? [])];
    for (const t of active) {
      const block = src.blockById?.[t.id];
      if (block) rows.push(...block);
    }
    return Papa.unparse(rows, opts);
  }

  // flat formats (revolut / generic): re-emit each row verbatim. `columns` (papaparse's
  // parsed field names) keys the row objects; the header LINE is emitted separately from
  // `headerRow` so blank / duplicate / whitespace-padded source headers survive verbatim
  // (papaparse renames/trims them in `columns`, which would corrupt the header otherwise).
  const fields = src.columns ?? Object.keys(src.flatById?.[active[0]?.id] ?? {});
  const data = active.map((t) => src.flatById?.[t.id] ?? {});
  const body = Papa.unparse({ fields, data }, { ...opts, header: false });
  // Build the header line by hand with minimal (RFC-4180) quoting: Papa.unparse would
  // over-quote whitespace-padded names, so joining preserves the source header verbatim
  // while still quoting names that genuinely contain the delimiter, a quote or a newline.
  const cell = (s: string) =>
    s.includes(opts.delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const header = (src.headerRow ?? fields).map(cell).join(opts.delimiter);
  return body ? `${header}${opts.newline}${body}` : header;
}

const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The app's flat, human-readable view — includes the derived group/category/tags. */
export function toTaggedCsv(active: Txn[]): string {
  const head = ["date", "who", "group", "category", "direction", "tags", "debit", "credit", "amount"];
  const rows = active.map((t) =>
    [t.date, q(t.who), t.group, q(t.category), t.direction, q(t.tags.join(" ")), t.debit.toFixed(2), t.credit.toFixed(2), t.amount.toFixed(2)].join(",")
  );
  return [head.join(","), ...rows].join("\n");
}
