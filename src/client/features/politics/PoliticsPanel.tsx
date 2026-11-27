import { useEffect, useMemo, useState } from "react";
import type { PledgeGap } from "@shared/types.ts";
import { usePledges, useSubsidies } from "../../api/queries.ts";
import { DataStamp } from "../../components/DataStamp.tsx";
import { Flag } from "../../components/Flag.tsx";
import { ChartLegend, LineChart, type LineSeries } from "../../components/LineChart.tsx";
import { Panel, PanelState } from "../../components/Panel.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { SERIES } from "../../lib/colors.ts";
import { formatCompact, formatSigned } from "../../lib/format.ts";
import { useCursorYear, useDashboard } from "../../state/store.ts";
import "./politics.css";

type Tab = "pledges" | "subsidies";

/** "Promises vs reality": NDC pledges against actual emissions, and fossil-fuel subsidies. */
export function PoliticsPanel() {
  const [tab, setTab] = useState<Tab>("pledges");
  return (
    <Panel
      title="Promises vs reality"
      actions={
        <Segmented
          label="Politics view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "pledges", label: "Pledges" },
            { value: "subsidies", label: "Fossil subsidies" },
          ]}
        />
      }
    >
      {tab === "pledges" ? <Pledges /> : <Subsidies />}
    </Panel>
  );
}

function Pledges() {
  const { data, isLoading, isError } = usePledges();
  const country = useDashboard((s) => s.country);
  const cursor = useCursorYear();
  const [iso, setIso] = useState("EU27");

  const gaps = data?.data.gaps;
  const { plottable, textOnly } = useMemo(() => {
    const all = gaps ?? [];
    return {
      plottable: all.filter((g) => g.targetPoints.length > 0),
      textOnly: all.filter((g) => g.targetPoints.length === 0 && (g.otherCommitments.length || g.netZero)),
    };
  }, [gaps]);

  // Follow the global country selection when we have pledges for it.
  useEffect(() => {
    if (country && gaps?.some((p) => p.iso3 === country)) setIso(country);
  }, [country, gaps]);

  if (isLoading) return <PanelState status="loading" />;
  if (isError || !data) return <PanelState status="error" />;
  const pledge = gaps?.find((p) => p.iso3 === iso) ?? plottable[0];

  return (
    <div className="politics-tab">
      <div className="politics__controls">
        <select className="select" value={pledge?.iso3 ?? ""} onChange={(e) => setIso(e.target.value)} aria-label="Country">
          <optgroup label={`Plottable targets (${plottable.length})`}>
            {plottable.map((p) => (
              <option key={p.iso3} value={p.iso3}>
                {p.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={`Intensity, peaking or baseline targets (${textOnly.length})`}>
            {textOnly.map((p) => (
              <option key={p.iso3} value={p.iso3}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="muted">Climate Watch NDC registry vs OWID emissions</span>
      </div>
      {pledge && <PledgeView pledge={pledge} cursor={cursor} />}
      <div className="politics__footer">
        <DataStamp source={data.data.sources.targets} extra={pledge ? undefined : ""} />
        <DataStamp source={data.data.sources.emissions} extra="actuals: total GHG incl. land use" />
      </div>
    </div>
  );
}

function PledgeView({ pledge, cursor }: { pledge: PledgeGap; cursor: number }) {
  const actual = useMemo(
    () => pledge.years.flatMap((y, i) => (pledge.actual[i] === null ? [] : [[y, pledge.actual[i]!] as [number, number]])),
    [pledge],
  );
  const commitments = (
    <ul className="politics__list">
      {pledge.targets.map((t) => (
        <li key={t.year} title={t.text}>
          <strong>{t.year}</strong> {t.rangeLabel}
          <q className="politics__quote">{t.text}</q>
        </li>
      ))}
      {pledge.otherCommitments.map((c) => (
        <li key={c}>
          <q className="politics__quote">{c}</q>
        </li>
      ))}
      {pledge.netZero && (
        <li>
          <strong>Net zero{pledge.netZero.year ? ` ${pledge.netZero.year}` : ""}</strong>{" "}
          <span className="muted">· {pledge.netZero.status || "status not recorded"}</span>
        </li>
      )}
      <li>
        <a href={pledge.sourceUrl} target="_blank" rel="noreferrer">
          {pledge.name} on Climate Watch ↗
        </a>
      </li>
    </ul>
  );

  if (pledge.targetPoints.length === 0) {
    return (
      <div className="politics politics--text">
        <p className="politics__note">
          {pledge.name}'s targets can't be drawn against its emissions: they are framed as intensity cuts, peaks or
          cuts against a projected baseline. In its own words:
        </p>
        {commitments}
      </div>
    );
  }

  const series: LineSeries[] = [
    { id: "actual", label: "Actual", color: SERIES[0], points: actual },
    { id: "trend", label: "Current trend", color: SERIES[0], points: pledge.currentTrend, style: "dotted" },
    { id: "required", label: "Pledged path", color: SERIES[1], points: pledge.requiredPath, style: "dashed" },
    { id: "targets", label: "Targets", color: SERIES[1], points: pledge.targetPoints.map((t) => [t.year, t.value]), markers: true },
  ];

  // Gap at the first future target: where the current trend lands vs the pledge.
  const first = pledge.targetPoints.find((t) => pledge.latestYear === null || t.year > pledge.latestYear);
  const trendAt = (y: number) => {
    const [a, b] = pledge.currentTrend;
    if (!a || !b || b[0] === a[0]) return null;
    return a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0]);
  };
  const trendValue = first ? trendAt(first.year) : null;
  const gap = first && trendValue !== null ? trendValue - first.value : null;
  const hasActual = actual.length > 0;

  return (
    <div className="politics">
      <div className="politics__main">
        <div className="politics__chart">
          <LineChart
            series={series}
            xDomain={[1990, Math.max(2036, ...pledge.targetPoints.map((t) => t.year + 1))]}
            cursor={cursor}
            formatY={formatCompact}
            yLabel="Mt CO₂e"
            ariaLabel={`${pledge.name}: actual emissions against pledged pathway`}
          />
        </div>
      </div>
      <div className="politics__side">
        <ChartLegend
          items={[
            { label: "Actual", color: SERIES[0] },
            { label: "10-yr trend", color: SERIES[0], style: "dotted" },
            { label: "Pledged path", color: SERIES[1], style: "dashed" },
            { label: "Targets", color: SERIES[1], style: "marker" },
          ]}
        />
        {!hasActual && <p className="politics__note">No emissions series for {pledge.name} in OWID, so targets can't be placed.</p>}
        {first && gap !== null && (
          <p className="politics__gap">
            On its current trend, {pledge.name} would emit <strong className="mono">{formatCompact(trendValue!)}</strong> Mt in{" "}
            {first.year}, against a target of <strong className="mono">{formatCompact(first.value)}</strong> ({first.label}). Gap:{" "}
            <strong className={`mono ${gap > 0 ? "gap--over" : "gap--under"}`}>
              {gap > 0 ? "▲" : "▼"} {formatSigned(gap, 0)} Mt ({formatSigned((gap / first.value) * 100, 0)}%)
            </strong>
          </p>
        )}
        {commitments}
      </div>
    </div>
  );
}

const TOP_N = 12;

/** Explicit fossil-fuel subsidies by country for the cursor year (or the latest before it). */
function Subsidies() {
  const { data, isLoading, isError } = useSubsidies();
  const cursor = useCursorYear();
  const country = useDashboard((s) => s.country);
  const selectCountry = useDashboard((s) => s.selectCountry);

  const view = useMemo(() => {
    if (!data) return null;
    const d = data.data;
    const yi = Math.max(0, d.years.findLastIndex((y) => y <= cursor));
    const rows = d.countries
      .map((c) => ({ ...c, v: c.values[yi] ?? null }))
      .filter((r): r is typeof r & { v: number } => r.v !== null && r.v > 0)
      .sort((a, b) => b.v - a.v);
    const worldValue = d.world?.[yi] ?? null;
    const total = worldValue ?? rows.reduce((a, r) => a + r.v, 0);
    return { year: d.years[yi]!, rows: rows.slice(0, TOP_N), total, isWorld: worldValue !== null, inRange: cursor >= d.years[0]! };
  }, [data, cursor]);

  if (isLoading) return <PanelState status="loading" />;
  if (isError || !data || !view) return <PanelState status="error" />;
  const maxV = view.rows[0]?.v ?? 1;

  return (
    <div className="politics-tab">
      <p className="tab-chart__lede">
        {!view.inRange && <span className="muted">Data starts in {data.data.years[0]}. </span>}
        In <strong>{view.year}</strong>, {view.isWorld ? "governments worldwide" : "reporting countries"} spent{" "}
        <strong className="mono">US${formatCompact(view.total / 1e9)} bn</strong> on explicit fossil-fuel subsidies.
      </p>
      <ol className="ranking__list">
        {view.rows.map((r, i) => (
          <li key={r.iso3}>
            <button
              type="button"
              className={`ranking__row${country === r.iso3 ? " is-selected" : ""}`}
              onClick={() => selectCountry(country === r.iso3 ? null : r.iso3)}
            >
              <span className="ranking__rank mono">{i + 1}</span>
              <span className="ranking__name">
                <Flag iso3={r.iso3} />
                <span className="ranking__label">{r.name}</span>
              </span>
              <span className="ranking__bar-track">
                <span className="ranking__bar ranking__bar--alt" style={{ width: `${(r.v / maxV) * 100}%` }} />
              </span>
              <span className="ranking__value mono">${formatCompact(r.v / 1e9)} bn</span>
            </button>
          </li>
        ))}
      </ol>
      <DataStamp source={data.source} extra="current US$, explicit subsidies only" />
    </div>
  );
}
