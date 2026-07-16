import type { Stats } from "../lib/analytics";
import { compact, money } from "../lib/format";

interface Props {
  stats: Stats;
  currency: string;
}

export default function StatTiles({ stats, currency }: Props) {
  const tiles: { label: string; value: string; hint: string; tone?: "pos" | "neg" }[] = [
    { label: "Money in", value: money(stats.totalIn, currency), hint: "income over the period" },
    { label: "Money out", value: money(stats.totalOut, currency), hint: "spend + transfers + savings" },
    {
      label: "Net",
      value: money(stats.net, currency),
      hint: stats.net >= 0 ? "you kept this" : stats.savings > 0 ? "incl. moves to own accounts" : "spent more than earned",
      tone: stats.net >= 0 ? "pos" : "neg",
    },
    {
      label: "Moved to savings",
      value: money(stats.savings, currency),
      hint:
        stats.savings <= 0
          ? "enable “Internal” to see"
          : stats.savingsRate <= 1
            ? `${(stats.savingsRate * 100).toFixed(0)}% of income`
            : "gross own-account moves",
    },
    { label: "Avg spend / mo", value: money(stats.avgMonthlySpend, currency), hint: `over ${stats.months} month${stats.months === 1 ? "" : "s"}` },
    {
      label: "Top category",
      value: stats.topCategory?.category ?? "–",
      hint: stats.topCategory ? `${compact(stats.topCategory.total)} ${currency}` : "no spend",
    },
    {
      label: "Top merchant",
      value: stats.topMerchant?.who ?? "–",
      hint: stats.topMerchant ? `${compact(stats.topMerchant.total)} ${currency}` : "no spend",
    },
    { label: "Transactions", value: stats.txCount.toLocaleString("en-US"), hint: "in current view" },
  ];

  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="tile-label">{t.label}</div>
          <div className={`tile-value ${t.tone ?? ""}`} title={t.value}>{t.value}</div>
          <div className="tile-hint">{t.hint}</div>
        </div>
      ))}
    </div>
  );
}
