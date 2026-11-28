import { quantile } from "d3-array";
import { geoEqualEarth, geoPath } from "d3-geo";
import { scaleSqrt } from "d3-scale";
import { useEffect, useMemo, useState } from "react";
import type { QueryResult } from "@shared/query.ts";
import type { EmissionsMetric } from "@shared/types.ts";
import { useCountries } from "../../api/queries.ts";
import { EvidenceBadge } from "../../components/EvidenceBadge.tsx";
import { Flag } from "../../components/Flag.tsx";
import { anomalyColor, emissionsColor } from "../../lib/colors.ts";
import { formatNumber } from "../../lib/format.ts";
import { useSize } from "../../lib/useSize.ts";
import { useDashboard } from "../../state/store.ts";
import { actionMapMeasure } from "../map/choropleth.ts";
import type { ResultActions } from "./AskResult.tsx";
import { Sentences } from "./AskResult.tsx";

type MapData = Extract<QueryResult, { kind: "map" }>;

/** Measures the dashboard's own map can show, by its metric name. */
const MAIN_MAP_METRIC: Record<string, EmissionsMetric> = {
  "emissions.co2": "co2",
  "emissions.perCapita": "co2_per_capita",
  "emissions.cumulative": "cumulative_co2",
  "emissions.consumption": "consumption_co2",
  "emissions.ghg": "total_ghg",
};

const NO_DATA = "#1b2027";
const fmt = (v: number, d: number) => formatNumber(v, d).replace(/^-/, "−");
const signed = (v: number, d: number) => `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v), d)}`;

/**
 * A choropleth of one per-country measure with a year slider. Values come
 * straight from the result; for change maps each country is compared with its
 * own base-year value. One colour scale spans every year, so playing through
 * the years shows growth instead of re-normalising each frame.
 */
export function MapResult({ result, actions }: { result: MapData; actions: ResultActions }) {
  const { data: geo, isError } = useCountries();
  const [ref, size] = useSize<HTMLDivElement>();
  const [idx, setIdx] = useState(() => Math.max(0, result.years.indexOf(result.year)));
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<{ iso3: string; x: number; y: number } | null>(null);
  const setMetric = useDashboard((s) => s.setMetric);
  const setActionMeasure = useDashboard((s) => s.setActionMeasure);
  const setYear = useDashboard((s) => s.setYear);
  const setView = useDashboard((s) => s.setView);
  const toggleLayer = useDashboard((s) => s.toggleLayer);

  const year = result.years[idx]!;
  const width = size.width;
  const height = Math.round(width * 0.47);
  const d = result.by === "percent" ? 0 : result.measure.decimals;
  const unit = result.by === "percent" ? "%" : result.by === "change" ? result.measure.unit.replace(/\s+vs\s+.*$/, "") : result.measure.unit;
  const baseIdx = result.base === null ? -1 : result.years.indexOf(result.base);

  /** The figure a country shows in a given year: its value, or its change since the base year. */
  const valueAt = useMemo(
    () =>
      (values: (number | null)[], i: number): number | null => {
        const v = values[i];
        if (v === null || v === undefined) return null;
        if (result.by === "value") return v;
        const b = values[baseIdx];
        if (b === null || b === undefined) return null;
        return result.by === "change" ? v - b : b > 0 ? ((v - b) / b) * 100 : null;
      },
    [result.by, baseIdx],
  );

  // One scale for all years. The brightest colour covers the top 1% (or, for changes, the outer 5%),
  // so a single outlier doesn't leave everything else dark.
  const scale = useMemo(() => {
    const all = result.countries.flatMap((c) => result.years.map((_, i) => valueAt(c.values, i)).filter((v): v is number => v !== null));
    if (result.by === "value") {
      const top = quantile(all, 0.99) ?? 1;
      const s = scaleSqrt().domain([0, top || 1]).range([0, 1]).clamp(true);
      return { color: (v: number) => emissionsColor(s(Math.max(0, v))), lo: 0, hi: top, diverging: false };
    }
    const maxAbs = quantile(all.map(Math.abs), 0.95) || 1;
    return { color: (v: number) => anomalyColor(v, maxAbs), lo: -maxAbs, hi: maxAbs, diverging: true };
  }, [result, valueAt]);

  const paths = useMemo(() => {
    if (!geo || width === 0) return [];
    const features = geo.data.features.filter((f) => f.properties.iso3 !== "ATA");
    const projection = geoEqualEarth().fitSize([width, height], { type: "FeatureCollection", features } as never);
    const path = geoPath(projection);
    return features.map((f) => ({ iso3: f.properties.iso3, name: f.properties.name, d: path(f as never) ?? "" }));
  }, [geo, width, height]);

  const byIso = useMemo(() => new Map(result.countries.map((c) => [c.iso3, c])), [result.countries]);
  const ranked = useMemo(
    () =>
      // Same rule as the rankings: per-person measures leave out countries under a million people.
      result.countries
        .filter((c) => c.ranked)
        .map((c) => ({ c, v: valueAt(c.values, idx) }))
        .filter((x): x is { c: (typeof result.countries)[number]; v: number } => x.v !== null)
        .sort((a, b) => b.v - a.v),
    [result.countries, valueAt, idx],
  );
  const rankOf = useMemo(() => new Map(ranked.map((x, i) => [x.c.iso3, i + 1])), [ranked]);

  // Playback: about ten seconds end to end, starting over if already at the end.
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(60, Math.min(400, 10_000 / result.years.length));
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= result.years.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, step);
    return () => clearInterval(id);
  }, [playing, result.years.length]);

  const show = (v: number | null) => (v === null ? "no data" : result.by === "value" ? `${fmt(v, d)}${unit.startsWith("%") ? "" : " "}${unit}` : `${signed(v, d)}${result.by === "percent" ? "%" : ` ${unit}`}`);
  const hovered = hover ? byIso.get(hover.iso3) : undefined;
  const hoveredName = hover ? (hovered?.name ?? paths.find((p) => p.iso3 === hover.iso3)?.name ?? hover.iso3) : null;
  const metric = MAIN_MAP_METRIC[result.measure.id];
  const action = actionMapMeasure(result.measure.id);
  const legendStops = Array.from({ length: 9 }, (_, i) => scale.lo + ((scale.hi - scale.lo) * i) / 8);

  const download = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [`iso3,country,${result.years.join(",")}`];
    for (const c of result.countries) lines.push(`${c.iso3},${esc(c.name)},${c.values.map((v) => v ?? "").join(",")}`);
    lines.push(`# ${result.measure.label} (${result.measure.unit}), ${result.measure.source.publisher}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ask-map-${result.measure.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <article className="ask-result">
      <header className="ask-result__head">
        <h3>{result.title}</h3>
        <div className="ask-result__actions">
          {(metric || action) && result.by === "value" && (
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                if (metric) setMetric(metric);
                setActionMeasure(action ? action.id : null);
                setYear(year + 0.5);
                if (!useDashboard.getState().layers.emissions) toggleLayer("emissions");
                setView("map");
                actions.close();
              }}
            >
              Open on the main map
            </button>
          )}
          <button type="button" className="btn" onClick={() => actions.rankCountries(result.measure.id, result.by, result.base, year)}>
            Rank {year}
          </button>
          <button type="button" className="btn" onClick={download}>
            CSV
          </button>
        </div>
      </header>

      <div className="ask-map" ref={ref} onMouseLeave={() => setHover(null)}>
        {isError && <p className="ask-error">The country outlines couldn’t be loaded.</p>}
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${result.title}: map for ${year}`}>
            {paths.map((p) => {
              const c = byIso.get(p.iso3);
              const v = c ? valueAt(c.values, idx) : null;
              return (
                <path
                  key={p.iso3 + p.d.length}
                  d={p.d}
                  fill={v === null ? NO_DATA : scale.color(v)}
                  className={hover?.iso3 === p.iso3 ? "is-hover" : undefined}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setHover({ iso3: p.iso3, x: e.clientX - r.left, y: e.clientY - r.top });
                  }}
                  onClick={() => c && actions.chartCountries(result.measure.id, [p.iso3], [result.base, null])}
                >
                  <title>{`${p.name}: ${show(v)}`}</title>
                </path>
              );
            })}
          </svg>
        )}
        {hover && hoveredName && (
          <div className="chart__tooltip ask-map__tip" style={{ left: Math.min(hover.x + 14, width - 200), top: Math.max(0, hover.y - 10) }} role="tooltip">
            <div className="ask-map__tip-name">
              <Flag iso3={hover.iso3} />
              {hoveredName}
            </div>
            <div className="mono">{show(hovered ? valueAt(hovered.values, idx) : null)}</div>
            {hovered && rankOf.get(hover.iso3) && (
              <div className="muted">
                {rankOf.get(hover.iso3)} of {ranked.length} in {year}
                {result.base !== null ? ` · vs ${result.base}` : ""}
              </div>
            )}
            {hovered && <div className="muted">Click to chart</div>}
          </div>
        )}
      </div>

      <div className="ask-map__controls">
        <button
          type="button"
          className="icon-btn ask-map__play"
          onClick={() => {
            if (!playing && idx >= result.years.length - 1) setIdx(0);
            setPlaying(!playing);
          }}
          aria-label={playing ? "Pause" : "Play through the years"}
          disabled={result.years.length < 2}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="ask-map__year mono" aria-live="polite">
          {year}
        </span>
        <input
          type="range"
          min={0}
          max={result.years.length - 1}
          value={idx}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
          aria-label="Year"
          aria-valuetext={String(year)}
          disabled={result.years.length < 2}
        />
        <span className="muted mono ask-map__range">
          {result.years[0]}–{result.years.at(-1)}
        </span>
      </div>

      <div className="ask-map__legend">
        <div className="ask-map__ramp">
          <svg width="220" height="10" aria-hidden="true">
            <defs>
              <linearGradient id="ask-map-ramp">
                {legendStops.map((v, i) => (
                  <stop key={i} offset={`${(i / 8) * 100}%`} stopColor={scale.color(v)} />
                ))}
              </linearGradient>
            </defs>
            <rect width="220" height="10" rx="2" fill="url(#ask-map-ramp)" />
          </svg>
          <div className="ask-map__legend-labels mono">
            <span>{scale.diverging ? show(scale.lo) : show(0)}</span>
            {scale.diverging && <span>0</span>}
            <span>
              {scale.diverging ? "" : "≥ "}
              {show(scale.hi)}
            </span>
          </div>
        </div>
        <span className="ask-map__nodata">
          <span style={{ background: NO_DATA }} /> no data
        </span>
      </div>

      <div className="ask-map__top">
        <span className="muted">{result.by === "value" ? "Highest" : "Largest increase"} in {year}:</span>
        {ranked.slice(0, 5).map((x, i) => (
          <button key={x.c.iso3} type="button" className="ask-link" onClick={() => actions.chartCountries(result.measure.id, [x.c.iso3], [result.base, null])}>
            <span className="muted">{i + 1}.</span>
            <Flag iso3={x.c.iso3} />
            {x.c.name} <span className="mono muted">{show(x.v)}</span>
          </button>
        ))}
      </div>

      <Sentences items={result.sentences} />
      <p className="ask-basis">{result.basis}</p>
      <div className="ask-sources">
        <span className="ask-source">
          <EvidenceBadge evidence={result.measure.evidence} compact />
          <a href={result.measure.source.url} target="_blank" rel="noreferrer">
            {result.measure.source.name}
          </a>
          <span className="muted"> · {result.measure.source.publisher}</span>
        </span>
      </div>
    </article>
  );
}
