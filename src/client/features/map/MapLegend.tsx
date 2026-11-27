import { emissionsColor, FACILITY_SECTOR_COLOR } from "../../lib/colors.ts";
import { DISASTER_COLOR, DISASTER_LABEL } from "./useMapLayers.ts";
import { useDashboard } from "../../state/store.ts";

const SECTOR_LABEL: Record<string, string> = {
  power: "Power",
  manufacturing: "Manufacturing",
  "fossil-fuel-operations": "Fossil fuel ops",
  "mineral-extraction": "Mining",
  waste: "Waste",
};

export function MapLegend() {
  const layers = useDashboard((s) => s.layers);
  const ramp = Array.from({ length: 12 }, (_, i) => emissionsColor(i / 11)).join(", ");
  return (
    <div className="map-legend">
      {layers.emissions && (
        <div className="map-legend__item">
          <span className="muted">Emissions</span>
          <span className="map-legend__ramp" style={{ background: `linear-gradient(90deg, ${ramp})` }} />
          <span className="map-legend__ends">
            <span>low</span>
            <span>high</span>
          </span>
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
