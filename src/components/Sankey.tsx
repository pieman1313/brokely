import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  sankey as d3sankey,
  sankeyLinkHorizontal,
  sankeyJustify,
  type SankeyGraph,
} from "d3-sankey";
import type { SankeyModel, SNode, SLink } from "../lib/sankey-model";
import { compact, money } from "../lib/format";

interface Props {
  model: SankeyModel;
  currency: string;
  /** drill-down callbacks fired on node click */
  onPickGroup?: (label: string) => void;
  onPickCategory?: (category: string) => void;
}

type LayoutNode = SNode & {
  x0: number; x1: number; y0: number; y1: number;
};
type LayoutLink = Omit<SLink, "source" | "target"> & {
  source: LayoutNode; target: LayoutNode; width: number; y0: number; y1: number;
};

const MARGIN = { top: 16, right: 168, bottom: 16, left: 150 };
const NODE_W = 15;
const NODE_PAD = 13;

export default function Sankey({ model, currency, onPickGroup, onPickCategory }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<
    | { kind: "node"; i: number; x: number; y: number }
    | { kind: "link"; i: number; x: number; y: number }
    | null
  >(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.max(360, entries[0].contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the hovered index points into the current graph arrays; when the model changes
  // (e.g. drilling down via a node click) that index is stale — clear it so the
  // tooltip never dereferences a node/link that no longer exists.
  useEffect(() => setHover(null), [model]);

  // tallest column drives the height so nodes never get razor-thin
  const height = useMemo(() => {
    const byDepthGuess = new Map<string, number>();
    for (const n of model.nodes) byDepthGuess.set(n.kind, (byDepthGuess.get(n.kind) ?? 0) + 1);
    const busiest = Math.max(
      byDepthGuess.get("category") ?? 0,
      (byDepthGuess.get("income") ?? 0) + (byDepthGuess.get("deficit") ?? 0),
      4
    );
    return Math.min(1400, Math.max(380, busiest * 26 + MARGIN.top + MARGIN.bottom));
  }, [model]);

  const graph = useMemo(() => {
    if (model.nodes.length === 0) return null;
    const layout = d3sankey<SNode, SLink>()
      .nodeWidth(NODE_W)
      .nodePadding(NODE_PAD)
      .nodeAlign(sankeyJustify)
      .extent([
        [MARGIN.left, MARGIN.top],
        [Math.max(MARGIN.left + 60, width - MARGIN.right), height - MARGIN.bottom],
      ]);
    // clone so d3 mutation never touches the memoised model
    const input: SankeyGraph<SNode, SLink> = {
      nodes: model.nodes.map((d) => ({ ...d })),
      links: model.links.map((d) => ({ ...d })),
    };
    return layout(input) as unknown as { nodes: LayoutNode[]; links: LayoutLink[] };
  }, [model, width, height]);

  if (!graph) {
    return (
      <div ref={wrapRef} className="sankey-empty">
        No flows match the current filters.
      </div>
    );
  }

  const linkPath = sankeyLinkHorizontal<SNode, SLink>();
  const total = Math.max(model.totalIn, model.totalOut, 1);

  const clickNode = (n: LayoutNode) => {
    if (n.kind === "group") onPickGroup?.(n.label);
    else if (n.kind === "category" && n.label !== "Other (small)") onPickCategory?.(n.label);
  };

  return (
    <div ref={wrapRef} className="sankey-wrap">
      <svg width={width} height={height} role="img" aria-label="Money flow diagram">
        {/* links */}
        <g fill="none">
          {graph.links.map((l, i) => (
            <path
              key={i}
              d={linkPath(l as unknown as SLink) ?? undefined}
              stroke={`var(--g-${l.colorKey})`}
              strokeOpacity={hover?.kind === "link" && hover.i === i ? 0.62 : 0.32}
              strokeWidth={Math.max(1, l.width)}
              onMouseMove={(e) => setHover({ kind: "link", i, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>

        {/* nodes */}
        <g>
          {graph.nodes.map((n, i) => {
            const leftHalf = (n.x0 + n.x1) / 2 < width / 2;
            const clickable = n.kind === "group" || (n.kind === "category" && n.label !== "Other (small)");
            const labelX = leftHalf ? n.x0 - 8 : n.x1 + 8;
            return (
              <g key={i}>
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={n.x1 - n.x0}
                  height={Math.max(1, n.y1 - n.y0)}
                  fill={`var(--g-${n.colorKey})`}
                  rx={2}
                  style={{ cursor: clickable ? "pointer" : "default" }}
                  onMouseMove={(e) => setHover({ kind: "node", i, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => clickNode(n)}
                />
                <text
                  className="sankey-label"
                  x={labelX}
                  y={(n.y0 + n.y1) / 2}
                  dy="0.35em"
                  textAnchor={leftHalf ? "end" : "start"}
                  style={{ cursor: clickable ? "pointer" : "default" }}
                  onClick={() => clickNode(n)}
                >
                  <tspan className="sankey-label-name">{n.label}</tspan>
                  <tspan className="sankey-label-value" dx="6">{compact(n.value)}</tspan>
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {hover && (
        <Tooltip
          hover={hover}
          graph={graph}
          currency={currency}
          total={total}
          wrap={wrapRef.current}
        />
      )}
    </div>
  );
}

function Tooltip({
  hover,
  graph,
  currency,
  total,
  wrap,
}: {
  hover: { kind: "node" | "link"; i: number; x: number; y: number };
  graph: { nodes: LayoutNode[]; links: LayoutLink[] };
  currency: string;
  total: number;
  wrap: HTMLDivElement | null;
}) {
  const rect = wrap?.getBoundingClientRect();
  const left = hover.x - (rect?.left ?? 0) + 14;
  const top = hover.y - (rect?.top ?? 0) + 14;

  let title = "";
  let value = 0;
  if (hover.kind === "node") {
    const n = graph.nodes[hover.i];
    if (!n) return null; // stale index after a model change
    title = n.label;
    value = n.value;
  } else {
    const l = graph.links[hover.i];
    if (!l) return null;
    title = `${l.source.label} → ${l.target.label}`;
    value = l.value;
  }
  const pct = ((value / total) * 100).toFixed(1);

  return (
    <div className="sankey-tip" style={{ left, top }}>
      <div className="sankey-tip-val">{money(value, currency)}</div>
      <div className="sankey-tip-title">{title}</div>
      <div className="sankey-tip-pct">{pct}% of total flow</div>
    </div>
  );
}
