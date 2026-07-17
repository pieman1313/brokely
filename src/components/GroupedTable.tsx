import { useEffect, useMemo, useRef, useState } from "react";
import type { Txn } from "../types";
import type { GroupDim } from "../lib/filters";
import { groupKeyOf, groupLabelOf } from "../lib/filters";
import { isInternalInflow } from "../lib/analytics";
import { dateLabel, money, money2 } from "../lib/format";
import { iconFor } from "../lib/tagging";

interface Props {
  txns: Txn[]; // filtered set, BEFORE group exclusion (so excluded groups still list)
  currency: string;
  dim: GroupDim;
  onDimChange: (d: GroupDim) => void;
  excluded: Set<string>;
  onToggle: (key: string) => void;
  onSetMany: (keys: string[], included: boolean) => void;
}

interface Grp {
  key: string;
  label: string;
  count: number;
  total: number;
  members: Txn[];
}

const DIMS: { key: GroupDim; label: string }[] = [
  { key: "category", label: "Category" },
  { key: "merchant", label: "Merchant" },
  { key: "group", label: "Group" },
];

export default function GroupedTable({ txns, currency, dim, onDimChange, excluded, onToggle, onSetMany }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, Grp>();
    for (const t of txns) {
      if (isInternalInflow(t)) continue; // match the analytics: returning own money isn't counted
      const key = groupKeyOf(t, dim);
      let g = map.get(key);
      if (!g) {
        g = { key, label: groupLabelOf(key, dim), count: 0, total: 0, members: [] };
        map.set(key, g);
      }
      g.count++;
      g.total += t.amount;
      g.members.push(t);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [txns, dim]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? groups.filter((g) => g.label.toLowerCase().includes(q)) : groups;
  }, [groups, query]);

  const visibleKeys = visible.map((g) => g.key);
  const includedCount = visibleKeys.filter((k) => !excluded.has(k)).length;
  const allIncluded = visible.length > 0 && includedCount === visible.length;
  const noneIncluded = includedCount === 0;

  // master checkbox indeterminate state
  const masterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = !allIncluded && !noneIncluded;
  }, [allIncluded, noneIncluded]);

  // count exclusions across the WHOLE dimension, not just the searched rows, so
  // filtering by search never hides that off-screen groups are still excluded
  const excludedCount = groups.filter((g) => excluded.has(g.key)).length;

  return (
    <div className="grouped">
      <div className="grouped-controls">
        <div className="segmented">
          {DIMS.map((d) => (
            <button
              key={d.key}
              className={dim === d.key ? "on" : ""}
              onClick={() => onDimChange(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder={`Search ${dim}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {excludedCount > 0 && (
          <span className="grouped-note">{excludedCount} excluded from all charts</span>
        )}
      </div>

      <div className="grouped-scroll">
      <table className="grouped-table">
        <thead>
          <tr>
            <th className="chk-col">
              <input
                ref={masterRef}
                type="checkbox"
                checked={allIncluded}
                onChange={() => onSetMany(visibleKeys, !allIncluded)}
                title={allIncluded ? "Uncheck all" : "Check all"}
                aria-label="Check or uncheck all groups"
              />
            </th>
            <th>{DIMS.find((d) => d.key === dim)?.label}</th>
            <th className="num">Txns</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((g) => {
            const included = !excluded.has(g.key);
            const isOpen = open === g.key;
            return (
              <FragmentGroup
                key={g.key}
                g={g}
                dim={dim}
                included={included}
                isOpen={isOpen}
                currency={currency}
                onToggle={() => onToggle(g.key)}
                onExpand={() => setOpen(isOpen ? null : g.key)}
              />
            );
          })}
          {visible.length === 0 && (
            <tr><td colSpan={4} className="chart-empty">{query.trim() ? `No groups match “${query}”.` : "No groups to show."}</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function FragmentGroup({
  g, dim, included, isOpen, currency, onToggle, onExpand,
}: {
  g: Grp; dim: GroupDim; included: boolean; isOpen: boolean; currency: string;
  onToggle: () => void; onExpand: () => void;
}) {
  const members = isOpen ? [...g.members].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100) : [];
  return (
    <>
      <tr className={included ? "" : "excluded-row"}>
        <td className="chk-col">
          <input type="checkbox" checked={included} onChange={onToggle} aria-label={`Include ${g.label}`} />
        </td>
        <td className="grouped-label" onClick={onExpand}>
          <span className="expand-caret">{isOpen ? "▾" : "▸"}</span>
          {dim === "category" && <span className="cat-icon">{iconFor(g.key)}</span>}
          {g.label}
        </td>
        <td className="num" onClick={onExpand}>{g.count}</td>
        <td className="num strong" onClick={onExpand}>{money(g.total, currency)}</td>
      </tr>
      {isOpen && (
        <tr className="grouped-members">
          <td></td>
          <td colSpan={3}>
            <ul className="member-list">
              {members.map((t) => (
                <li key={t.id}>
                  <span className="member-date">{dateLabel(t.date)}</span>
                  <span className="member-who">{t.who || t.type}</span>
                  <span className={`member-amt ${t.direction === "in" ? "pos" : ""}`}>
                    {t.direction === "in" ? "+" : t.direction === "internal" ? "±" : "−"}
                    {money2(t.amount, currency)}
                  </span>
                </li>
              ))}
              {g.members.length > 100 && <li className="muted">…and {g.members.length - 100} more</li>}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
