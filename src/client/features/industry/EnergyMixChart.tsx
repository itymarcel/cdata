import { ENERGY_SOURCES, type EnergySource } from "@shared/types.ts";
import { useEnergyMix } from "../../api/queries.ts";
import { ChartLegend } from "../../components/LineChart.tsx";
import { DataStamp } from "../../components/DataStamp.tsx";
import { PanelState } from "../../components/Panel.tsx";
import { StackedArea } from "../../components/StackedArea.tsx";
import { ENERGY_COLOR } from "../../lib/colors.ts";
import { useCursorYear, useDashboard } from "../../state/store.ts";

const LABEL: Record<EnergySource, string> = {
  coal: "Coal",
  gas: "Gas",
  oil: "Oil",
  nuclear: "Nuclear",
  hydro: "Hydro",
  wind: "Wind",
  solar: "Solar",
  other_renewables: "Other renewables",
};

/** Share of electricity by source for the selected country (or the world). */
export function EnergyMixChart() {
  const country = useDashboard((s) => s.country);
  const year = useCursorYear();
  const iso = country ?? "WLD";
  const { data, isLoading, isError, error } = useEnergyMix(iso);

  if (isLoading) return <PanelState status="loading" />;
  if (isError || !data)
    return <PanelState status="error" message={error?.message.includes("not found") ? "No electricity data for this country." : undefined} />;

  return (
    <div className="tab-chart">
      <p className="tab-chart__lede">
        Electricity generation by source, % · <strong>{data.data.name}</strong>
        {!country && <span className="muted"> (select a country on the map or in the ranking)</span>}
      </p>
      <StackedArea
        years={data.data.years}
        keys={ENERGY_SOURCES}
        values={data.data.shares}
        colors={ENERGY_COLOR}
        labels={LABEL}
        cursor={year}
        yMax={100}
        xMin={1990}
        formatY={(v) => `${Math.round(v)}%`}
        ariaLabel={`Electricity mix for ${data.data.name}`}
      />
      <ChartLegend items={ENERGY_SOURCES.map((s) => ({ label: LABEL[s], color: ENERGY_COLOR[s], style: "swatch" as const }))} />
      <DataStamp source={data.source} />
    </div>
  );
}
