import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "../types";
import { GROUP_LABELS, GROUP_ORDER } from "../types";
import type { Overrides } from "../lib/overrides";
import { iconFor } from "../lib/tagging";

interface Props {
  merchants: string[];
  categories: { name: string; group: Group }[];
  overrides: Overrides;
  onSet: (who: string, group: Group, category: string) => void;
  onRemove: (who: string) => void;
  onClear: () => void;
  /** when set (from the grouped table's "assign" button), prefill the form for this merchant.
   *  `n` is a nonce so the same merchant can be re-requested. */
  focusMerchant?: { who: string; n: number } | null;
}

export default function RulesPanel({ merchants, categories, overrides, onSet, onRemove, onClear, focusMerchant }: Props) {
  const catGroup = useMemo(() => new Map(categories.map((c) => [c.name, c.group])), [categories]);

  const [merchant, setMerchant] = useState("");
  const [group, setGroup] = useState<Group>("optional");
  const [category, setCategory] = useState("");
  const rootRef = useRef<HTMLSelectElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // prefill when the user clicks "assign" on a merchant row elsewhere
  useEffect(() => {
    if (!focusMerchant) return;
    const who = focusMerchant.who;
    setMerchant(who);
    const existing = overrides[who];
    if (existing) {
      setGroup(existing.group);
      setCategory(existing.category);
    } else {
      // new merchant: reset to a neutral default so a previous rule's group can't carry over
      setGroup("optional");
      setCategory("");
    }
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    rootRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMerchant?.n]);

  const onCategoryChange = (v: string) => {
    setCategory(v);
    const g = catGroup.get(v); // picking an existing category adopts its group
    if (g) setGroup(g);
  };

  const canAdd = merchant.trim() !== "" && category.trim() !== "";
  const add = () => {
    if (!canAdd) return;
    onSet(merchant.trim(), group, category.trim());
    setMerchant("");
    setCategory("");
  };

  const entries = Object.entries(overrides).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="rules" ref={cardRef}>
      <div className="rules-form">
        <label className="rules-field">
          <span>Merchant</span>
          <input list="rp-merchants" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="pick or type a merchant…" />
        </label>
        <label className="rules-field">
          <span>Group</span>
          <select ref={rootRef} value={group} onChange={(e) => setGroup(e.target.value as Group)}>
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>{GROUP_LABELS[g]}</option>
            ))}
          </select>
        </label>
        <label className="rules-field">
          <span>Category</span>
          <input list="rp-categories" value={category} onChange={(e) => onCategoryChange(e.target.value)} placeholder="existing or new category…" />
        </label>
        <button className="btn-primary rules-add" onClick={add} disabled={!canAdd}>
          {merchant && overrides[merchant.trim()] ? "Update rule" : "Add rule"}
        </button>
      </div>

      <datalist id="rp-merchants">
        {merchants.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="rp-categories">
        {categories.map((c) => (
          <option key={c.name} value={c.name}>{GROUP_LABELS[c.group]}</option>
        ))}
      </datalist>

      {entries.length === 0 ? (
        <p className="rules-empty">No custom rules yet. Assign a merchant above (or use “assign” in the merchant table) to override its group &amp; category everywhere.</p>
      ) : (
        <div className="rules-list-head">
          <span>{entries.length} rule{entries.length === 1 ? "" : "s"} active</span>
          <button className="btn-reset" onClick={onClear}>Clear all</button>
        </div>
      )}
      <ul className="rules-list">
        {entries.map(([who, ov]) => (
          <li key={who}>
            <button
              className="rules-item"
              title="Edit this rule"
              onClick={() => { setMerchant(who); setGroup(ov.group); setCategory(ov.category); }}
            >
              <span className="rules-who">{who}</span>
              <span className="rules-arrow">→</span>
              <span className="cat-icon">{iconFor(ov.category)}</span>
              <span className="rules-cat">{ov.category}</span>
              <span className={`grp-chip grp-${ov.group}`}>{GROUP_LABELS[ov.group]}</span>
            </button>
            <button className="rules-remove" title="Remove rule" onClick={() => onRemove(who)}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
