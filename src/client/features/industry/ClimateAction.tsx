import type { MapMeasureData, Point } from "@shared/types.ts";
import { useMapMeasures } from "../../api/queries.ts";
import { EvidenceBadge } from "../../components/EvidenceBadge.tsx";
import { ChartLegend, LineChart, type LineSeries } from "../../components/LineChart.tsx";
import { PanelState } from "../../components/Panel.tsx";
import { SERIES } from "../../lib/colors.ts";
import { formatCompact, formatNumber } from "../../lib/format.ts";
import { useCursorYear, useDashboard } from "../../state/store.ts";

/** One country's row as points, or null when it has no values. */
function rowOf(d: MapMeasureData | undefined, iso3: string): Point[] | null {
  if (!d) return null;
  const i = d.countries.findIndex((c) => c.iso3 === iso3);
  if (i < 0) return null;
  const pts = d.years.flatMap((y, k): Point[] => {
    const v = d.values[i]![k];
    return v === null || v === undefined ? [] : [[y, v]];
  });
  return pts.length ? pts : null;
}

const fmt = (v: number, decimals: number) => (Math.abs(v) >= 100_000 ? formatCompact(v) : formatNumber(v, Math.abs(v) >= 100 ? 0 : decimals));

interface Part {
  id: string;
  label: string;
  color: string;
}

/**
 * One small chart: one or more catalog measures in the same unit, for the
 * selected country when it has data, else the world. The figure above it is
 * the latest value, nothing more.
 */
function ActionChart({ title, parts, note }: { title: string; parts: Part[]; note?: string }) {
  const country = useDashboard((s) => s.country);
  const cursor = useCursorYear();
  const setYear = useDashboard((s) => s.setYear);
  const queries = useMapMeasures(parts.map((p) => p.id));
  const data = queries.map((q) => q.data);
  const first = data.find(Boolean);

  if (queries.every((q) => q.isLoading)) return <PanelState status="loading" />;
  if (!first) return <PanelState status="error" />;

  const hasCountry = country !== null && data.some((d) => rowOf(d, country));
  const iso3 = hasCountry ? country! : "WLD";
  const place = hasCountry ? (first.countries.find((c) => c.iso3 === iso3)?.name ?? iso3) : "World";
  const series: LineSeries[] = parts.flatMap((p, k) => {
    const pts = rowOf(data[k], iso3);
    return pts ? [{ id: p.id, label: p.label, color: p.color, points: pts }] : [];
  });
  const latest = series.map((s) => ({ s, p: s.points.at(-1)! }));

  return (
    <figure className="action-chart">
      <figcaption>
        <span className="action-chart__title">{title}</span>
        <span className="muted">
          {place}
          {country && !hasCountry ? " (no data for the selected country)" : ""}
        </span>
      </figcaption>
      {series.length === 0 ? (
        <p className="muted">No data.</p>
      ) : (
        <>
          <div className="action-chart__figures">
            {latest.map(({ s, p }) => (
              <span key={s.id}>
                {latest.length > 1 && <span className="action-chart__key" style={{ background: s.color }} />}
                <strong className="mono">{fmt(p[1], first.decimals)}</strong> <span className="muted">{first.unit}</span>{" "}
                <span className="muted">in {p[0]}</span>
              </span>
            ))}
          </div>
          <LineChart
            series={series}
            height={110}
            cursor={cursor}
            formatY={(v) => fmt(v, Number.isInteger(v) ? 0 : first.decimals)}
            refLines={series.some((s) => s.points.some((p) => p[1] < 0)) ? [{ y: 0, label: "" }] : []}
            onClickX={(x) => setYear(Math.round(x) + 0.5)}
            ariaLabel={`${title}, ${place}`}
          />
          {series.length > 1 && <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color, style: "solid" as const }))} />}
        </>
      )}
      <div className="action-chart__source">
        <EvidenceBadge evidence={first.evidence} compact />{" "}
        {[...new Set(data.filter(Boolean).map((d) => d!.source.publisher))].map((pub, i) => (
          <a key={i} href={data.find((d) => d?.source.publisher === pub)!.source.url} target="_blank" rel="noopener noreferrer">
            {pub}
          </a>
        ))}
        {note && <span className="muted"> · {note}</span>}
      </div>
    </figure>
  );
}

/** What is being done: clean power built, electric cars sold, forests gained and lost. */
export function ClimateAction() {
  return (
    <div className="action-grid">
      <ActionChart
        title="Clean power built"
        parts={[
          { id: "action.solar", label: "Solar", color: SERIES[3] },
          { id: "action.wind", label: "Wind", color: SERIES[0] },
        ]}
      />
      <ActionChart title="Electric share of new cars" parts={[{ id: "action.evShare", label: "Electric", color: SERIES[2] }]} note="incl. plug-in hybrids" />
      <ActionChart title="Low-carbon electricity" parts={[{ id: "energy.lowCarbon", label: "Renewables and nuclear", color: SERIES[5] }]} />
      <ActionChart
        title="Forests gained and lost"
        parts={[
          { id: "forest.change", label: "Net change", color: SERIES[4] },
          { id: "forest.afforestation", label: "Afforestation", color: SERIES[2] },
        ]}
        note="FAO period averages"
      />
    </div>
  );
}
