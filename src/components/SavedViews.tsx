import { useState } from "react";
import type { SavedView } from "../lib/views";

interface Props {
  views: SavedView[];
  /** view whose snapshot matches the current state (null if none) */
  activeId: string | null;
  /** last-applied view (target for "Update" when the current state has drifted) */
  baseId: string | null;
  onApply: (v: SavedView) => void;
  onSave: (name: string) => void;
  onUpdate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export default function SavedViews({ views, activeId, baseId, onApply, onSave, onUpdate, onRename, onDelete }: Props) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const base = baseId ? views.find((v) => v.id === baseId) : undefined;
  const drifted = base && base.id !== activeId; // applied a view, then changed something

  const save = () => { if (name.trim()) { onSave(name.trim()); setName(""); } };
  const commitRename = () => {
    if (renaming && renameVal.trim()) onRename(renaming, renameVal.trim());
    setRenaming(null);
  };

  return (
    <div className="views-bar">
      <span className="fb-legend">Views</span>
      <div className="chips">
        {views.length === 0 && <span className="views-empty">none saved yet</span>}
        {views.map((v) =>
          renaming === v.id ? (
            <input
              key={v.id}
              className="view-rename"
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
            />
          ) : (
            <span key={v.id} className="view-chip">
              <button className={`chip ${v.id === activeId ? "on" : ""}`} title="Apply this view" onClick={() => onApply(v)}>{v.name}</button>
              <button className="view-mini" title="Rename" onClick={() => { setRenaming(v.id); setRenameVal(v.name); }}>✎</button>
              <button className="view-mini del" title="Delete" onClick={() => onDelete(v.id)}>✕</button>
            </span>
          )
        )}
      </div>

      {drifted && base && (
        <button className="btn-ghost view-update" title="Overwrite this view with the current filters" onClick={() => onUpdate(base.id)}>
          Update “{base.name}”
        </button>
      )}

      <div className="views-save">
        <input
          className="view-name"
          placeholder="name this view…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
        <button className="btn-ghost" disabled={!name.trim()} onClick={save}>Save view</button>
      </div>
    </div>
  );
}
