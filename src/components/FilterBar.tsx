import type { Direction, GroupDef } from "../types";
import type { DataBounds, Filters } from "../lib/filters";
import { dateLabel } from "../lib/format";

interface Props {
  filters: Filters;
  bounds: DataBounds;
  groups: GroupDef[];
  categories: string[];
  tags: string[];
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  filtered: boolean;
}

const DIRECTIONS: { key: Direction; label: string; hint: string }[] = [
  { key: "in", label: "In", hint: "Money arriving (salary, incoming transfers, interest)" },
  { key: "out", label: "Out", hint: "Real spending and transfers to other people" },
  { key: "internal", label: "Internal", hint: "Moves between your own accounts — deposits, Revolut top-ups, own transfers. Hidden by default." },
];

/** Shift an ISO date back by N months, clamped to the data's earliest date.
 *  The day is clamped to the target month's length so we never emit 2026-02-31. */
function monthsAgo(endISO: string, n: number, floor: string): string {
  const [y, m, d] = endISO.split("-").map(Number);
  let ty = y;
  let tm = m - n;
  while (tm <= 0) { tm += 12; ty--; }
  const daysInTarget = new Date(ty, tm, 0).getDate(); // last day of 1-indexed month `tm`
  const cd = Math.min(d, daysInTarget);
  const iso = `${ty}-${String(tm).padStart(2, "0")}-${String(cd).padStart(2, "0")}`;
  return iso < floor ? floor : iso;
}

export default function FilterBar({ filters, bounds, groups, categories, tags, onChange, onReset, filtered }: Props) {
  const toggleArr = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const setPreset = (start: string) => onChange({ start, end: bounds.maxDate });

  // Exactly one preset chip lights up. "All" wins when the full range is selected;
  // a month preset lights only when it genuinely narrows (its start > earliest date).
  const monthPresets = [
    { key: "3m", start: monthsAgo(bounds.maxDate, 3, bounds.minDate) },
    { key: "6m", start: monthsAgo(bounds.maxDate, 6, bounds.minDate) },
    { key: "12m", start: monthsAgo(bounds.maxDate, 12, bounds.minDate) },
  ];
  const activePreset: string | null =
    filters.end !== bounds.maxDate
      ? null
      : filters.start === bounds.minDate
        ? "all"
        : monthPresets.find((p) => p.start === filters.start && p.start !== bounds.minDate)?.key ?? null;

  return (
    <div className="filterbar" role="region" aria-label="Filters">
      <div className="fb-row">
        <div className="fb-group">
          <span className="fb-legend">Range</span>
          <div className="chips">
            <button className={`chip ${activePreset === "all" ? "on" : ""}`} onClick={() => setPreset(bounds.minDate)}>All</button>
            {monthPresets.map((p) => (
              <button key={p.key} className={`chip ${activePreset === p.key ? "on" : ""}`} onClick={() => setPreset(p.start)}>
                {p.key}
              </button>
            ))}
          </div>
          <label className="date-in">
            <input type="date" value={filters.start} min={bounds.minDate} max={filters.end} onChange={(e) => onChange({ start: e.target.value || bounds.minDate })} />
          </label>
          <span className="fb-arrow">→</span>
          <label className="date-in">
            <input type="date" value={filters.end} min={filters.start} max={bounds.maxDate} onChange={(e) => onChange({ end: e.target.value || bounds.maxDate })} />
          </label>
        </div>

        <div className="fb-group grow">
          <input
            className="search"
            type="search"
            placeholder="Search merchant, category, tag…"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </div>

        {filtered && (
          <button className="btn-reset" onClick={onReset} title="Clear all filters">Reset</button>
        )}
      </div>

      <div className="fb-row">
        <div className="fb-group">
          <span className="fb-legend">Flow</span>
          <div className="chips">
            {DIRECTIONS.map((d) => (
              <button
                key={d.key}
                title={d.hint}
                className={`chip ${filters.directions.includes(d.key) ? "on" : ""}`}
                onClick={() => onChange({ directions: toggleArr(filters.directions, d.key) })}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="fb-group">
          <span className="fb-legend">Groups</span>
          <div className="chips">
            {groups.map((g) => (
              <button
                key={g.id}
                style={{ ["--chip-accent" as string]: `var(--g-${g.colorVar})` }}
                className={`chip ${filters.groups.includes(g.id) ? "on" : ""}`}
                onClick={() => onChange({ groups: toggleArr(filters.groups, g.id) })}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <MultiSelect
          label="Categories"
          options={categories}
          selected={filters.categories}
          onToggle={(c) => onChange({ categories: toggleArr(filters.categories, c) })}
          onClear={() => onChange({ categories: [] })}
        />

        {tags.length > 0 && (
          <div className="fb-group">
            <span className="fb-legend">Tags</span>
            <div className="chips">
              {tags.map((t) => (
                <button
                  key={t}
                  className={`chip ${filters.tags.includes(t) ? "on" : ""}`}
                  onClick={() => onChange({ tags: toggleArr(filters.tags, t) })}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="fb-group">
          <span className="fb-legend">Amount</span>
          <input className="amt" type="number" placeholder="min" value={filters.minAmount ?? ""} onChange={(e) => onChange({ minAmount: e.target.value === "" ? null : Number(e.target.value) })} />
          <span className="fb-arrow">–</span>
          <input className="amt" type="number" placeholder="max" value={filters.maxAmount ?? ""} onChange={(e) => onChange({ maxAmount: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
      </div>

      <div className="fb-active">
        {dateLabel(filters.start)} – {dateLabel(filters.end)}
      </div>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <details className="fb-group multiselect">
      <summary>
        <span className="fb-legend">{label}</span>
        <span className="ms-count">{selected.length ? selected.length : "all"}</span>
      </summary>
      <div className="ms-menu">
        <button className="ms-clear" onClick={onClear} disabled={selected.length === 0}>Clear</button>
        {options.map((o) => (
          <label key={o} className="ms-opt">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} />
            {o}
          </label>
        ))}
      </div>
    </details>
  );
}
