import { useEffect, useMemo, useState } from "react";
import type { Group, GroupDef, GroupKind, ParseResult, Txn } from "./types";
import { parseStatement } from "./lib/parse";
import { boundsOf, defaultFilters, applyFilters, isFiltered, groupKeyOf, type Filters, type GroupDim } from "./lib/filters";
import { buildSankey } from "./lib/sankey-model";
import { computeStats, monthlySeries, topCategories, topMerchants, recurring } from "./lib/analytics";
import { applyOverrides, loadOverrides, saveOverrides, distinctMerchants, categoriesWithGroup, type Overrides } from "./lib/overrides";
import { loadGroups, saveGroups, groupMap, nextColorVar, slugId } from "./lib/groups";
import { useLocalStorageState } from "./lib/ui-state";
import { iconFor } from "./lib/tagging";
import { money2 } from "./lib/format";
import FilterBar from "./components/FilterBar";
import RulesPanel from "./components/RulesPanel";
import GroupsPanel from "./components/GroupsPanel";
import StatTiles from "./components/StatTiles";
import Sankey from "./components/Sankey";
import MonthlyTrend from "./components/MonthlyTrend";
import BarList, { type BarItem } from "./components/BarList";
import RecurringPanel from "./components/RecurringPanel";
import TransactionTable from "./components/TransactionTable";
import GroupedTable from "./components/GroupedTable";
import Card from "./components/Card";
import FileLoader from "./components/FileLoader";

const BEHAVIOURAL_TAGS = ["#recurring", "#large", "#weekend", "#cash"];

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
  const [groupBy, setGroupBy] = useState<GroupDim>("category");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides());
  const [assignReq, setAssignReq] = useState<{ who: string; n: number } | null>(null);
  const [groups, setGroups] = useState<GroupDef[]>(() => loadGroups());
  const [tab, setTab] = useLocalStorageState<"dashboard" | "configure">("spend.tab", "dashboard");

  useEffect(() => saveOverrides(overrides), [overrides]);
  useEffect(() => saveGroups(groups), [groups]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "sample-statement.csv")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("no sample"))))
      .then((text) => load("sample-statement.csv", text))
      .catch(() => setError(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = (name: string, text: string) => {
    try {
      const result = parseStatement(text);
      setParsed(result);
      setFileName(name);
      setFilters(defaultFilters(boundsOf(result.txns)));
      setExcluded(new Set());
      setError(result.txns.length === 0 ? "No transactions were recognised in this file." : null);
    } catch (e) {
      setError(`Could not parse ${name}: ${(e as Error).message}`);
    }
  };

  // raw parsed txns → apply manual overrides (resolved against the group config)
  const rawTxns = parsed?.txns ?? [];
  const txns = useMemo(() => applyOverrides(rawTxns, overrides, groups), [rawTxns, overrides, groups]);
  const currency = parsed?.currency ?? "";
  const bounds = useMemo(() => boundsOf(txns), [txns]);

  const gmap = useMemo(() => groupMap(groups), [groups]);
  const groupLabelMap = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.label])), [groups]);

  const filtered = useMemo(() => (filters ? applyFilters(txns, filters) : txns), [txns, filters]);
  const active = useMemo(
    () => (excluded.size ? filtered.filter((t) => !excluded.has(groupKeyOf(t, groupBy))) : filtered),
    [filtered, excluded, groupBy]
  );

  const model = useMemo(() => buildSankey(active, minFlowPct, groups), [active, minFlowPct, groups]);
  const stats = useMemo(() => computeStats(active), [active]);
  const monthly = useMemo(() => monthlySeries(active), [active]);
  const cats = useMemo(() => topCategories(active), [active]);
  const merchants = useMemo(() => topMerchants(active), [active]);
  const recur = useMemo(() => recurring(active), [active]);

  const groupOptions = useMemo(() => groups.filter((g) => txns.some((t) => t.group === g.id)), [groups, txns]);
  const categoryOptions = useMemo(() => {
    const tot = new Map<string, number>();
    for (const t of txns) tot.set(t.category, (tot.get(t.category) ?? 0) + t.amount);
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [txns]);
  const tagOptions = useMemo(() => BEHAVIOURAL_TAGS.filter((tag) => txns.some((t) => t.tags.includes(tag))), [txns]);
  const uncategorized = useMemo(() => txns.filter((t) => t.category === "Other").length, [txns]);
  const merchantList = useMemo(() => distinctMerchants(txns), [txns]);
  const categoryList = useMemo(() => categoriesWithGroup(txns), [txns]);
  const groupUsage = useMemo(() => {
    const u: Record<string, number> = {};
    for (const t of txns) u[t.group] = (u[t.group] ?? 0) + 1;
    return u;
  }, [txns]);

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
            <li><span>🏦</span> Reads Banca Transilvania / ING Romania &amp; Revolut exports, plus generic CSVs</li>
            <li><span>🏷️</span> Auto-tags spending into categories and flags recurring bills &amp; subscriptions</li>
          </ul>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...(f as Filters), ...p }));
  const reset = () => { setFilters(defaultFilters(bounds)); setExcluded(new Set()); };

  const toggleGroup = (key: string) =>
    setExcluded((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const setManyGroups = (keys: string[], included: boolean) =>
    setExcluded((prev) => { const next = new Set(prev); for (const k of keys) (included ? next.delete(k) : next.add(k)); return next; });
  const changeGroupBy = (d: GroupDim) => { if (d === groupBy) return; setGroupBy(d); setExcluded(new Set()); };

  const setOverride = (who: string, group: Group, category: string) => setOverrides((o) => ({ ...o, [who]: { group, category } }));
  const removeOverride = (who: string) => setOverrides((o) => { const n = { ...o }; delete n[who]; return n; });
  const clearOverrides = () => setOverrides({});
  const assign = (who: string) => { setTab("configure"); setAssignReq((prev) => ({ who, n: (prev?.n ?? 0) + 1 })); };

  // group CRUD
  const addGroup = (label: string, kind: GroupKind) =>
    setGroups((gs) => [...gs, { id: slugId(label, new Set(gs.map((g) => g.id))), label, kind, colorVar: nextColorVar(gs), builtin: false }]);
  const renameGroup = (id: string, label: string) => setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, label } : g)));
  const recolorGroup = (id: string, colorVar: string) => setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, colorVar } : g)));
  const changeKind = (id: string, kind: GroupKind) => setGroups((gs) => gs.map((g) => (g.id === id && !g.builtin ? { ...g, kind } : g)));
  const deleteGroup = (id: string) => {
    setGroups((gs) => gs.filter((g) => g.id !== id || g.builtin));
    // any rule pointing at the deleted group reverts to Optional
    setOverrides((o) => {
      const n: Overrides = {};
      for (const [k, v] of Object.entries(o)) n[k] = v.group === id ? { ...v, group: "optional" } : v;
      return n;
    });
    // scrub the dead id from live scoping state so the dashboard can't go blank
    setFilters((f) => (f ? { ...f, groups: f.groups.filter((g) => g !== id) } : f));
    setExcluded((prev) => { const nx = new Set(prev); nx.delete(id); return nx; });
  };

  const catItems: BarItem[] = cats.map((c) => ({
    key: `${c.group}:${c.category}`,
    label: c.category,
    icon: iconFor(c.category),
    sub: `${c.count}×`,
    value: c.total,
    colorKey: gmap.get(c.group)?.colorVar ?? c.group,
  }));
  const merchItems: BarItem[] = merchants.map((m) => ({ key: m.who, label: m.who, sub: m.category, value: m.total }));

  const exportCsv = () => {
    const head = ["date", "who", "group", "category", "direction", "tags", "debit", "credit", "amount"];
    const rows = active.map((t: Txn) =>
      [t.date, csv(t.who), t.group, csv(t.category), t.direction, csv(t.tags.join(" ")), t.debit.toFixed(2), t.credit.toFixed(2), t.amount.toFixed(2)].join(",")
    );
    const blob = new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "spending-tagged.csv"; a.click();
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
          <div className="segmented tabs">
            <button className={tab === "dashboard" ? "on" : ""} onClick={() => setTab("dashboard")}>📊 Dashboard</button>
            <button className={tab === "configure" ? "on" : ""} onClick={() => setTab("configure")}>⚙︎ Configure</button>
          </div>
          <span className="privacy" title="All parsing happens in your browser. Nothing is uploaded.">🔒 100% local</span>
          <FileLoader onLoad={load} compact />
          <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
          <button className="btn-ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀︎ Light" : "☾ Dark"}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {parsed?.warnings.map((w, i) => <div className="banner warn" key={i}>{w}</div>)}

      {tab === "configure" ? (
        <>
          <Card id="groups-config" title="Top-level groups" subtitle="Create, rename, recolour or delete the buckets your money flows into. A group’s behaviour sets its side of the flow (income / spending / savings).">
            <GroupsPanel
              groups={groups}
              usage={groupUsage}
              onAdd={addGroup}
              onRename={renameGroup}
              onRecolor={recolorGroup}
              onChangeKind={changeKind}
              onDelete={deleteGroup}
            />
          </Card>
          <Card id="custom-rules" title="Custom categories & rules" subtitle="Assign a group + category to an entire merchant — it overrides the automatic tagging everywhere. Type a new category name to create one. Saved in this browser.">
            <RulesPanel
              merchants={merchantList}
              categories={categoryList}
              groups={groups}
              overrides={overrides}
              onSet={setOverride}
              onRemove={removeOverride}
              onClear={clearOverrides}
              focusMerchant={assignReq}
            />
          </Card>
        </>
      ) : (
        <>
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

          <Card id="groups-exclude" title="Groups — include or exclude" subtitle="Untick a group to drop it from every chart, tile and total below. Search, expand a row to see its transactions, or use the header box to toggle all.">
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
              groupLabels={groupLabelMap}
            />
          </Card>

          <Card
            id="money-flow"
            className="sankey-card"
            title="Money flow"
            subtitle="Income → available → where it goes. Click a group or category to filter. Transfers between your own accounts are hidden until you enable “Internal”."
            actions={
              <label className="slider">
                Hide flows under {(minFlowPct * 100).toFixed(1)}%
                <input type="range" min={0} max={0.05} step={0.0025} value={minFlowPct} onChange={(e) => setMinFlowPct(Number(e.target.value))} />
              </label>
            }
          >
            <Sankey
              model={model}
              currency={currency}
              onPickGroup={(id) => patch({ groups: [id] })}
              onPickCategory={(category) => patch({ categories: [category] })}
            />
          </Card>

          <div className="grid-2">
            <Card id="monthly" title="Monthly in vs out"><MonthlyTrend data={monthly} currency={currency} /></Card>
            <Card id="top-categories" title="Top categories">
              <BarList items={catItems} currency={currency} empty="No spending in this view." onPick={(it) => patch({ categories: [it.label] })} />
            </Card>
          </div>

          <div className="grid-2">
            <Card id="top-merchants" title="Top merchants">
              <BarList items={merchItems} currency={currency} empty="No merchants in this view." onPick={(it) => patch({ search: it.label })} />
            </Card>
            <Card id="recurring" title="Recurring & subscriptions"><RecurringPanel items={recur} currency={currency} /></Card>
          </div>

          <Card
            id="transactions"
            title="Transactions"
            subtitle={`${active.length.toLocaleString("en-US")} counted${excluded.size ? ` · ${filtered.length - active.length} hidden by group exclusions` : ""} · click a row for details`}
          >
            <TransactionTable txns={active} currency={currency} groupLabels={groupLabelMap} />
          </Card>

          <footer className="foot">
            <span>{txns.length.toLocaleString("en-US")} transactions parsed as <b>{parsed?.format}</b>.</span>
            <span>{uncategorized} uncategorised ({txns.length ? ((uncategorized / txns.length) * 100).toFixed(0) : 0}%) — these show as “Other”.</span>
            <span>Everything runs in your browser; your statement never leaves this machine.</span>
            <span className="foot-total">Filtered total out: {money2(stats.totalOut, currency)}</span>
          </footer>
        </>
      )}
    </div>
  );
}

function csv(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
