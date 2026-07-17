import { useMemo } from "react";
import type { Txn } from "../types";
import { GROUP_LABELS } from "../types";
import { reconcileKey, type Decision, type Reconcile } from "../lib/reconcile";
import { dateLabel, money2 } from "../lib/format";
import { iconFor } from "../lib/tagging";

interface Props {
  items: Txn[]; // all non-completed transactions
  reconcile: Reconcile;
  currency: string;
  groupLabels?: Record<string, string>;
  onSet: (key: string, decision: Decision) => void;
  onReset: (key: string) => void;
  onBulk: (keys: string[], decision: Decision | "reset") => void;
}

export default function ReconcilePanel({ items, reconcile, currency, groupLabels, onSet, onReset, onBulk }: Props) {
  const { visible, undecidedKeys, dismissedKeys, adoptedCount } = useMemo(() => {
    const withKey = items.map((t) => ({ t, key: reconcileKey(t) }));
    const visible = withKey
      .filter(({ key }) => reconcile[key] !== "dismiss")
      .sort((a, b) => b.t.date.localeCompare(a.t.date));
    return {
      visible,
      undecidedKeys: withKey.filter(({ key }) => !reconcile[key]).map(({ key }) => key),
      dismissedKeys: withKey.filter(({ key }) => reconcile[key] === "dismiss").map(({ key }) => key),
      adoptedCount: withKey.filter(({ key }) => reconcile[key] === "adopt").length,
    };
  }, [items, reconcile]);

  const label = (id: string) => groupLabels?.[id] ?? GROUP_LABELS[id] ?? id;

  if (items.length === 0) {
    return <p className="rules-empty">No pending or reverted transactions — nothing to reconcile. (Only some exports, e.g. Revolut, have these.)</p>;
  }

  return (
    <div className="reconcile">
      <div className="reconcile-head">
        <span className="reconcile-summary">
          {undecidedKeys.length} to decide · {adoptedCount} included · {dismissedKeys.length} removed
        </span>
        <div className="reconcile-bulk">
          {undecidedKeys.length > 0 && (
            <>
              <button className="btn-ghost" onClick={() => onBulk(undecidedKeys, "adopt")}>Include all</button>
              <button className="btn-ghost" onClick={() => onBulk(undecidedKeys, "dismiss")}>Remove all</button>
            </>
          )}
          {dismissedKeys.length > 0 && (
            <button className="btn-ghost" onClick={() => onBulk(dismissedKeys, "reset")}>Restore removed ({dismissedKeys.length})</button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rules-empty">All non-completed transactions have been removed. Use “Restore removed” to bring them back.</p>
      ) : (
        <table className="mini-table reconcile-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Date</th>
              <th>Merchant / party</th>
              <th>Category</th>
              <th className="num">Amount</th>
              <th className="num">Decision</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ t, key }) => {
              const adopted = reconcile[key] === "adopt";
              const st = (t.state ?? "").toUpperCase();
              const sign = t.direction === "in" ? "+" : t.direction === "internal" ? "±" : "−";
              return (
                <tr key={t.id} className={adopted ? "adopted-row" : ""}>
                  <td><span className={`state-chip ${st === "REVERTED" ? "reverted" : "pending"}`}>{st.toLowerCase() || "?"}</span></td>
                  <td className="nowrap">{dateLabel(t.date)}</td>
                  <td>{t.who || <span className="muted">{t.type}</span>}</td>
                  <td className="nowrap"><span className="cat-icon">{iconFor(t.category)}</span>{t.category}<span className="grp-chip">{label(t.group)}</span></td>
                  <td className="num strong">{sign}{money2(t.amount, currency)}</td>
                  <td className="num reconcile-actions">
                    {adopted ? (
                      <>
                        <span className="pos">included ✓</span>
                        <button className="btn-more inline" onClick={() => onReset(key)}>undo</button>
                      </>
                    ) : (
                      <>
                        <button className="btn-more inline include" onClick={() => onSet(key, "adopt")}>Include</button>
                        <button className="btn-more inline" onClick={() => onSet(key, "dismiss")}>Remove</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
