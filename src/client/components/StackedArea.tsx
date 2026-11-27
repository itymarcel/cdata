import { bisector, max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, stack } from "d3-shape";
import { useMemo, useState } from "react";
import { useSize } from "../lib/useSize.ts";
import "./charts.css";

interface StackedAreaProps<K extends string> {
  years: number[];
  keys: readonly K[];
  values: Record<K, (number | null)[]>;
  colors: Record<K, string>;
  labels: Record<K, string>;
  cursor?: number;
  formatY?: (v: number) => string;
  yMax?: number;
  xMin?: number;
  ariaLabel: string;
}

const M = { top: 8, right: 12, bottom: 22, left: 44 };

/** Stacked area with a 1px surface gap between layers and a per-year hover breakdown. */
export function StackedArea<K extends string>({
  years,
  keys,
  values,
  colors,
  labels,
  cursor,
  formatY = (v) => v.toLocaleString("en"),
  yMax,
  xMin,
  ariaLabel,
}: StackedAreaProps<K>) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const rows = useMemo(() => {
    const start = xMin === undefined ? 0 : Math.max(0, years.indexOf(xMin));
    return years.slice(start).map((year, i) => {
      const row: Record<string, number> = { year };
      for (const k of keys) row[k] = values[k][start + i] ?? 0;
      return row;
    });
  }, [years, keys, values, xMin]);

  if (width === 0 || height === 0 || rows.length === 0) return <div ref={ref} className="chart" />;

  const series = stack<Record<string, number>, K>().keys(keys)(rows);
  const x = scaleLinear()
    .domain([rows[0]!.year!, rows.at(-1)!.year!])
    .range([M.left, width - M.right]);
  const top = yMax ?? max(series.at(-1) ?? [], (d) => d[1]) ?? 1;
  const y = scaleLinear().domain([0, top]).range([height - M.bottom, M.top]).nice();
  const gen = area<[number, number] & { data: Record<string, number> }>()
    .x((d) => x(d.data.year!))
    .y0((d) => y(d[0]))
    .y1((d) => y(d[1]));
  const yearBisect = bisector<Record<string, number>, number>((r) => r.year!).center;
  const hoverRow = hoverIdx !== null ? rows[hoverIdx] : null;

  return (
    <div ref={ref} className="chart">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => {
          const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
          setHoverIdx(px >= M.left ? yearBisect(rows, x.invert(px)) : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={M.left - 6} y={y(t)} className="chart__tick" textAnchor="end" dominantBaseline="middle">
              {formatY(t)}
            </text>
          </g>
        ))}
        {x.ticks(Math.max(2, Math.floor(width / 80))).map((t) => (
          <text key={t} x={x(t)} y={height - 6} className="chart__tick" textAnchor="middle">
            {Math.round(t)}
          </text>
        ))}
        {series.map((s) => (
          <path
            key={s.key}
            d={gen(s as never) ?? ""}
            fill={colors[s.key as K]}
            fillOpacity={0.85}
            stroke="var(--surface-1)"
            strokeWidth={1}
          />
        ))}
        {cursor !== undefined && cursor >= x.domain()[0]! && cursor <= x.domain()[1]! && (
          <line x1={x(cursor)} x2={x(cursor)} y1={M.top} y2={height - M.bottom} className="chart__cursor" />
        )}
        {hoverRow && (
          <line x1={x(hoverRow.year!)} x2={x(hoverRow.year!)} y1={M.top} y2={height - M.bottom} className="chart__crosshair" />
        )}
      </svg>
      {hoverRow && (
        <div className="chart__tooltip" style={{ left: Math.min(x(hoverRow.year!) + 12, width - 200), top: M.top }} role="tooltip">
          <div className="chart__tooltip-x">{hoverRow.year}</div>
          {[...keys].reverse().map((k) => (
            <div key={k} className="chart__tooltip-row">
              <span className="chart__key" style={{ background: colors[k] }} />
              <span>{labels[k]}</span>
              <strong className="mono">{formatY(hoverRow[k] ?? 0)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
