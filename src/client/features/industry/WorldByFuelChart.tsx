import { FUELS, type Fuel } from "@shared/types.ts";
import { useWorldByFuel } from "../../api/queries.ts";
import { ChartLegend } from "../../components/LineChart.tsx";
import { DataStamp } from "../../components/DataStamp.tsx";
import { PanelState } from "../../components/Panel.tsx";
import { StackedArea } from "../../components/StackedArea.tsx";
import { FUEL_COLOR } from "../../lib/colors.ts";
import { formatCompact } from "../../lib/format.ts";
import { useCursorYear } from "../../state/store.ts";

const FUEL_LABEL: Record<Fuel, string> = {
  coal: "Coal",
  oil: "Oil",
  gas: "Gas",
  cement: "Cement",
  flaring: "Flaring",
  land_use_change: "Land-use change",
};

export function WorldByFuelChart() {
  const year = useCursorYear();
  const { data, isLoading, isError } = useWorldByFuel();
  if (isLoading) return <PanelState status="loading" />;
  if (isError || !data) return <PanelState status="error" />;
  return (
    <div className="tab-chart">
      <p className="tab-chart__lede">Global CO₂ by source, {data.data.unit}. Land-use change is estimated with wide uncertainty.</p>
      <StackedArea
        years={data.data.years}
        keys={FUELS}
        values={data.data.series}
        colors={FUEL_COLOR}
        labels={FUEL_LABEL}
        cursor={year}
        formatY={formatCompact}
        ariaLabel="Global CO₂ emissions by fuel since 1850"
      />
      <ChartLegend items={FUELS.map((f) => ({ label: FUEL_LABEL[f], color: FUEL_COLOR[f], style: "swatch" as const }))} />
      <DataStamp source={data.source} />
    </div>
  );
}
