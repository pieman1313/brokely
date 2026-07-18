import { useEffect, useMemo, useState } from "react";
import type { Group, GroupDef, GroupKind, ParseResult } from "./types";
import { parseStatement } from "./lib/parse";
import { boundsOf, defaultFilters, applyFilters, isFiltered, groupKeyOf, type Filters, type GroupDim } from "./lib/filters";
import { buildSankey } from "./lib/sankey-model";
import { computeStats, monthlySeries, topCategories, topMerchants, recurring } from "./lib/analytics";
import { applyOverrides, loadOverrides, saveOverrides, distinctMerchants, categoriesWithGroup, type Overrides } from "./lib/overrides";
import { loadGroups, saveGroups, groupMap, nextColorVar, slugId } from "./lib/groups";
import { isCounted, isNonCompleted, reconcileKey, loadReconcile, saveReconcile, type Reconcile, type Decision } from "./lib/reconcile";
import { loadViews, saveViews, newViewId, matchesView, type SavedView } from "./lib/views";
import { useLocalStorageState } from "./lib/ui-state";
import { iconFor } from "./lib/tagging";
import { money2 } from "./lib/format";
import { toOriginalCsv, toTaggedCsv } from "./lib/export-csv";
import { saveTextFile } from "./lib/save-file";
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
import ReconcilePanel from "./components/ReconcilePanel";
import SavedViews from "./components/SavedViews";
import Card from "./components/Card";
import FileLoader from "./components/FileLoader";

const BEHAVIOURAL_TAGS = ["#recurring", "#large", "#weekend", "#cash"];

// dashboard sections, in default order — reorderable & hideable by the user
const SECTIONS: { id: string; title: string }[] = [
  { id: "kpis", title: "Overview (KPIs)" },
  { id: "groups-exclude", title: "Groups — include/exclude" },
  { id: "money-flow", title: "Money flow" },
  { id: "monthly", title: "Monthly in vs out" },
  { id: "top-categories", title: "Top categories" },
  { id: "top-merchants", title: "Top merchants" },
  { id: "recurring", title: "Recurring & subscriptions" },
  { id: "transactions", title: "Transactions" },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

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
  const [order, setOrder] = useLocalStorageState<string[]>("spend.order", SECTION_IDS);
  const [hidden, setHidden] = useLocalStorageState<string[]>("spend.hidden", []);
  const [reconcile, setReconcile] = useState<Reconcile>(() => loadReconcile());
  const [views, setViews] = useState<SavedView[]>(() => loadViews());
  const [baseViewId, setBaseViewId] = useState<string | null>(null);

  useEffect(() => saveOverrides(overrides), [overrides]);
  useEffect(() => saveGroups(groups), [groups]);
  useEffect(() => saveReconcile(reconcile), [reconcile]);
  useEffect(() => saveViews(views), [views]);
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

  // raw parsed txns → apply manual overrides → keep only counted (completed + adopted)
  const rawTxns = parsed?.txns ?? [];
  const tagged = useMemo(() => applyOverrides(rawTxns, overrides, groups), [rawTxns, overrides, groups]);
  const txns = useMemo(() => tagged.filter((t) => isCounted(t, reconcile)), [tagged, reconcile]);
  const pending = useMemo(() => tagged.filter(isNonCompleted), [tagged]);
  const undecidedCount = useMemo(() => pending.filter((t) => !reconcile[reconcileKey(t)]).length, [pending, reconcile]);
  const currency = parsed?.currency ?? "";
  // date bounds span the FULL dataset (incl. pending/reverted) so the range covers a
  // row you later adopt, and the "All" preset / Reset chrome stays consistent on load
  const bounds = useMemo(() => boundsOf(tagged), [tagged]);

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
  const activeViewId = useMemo(() => {
    if (!filters) return null;
    // prefer the applied view when it still matches, so identical-snapshot views don't mispoint
    const base = baseViewId ? views.find((v) => v.id === baseViewId) : undefined;
    if (base && matchesView(base, filters, groupBy, excluded)) return base.id;
    return views.find((v) => matchesView(v, filters, groupBy, excluded))?.id ?? null;
  }, [views, filters, groupBy, excluded, baseViewId]);

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

  // reconciliation handlers
  const setDecision = (key: string, d: Decision) => setReconcile((r) => ({ ...r, [key]: d }));
  const resetDecision = (key: string) => setReconcile((r) => { const n = { ...r }; delete n[key]; return n; });
  const bulkDecision = (keys: string[], d: Decision | "reset") =>
    setReconcile((r) => { const n = { ...r }; for (const k of keys) { if (d === "reset") delete n[k]; else n[k] = d; } return n; });

  // saved views
  const snapshot = () => ({ filters: filters as Filters, groupBy, excluded: [...excluded] });
  const applyView = (v: SavedView) => { setFilters(v.filters); setGroupBy(v.groupBy); setExcluded(new Set(v.excluded)); setBaseViewId(v.id); };
  const saveView = (name: string) => { const id = newViewId(); setViews((vs) => [...vs, { id, name, ...snapshot() }]); setBaseViewId(id); };
  const updateView = (id: string) => { setViews((vs) => vs.map((v) => (v.id === id ? { ...v, ...snapshot() } : v))); setBaseViewId(id); };
  const renameView = (id: string, name: string) => setViews((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)));
  const deleteView = (id: string) => { setViews((vs) => vs.filter((v) => v.id !== id)); setBaseViewId((b) => (b === id ? null : b)); };

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
    // scrub the dead id from live scoping state AND saved views so nothing goes blank
    setFilters((f) => (f ? { ...f, groups: f.groups.filter((g) => g !== id) } : f));
    setExcluded((prev) => { const nx = new Set(prev); nx.delete(id); return nx; });
    setViews((vs) => vs.map((v) => ({ ...v, filters: { ...v.filters, groups: v.filters.groups.filter((g) => g !== id) }, excluded: v.excluded.filter((e) => e !== id) })));
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

  // Export the current filtered view, reproducing the uploaded file's original
  // shape so re-importing looks identical. Prompts for a name (native dialog when
  // the browser supports it), defaulting to the source file name.
  const exportOriginal = () => {
    const text = parsed?.original ? toOriginalCsv(active, parsed.original) : toTaggedCsv(active);
    void saveTextFile(fileName || "statement.csv", text);
  };
  // The app's tagged/flat view — groups, categories and tags added (for spreadsheets).
  const exportTagged = () => {
    const base = (fileName || "statement").replace(/\.csv$/i, "");
    void saveTextFile(`${base}-tagged.csv`, toTaggedCsv(active));
  };

  // dashboard section ordering / visibility
  const fullOrder = [...order.filter((id) => SECTION_IDS.includes(id)), ...SECTION_IDS.filter((id) => !order.includes(id))];
  const hiddenSet = new Set(hidden);
  const moveSection = (from: string, to: string) =>
    setOrder(() => {
      const arr = [...fullOrder];
      const fi = arr.indexOf(from);
      const tiOrig = arr.indexOf(to);
      if (fi < 0 || tiOrig < 0) return arr;
      arr.splice(fi, 1);
      let ti = arr.indexOf(to);
      if (fi < tiOrig) ti += 1; // dragging downward → drop AFTER the target (reaches last slot)
      arr.splice(ti, 0, from);
      return arr;
    });
  const closeSection = (id: string) => setHidden((h) => (h.includes(id) ? h : [...h, id]));
  const toggleHidden = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  const renderSection = (id: string) => {
    const shared = { id, onClose: () => closeSection(id), onMove: moveSection };
    switch (id) {
      case "kpis":
        return <Card key={id} {...shared} title="Overview"><StatTiles stats={stats} currency={currency} /></Card>;
      case "groups-exclude":
        return (
          <Card key={id} {...shared} title="Groups — include or exclude" subtitle="Untick a group to drop it from every chart, tile and total below. Search, expand a row to see its transactions, or use the header box to toggle all.">
            <GroupedTable txns={filtered} currency={currency} dim={groupBy} onDimChange={changeGroupBy} excluded={excluded} onToggle={toggleGroup} onSetMany={setManyGroups} overrides={overrides} onAssign={assign} groupLabels={groupLabelMap} />
          </Card>
        );
      case "money-flow":
        return (
          <Card key={id} {...shared} className="sankey-card" title="Money flow" subtitle="Income → available → where it goes. Click a group or category to filter. Transfers between your own accounts are hidden until you enable “Internal”." actions={
            <label className="slider">
              Hide flows under {(minFlowPct * 100).toFixed(1)}%
              <input type="range" min={0} max={0.05} step={0.0025} value={minFlowPct} onChange={(e) => setMinFlowPct(Number(e.target.value))} />
            </label>
          }>
            <Sankey model={model} currency={currency} onPickGroup={(gid) => patch({ groups: [gid] })} onPickCategory={(category) => patch({ categories: [category] })} />
          </Card>
        );
      case "monthly":
        return <Card key={id} {...shared} title="Monthly in vs out"><MonthlyTrend data={monthly} currency={currency} /></Card>;
      case "top-categories":
        return <Card key={id} {...shared} title="Top categories"><BarList items={catItems} currency={currency} empty="No spending in this view." onPick={(it) => patch({ categories: [it.label] })} /></Card>;
      case "top-merchants":
        return <Card key={id} {...shared} title="Top merchants"><BarList items={merchItems} currency={currency} empty="No merchants in this view." onPick={(it) => patch({ search: it.label })} /></Card>;
      case "recurring":
        return <Card key={id} {...shared} title="Recurring & subscriptions"><RecurringPanel items={recur} currency={currency} /></Card>;
      case "transactions":
        return (
          <Card key={id} {...shared} title="Transactions" subtitle={`${active.length.toLocaleString("en-US")} counted${excluded.size ? ` · ${filtered.length - active.length} hidden by group exclusions` : ""} · click a row for details`}>
            <TransactionTable txns={active} currency={currency} groupLabels={groupLabelMap} />
          </Card>
        );
      default:
        return null;
    }
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
          <button className="btn-ghost" onClick={exportOriginal} title={`Save the ${active.length.toLocaleString("en-US")} transactions in your current filtered view, in the same format as the file you uploaded — so re-importing looks identical. You'll be asked for a file name.`}>Export CSV · {active.length.toLocaleString("en-US")}</button>
          <button className="btn-ghost" onClick={exportTagged} title="Save the same filtered rows as a flat table with the app's groups, categories and tags added (for spreadsheets — not re-importable as-is).">Tagged</button>
          <button className="btn-ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀︎ Light" : "☾ Dark"}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {parsed?.warnings.map((w, i) => <div className="banner warn" key={i}>{w}</div>)}
      {undecidedCount > 0 && tab === "dashboard" && (
        <div className="banner warn reconcile-banner">
          <span><b>{undecidedCount}</b> pending/reverted transaction{undecidedCount === 1 ? " is" : "s are"} excluded from the totals until you reconcile them.</span>
          <button className="btn-ghost" onClick={() => setTab("configure")}>Reconcile →</button>
        </div>
      )}

      {tab === "configure" ? (
        <>
          {pending.length > 0 && (
            <Card id="reconcile" title={`Reconcile pending / reverted${undecidedCount ? ` · ${undecidedCount} to decide` : ""}`} subtitle="These transactions haven’t settled or were reverted, so they’re excluded from every total. Include the ones that should count; remove the rest.">
              <ReconcilePanel items={pending} reconcile={reconcile} currency={currency} groupLabels={groupLabelMap} onSet={setDecision} onReset={resetDecision} onBulk={bulkDecision} />
            </Card>
          )}
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
          <Card id="filters" title="Filters" subtitle={`${active.length.toLocaleString("en-US")} of ${txns.length.toLocaleString("en-US")} transactions in view`}>
            <SavedViews
              views={views}
              activeId={activeViewId}
              baseId={baseViewId}
              onApply={applyView}
              onSave={saveView}
              onUpdate={updateView}
              onRename={renameView}
              onDelete={deleteView}
            />
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
          </Card>

          <div className="sections-bar">
            <details className="sections-menu">
              <summary>⚙︎ Sections{hidden.length ? ` · ${hidden.length} hidden` : ""}</summary>
              <div className="ms-menu">
                {SECTIONS.map((s) => (
                  <label key={s.id} className="ms-opt">
                    <input type="checkbox" checked={!hiddenSet.has(s.id)} onChange={() => toggleHidden(s.id)} />
                    {s.title}
                  </label>
                ))}
              </div>
            </details>
            <span className="sections-hint">drag ⠿ to reorder · ✕ on a card to hide</span>
          </div>

          {fullOrder.filter((id) => !hiddenSet.has(id)).map(renderSection)}

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
