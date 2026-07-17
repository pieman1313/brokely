import type { ReactNode } from "react";
import { useLocalStorageState } from "../lib/ui-state";

interface Props {
  /** stable id used to persist the collapsed state */
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** right-aligned header controls (kept visible even when collapsed) */
  actions?: ReactNode;
  defaultCollapsed?: boolean;
  className?: string;
  children: ReactNode;
}

/** A card whose body collapses to just its header; state persists per id, and the
 *  body is NOT rendered while collapsed. */
export default function Card({ id, title, subtitle, actions, defaultCollapsed = false, className = "", children }: Props) {
  const [collapsed, setCollapsed] = useLocalStorageState(`spend.collapse.${id}`, defaultCollapsed);
  return (
    <section className={`card ${className} ${collapsed ? "is-collapsed" : ""}`}>
      <div className="card-head">
        <button
          className="card-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <div className="card-head-main">
          <h2>{title}</h2>
          {subtitle && !collapsed && <p className="card-sub">{subtitle}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      {!collapsed && <div className="card-body">{children}</div>}
    </section>
  );
}
