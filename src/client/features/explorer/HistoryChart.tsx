import { scaleLinear, scaleLog } from "d3-scale";
import { interpolateRgb } from "d3-interpolate";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BandPoint, EnsoEpisode, OverlayId, Point, Resolution, TimelineEvent, TimelineKind, Volcano } from "@shared/types.ts";
import { useSize } from "../../lib/useSize.ts";
import { formatNumber } from "../../lib/format.ts";
import { INK } from "../../lib/colors.ts";
import { bandPath, byYear, clip, decimatedPath, formatT, linearFit, nearest, quadraticFit } from "./transform.ts";

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  role: "primary" | "alternative" | "reconstruction" | "projection";
  resolution: Resolution;
  points: Point[];
  band?: BandPoint[];
  maxGap: number;
}

export interface CompareSeries {
  label: string;
  unit: string;
  decimals: number;
  color: string;
  points: Point[];
}

export interface TimeScale {
  (t: number): number;
  invert(px: number): number;
  ticks(): { t: number; label: string }[];
}

interface Props {
  series: ChartSeries[];
  compare: CompareSeries | null;
  window: [number, number];
  scale: "linear" | "log";
  mode: "timeline" | "seasonal";
  now: number;
  unit: string;
  decimals: number;
  overlays: Set<OverlayId>;
  /** Overlays this vital offers; space is reserved for them so toggling never shifts the plot. */
  available: OverlayId[];
  references: { y: number; label: string; note: string }[];
  enso: EnsoEpisode[];
  volcanoes: Volcano[];
  events: TimelineEvent[];
  eventKinds: TimelineKind[];
  /** Fit a quadratic too, to show acceleration. */
  acceleration: boolean;
  cursor: number;
  onPan: (window: [number, number]) => void;
  onZoom: (window: [number, number]) => void;
  onReset: () => void;
  onPickYear: (t: number) => void;
}

interface Tooltip {
  title: string;
  rows: { color: string; label: string; value: string }[];
  notes: string[];
}

const EVENT_ROWS: TimelineKind[] = ["record", "cop", "law", "attribution"];
const EVENT_ROW_H = 7;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yearRamp = interpolateRgb("#2a3542", "#7fa9db");

/** A time axis that is either linear in years or logarithmic in "years ago". */
export function makeTimeScale(kind: "linear" | "log", window: [number, number], range: [number, number], now: number): TimeScale {
  if (kind === "linear") {
    const s = scaleLinear().domain(window).range(range);
    const span = window[1] - window[0];
    const f = (t: number) => s(t);
    f.invert = (px: number) => s.invert(px);
    f.ticks = () => s.ticks(Math.max(2, Math.floor((range[1] - range[0]) / 90))).map((t) => ({ t, label: formatT(t, span, now) }));
    return f;
  }
  const ago = (t: number) => Math.max(0.5, now + 1 - t);
  const s = scaleLog().domain([ago(window[0]), ago(window[1])]).range(range);
  const f = (t: number) => s(ago(t));
  f.invert = (px: number) => now + 1 - s.invert(px);
  f.ticks = () => {
    const [a, b] = s.domain() as [number, number];
    const out: { t: number; label: string }[] = [];
    for (let p = Math.ceil(Math.log10(Math.min(a, b))); 10 ** p <= Math.max(a, b); p++) {
      const yrs = 10 ** p;
      out.push({ t: now + 1 - yrs, label: yrs >= 1000 ? `${(yrs / 1000).toLocaleString("en")}k yrs ago` : yrs === 1 ? "1 yr ago" : `${yrs} yrs ago` });
    }
    return out;
  };
  return f;
}

const M = { right: 54, bottom: 22, left: 50, top: 12 };

export function HistoryChart(props: Props) {
  const { series, compare, window: win, scale, mode, now, unit, decimals, overlays, available, cursor } = props;
  const [ref, size] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const [box, setBox] = useState<[number, number] | null>(null);
  const drag = useRef<{ x0: number; y0: number; win: [number, number]; box: boolean; moved: boolean } | null>(null);
  const on = (o: OverlayId) => overlays.has(o);
  const seasonal = mode === "seasonal";

  const eventsTop = M.top + (available.includes("events") && !seasonal ? EVENT_ROWS.length * EVENT_ROW_H + 6 : 0);
  const width = size.width;
  const height = size.height;
  const plot = { left: M.left, right: Math.max(M.left + 10, width - (compare ? M.right : 14)), top: eventsTop, bottom: Math.max(eventsTop + 10, height - M.bottom) };

  const x = useMemo(
    () =>
      seasonal
        ? makeTimeScale("linear", [0, 1], [plot.left, plot.right], now)
        : makeTimeScale(scale, win, [plot.left, plot.right], now),
    [seasonal, scale, win, plot.left, plot.right, now],
  );

  // Years drawn in seasonal mode: those overlapping the window.
  const seasonalYears = useMemo(() => {
    if (!seasonal) return null;
    const y0 = Math.floor(win[0]);
    const y1 = Math.floor(win[1]);
    return series
      .filter((s) => s.resolution === "daily" || s.resolution === "monthly")
      .map((s) => {
        const span = (s.points.at(-1)?.[0] ?? 0) - (s.points[0]?.[0] ?? 0);
        const years = [...byYear(s.points)].filter(([y]) => y >= y0 && y <= y1);
        return { s, years, single: span <= 1.2 };
      });
  }, [seasonal, series, win]);

  const visible = useMemo(
    () =>
      series.map((s) => ({
        s,
        pts: clip(s.points, win[0], win[1]),
        band: s.band ? clip(s.band, win[0], win[1]) : undefined,
      })),
    [series, win],
  );

  const y = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    const take = (v: number) => {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    };
    if (seasonalYears) {
      for (const g of seasonalYears) for (const [, pts] of g.years) for (const [, v] of pts) take(v);
    } else {
      for (const { s, pts, band } of visible) {
        for (const [t, v] of pts) if (t >= win[0] && t <= win[1]) take(v);
        if (band && on("uncertainty")) for (const [t, l, h] of band) if (t >= win[0] && t <= win[1]) (take(l), take(h));
        if (pts.length && s.points.length && lo === Infinity) for (const [, v] of pts) take(v); // a lone point either side of a narrow window
      }
    }
    if (!Number.isFinite(lo)) (lo = 0), (hi = 1);
    if (on("references") && !seasonal) {
      const span = hi - lo || 1;
      for (const r of props.references) if (r.y >= lo - span * 0.6 && r.y <= hi + span * 0.6) take(r.y);
    }
    const pad = (hi - lo) * 0.06 || 1;
    return scaleLinear().domain([lo - pad, hi + pad]).range([plot.bottom, plot.top]).nice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seasonalYears, overlays, props.references, plot.top, plot.bottom, win, seasonal]);

  const yCompare = useMemo(() => {
    if (!compare) return null;
    const pts = clip(compare.points, win[0], win[1]).filter(([t]) => t >= win[0] && t <= win[1]);
    if (pts.length === 0) return null;
    const vals = pts.map((p) => p[1]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.06 || 1;
    return scaleLinear().domain([lo - pad, hi + pad]).range([plot.bottom, plot.top]).nice();
  }, [compare, win, plot.top, plot.bottom]);

  // Where the main series ends, labelled on the chart: "where are we now" at a glance.
  const latest = useMemo(() => {
    if (seasonal) return null;
    const p = series.find((s) => s.role === "primary");
    const last = p?.points.at(-1);
    if (!p || !last || last[0] < win[0] || last[0] > win[1]) return null;
    return { t: last[0], v: last[1], color: p.color };
  }, [seasonal, series, win]);

  // Trend over what's in view, on the measured series that covers most of it
  // (the primary wins ties): tide gauges for 1880 onwards, satellites from 1993.
  const trend = useMemo(() => {
    if (seasonal) return null;
    let best: { s: ChartSeries; pts: Point[]; cover: number } | null = null;
    for (const s of series) {
      if (s.role === "projection") continue;
      const pts = clip(s.points, win[0], win[1]).filter(([t]) => t >= win[0] && t <= win[1]);
      if (pts.length < 3) continue;
      const cover = pts.at(-1)![0] - pts[0]![0] + (s.role === "primary" ? (win[1] - win[0]) * 0.05 : 0);
      if (!best || cover > best.cover) best = { s, pts, cover };
    }
    if (!best) return null;
    const lin = linearFit(best.pts);
    if (!lin) return null;
    const quad = props.acceleration ? quadraticFit(best.pts) : null;
    return { lin, quad, from: best.pts[0]![0], to: best.pts.at(-1)![0], color: best.s.color, label: best.s.label };
  }, [seasonal, series, win, props.acceleration]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  const zoomRef = useRef<(e: WheelEvent) => void>(() => {});
  zoomRef.current = (e: WheelEvent) => {
    if (seasonal) return;
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const px = Math.min(plot.right, Math.max(plot.left, e.clientX - rect.left));
    const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0025)));
    props.onZoom([x.invert(px - (px - plot.left) * f), x.invert(px + (plot.right - px) * f)]);
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const fn = (e: WheelEvent) => zoomRef.current(e);
    el.addEventListener("wheel", fn, { passive: false });
    return () => el.removeEventListener("wheel", fn);
  }, [width > 0]);

  if (width === 0 || height === 0) return <div ref={ref} className="xp-chart" />;

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const inPlot = (px: number) => px >= plot.left && px <= plot.right;

  const onPointerDown = (e: React.PointerEvent) => {
    const { px, py } = local(e);
    if (!inPlot(px) || e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x0: px, y0: py, win, box: e.shiftKey && !seasonal, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const { px, py } = local(e);
    const d = drag.current;
    if (d) {
      if (Math.abs(px - d.x0) > 3) d.moved = true;
      if (d.box) setBox([d.x0, px]);
      else if (d.moved && !seasonal) {
        const back = makeTimeScale(scale, d.win, [plot.left, plot.right], now);
        const dx = px - d.x0;
        props.onPan([back.invert(plot.left - dx), back.invert(plot.right - dx)]);
      }
    }
    setHover(inPlot(px) && py >= plot.top - 2 && py <= plot.bottom ? { px, py } : null);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const { px } = local(e);
    if (d.box && box && Math.abs(box[1] - box[0]) > 6) {
      const a = Math.min(box[0], box[1]);
      const b = Math.max(box[0], box[1]);
      props.onZoom([x.invert(a), x.invert(b)]);
    } else if (!d.moved && !seasonal) {
      props.onPickYear(x.invert(px));
    }
    setBox(null);
  };

  const yTicks = y.ticks(Math.max(3, Math.floor((plot.bottom - plot.top) / 48)));
  const span = win[1] - win[0];
  const fmtY = (v: number) => formatNumber(v, Math.max(0, Math.min(decimals, yTicks.length > 1 && Math.abs(yTicks[1]! - yTicks[0]!) >= 1 ? 0 : decimals)));
  const yPos = (v: number) => y(v);
  // The latest-value label sits just above its point (below it when that is off the top);
  // a reference label at the same height moves to the left end of its line.
  const latestY = latest ? (y(latest.v) - 8 < plot.top + 10 ? y(latest.v) + 16 : y(latest.v) - 8) : null;
  const dodges = (ry: number) => latestY !== null && Math.abs(ry - 4 - latestY) < 13;
  const shortUnit = unit.replace(/ (vs|since) .*$/, "");

  // ----- hover readout -----
  let tooltip: Tooltip | null = null;
  let hoverMarks: { cx: number; cy: number; color: string }[] = [];
  let hoverYear: number | null = null;
  if (hover && !drag.current?.moved) {
    if (seasonal && seasonalYears) {
      const frac = x.invert(hover.px);
      let best: { year: number; p: Point; d: number; color: string; label: string } | null = null;
      for (const g of seasonalYears) {
        for (const [year, pts] of g.years) {
          const p = nearest(pts, frac);
          if (!p) continue;
          const d = Math.abs(y(p[1]) - hover.py);
          if (!best || d < best.d) best = { year, p, d, color: g.s.color, label: g.s.label };
        }
      }
      if (best) {
        hoverYear = best.year;
        const date = new Date(Date.UTC(best.year, 0, 1 + Math.floor(best.p[0] * 365)));
        tooltip = {
          title: date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
          rows: [{ color: best.color, label: best.label, value: `${formatNumber(best.p[1], decimals)} ${shortUnit}` }],
          notes: [],
        };
        hoverMarks = [{ cx: x(best.p[0]), cy: y(best.p[1]), color: best.color }];
      }
    } else {
      const t = x.invert(hover.px);
      const rows: Tooltip["rows"] = [];
      for (const { s, pts } of visible) {
        const p = nearest(pts, t);
        if (!p || Math.abs(x(p[0]) - hover.px) > 30) continue;
        rows.push({ color: s.color, label: s.label, value: `${formatNumber(p[1], decimals)} ${shortUnit}` });
        hoverMarks.push({ cx: x(p[0]), cy: y(p[1]), color: s.color });
      }
      if (compare && yCompare) {
        const p = nearest(compare.points, t);
        if (p && Math.abs(x(p[0]) - hover.px) <= 30) {
          rows.push({ color: compare.color, label: compare.label, value: `${formatNumber(p[1], compare.decimals)} ${compare.unit.split(" ")[0]}` });
          hoverMarks.push({ cx: x(p[0]), cy: yCompare(p[1]), color: compare.color });
        }
      }
      const notes: string[] = [];
      if (on("enso")) {
        const ep = props.enso.find((e) => t >= e.start && t <= e.end);
        if (ep) notes.push(`${ep.phase === "elNino" ? "El Niño" : "La Niña"} (peak ${ep.peak > 0 ? "+" : ""}${ep.peak} °C)`);
      }
      if (on("volcanoes"))
        for (const v of props.volcanoes) if (Math.abs(x(v.t) - hover.px) < 6) notes.push(`Eruption: ${v.name}, ${v.country} (VEI ${v.vei})`);
      if (on("events")) {
        const near = props.events.filter((ev) => props.eventKinds.includes(ev.kind) && Math.abs(x(ev.t) - hover.px) < 4);
        near.slice(0, 3).forEach((ev) => notes.push(ev.title));
        if (near.length > 3) notes.push(`+${near.length - 3} more events`);
      }
      tooltip = { title: formatT(t, span < 60 ? Math.min(span, 2.9) : span, now), rows, notes };
    }
  }

  const xTicks = seasonal
    ? MONTHS.map((m, i) => ({ t: i / 12, label: m }))
    : x.ticks().filter((tk) => x(tk.t) >= plot.left - 1 && x(tk.t) <= plot.right + 1);
  const clipId = "xp-plot-clip";

  return (
    <div ref={ref} className="xp-chart">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        aria-label="History chart. Drag to pan, scroll to zoom, shift-drag to zoom to a range, double-click to reset."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={() => !seasonal && props.onReset()}
        className={seasonal ? undefined : drag.current?.moved ? "is-panning" : "is-pannable"}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={plot.left} y={plot.top - 2} width={plot.right - plot.left} height={plot.bottom - plot.top + 4} />
          </clipPath>
        </defs>

        {/* ENSO shading sits behind everything. */}
        {!seasonal && (
          <g className={`xp-layer${on("enso") ? "" : " is-off"}`} clipPath={`url(#${clipId})`}>
            {props.enso
              .filter((e) => e.end >= win[0] && e.start <= win[1])
              .map((e) => (
                <rect
                  key={`${e.phase}-${e.start}`}
                  x={x(e.start)}
                  width={Math.max(1, x(e.end) - x(e.start))}
                  y={plot.top}
                  height={plot.bottom - plot.top}
                  className={`xp-enso xp-enso--${e.phase}`}
                  style={{ opacity: Math.min(1, 0.35 + Math.abs(e.peak) / 3) }}
                />
              ))}
          </g>
        )}

        {/* Grid and axes */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={plot.left} x2={plot.right} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={plot.left - 6} y={y(t)} className="chart__tick" textAnchor="end" dominantBaseline="middle">
              {fmtY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((tk) => (
          <text
            key={tk.t}
            x={x(tk.t)}
            y={height - 6}
            className="chart__tick"
            textAnchor={x(tk.t) > plot.right - 36 ? "end" : x(tk.t) < plot.left + 36 && !seasonal ? "start" : "middle"}
          >
            {tk.label}
          </text>
        ))}
        <text x={plot.left} y={plot.top - 4} className="chart__ylabel">
          {unit}
        </text>
        {compare && yCompare && (
          <g>
            {yCompare.ticks(4).map((t) => (
              <text key={t} x={plot.right + 6} y={yCompare(t)} className="chart__tick" dominantBaseline="middle" style={{ fill: compare.color }}>
                {formatNumber(t, Math.abs(yCompare.ticks(4)[1]! - yCompare.ticks(4)[0]!) >= 1 ? 0 : compare.decimals)}
              </text>
            ))}
            <text x={plot.right + 6} y={plot.top - 4} className="chart__ylabel" style={{ fill: compare.color }}>
              {compare.unit}
            </text>
          </g>
        )}

        {/* Reference lines */}
        {!seasonal && (
          <g className={`xp-layer${on("references") ? "" : " is-off"}`}>
            {props.references
              .filter((r) => r.y >= y.domain()[0]! && r.y <= y.domain()[1]!)
              .map((r) => (
                <g key={r.label}>
                  <title>{r.note}</title>
                  <line x1={plot.left} x2={plot.right} y1={yPos(r.y)} y2={yPos(r.y)} className="xp-ref" />
                  <text
                    x={dodges(yPos(r.y)) ? plot.left + 4 : plot.right - 4}
                    y={yPos(r.y) - 4}
                    className="xp-ref__label"
                    textAnchor={dodges(yPos(r.y)) ? "start" : "end"}
                  >
                    {r.label}
                  </text>
                </g>
              ))}
          </g>
        )}

        {/* Volcanic eruptions */}
        {!seasonal && (
          <g className={`xp-layer${on("volcanoes") ? "" : " is-off"}`} clipPath={`url(#${clipId})`}>
            {props.volcanoes
              .filter((v) => v.t >= win[0] && v.t <= win[1])
              .map((v, i, arr) => {
                const vx = x(v.t);
                const crowded = i > 0 && vx - x(arr[i - 1]!.t) < 46;
                return (
                  <g key={`${v.name}-${v.t}`}>
                    <line x1={vx} x2={vx} y1={plot.top} y2={plot.bottom} className="xp-volcano" />
                    <path d={`M${vx - 4},${plot.bottom} L${vx},${plot.bottom - 6} L${vx + 4},${plot.bottom} Z`} className="xp-volcano__mark" />
                    {!crowded && (
                      <text x={vx + 3} y={plot.bottom - 9} className="xp-volcano__label">
                        {v.name}
                      </text>
                    )}
                  </g>
                );
              })}
          </g>
        )}

        {/* Data */}
        <g clipPath={`url(#${clipId})`}>
          {!seasonal &&
            visible.map(({ s, band }) =>
              band ? (
                <path
                  key={`band-${s.id}`}
                  d={bandPath(band, x, y)}
                  fill={s.color}
                  className={`xp-band xp-layer${on("uncertainty") ? "" : " is-off"}`}
                />
              ) : null,
            )}
          {!seasonal &&
            visible.map(({ s, pts }) => (
              <path
                key={s.id}
                d={decimatedPath(pts, x, y, s.maxGap)}
                className={`xp-line xp-line--${s.role}`}
                stroke={s.color}
              />
            ))}
          {seasonalYears?.map((g) =>
            g.years.map(([year, pts], i) => {
              const latest = i === g.years.length - 1;
              const k = g.years.length > 1 ? i / (g.years.length - 1) : 1;
              const color = g.single ? g.s.color : latest ? INK.accent : yearRamp(k);
              return (
                <path
                  key={`${g.s.id}-${year}`}
                  d={decimatedPath(pts, x, y, g.s.maxGap)}
                  className={`xp-line xp-line--season${latest || g.single ? " is-latest" : ""}${hoverYear === year && !g.single ? " is-hovered" : ""}`}
                  stroke={color}
                  strokeDasharray={g.single ? "4 3" : undefined}
                />
              );
            }),
          )}
          {compare && yCompare && !seasonal && (
            <path d={decimatedPath(clip(compare.points, win[0], win[1]), x, yCompare, 3)} className="xp-line xp-line--compare" stroke={compare.color} />
          )}
          {trend && (
            <g className={`xp-layer${on("trend") ? "" : " is-off"}`}>
              <line
                x1={x(trend.from)}
                x2={x(trend.to)}
                y1={y(trend.lin.intercept + trend.lin.slope * trend.from)}
                y2={y(trend.lin.intercept + trend.lin.slope * trend.to)}
                className="xp-trend"
              />
              {trend.quad && (
                <path
                  className="xp-trend xp-trend--curve"
                  d={Array.from({ length: 60 }, (_, i) => {
                    const t = trend.from + ((trend.to - trend.from) * i) / 59;
                    const u = t - trend.quad!.t0;
                    return `${i ? "L" : "M"}${x(t).toFixed(1)},${y(trend.quad!.a + trend.quad!.b * u + trend.quad!.c * u * u).toFixed(1)}`;
                  }).join("")}
                />
              )}
            </g>
          )}
        </g>

        {latest && (
          <g className="xp-latest" aria-hidden="true">
            <circle cx={x(latest.t)} cy={y(latest.v)} r={3.5} fill={latest.color} stroke="var(--surface-1)" strokeWidth={1.5} />
            <text x={x(latest.t) - 7} y={latestY!} textAnchor="end" className="xp-latest__label" fill={latest.color}>
              {formatNumber(latest.v, decimals)} {unit.replace(/\s+(vs|since)\b.*$/, "")}
            </text>
          </g>
        )}

        {/* Events strip */}
        {!seasonal && available.includes("events") && (
          <g className={`xp-layer${on("events") ? "" : " is-off"}`}>
            {EVENT_ROWS.map((kind, row) => {
              const cy = M.top + row * EVENT_ROW_H + EVENT_ROW_H / 2;
              if (!props.eventKinds.includes(kind)) return null;
              return (
                <g key={kind}>
                  {props.events
                    .filter((ev) => ev.kind === kind && ev.t >= win[0] && ev.t <= win[1])
                    .map((ev) => (
                      <circle key={ev.id} cx={x(ev.t)} cy={cy} r={2.4} className={`tl-glyph tl-glyph--${kind}`} />
                    ))}
                </g>
              );
            })}
          </g>
        )}

        {/* Scrubber year */}
        {!seasonal && cursor >= win[0] && cursor <= win[1] && (
          <line x1={x(cursor)} x2={x(cursor)} y1={plot.top} y2={plot.bottom} className="chart__cursor" />
        )}

        {/* Hover */}
        {hover && !seasonal && <line x1={hover.px} x2={hover.px} y1={plot.top} y2={plot.bottom} className="chart__crosshair" />}
        {hoverMarks.map((m, i) => (
          <circle key={i} cx={m.cx} cy={m.cy} r={3.5} fill={m.color} stroke="var(--surface-1)" strokeWidth={1.5} />
        ))}
        {box && <rect x={Math.min(...box)} width={Math.abs(box[1] - box[0])} y={plot.top} height={plot.bottom - plot.top} className="xp-box" />}
      </svg>

      {trend && on("trend") && (
        <div className="xp-trend-label" style={{ top: plot.top + 4, left: plot.left + 8 }}>
          <span className="xp-trend-label__series">
            <span className="chart__key" style={{ background: trend.color }} /> {trend.label}
          </span>
          <span className="mono">{trendText(trend, unit, decimals)}</span>
          {trend.quad && <span className="mono">{accelText(trend.quad.c, unit)}</span>}
        </div>
      )}

      {tooltip && hover && (tooltip.rows.length > 0 || tooltip.notes.length > 0) && (
        <div className="chart__tooltip xp-tooltip" style={{ left: Math.min(hover.px + 14, width - 240), top: Math.max(4, Math.min(hover.py - 10, height - 150)) }} role="tooltip">
          <div className="chart__tooltip-x">{tooltip.title}</div>
          {tooltip.rows.map((r) => (
            <div key={r.label} className="chart__tooltip-row">
              <span className="chart__key" style={{ background: r.color }} />
              <span>{r.label}</span>
              <strong className="mono">{r.value}</strong>
            </div>
          ))}
          {tooltip.notes.map((n) => (
            <div key={n} className="xp-tooltip__note">
              {n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function trendText(trend: { lin: { slope: number }; from: number; to: number }, unit: string, decimals: number): string {
  const perDecade = trend.to - trend.from >= 15;
  const v = trend.lin.slope * (perDecade ? 10 : 1);
  const d = Math.abs(v) >= 10 ? 0 : Math.max(decimals, 2);
  return `Trend ${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v), d)} ${unit.split(" ")[0]} per ${perDecade ? "decade" : "year"} (${Math.floor(trend.from)}–${Math.floor(trend.to)})`;
}

function accelText(c: number, unit: string): string {
  // y'' = 2c per year²; per decade that is 20c (units/yr per decade).
  const v = 20 * c;
  return `${v >= 0 ? "Accelerating" : "Slowing"}: rate ${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v), 2)} ${unit.split(" ")[0]}/yr each decade`;
}
