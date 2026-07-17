import { useState } from "react";
import type { GroupDef, GroupKind } from "../types";
import { CUSTOM_COLOR_SLOTS } from "../types";

interface Props {
  groups: GroupDef[];
  usage: Record<string, number>; // #transactions currently in each group
  onAdd: (label: string, kind: GroupKind) => void;
  onRename: (id: string, label: string) => void;
  onRecolor: (id: string, colorVar: string) => void;
  onChangeKind: (id: string, kind: GroupKind) => void;
  onDelete: (id: string) => void;
}

const KINDS: { key: GroupKind; label: string }[] = [
  { key: "income", label: "Income (inflow)" },
  { key: "spend", label: "Spending (outflow)" },
  { key: "transfers", label: "To people (outflow)" },
  { key: "savings", label: "Savings / internal" },
];

const COLOR_VARS = [
  "income", "required", "optional", "transfers", "savings",
  ...Array.from({ length: CUSTOM_COLOR_SLOTS }, (_, i) => `custom-${i + 1}`),
];

export default function GroupsPanel({ groups, usage, onAdd, onRename, onRecolor, onChangeKind, onDelete }: Props) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<GroupKind>("spend");

  const add = () => {
    if (!label.trim()) return;
    onAdd(label.trim(), kind);
    setLabel("");
    setKind("spend");
  };

  return (
    <div className="groups-panel">
      <div className="rules-form">
        <label className="rules-field">
          <span>New group name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Investments, Business…" onKeyDown={(e) => e.key === "Enter" && add()} />
        </label>
        <label className="rules-field">
          <span>Behaves as</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as GroupKind)}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </label>
        <button className="btn-primary rules-add" onClick={add} disabled={!label.trim()}>Add group</button>
      </div>

      <ul className="groups-list">
        {groups.map((g) => (
          <li key={g.id} className="group-row">
            <details className="color-pick">
              <summary title="Change colour"><span className="swatch group-swatch" style={{ background: `var(--g-${g.colorVar})` }} /></summary>
              <div className="color-menu">
                {COLOR_VARS.map((cv) => (
                  <button
                    key={cv}
                    className={`color-swatch ${g.colorVar === cv ? "on" : ""}`}
                    style={{ background: `var(--g-${cv})` }}
                    title={cv}
                    onClick={(e) => { onRecolor(g.id, cv); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}
                  />
                ))}
              </div>
            </details>

            <input
              className="group-label"
              defaultValue={g.label}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.label) onRename(g.id, v); else e.target.value = g.label; }}
            />

            {g.builtin ? (
              <span className="group-kind muted" title="Built-in groups keep their behaviour">{KINDS.find((k) => k.key === g.kind)?.label}</span>
            ) : (
              <select className="group-kind" value={g.kind} onChange={(e) => onChangeKind(g.id, e.target.value as GroupKind)}>
                {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            )}

            <span className="group-usage">{usage[g.id] ? `${usage[g.id]} txns` : "unused"}</span>

            {g.builtin ? (
              <span className="group-builtin">built-in</span>
            ) : (
              <button className="rules-remove" title="Delete group (its rules revert to Optional)" onClick={() => onDelete(g.id)}>✕</button>
            )}
          </li>
        ))}
      </ul>
      <p className="rules-empty">Built-in groups can be renamed &amp; recoloured. Custom groups also let you set behaviour and be deleted. A group’s behaviour decides which side of the money flow it sits on.</p>
    </div>
  );
}
