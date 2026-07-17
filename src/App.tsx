import { useEffect, useMemo, useState } from "react";
import type { Group, ParseResult, Txn } from "./types";
import { GROUP_LABELS, GROUP_ORDER } from "./types";
import { parseStatement } from "./lib/parse";
import { boundsOf, defaultFilters, applyFilters, isFiltered, groupKeyOf, type Filters, type GroupDim } from "./lib/filters";
import { buildSankey } from "./lib/sankey-model";
import { computeStats, monthlySeries, topCategories, topMerchants, recurring } from "./lib/analytics";
import { applyOverrides, loadOverrides, saveOverrides, distinctMerchants, categoriesWithGroup, type Overrides } from "./lib/overrides";
import { iconFor } from "./lib/tagging";
import { money2 } from "./lib/format";
import FilterBar from "./components/FilterBar";
import RulesPanel from "./components/RulesPanel";
import StatTiles from "./components/StatTiles";
import Sankey from "./components/Sankey";
import MonthlyTrend from "./components/MonthlyTrend";
import BarList, { type BarItem } from "./components/BarList";
import RecurringPanel from "./components/RecurringPanel";
import TransactionTable from "./components/TransactionTable";
import GroupedTable from "./components/GroupedTable";
import FileLoader from "./components/FileLoader";

const BEHAVIOURAL_TAGS = ["#recurring", "#large", "#weekend", "#cash"];
const LABEL_TO_GROUP: Record<string, Group> = Object.fromEntries(
  (Object.entries(GROUP_LABELS) as [Group, string][]).map(([k, v]) => [v, k])
) as Record<string, Group>;

function initialTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string>("sample-statement.csv");
  const [filters, setFilters] = useState<Filters | null>(null);
  const [minFlowPct, setMinFlowPct] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [error, setError] = useState<string | null>(null);
  // include/exclude table state
  const [groupBy, setGroupBy] = useState<GroupDim>("category");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // manual reclassification rules (merchant -> group + category), persisted
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides());
  // {who, n}: n is a nonce so re-clicking the same merchant re-fires the prefill
  const [assignReq, setAssignReq] = useState<{ who: string; n: number } | null>(null);

  useEffect(() => saveOverrides(overrides), [overrides]);

  // apply theme to the document
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // load the bundled sample on first run so there's always something to look at
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "sample-statement.csv")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("no sample"))))
      .then((text) => load("sample-statement.csv", text))
      .catch(() => setError(null)); // fine — user can drop a file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = (name: string, text: string) => {
    try {
      const result = parseStatement(text);
      setParsed(result);
      setFileName(name);
      setFilters(defaultFilters(boundsOf(result.txns)));
      setExcluded(new Set()); // fresh data → nothing excluded
      setError(result.txns.length === 0 ? "No transactions were recognised in this file." : null);
    } catch (e) {
      setError(`Could not parse ${name}: ${(e as Error).message}`);
    }
  };

  // raw parsed txns, then apply manual overrides → everything downstream uses `txns`
  const rawTxns = parsed?.txns ?? [];
  const txns = useMemo(() => applyOverrides(rawTxns, overrides), [rawTxns, overrides]);
  const currency = parsed?.currency ?? "";
  const bounds = useMemo(() => boundsOf(txns), [txns]);

  // filters produce `filtered`; the include/exclude table further removes whole
  // groups, producing `active` — which feeds every chart, tile and total.
  const filtered = useMemo(
    () => (filters ? applyFilters(txns, filters) : txns),
    [txns, filters]
  );
  const active = useMemo(
    () => (excluded.size ? filtered.filter((t) => !excluded.has(groupKeyOf(t, groupBy))) : filtered),
    [filtered, excluded, groupBy]
  );

  const model = useMemo(() => buildSankey(active, minFlowPct), [active, minFlowPct]);
  const stats = useMemo(() => computeStats(active), [active]);
  const monthly = useMemo(() => monthlySeries(active), [active]);
  const cats = useMemo(() => topCategories(active), [active]);
  const merchants = useMemo(() => topMerchants(active), [active]);
  const recur = useMemo(() => recurring(active), [active]);

  // stable option lists from the whole dataset
  const groupOptions = useMemo(
    () => GROUP_ORDER.filter((g) => txns.some((t) => t.group === g)),
    [txns]
  );
  const categoryOptions = useMemo(() => {
    const tot = new Map<string, number>();
    for (const t of txns) tot.set(t.category, (tot.get(t.category) ?? 0) + t.amount);
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [txns]);
  const tagOptions = useMemo(
    () => BEHAVIOURAL_TAGS.filter((tag) => txns.some((t) => t.tags.includes(tag))),
    [txns]
  );

  const uncategorized = useMemo(() => txns.filter((t) => t.category === "Other").length, [txns]);
  const merchantList = useMemo(() => distinctMerchants(txns), [txns]);
  const categoryList = useMemo(() => categoriesWithGroup(txns), [txns]);

  if (!filters) {
    return (
      <div className="splash">
        <div className="splash-card">
          <div className="brand-mark splash-mark">₿</div>
          <h1>Spend</h1>
          <p className="splash-tag">
            See where your money actually goes. Drop a bank-statement CSV and get an
            interactive money-flow Sankey, live filters, and automatic tagging.
          </p>
          <div className="splash-drop">
            <FileLoader onLoad={load} />
            <span className="splash-hint">…or drag &amp; drop a file anywhere on the page</span>
          </div>
          <ul className="splash-points">
            <li><span>🔒</span> 100% local — your statement is parsed in your browser and never uploaded</li>
            <li><span>🏦</span> Built for Banca Transilvania / ING Romania exports; also reads generic CSVs</li>
            <li><span>🏷️</span> Auto-tags spending into categories and flags recurring bills &amp; subscriptions</li>
          </ul>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...(f as Filters), ...p }));
  const reset = () => {
    setFilters(defaultFilters(bounds));
    setExcluded(new Set());
  };

  // include/exclude table handlers
  const toggleGroup = (key: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const setManyGroups = (keys: string[], included: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const k of keys) (included ? next.delete(k) : next.add(k));
      return next;
    });
  const changeGroupBy = (d: GroupDim) => {
    if (d === groupBy) return; // no-op click must not wipe selections
    setGroupBy(d);
    setExcluded(new Set()); // keys are dimension-specific; start fresh
  };

  // manual override handlers
  const setOverride = (who: string, group: Group, category: string) =>
    setOverrides((o) => ({ ...o, [who]: { group, category } }));
  const removeOverride = (who: string) =>
    setOverrides((o) => {
      const next = { ...o };
      delete next[who];
      return next;
    });
  const clearOverrides = () => setOverrides({});
  const assign = (who: string) => setAssignReq((prev) => ({ who, n: (prev?.n ?? 0) + 1 }));

  const catItems: BarItem[] = cats.map((c) => ({
    key: `${c.group}:${c.category}`,
    label: c.category,
    icon: iconFor(c.category),
    sub: `${c.count}×`,
    value: c.total,
    colorKey: c.group,
  }));
  const merchItems: BarItem[] = merchants.map((m) => ({
    key: m.who,
    label: m.who,
    sub: m.category,
    value: m.total,
  }));

  const exportCsv = () => {
    const head = ["date", "who", "group", "category", "direction", "tags", "debit", "credit", "amount"];
    const rows = active.map((t: Txn) =>
      [t.date, csv(t.who), t.group, csv(t.category), t.direction, csv(t.tags.join(" ")), t.debit.toFixed(2), t.credit.toFixed(2), t.amount.toFixed(2)].join(",")
    );
    const blob = new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spending-tagged.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">₿</span>
          <div>
            <h1>Spend</h1>
            <span className="brand-sub">money-flow visualiser · <b>{fileName}</b></span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="privacy" title="All parsing happens in your browser. Nothing is uploaded.">🔒 100% local</span>
          <FileLoader onLoad={load} compact />
          <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
          <button className="btn-ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀︎ Light" : "☾ Dark"}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {parsed?.warnings.map((w, i) => (
        <div className="banner warn" key={i}>{w}</div>
      ))}

      <FilterBar
        filters={filters}
        bounds={bounds}
        groups={groupOptions}
        categories={categoryOptions}
        tags={tagOptions}
        onChange={patch}
        onReset={reset}
        filtered={isFiltered(filters, bounds)}
      />

      <StatTiles stats={stats} currency={currency} />

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Groups — include or exclude</h2>
            <p className="card-sub">Untick a group to drop it from every chart, tile and total below. Search, expand a row to see its transactions, or use the header box to toggle all.</p>
          </div>
        </div>
        <GroupedTable
          txns={filtered}
          currency={currency}
          dim={groupBy}
          onDimChange={changeGroupBy}
          excluded={excluded}
          onToggle={toggleGroup}
          onSetMany={setManyGroups}
          overrides={overrides}
          onAssign={assign}
        />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Custom categories &amp; rules</h2>
            <p className="card-sub">Assign a group + category to an entire merchant — it overrides the automatic tagging everywhere. Type a new category name to create one. Rules are saved in this browser.</p>
          </div>
        </div>
        <RulesPanel
          merchants={merchantList}
          categories={categoryList}
          overrides={overrides}
          onSet={setOverride}
          onRemove={removeOverride}
          onClear={clearOverrides}
          focusMerchant={assignReq}
        />
      </section>

      <section className="card sankey-card">
        <div className="card-head">
          <div>
            <h2>Money flow</h2>
            <p className="card-sub">Income → available → where it goes. Click a group or category to filter. Transfers between your own accounts are hidden until you enable “Internal”.</p>
          </div>
          <label className="slider">
            Hide flows under {(minFlowPct * 100).toFixed(1)}%
            <input type="range" min={0} max={0.05} step={0.0025} value={minFlowPct} onChange={(e) => setMinFlowPct(Number(e.target.value))} />
          </label>
        </div>
        <Sankey
          model={model}
          currency={currency}
          onPickGroup={(label) => patch({ groups: [LABEL_TO_GROUP[label]] })}
          onPickCategory={(category) => patch({ categories: [category] })}
        />
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Monthly in vs out</h2></div>
          <MonthlyTrend data={monthly} currency={currency} />
        </section>
        <section className="card">
          <div className="card-head"><h2>Top categories</h2></div>
          <BarList items={catItems} currency={currency} empty="No spending in this view." onPick={(it) => patch({ categories: [it.label] })} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Top merchants</h2></div>
          <BarList items={merchItems} currency={currency} empty="No merchants in this view." onPick={(it) => patch({ search: it.label })} />
        </section>
        <section className="card">
          <div className="card-head"><h2>Recurring & subscriptions</h2></div>
          <RecurringPanel items={recur} currency={currency} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Transactions</h2>
          <span className="card-sub">{active.length.toLocaleString("en-US")} counted{excluded.size ? ` · ${filtered.length - active.length} hidden by group exclusions` : ""} · click a row for details</span>
        </div>
        <TransactionTable txns={active} currency={currency} />
      </section>

      <footer className="foot">
        <span>{txns.length.toLocaleString("en-US")} transactions parsed as <b>{parsed?.format}</b>.</span>
        <span>{uncategorized} uncategorised ({txns.length ? ((uncategorized / txns.length) * 100).toFixed(0) : 0}%) — these show as “Other”.</span>
        <span>Everything runs in your browser; your statement never leaves this machine.</span>
        <span className="foot-total">Filtered total out: {money2(stats.totalOut, currency)}</span>
      </footer>
    </div>
  );
}

function csv(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
