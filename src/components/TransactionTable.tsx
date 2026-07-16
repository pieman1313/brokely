import { useMemo, useState } from "react";
import type { Txn } from "../types";
import { GROUP_LABELS } from "../types";
import { dateLabel, money2 } from "../lib/format";
import { iconFor } from "../lib/tagging";

interface Props {
  txns: Txn[];
  currency: string;
}

type SortKey = "date" | "amount" | "who" | "category";

/** The full ledger — sortable, expandable, and the accessible fallback for every chart. */
export default function TransactionTable({ txns, currency }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const arr = [...txns];
    arr.sort((a, b) => {
      let d = 0;
      if (sortKey === "date") d = a.date.localeCompare(b.date);
      else if (sortKey === "amount") d = a.amount - b.amount;
      else if (sortKey === "who") d = a.who.localeCompare(b.who);
      else d = a.category.localeCompare(b.category);
      return asc ? d : -d;
    });
    return arr;
  }, [txns, sortKey, asc]);

  const toggle = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc);
    else {
      setSortKey(k);
      setAsc(k === "who" || k === "category");
    }
  };
  const arrow = (k: SortKey) => (k === sortKey ? (asc ? " ▲" : " ▼") : "");

  if (txns.length === 0) return <div className="chart-empty">No transactions in this view.</div>;

  const shown = sorted.slice(0, limit);

  return (
    <div>
      <table className="txn-table">
        <thead>
          <tr>
            <th className="sortable" onClick={() => toggle("date")}>Date{arrow("date")}</th>
            <th className="sortable" onClick={() => toggle("who")}>Merchant / party{arrow("who")}</th>
            <th className="sortable" onClick={() => toggle("category")}>Category{arrow("category")}</th>
            <th>Tags</th>
            <th className="num sortable" onClick={() => toggle("amount")}>Amount{arrow("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <FragmentRow key={t.id} t={t} currency={currency} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
          ))}
        </tbody>
      </table>
      {limit < sorted.length && (
        <button className="btn-more" onClick={() => setLimit(limit + 100)}>
          Show more ({sorted.length - limit} remaining)
        </button>
      )}
    </div>
  );
}

function FragmentRow({ t, currency, open, onToggle }: { t: Txn; currency: string; open: boolean; onToggle: () => void }) {
  const sign = t.direction === "in" ? "+" : t.direction === "internal" ? "±" : "−";
  const cls = t.direction === "in" ? "pos" : t.direction === "internal" ? "muted" : "";
  return (
    <>
      <tr className="txn-row" onClick={onToggle}>
        <td className="nowrap">{dateLabel(t.date)}</td>
        <td>{t.who || <span className="muted">{t.type}</span>}</td>
        <td className="nowrap">
          <span className="cat-icon">{iconFor(t.category)}</span>
          {t.category}
          <span className="grp-chip">{GROUP_LABELS[t.group]}</span>
        </td>
        <td className="tags-cell">
          {t.tags.filter((x) => x === "#recurring" || x === "#large" || x === "#weekend" || x === "#cash").map((x) => (
            <span className="tag" key={x}>{x}</span>
          ))}
        </td>
        <td className={`num strong ${cls}`}>{sign}{money2(t.amount, currency)}</td>
      </tr>
      {open && (
        <tr className="txn-detail">
          <td colSpan={5}>
            <div className="detail-grid">
              <div><span className="detail-k">Type</span> {t.type}</div>
              <div><span className="detail-k">Rule</span> {t.rule}</div>
              <div><span className="detail-k">All tags</span> {t.tags.join(" ")}</div>
              {Object.entries(t.details).map(([k, v]) => (
                <div key={k}><span className="detail-k">{k}</span> {v}</div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
