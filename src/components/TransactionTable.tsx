import { useMemo, useState } from "react";
import type { Txn } from "../types";
import { GROUP_LABELS } from "../types";
import { dateLabel, money2 } from "../lib/format";
import { iconFor } from "../lib/tagging";

interface Props {
  txns: Txn[];
  currency: string;
  groupLabels?: Record<string, string>;
}

type SortKey = "date" | "amount" | "who" | "category";

/** The full ledger — sortable, expandable, and the accessible fallback for every chart.
 *  Rows are CSS-grid blocks so the browser skips rendering off-screen ones
 *  (content-visibility), keeping it fast with thousands of rows without pagination. */
export default function TransactionTable({ txns, currency, groupLabels }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
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
    else { setSortKey(k); setAsc(k === "who" || k === "category"); }
  };
  const arrow = (k: SortKey) => (k === sortKey ? (asc ? " ▲" : " ▼") : "");
  const label = (id: string) => groupLabels?.[id] ?? GROUP_LABELS[id] ?? id;

  if (txns.length === 0) return <div className="chart-empty">No transactions in this view.</div>;

  return (
    <div className="txn-scroll">
      <div className="vtable" role="table">
        <div className="vt-head" role="row">
          <button className="vt-cell sortable" onClick={() => toggle("date")}>Date{arrow("date")}</button>
          <button className="vt-cell sortable" onClick={() => toggle("who")}>Merchant / party{arrow("who")}</button>
          <button className="vt-cell sortable" onClick={() => toggle("category")}>Category{arrow("category")}</button>
          <span className="vt-cell">Tags</span>
          <button className="vt-cell num sortable" onClick={() => toggle("amount")}>Amount{arrow("amount")}</button>
        </div>
        {sorted.map((t) => (
          <VRow key={t.id} t={t} currency={currency} groupLabel={label(t.group)} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
        ))}
      </div>
    </div>
  );
}

function VRow({ t, currency, groupLabel, open, onToggle }: { t: Txn; currency: string; groupLabel: string; open: boolean; onToggle: () => void }) {
  const sign = t.direction === "in" ? "+" : t.direction === "internal" ? "±" : "−";
  const cls = t.direction === "in" ? "pos" : t.direction === "internal" ? "muted" : "";
  return (
    <>
      <div className="vt-row" role="row" onClick={onToggle}>
        <span className="vt-cell nowrap">{dateLabel(t.date)}</span>
        <span className="vt-cell ellip">{t.who || <span className="muted">{t.type}</span>}</span>
        <span className="vt-cell ellip">
          <span className="cat-icon">{iconFor(t.category)}</span>
          {t.category}
          <span className="grp-chip">{groupLabel}</span>
          {t.state && t.state.toUpperCase() !== "COMPLETED" && (
            <span className={`state-chip ${t.state.toUpperCase() === "REVERTED" ? "reverted" : "pending"}`}>{t.state.toLowerCase()}</span>
          )}
        </span>
        <span className="vt-cell tags-cell">
          {t.tags.filter((x) => x === "#recurring" || x === "#large" || x === "#weekend" || x === "#cash").map((x) => (
            <span className="tag" key={x}>{x}</span>
          ))}
        </span>
        <span className={`vt-cell num strong ${cls}`}>{sign}{money2(t.amount, currency)}</span>
      </div>
      {open && (
        <div className="vt-detail">
          <div className="detail-grid">
            <div><span className="detail-k">Type</span> {t.type}</div>
            <div><span className="detail-k">Rule</span> {t.rule}</div>
            <div><span className="detail-k">All tags</span> {t.tags.join(" ")}</div>
            {Object.entries(t.details).map(([k, v]) => (
              <div key={k}><span className="detail-k">{k}</span> {v}</div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
