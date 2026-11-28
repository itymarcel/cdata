import { useMemo, useState } from "react";
import { type Catalog, type Query, type QueryResult, type RankBy, type ResultSeries, type Sentence, type SeriesStats, type StatPoint, splitRef } from "@shared/query.ts";
import type { RichText, VitalId } from "@shared/types.ts";
import { EvidenceBadge } from "../../components/EvidenceBadge.tsx";
import { Flag } from "../../components/Flag.tsx";
import { ChartLegend, LineChart, type LineSeries } from "../../components/LineChart.tsx";
import { StackedArea } from "../../components/StackedArea.tsx";
import { ENERGY_COLOR, FUEL_COLOR, SERIES } from "../../lib/colors.ts";
import { formatNumber } from "../../lib/format.ts";
import { nowYear, useDashboard } from "../../state/store.ts";
import { formatT } from "../explorer/transform.ts";
import { MapResult } from "./MapResult.tsx";

type Of<K extends QueryResult["kind"]> = Extract<QueryResult, { kind: K }>;

export interface ResultActions {
  openInExplorer: (view: VitalId, compare: VitalId | null) => void;
  /** Runs a follow-up query (e.g. "chart these countries"). */
  chartCountries: (measure: string, iso3s: string[], span: [number | null, number | null]) => void;
  /** Ranks countries by a measure in one year (or by its change since `base`). */
  rankCountries: (measure: string, by: RankBy, base: number | null, year: number) => void;
  close: () => void;
}

export function AskResult({ result, query, catalog, actions }: { result: QueryResult; query: Query | null; catalog: Catalog; actions: ResultActions }) {
  switch (result.kind) {
    case "series":
      return <SeriesResult result={result} query={query} actions={actions} />;
    case "rank":
      return <RankResult result={result} actions={actions} />;
    case "map":
      return <MapResult result={result} actions={actions} />;
    case "list":
      return <ListResult result={result} catalog={catalog} actions={actions} />;
    case "open":
      return null;
  }
}

/** Template sentences with their figures emphasised; the basis is one click away. */
export function Sentences({ items }: { items: Sentence[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (items.length === 0) return null;
  return (
    <ul className="ask-sentences">
      {items.map((s, i) => (
        <li key={i}>
          <Rich text={s.text} />{" "}
          <button
            type="button"
            className="ask-basis-btn"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            title="How this was computed"
            aria-label="How this was computed"
          >
            ⓘ
          </button>
          {open === i && <div className="ask-basis">{s.basis}</div>}
        </li>
      ))}
    </ul>
  );
}

function Rich({ text }: { text: RichText }) {
  return (
    <>
      {text.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <strong key={i}>{p.em}</strong>))}
    </>
  );
}

function Sources({ items }: { items: { name: string; publisher?: string; url: string; evidence: ResultSeries["evidence"] }[] }) {
  const unique = [...new Map(items.map((s) => [s.url + s.name, s])).values()];
  return (
    <div className="ask-sources">
      {unique.map((s) => (
        <span key={s.url + s.name} className="ask-source">
          <EvidenceBadge evidence={s.evidence} compact />
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.name}
          </a>
          {s.publisher && <span className="muted"> · {s.publisher}</span>}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

const fmtV = (v: number, d: number) => formatNumber(v, d).replace(/^-/, "−");
const signed = (v: number, d: number) => `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v), d)}`;

function SeriesResult({ result, query, actions }: { result: Of<"series">; query: Query | null; actions: ResultActions }) {
  const now = useMemo(() => nowYear(), []);
  // The Industry panel's colours for fuels and electricity sources, so a fuel looks the same everywhere.
  const colors = new Map(
    result.series.map((s, i) => {
      const [group, key] = splitRef(s.ref).measure.split(".");
      const fixed = group === "energy" ? ENERGY_COLOR[key as keyof typeof ENERGY_COLOR] : group === "emissions" ? FUEL_COLOR[key as keyof typeof FUEL_COLOR] : undefined;
      const parts = new Set(result.series.map((x) => splitRef(x.ref).iso3)).size === 1;
      return [s.ref, (parts && fixed) || SERIES[i % SERIES.length]!];
    }),
  );
  // Stacked areas need parts of one whole: one unit, yearly values, not rates.
  const stackable =
    result.chart === "stacked" &&
    result.display === "values" &&
    result.series.length > 1 &&
    new Set(result.series.map((s) => s.unit)).size === 1 &&
    result.series.every((s) => s.resolution === "annual" && s.scale === "ratio");
  const stack = useMemo(() => {
    if (!stackable) return null;
    const years = [...new Set(result.series.flatMap((s) => s.points.map(([t]) => Math.floor(t))))].sort((a, b) => a - b);
    const keys = result.series.map((s) => s.ref);
    const values = Object.fromEntries(result.series.map((s) => {
      const m = new Map(s.points.map(([t, v]) => [Math.floor(t), v]));
      return [s.ref, years.map((y) => m.get(y) ?? null)];
    }));
    const labels = Object.fromEntries(result.series.map((s) => [s.ref, s.country && new Set(result.series.map((x) => x.country?.iso3)).size > 1 ? s.label : s.short]));
    return { years, keys, values, labels };
  }, [stackable, result.series]);
  // One chart per unit, so values in different units never share an axis.
  const groups = useMemo(() => {
    const m = new Map<string, ResultSeries[]>();
    for (const s of result.series) {
      const g = m.get(s.unit);
      if (g) g.push(s);
      else m.set(s.unit, [s]);
    }
    return [...m.entries()];
  }, [result.series]);
  const span = result.extent[1] - result.extent[0];
  const vitals = [...new Set(result.series.map((s) => s.vital?.id).filter((v): v is VitalId => !!v))];
  const allVital = result.series.every((s) => s.vital);
  const canOpen = allVital && vitals.length >= 1 && vitals.length <= 2;
  const height = groups.length === 1 ? 240 : groups.length === 2 ? 180 : 150;
  // One value per series (a single year): bars, not a line chart with nothing to draw.
  const singleValues = result.series.every((s) => s.points.length === 1) && new Set(result.series.map((s) => s.unit)).size === 1;

  const download = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ["series,unit,decimal_year,value"];
    for (const s of result.series) for (const [t, v] of s.points) lines.push(`${esc(s.label)},${esc(s.unit)},${t},${v}`);
    if (result.series.some((s) => s.thinned)) lines.push("# Dense series were thinned for drawing (each stretch's lowest and highest values kept); open the explorer for every value.");
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ask-${result.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <article className="ask-result">
      <header className="ask-result__head">
        <h3>{result.title}</h3>
        <div className="ask-result__actions">
          {canOpen && (
            <button type="button" className="btn btn--accent" onClick={() => actions.openInExplorer(vitals[0]!, vitals[1] ?? null)}>
              Open in explorer
            </button>
          )}
          <button type="button" className="btn" onClick={download}>
            CSV
          </button>
        </div>
      </header>
      {result.chart === "stacked" && !stackable && (
        <p className="ask-hint muted">These series can’t be stacked (different units or rates), so they’re drawn as lines.</p>
      )}
      {stack && (
        <figure className="ask-chart">
          <div className="ask-stack" style={{ height: 260 }}>
            <StackedArea
              years={stack.years}
              keys={stack.keys}
              values={stack.values}
              colors={Object.fromEntries(stack.keys.map((k) => [k, colors.get(k)!]))}
              labels={stack.labels}
              formatY={(v) => fmtV(v, 0)}
              ariaLabel={`${result.title}, stacked`}
            />
          </div>
          <ChartLegend items={stack.keys.map((k) => ({ label: stack.labels[k]!, color: colors.get(k)!, style: "swatch" as const }))} />
        </figure>
      )}
      {!stack && singleValues && <ValueBars series={result.series} colors={colors} />}
      {!stack && !singleValues && groups.map(([unit, ss]) => (
        <figure key={unit} className="ask-chart">
          <LineChart
            series={ss.map((s): LineSeries => ({ id: s.ref, label: s.label, color: colors.get(s.ref)!, points: s.points }))}
            refLines={result.display === "change" ? [{ y: 0, label: "no change" }] : []}
            formatX={(x) => formatT(x, span, now)}
            formatY={(y) => fmtV(y, Math.max(0, Math.min(2, ss[0]!.decimals)))}
            yLabel={unit}
            height={height}
            ariaLabel={`${ss.map((s) => s.label).join(", ")} in ${unit}`}
          />
          {ss.length > 1 && <ChartLegend items={ss.map((s) => ({ label: s.label, color: colors.get(s.ref)! }))} />}
        </figure>
      ))}
      <Sentences items={result.sentences} />
      <StatsTable series={result.series} stats={result.stats} colors={colors} />
      <Sources items={result.series.map((s) => ({ ...s.source, evidence: s.evidence }))} />
      {query?.kind === "series" && result.series.length === 1 && result.series[0]!.country && result.series[0]!.country.iso3 !== "WLD" && (
        <p className="ask-hint muted">Tip: add more countries to compare, e.g. “… vs India”.</p>
      )}
    </article>
  );
}

/** Horizontal bars for one value per series, scaled from zero. */
function ValueBars({ series, colors }: { series: ResultSeries[]; colors: Map<string, string> }) {
  const max = Math.max(...series.map((s) => Math.abs(s.points[0]![1])), 1e-9);
  const sameCountry = new Set(series.map((s) => s.country?.iso3)).size === 1;
  return (
    <table className="ask-rank ask-bars">
      <caption className="visually-hidden">Values</caption>
      <tbody>
        {series.map((s) => (
          <tr key={s.ref}>
            <th scope="row">
              <span className="ask-link">
                {s.country && !sameCountry && <Flag iso3={s.country.iso3} />}
                {sameCountry || !s.country ? s.short : s.country.name}
              </span>
            </th>
            <td className="ask-rank__num">
              <span className="ask-rank__bar" style={{ width: `${(Math.abs(s.points[0]![1]) / max) * 100}%`, background: colors.get(s.ref) }} />
              <span className="mono">
                {fmtV(s.points[0]![1], s.decimals)} {s.unit}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatsTable({ series, stats, colors }: { series: ResultSeries[]; stats: SeriesStats[]; colors: Map<string, string> }) {
  const sameCountry = new Set(series.map((s) => s.country?.iso3)).size === 1;
  const cell = (p: StatPoint | null, d: number) =>
    p ? (
      <>
        <span className="mono">{fmtV(p.v, d)}</span>
        <span className="ask-stats__when">{p.label}</span>
      </>
    ) : (
      "—"
    );
  return (
    <div className="ask-stats-wrap">
      <table className="ask-stats">
        <thead>
          <tr>
            <th scope="col">Series</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col">Change</th>
            <th scope="col">Trend / yr</th>
            <th scope="col">Lowest</th>
            <th scope="col">Highest</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, i) => {
            const st = stats[i];
            const unit = s.unit.replace(/ per year$/, "");
            return (
              <tr key={s.ref} title={st?.basis}>
                <th scope="row">
                  <span className="chart__key" style={{ background: colors.get(s.ref) }} />
                  {s.country && s.country.iso3 !== "WLD" && !sameCountry && <Flag iso3={s.country.iso3} />}
                  <span>{s.country && !sameCountry ? s.country.name : s.short}</span>
                  <span className="ask-stats__unit">{unit}</span>
                </th>
                <td>{cell(st?.first ?? null, s.decimals)}</td>
                <td>{cell(st?.last ?? null, s.decimals)}</td>
                <td className="mono">
                  {st?.change != null ? signed(st.change, s.decimals) : "—"}
                  {st?.percent != null && <span className="ask-stats__when">{signed(st.percent, Math.abs(st.percent) >= 10 ? 0 : 1)}%</span>}
                </td>
                <td className="mono">{st?.trendPerYear != null ? signed(st.trendPerYear, s.decimals + 1) : "—"}</td>
                <td>{cell(st?.min ?? null, s.decimals)}</td>
                <td>{cell(st?.max ?? null, s.decimals)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ask-basis ask-basis--table">{stats[0]?.basis}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function RankResult({ result, actions }: { result: Of<"rank">; actions: ResultActions }) {
  const selectCountry = useDashboard((s) => s.selectCountry);
  const max = Math.max(...result.rows.map((r) => Math.abs(r.value)), 1e-9);
  const d = result.by === "percent" ? 0 : result.measure.decimals;
  const fmt = (v: number) => (result.by === "value" ? fmtV(v, d) : `${signed(v, d)}${result.by === "percent" ? "%" : ""}`);
  return (
    <article className="ask-result">
      <header className="ask-result__head">
        <h3>{result.title}</h3>
        <div className="ask-result__actions">
          <button
            type="button"
            className="btn btn--accent"
            onClick={() =>
              actions.chartCountries(
                result.measure.id,
                result.rows.slice(0, 5).map((r) => r.iso3),
                // A change ranking charts its own period; a one-year ranking charts the whole record.
                result.by === "value" ? [null, null] : [result.from, result.to],
              )
            }
          >
            Chart the top {Math.min(5, result.rows.length)}
          </button>
        </div>
      </header>
      <Sentences items={result.sentences} />
      <table className="ask-rank">
        <caption className="visually-hidden">{result.title}</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Country</th>
            <th scope="col" className="ask-rank__num">
              {result.unit}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.iso3}>
              <td className="mono muted">{r.rank}</td>
              <th scope="row">
                <button
                  type="button"
                  className="ask-link"
                  onClick={() => {
                    selectCountry(r.iso3);
                    actions.close();
                  }}
                  title="Select on the dashboard"
                >
                  <Flag iso3={r.iso3} />
                  {r.name}
                </button>
              </th>
              <td className="ask-rank__num">
                <span className="ask-rank__bar" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} data-neg={r.value < 0 || undefined} />
                <span className="mono">{fmt(r.value)}</span>
                {r.start !== null && <span className="ask-stats__when">from {fmtV(r.start, result.measure.decimals)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ask-basis">
        {result.total > result.rows.length ? `Top ${result.rows.length} of ${result.total} countries. ` : ""}
        {result.basis}
      </p>
      <Sources items={[{ ...result.measure.source, evidence: result.measure.evidence }]} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function ListResult({ result, actions }: { result: Of<"list">; catalog: Catalog; actions: ResultActions }) {
  const setYear = useDashboard((s) => s.setYear);
  const selectCountry = useDashboard((s) => s.selectCountry);
  return (
    <article className="ask-result">
      <header className="ask-result__head">
        <h3>{result.title}</h3>
        <span className="muted">
          {result.total === 0 ? "Nothing matches" : result.total > result.items.length ? `${result.items.length} of ${result.total}` : `${result.total}`}
        </span>
      </header>
      {result.items.length === 0 ? (
        <p className="ask-empty">No entries match. Try a longer period or remove a filter.</p>
      ) : (
        <ol className="ask-list">
          {result.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="ask-list__date mono"
                onClick={() => {
                  setYear(item.t);
                  actions.close();
                }}
                title="Move the timeline here"
              >
                {item.date}
              </button>
              <div className="ask-list__body">
                <div className="ask-list__title">
                  <EvidenceBadge evidence={item.evidence} compact />
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    <span>{item.title}</span>
                  )}
                </div>
                {item.detail && <p className="ask-list__detail">{item.detail}</p>}
                <div className="ask-list__meta">
                  {item.place && (
                    item.place.iso3 ? (
                      <button
                        type="button"
                        className="ask-link"
                        onClick={() => {
                          selectCountry(item.place!.iso3);
                          actions.close();
                        }}
                      >
                        <Flag iso3={item.place.iso3} />
                        {item.place.name}
                      </button>
                    ) : (
                      <span>{item.place.name}</span>
                    )
                  )}
                  {item.tags.map((t) => (
                    <span key={t} className="ask-tag">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="ask-basis">{result.basis}</p>
      <Sources items={result.sources} />
    </article>
  );
}
