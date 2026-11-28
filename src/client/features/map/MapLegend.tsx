import { TRADE_INFO } from "@shared/trade.ts";
import type { FlowsView, MapMeasureData } from "@shared/types.ts";
import { actionColor, divergingActionColor, emissionsColor, FACILITY_SECTOR_COLOR, FLOW_COLOR } from "../../lib/colors.ts";
import { formatCompact, formatNumber } from "../../lib/format.ts";
import { useDashboard } from "../../state/store.ts";
import type { ACTION_MAP_MEASURES } from "./choropleth.ts";
import { DISASTER_COLOR, DISASTER_LABEL } from "./useMapLayers.ts";

const SECTOR_LABEL: Record<string, string> = {
  power: "Power",
  manufacturing: "Manufacturing",
  "fossil-fuel-operations": "Fossil fuel ops",
  "mineral-extraction": "Mining",
  waste: "Waste",
};

interface ActionLegend {
  data: MapMeasureData;
  def: (typeof ACTION_MAP_MEASURES)[number];
  scale: { lo: number; hi: number } | null;
}

const short = (v: number, decimals: number) => (Math.abs(v) >= 10_000 ? formatCompact(v) : formatNumber(v, Math.abs(v) >= 100 ? 0 : decimals));

export function MapLegend({ action, flows }: { action: ActionLegend | null; flows: FlowsView | null }) {
  const layers = useDashboard((s) => s.layers);
  const ramp = Array.from({ length: 12 }, (_, i) => emissionsColor(i / 11)).join(", ");
  return (
    <div className="map-legend">
      {layers.emissions && action?.scale ? (
        <div className="map-legend__item">
          <span className="muted">
            {action.data.short} <span className="map-legend__unit">({action.data.unit})</span>
          </span>
          <span
            className="map-legend__ramp"
            style={{
              background: `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) =>
                action.def.kind === "diverging" ? divergingActionColor(i / 6 - 1) : actionColor(i / 12),
              ).join(", ")})`,
            }}
          />
          <span className="map-legend__ends">
            <span>{action.def.kind === "diverging" ? `−${short(action.scale.hi, action.data.decimals)} loss` : "0"}</span>
            <span>
              {action.def.kind === "diverging" ? "+" : "≥ "}
              {short(action.scale.hi, action.data.decimals)}
              {action.def.kind === "diverging" ? " gain" : ""}
            </span>
          </span>
        </div>
      ) : (
        layers.emissions && (
          <div className="map-legend__item">
            <span className="muted">Emissions</span>
            <span className="map-legend__ramp" style={{ background: `linear-gradient(90deg, ${ramp})` }} />
            <span className="map-legend__ends">
              <span>low</span>
              <span>high</span>
            </span>
          </div>
        )
      )}
      {layers.flows && flows && (
        <div className="map-legend__item">
          <span className="muted">Trade, {flows.year} (width = value)</span>
          <ul className="map-legend__list">
            <li>
              <span className="map-legend__line" style={{ background: FLOW_COLOR[TRADE_INFO[flows.commodity].group] }} />
              {flows.label}
            </li>
          </ul>
        </div>
      )}
      {layers.facilities && (
        <div className="map-legend__item">
          <span className="muted">Facilities (size = CO₂e)</span>
          <ul className="map-legend__list">
            {Object.entries(FACILITY_SECTOR_COLOR).map(([k, c]) => (
              <li key={k}>
                <span className="map-legend__dot" style={{ background: c }} />
                {SECTOR_LABEL[k]}
              </li>
            ))}
          </ul>
        </div>
      )}
      {layers.attribution && (
        <div className="map-legend__item">
          <span className="muted">Attribution studies</span>
          <ul className="map-legend__list">
            <li>
              <span className="map-legend__dot map-legend__dot--filled" /> study (WWA)
            </li>
          </ul>
        </div>
      )}
      {layers.disasters && (
        <div className="map-legend__item">
          <span className="muted">Disaster alerts (ring; larger = red)</span>
          <ul className="map-legend__list">
            {Object.entries(DISASTER_COLOR).map(([k, c]) => (
              <li key={k}>
                <span className="map-legend__dot" style={{ boxShadow: `inset 0 0 0 2px ${c}` }} />
                {DISASTER_LABEL[k as keyof typeof DISASTER_LABEL]}
              </li>
            ))}
          </ul>
        </div>
      )}
      {layers.forestLoss && (
        <div className="map-legend__item">
          <span className="muted">Tree cover loss</span>
          <ul className="map-legend__list">
            <li>
              <span className="map-legend__dot" style={{ background: "#dc6699" }} /> loss since 2001
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
