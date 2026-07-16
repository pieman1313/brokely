// Formatting helpers. All money is shown in the statement's own currency.

/** Compact money, no decimals: 12,345 */
export function money(n: number, currency = ""): string {
  const s = Math.round(n).toLocaleString("en-US");
  return currency ? `${s} ${currency}` : s;
}

/** Full money with 2 decimals: 12,345.67 */
export function money2(n: number, currency = ""): string {
  const s = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${s} ${currency}` : s;
}

/** Short, human-friendly big number: 12.3k, 1.2M */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 1e7 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 1e4 ? 0 : 1) + "k";
  return Math.round(n).toString();
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2025-06" -> "Jun 25" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_SHORT[Number(m) - 1]} ${y.slice(2)}`;
}

/** "2025-06-05" -> "5 Jun 2025" */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTH_SHORT[Number(m) - 1]} ${y}`;
}

/** Inclusive count of calendar months a date range spans (min 1). */
export function monthsBetween(startISO: string, endISO: string): number {
  const [ys, ms] = startISO.split("-").map(Number);
  const [ye, me] = endISO.split("-").map(Number);
  return Math.max(1, (ye - ys) * 12 + (me - ms) + 1);
}
