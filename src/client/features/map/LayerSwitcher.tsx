import type { EmissionsMetric } from "@shared/types.ts";
import { Segmented } from "../../components/Segmented.tsx";
import { useDashboard, type MapLayerId, type MapProjection } from "../../state/store.ts";
import { ACTION_MAP_MEASURES } from "./choropleth.ts";

export const LAYERS: { id: MapLayerId; label: string; badge?: string; detail: string }[] = [
  { id: "emissions", label: "Country colours", detail: "Colour each country by an emissions or climate-action measure" },
  { id: "flows", label: "Trade flows", detail: "UN Comtrade: who ships clean technology and fossil fuels to whom" },
  { id: "forestLoss", label: "Tree cover loss", detail: "UMD / Global Forest Watch, 30 m, annual" },
  { id: "facilities", label: "Largest emitting facilities", detail: "Climate TRACE, modelled" },
  { id: "attribution", label: "Attribution studies", detail: "World Weather Attribution, placed by the country named in each study" },
  { id: "disasters", label: "Disaster alerts", detail: "GDACS orange and red alerts: floods, cyclones, droughts, wildfires" },
  { id: "fires", label: "Active fires", badge: "live", detail: "NASA FIRMS VIIRS, last 24 h" },
  { id: "naturalEvents", label: "Natural events", badge: "live", detail: "NASA EONET, open events" },
];

export const METRIC_OPTIONS: { value: EmissionsMetric; label: string; title: string }[] = [
  { value: "co2", label: "Total", title: "Annual territorial CO₂ from fossil fuels and industry" },
  { value: "co2_per_capita", label: "Per person", title: "Annual CO₂ divided by population" },
  { value: "cumulative_co2", label: "Since 1850", title: "Cumulative CO₂ since 1850, which drives warming" },
  { value: "consumption_co2", label: "Consumption", title: "Adjusted for trade: emissions embodied in what a country consumes" },
  { value: "total_ghg", label: "All GHGs", title: "All greenhouse gases in CO₂e, including land use" },
];

const PROJECTIONS: { value: MapProjection; label: string; title: string }[] = [
  { value: "globe", label: "Globe", title: "A 3D globe: routes follow great circles" },
  { value: "mercator", label: "Flat", title: "A flat Web Mercator map" },
];

/** Select values: emissions metrics as-is, action measures prefixed so the two can't collide. */
const ACTION_PREFIX = "action:";

export function LayerSwitcher({ isLive, forestNote }: { isLive: boolean; forestNote: string | null }) {
  const layers = useDashboard((s) => s.layers);
  const toggle = useDashboard((s) => s.toggleLayer);
  const metric = useDashboard((s) => s.metric);
  const setMetric = useDashboard((s) => s.setMetric);
  const actionMeasure = useDashboard((s) => s.actionMeasure);
  const setActionMeasure = useDashboard((s) => s.setActionMeasure);
  const projection = useDashboard((s) => s.projection);
  const setProjection = useDashboard((s) => s.setProjection);

  const value = actionMeasure ? `${ACTION_PREFIX}${actionMeasure}` : metric;
  const choose = (v: string) => {
    if (v.startsWith(ACTION_PREFIX)) setActionMeasure(v.slice(ACTION_PREFIX.length));
    else {
      setActionMeasure(null);
      setMetric(v as EmissionsMetric);
    }
  };

  return (
    <fieldset className="layer-switcher">
      <legend>Layers</legend>
      <div className="layer-switcher__projection">
        <Segmented label="Map projection" value={projection} options={PROJECTIONS} onChange={setProjection} />
      </div>
      {LAYERS.map((l) => (
        <div key={l.id} className="layer-switcher__item">
          <label className="layer-switcher__row" title={l.detail}>
            <input type="checkbox" checked={layers[l.id]} onChange={() => toggle(l.id)} />
            <span>{l.label}</span>
            {l.badge && <span className={`live-badge${isLive ? "" : " is-paused"}`}>{isLive ? l.badge : "paused"}</span>}
          </label>
          {l.id === "emissions" && layers.emissions && (
            <label className="layer-switcher__metric">
              <span className="muted">by</span>
              <select className="select" value={value} onChange={(e) => choose(e.target.value)} aria-label="Colour countries by">
                <optgroup label="Emissions">
                  {METRIC_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} title={o.title}>
                      {o.value === "total_ghg" ? "All greenhouse gases" : `CO₂ ${o.label.toLowerCase()}`}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Climate action">
                  {ACTION_MAP_MEASURES.map((m) => (
                    <option key={m.id} value={`${ACTION_PREFIX}${m.id}`} title={m.title}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
          )}
        </div>
      ))}
      {forestNote && <p className="layer-switcher__note">{forestNote}</p>}
    </fieldset>
  );
}
