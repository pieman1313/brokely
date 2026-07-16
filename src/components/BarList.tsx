import { money } from "../lib/format";

export interface BarItem {
  key: string;
  label: string;
  sub?: string;
  value: number;
  colorKey?: string; // css var --g-<key>
  icon?: string;
}

interface Props {
  items: BarItem[];
  currency: string;
  onPick?: (item: BarItem) => void;
  empty?: string;
}

/** A ranked horizontal-bar list. Bars share one hue by default (magnitude is the length). */
export default function BarList({ items, currency, onPick, empty = "Nothing here." }: Props) {
  if (items.length === 0) return <div className="chart-empty">{empty}</div>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="barlist">
      {items.map((it) => (
        <li
          key={it.key}
          className={onPick ? "clickable" : ""}
          onClick={onPick ? () => onPick(it) : undefined}
          title={onPick ? `Filter by ${it.label}` : undefined}
        >
          <div className="barlist-head">
            <span className="barlist-label">
              {it.icon && <span className="barlist-icon">{it.icon}</span>}
              {it.label}
              {it.sub && <span className="barlist-sub">{it.sub}</span>}
            </span>
            <span className="barlist-value">{money(it.value, currency)}</span>
          </div>
          <div className="barlist-track">
            <div
              className="barlist-fill"
              style={{
                width: `${(it.value / max) * 100}%`,
                background: it.colorKey ? `var(--g-${it.colorKey})` : "var(--series-1)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
