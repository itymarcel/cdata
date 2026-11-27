import { bisector, extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useMemo, useState, type ReactNode } from "react";
import type { Point } from "@shared/types.ts";
import { useSize } from "../lib/useSize.ts";
import "./charts.css";

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  points: Point[];
  /** "solid" observed, "dashed" required/projected, "dotted" extrapolated trend. */
  style?: "solid" | "dashed" | "dotted";
  /** Draw markers (e.g. target points) instead of a line. */
  markers?: boolean;
}

interface LineChartProps {
  series: LineSeries[];
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Vertical cursor (the global scrubber year). */
  cursor?: number;
  formatX?: (x: number) => string;
  formatY?: (y: number) => string;
  yLabel?: string;
  height?: number;
  /** Horizontal reference lines, e.g. a zero line. */
  refLines?: { y: number; label: string }[];
  onClickX?: (x: number) => void;
  ariaLabel: string;
  children?: ReactNode;
}

const M = { top: 10, right: 14, bottom: 22, left: 44 };
const bisect = bisector<Point, number>((p) => p[0]).center;

export function LineChart({
  series,
  xDomain,
  yDomain,
  cursor,
  formatX = (x) => String(Math.round(x)),
  formatY = (y) => y.toLocaleString("en"),
  yLabel,
  height,
  refLines = [],
  onClickX,
  ariaLabel,
}: LineChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const width = size.width;
  const h = height ?? size.height;

  const scales = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const xd = xDomain ?? (extent(all, (p) => p[0]) as [number, number]);
    const yd = yDomain ?? (extent([...all.map((p) => p[1]), ...refLines.map((r) => r.y)]) as [number, number]);
    const pad = (yd[1] - yd[0]) * 0.06 || 1;
    const x = scaleLinear().domain(xd).range([M.left, Math.max(M.left + 1, width - M.right)]);
    const y = scaleLinear()
      .domain(yDomain ?? [yd[0] - pad, yd[1] + pad])
      .range([Math.max(M.top + 1, h - M.bottom), M.top])
      .nice();
    return { x, y };
  }, [series, xDomain, yDomain, refLines, width, h]);

  if (width === 0 || h === 0) return <div ref={ref} className="chart" style={{ height }} />;
  const { x, y } = scales;
  const [xMin, xMax] = x.domain() as [number, number];
  const pathFor = (pts: Point[]) => line<Point>().x((p) => x(p[0])).y((p) => y(p[1]))(pts) ?? "";

  // Tooltip rows: nearest point in each series to the hovered x.
  const hoverRows =
    hoverX === null
      ? []
      : series.flatMap((s) => {
          if (s.points.length === 0) return [];
          const p = s.points[bisect(s.points, hoverX)]!;
          return Math.abs(p[0] - hoverX) <= (xMax - xMin) / 40 ? [{ s, p }] : [];
        });

  return (
    <div ref={ref} className="chart" style={{ height }}>
      <svg
        width={width}
        height={h}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          setHoverX(px >= M.left && px <= width - M.right ? x.invert(px) : null);
        }}
        onMouseLeave={() => setHoverX(null)}
        onClick={() => hoverX !== null && onClickX?.(hoverX)}
        style={{ cursor: onClickX ? "pointer" : undefined }}
      >
        {/* Grid and axes: hairline, solid, recessive */}
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={M.left - 6} y={y(t)} className="chart__tick" textAnchor="end" dominantBaseline="middle">
              {formatY(t)}
            </text>
          </g>
        ))}
        {x.ticks(Math.max(2, Math.floor(width / 80))).map((t) => (
          <text key={t} x={x(t)} y={h - 6} className="chart__tick" textAnchor="middle">
            {formatX(t)}
          </text>
        ))}
        {yLabel && (
          <text x={M.left} y={M.top - 1} className="chart__ylabel">
            {yLabel}
          </text>
        )}
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={M.left} x2={width - M.right} y1={y(r.y)} y2={y(r.y)} className="chart__ref" />
            <text x={width - M.right} y={y(r.y) - 4} className="chart__tick" textAnchor="end">
              {r.label}
            </text>
          </g>
        ))}

        {cursor !== undefined && cursor >= xMin && cursor <= xMax && (
          <line x1={x(cursor)} x2={x(cursor)} y1={M.top} y2={h - M.bottom} className="chart__cursor" />
        )}

        {series.map((s) =>
          s.markers ? (
            <g key={s.id}>
              {s.points.map((p) => (
                <circle key={p[0]} cx={x(p[0])} cy={y(p[1])} r={5} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              ))}
            </g>
          ) : (
            <path
              key={s.id}
              d={pathFor(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.style === "dashed" ? "6 4" : s.style === "dotted" ? "1.5 4" : undefined}
            />
          ),
        )}

        {hoverX !== null && (
          <>
            <line x1={x(hoverX)} x2={x(hoverX)} y1={M.top} y2={h - M.bottom} className="chart__crosshair" />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.id} cx={x(p[0])} cy={y(p[1])} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
            ))}
          </>
        )}
      </svg>
      {hoverX !== null && hoverRows.length > 0 && (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(x(hoverX) + 12, width - 180), top: M.top }}
          role="tooltip"
        >
          <div className="chart__tooltip-x">{formatX(hoverRows[0]!.p[0])}</div>
          {hoverRows.map(({ s, p }) => (
            <div key={s.id} className="chart__tooltip-row">
              <span className="chart__key" style={{ background: s.color }} />
              <span>{s.label}</span>
              <strong className="mono">{formatY(p[1])}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legend row: always present for two or more series. */
export function ChartLegend({ items }: { items: { label: string; color: string; style?: LineSeries["style"] | "marker" | "swatch" }[] }) {
  return (
    <ul className="chart-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`chart-legend__key chart-legend__key--${i.style ?? "solid"}`} style={{ color: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
