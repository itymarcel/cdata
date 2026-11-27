import { useMemo } from "react";
import { LOSS_DRIVERS, type LossDriver } from "@shared/types.ts";
import { useTreeCoverLoss } from "../../api/queries.ts";
import { ChartLegend } from "../../components/LineChart.tsx";
import { DataStamp } from "../../components/DataStamp.tsx";
import { PanelState } from "../../components/Panel.tsx";
import { StackedArea } from "../../components/StackedArea.tsx";
import { LOSS_DRIVER_COLOR } from "../../lib/colors.ts";
import { compareArea } from "../../lib/compare.ts";
import { formatCompact } from "../../lib/format.ts";
import { useCursorYear } from "../../state/store.ts";

const LABEL: Record<LossDriver, string> = {
  permanent_agriculture: "Permanent agriculture",
  hard_commodities: "Mining & energy",
  shifting_cultivation: "Shifting cultivation",
  logging: "Logging",
  wildfire: "Wildfire",
  settlements_infrastructure: "Settlements",
  other_natural_disturbances: "Other natural",
};

/**
 * Tree cover loss split by driver. Not a net figure: regrowth and plantation
 * gains are measured differently and are not subtracted.
 */
export function ForestLoss() {
  const year = useCursorYear();
  const cursorYear = useCursorYear();
  const { data, isLoading, isError } = useTreeCoverLoss();

  const summary = useMemo(() => {
    if (!data) return null;
    const d = data.data;
    const yi = Math.min(d.years.length - 1, Math.max(0, cursorYear - d.years[0]!));
    const total = LOSS_DRIVERS.reduce((a, k) => a + (d.world[k][yi] ?? 0), 0);
    const fire = d.world.wildfire[yi] ?? 0;
    return { year: d.years[yi]!, total, fireShare: total ? fire / total : 0, inRange: cursorYear >= d.years[0]! };
  }, [data, cursorYear]);

  if (isLoading) return <PanelState status="loading" />;
  if (isError || !data || !summary) return <PanelState status="error" />;

  return (
    <div className="tab-chart">
      <p className="tab-chart__lede">
        {!summary.inRange && <span className="muted">Satellite record starts in 2001. Showing 2001. </span>}
        In <strong>{summary.year}</strong> the world lost <strong className="mono">{formatCompact(summary.total)} ha</strong> of tree cover,{" "}
        {compareArea(summary.total)}. Wildfire caused {Math.round(summary.fireShare * 100)}%.
      </p>
      <StackedArea
        years={data.data.years}
        keys={LOSS_DRIVERS}
        values={data.data.world}
        colors={LOSS_DRIVER_COLOR}
        labels={LABEL}
        cursor={year}
        formatY={formatCompact}
        ariaLabel="Global tree cover loss by driver, hectares"
      />
      <ChartLegend items={LOSS_DRIVERS.map((k) => ({ label: LABEL[k], color: LOSS_DRIVER_COLOR[k], style: "swatch" as const }))} />
      <DataStamp source={data.source} extra="gross loss, not net of regrowth" />
    </div>
  );
}
