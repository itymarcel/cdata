import { useMemo } from "react";
import { useEmissionsMatrix } from "../../api/queries.ts";
import { DataStamp } from "../../components/DataStamp.tsx";
import { Flag } from "../../components/Flag.tsx";
import { PanelState } from "../../components/Panel.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { compareEmissions } from "../../lib/compare.ts";
import { formatCompact, formatNumber } from "../../lib/format.ts";
import { useCursorYear, useDashboard } from "../../state/store.ts";
import { METRIC_OPTIONS } from "../map/LayerSwitcher.tsx";

const TOP_N = 12;
const MIN_POPULATION = 1_000_000;

/**
 * Ranked bars for the cursor year. Switching total / per person / since 1850 /
 * consumption-based reorders the list, which is the point.
 */
export function EmittersRanking() {
  const metric = useDashboard((s) => s.metric);
  const setMetric = useDashboard((s) => s.setMetric);
  const country = useDashboard((s) => s.country);
  const selectCountry = useDashboard((s) => s.selectCountry);
  const cursorYear = useCursorYear();
  const { data, isLoading, isError } = useEmissionsMatrix(metric);

  const ranking = useMemo(() => {
    if (!data) return null;
    const m = data.data;
    const yi = Math.min(m.years.length - 1, Math.max(0, cursorYear - m.years[0]!));
    const world = m.countries.findIndex((c) => c.iso3 === "WLD");
    const worldValue = world >= 0 ? m.values[world]![yi] : null;
    // Per-capita rankings are otherwise dominated by tiny states; require 1M+ people.
    const bigEnough = (i: number) => !m.population || (m.population[i]![yi] ?? 0) >= MIN_POPULATION;
    const rows = m.countries
      .map((c, i) => ({ ...c, i, value: m.values[i]![yi] ?? null }))
      .filter((r): r is typeof r & { value: number } => r.value !== null && r.iso3.length === 3 && r.iso3 !== "WLD" && bigEnough(r.i))
      .sort((a, b) => b.value - a.value);
    return { year: m.years[yi]!, rows: rows.slice(0, TOP_N), worldValue, unit: m.unit };
  }, [data, cursorYear]);

  if (isLoading) return <PanelState status="loading" />;
  if (isError || !ranking || !data) return <PanelState status="error" />;
  const maxValue = ranking.rows[0]?.value ?? 1;
  const perCapita = metric === "co2_per_capita";

  return (
    <div className="ranking">
      <div className="ranking__controls">
        <Segmented label="Emissions measure" value={metric} options={METRIC_OPTIONS} onChange={setMetric} />
        <span className="muted">
          {ranking.year} · {ranking.unit}
          {metric === "co2_per_capita" && " · countries over 1M people"}
        </span>
      </div>
      {ranking.rows.length === 0 ? (
        <PanelState status="empty" message={`No country data for ${ranking.year}.`} />
      ) : (
        <ol className="ranking__list">
          {ranking.rows.map((r, i) => {
            const share = ranking.worldValue && !perCapita ? (r.value / ranking.worldValue) * 100 : null;
            return (
              <li key={r.iso3}>
                <button
                  type="button"
                  className={`ranking__row${country === r.iso3 ? " is-selected" : ""}`}
                  onClick={() => selectCountry(country === r.iso3 ? null : r.iso3)}
                  title={perCapita || metric === "cumulative_co2" ? r.name : `${r.name}: ${compareEmissions(r.value)}`}
                >
                  <span className="ranking__rank mono">{i + 1}</span>
                  <span className="ranking__name">
                    <Flag iso3={r.iso3} />
                    <span className="ranking__label">{r.name}</span>
                  </span>
                  <span className="ranking__bar-track">
                    <span className="ranking__bar" style={{ width: `${(r.value / maxValue) * 100}%` }} />
                  </span>
                  <span className="ranking__value mono">
                    {perCapita ? formatNumber(r.value, 1) : formatCompact(r.value)}
                    {share !== null && <span className="muted"> {share.toFixed(0)}%</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <DataStamp source={data.source} />
    </div>
  );
}
