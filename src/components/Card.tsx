import type { ReactNode } from "react";
import { useState } from "react";
import { useLocalStorageState } from "../lib/ui-state";

// which card is currently being dragged (dataTransfer isn't readable during dragover)
let draggedCard: string | null = null;

interface Props {
  /** stable id used to persist the collapsed state and identify the section */
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** right-aligned header controls (kept visible even when collapsed) */
  actions?: ReactNode;
  defaultCollapsed?: boolean;
  className?: string;
  /** show a close (hide) button */
  onClose?: () => void;
  /** enable drag-to-reorder: called with (draggedId, thisId) on drop */
  onMove?: (draggedId: string, targetId: string) => void;
  children: ReactNode;
}

/** A card whose whole header toggles its body (persisted per id; body not rendered
 *  while collapsed). A focusable chevron button gives keyboard/AT access; the header
 *  click is a mouse convenience. Optionally closable and drag-reorderable. */
export default function Card({ id, title, subtitle, actions, defaultCollapsed = false, className = "", onClose, onMove, children }: Props) {
  const [collapsed, setCollapsed] = useLocalStorageState(`spend.collapse.${id}`, defaultCollapsed);
  const [over, setOver] = useState(false);
  const toggle = () => setCollapsed((c) => !c);

  return (
    <section
      className={`card ${className} ${collapsed ? "is-collapsed" : ""} ${over ? "drag-over" : ""}`}
      onDragOver={onMove ? (e) => { if (draggedCard && draggedCard !== id) { e.preventDefault(); setOver(true); } } : undefined}
      onDragLeave={onMove ? () => setOver(false) : undefined}
      onDrop={onMove ? (e) => {
        e.preventDefault();
        setOver(false);
        const from = e.dataTransfer.getData("text/card") || draggedCard;
        if (from && from !== id) onMove(from, id);
      } : undefined}
    >
      {/* whole header toggles collapse (mouse); the chevron button is the a11y control */}
      <div className="card-head" onClick={toggle}>
        {onMove && (
          <span
            className="drag-handle"
            draggable
            title="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) => { draggedCard = id; e.dataTransfer.setData("text/card", id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { draggedCard = null; setOver(false); }}
          >
            ⠿
          </span>
        )}
        <button
          className="card-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <div className="card-head-main">
          <h2>{title}</h2>
          {subtitle && !collapsed && <p className="card-sub">{subtitle}</p>}
        </div>
        {actions && <div className="card-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>}
        {onClose && (
          <button className="card-close" aria-label="Hide this section" title="Hide this section" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
        )}
      </div>
      {!collapsed && <div className="card-body">{children}</div>}
    </section>
  );
}
