import type { Recurring } from "../lib/analytics";
import { money } from "../lib/format";

interface Props {
  items: Recurring[];
  currency: string;
}

/** Likely subscriptions & recurring bills — anything seen across 3+ months. */
export default function RecurringPanel({ items, currency }: Props) {
  if (items.length === 0) return <div className="chart-empty">No recurring commitments detected.</div>;
  return (
    <div className="table-scroll">
    <table className="mini-table">
      <thead>
        <tr>
          <th>Merchant</th>
          <th>Category</th>
          <th className="num">Months</th>
          <th className="num">Per month</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.who}>
            <td>{r.who}</td>
            <td className="muted">{r.category}</td>
            <td className="num">{r.months}</td>
            <td className="num">{money(r.perMonth, currency)}</td>
            <td className="num strong">{money(r.total, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
