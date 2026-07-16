import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MonthPoint } from "../lib/analytics";
import { compact, money, monthLabel } from "../lib/format";

interface Props {
  data: MonthPoint[];
  currency: string;
}

const M = { top: 14, right: 14, bottom: 26, left: 46 };
const H = 240;

export default function MonthlyTrend({ data, currency }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(320, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setHover(null), [data]); // drop stale index when the series changes

  const geom = useMemo(() => {
    const iw = Math.max(120, width - M.left - M.right);
    const ih = H - M.top - M.bottom;
    const max = Math.max(1, ...data.map((d) => Math.max(d.in, d.out)));
    const minNet = Math.min(0, ...data.map((d) => d.net));
    const yTop = max;
    const yBot = Math.min(minNet, 0);
    const range = yTop - yBot || 1;
    const y = (v: number) => M.top + ih * (1 - (v - yBot) / range);
    const band = iw / Math.max(1, data.length);
    const barW = Math.min(22, band * 0.34);
    const x = (i: number) => M.left + band * i + band / 2;
    return { iw, ih, y, x, band, barW, yTop, yBot };
  }, [data, width]);

  if (data.length === 0) return <div className="chart-empty">No monthly data.</div>;

  const zeroY = geom.y(0);
  const netPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${geom.x(i)},${geom.y(d.net)}`)
    .join(" ");

  // sparse axis ticks: ~5
  const step = Math.max(1, Math.round(data.length / 6));

  return (
    <div className="chart" ref={wrapRef}>
      <div className="legend">
        <span className="legend-item"><span className="swatch" style={{ background: "var(--g-income)" }} />In</span>
        <span className="legend-item"><span className="swatch" style={{ background: "var(--g-optional)" }} />Out</span>
        <span className="legend-item"><span className="swatch line" style={{ background: "var(--series-net)" }} />Net</span>
      </div>
      <svg width={width} height={H} role="img" aria-label="Monthly money in, out and net">
        {/* zero baseline */}
        <line x1={M.left} x2={width - M.right} y1={zeroY} y2={zeroY} className="axis-base" />
        {/* bars */}
        {data.map((d, i) => {
          const cx = geom.x(i);
          return (
            <g
              key={d.month}
              onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={cx - geom.barW - 1} y={geom.y(d.in)} width={geom.barW} height={Math.max(0, zeroY - geom.y(d.in))} rx={3} fill="var(--g-income)" fillOpacity={hover?.i === i ? 1 : 0.85} />
              <rect x={cx + 1} y={geom.y(d.out)} width={geom.barW} height={Math.max(0, zeroY - geom.y(d.out))} rx={3} fill="var(--g-optional)" fillOpacity={hover?.i === i ? 1 : 0.85} />
              {/* invisible hit area spanning the band */}
              <rect x={M.left + geom.band * i} y={M.top} width={geom.band} height={geom.ih} fill="transparent" />
            </g>
          );
        })}
        {/* net line */}
        <path d={netPath} className="net-line" />
        {data.map((d, i) => (
          <circle key={d.month} cx={geom.x(i)} cy={geom.y(d.net)} r={hover?.i === i ? 4 : 2.5} fill="var(--series-net)" />
        ))}
        {/* x labels */}
        {data.map((d, i) =>
          i % step === 0 ? (
            <text key={d.month} className="axis-label" x={geom.x(i)} y={H - 8} textAnchor="middle">
              {monthLabel(d.month)}
            </text>
          ) : null
        )}
        {/* y max label */}
        <text className="axis-label" x={M.left - 6} y={geom.y(geom.yTop) + 4} textAnchor="end">{compact(geom.yTop)}</text>
      </svg>
      {hover && (() => {
        const d = data[hover.i];
        if (!d) return null;
        const r = wrapRef.current?.getBoundingClientRect();
        return (
          <div className="tip" style={{ left: hover.x - (r?.left ?? 0) + 12, top: hover.y - (r?.top ?? 0) + 12 }}>
            <div className="tip-title">{monthLabel(d.month)}</div>
            <div className="tip-row"><span className="swatch" style={{ background: "var(--g-income)" }} />In<b>{money(d.in, currency)}</b></div>
            <div className="tip-row"><span className="swatch" style={{ background: "var(--g-optional)" }} />Out<b>{money(d.out, currency)}</b></div>
            <div className="tip-row"><span className="swatch line" style={{ background: "var(--series-net)" }} />Net<b>{money(d.net, currency)}</b></div>
          </div>
        );
      })()}
    </div>
  );
}
