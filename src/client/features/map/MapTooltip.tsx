import { compareEmissions } from "../../lib/compare.ts";
import { formatCompact, formatNumber } from "../../lib/format.ts";
import { DISASTER_LABEL, type HoverInfo } from "./useMapLayers.ts";

const PER_CAPITA = new Set(["co2_per_capita"]);

export function MapTooltip({ info }: { info: HoverInfo }) {
  return (
    <div className="map-tooltip" style={{ left: info.x + 14, top: info.y + 14 }} role="tooltip">
      <Content info={info} />
    </div>
  );
}

function Content({ info }: { info: HoverInfo }) {
  switch (info.kind) {
    case "country": {
      const perCapita = PER_CAPITA.has(info.matrix.metric);
      return (
        <>
          <strong>{info.name}</strong>
          <div className="muted">{info.year}</div>
          <div className="map-tooltip__value mono">
            {info.value === null ? "No data" : perCapita ? formatNumber(info.value, 1) : formatCompact(info.value)}{" "}
            <span className="muted">{info.matrix.unit}</span>
          </div>
          {info.value !== null && !perCapita && info.matrix.metric !== "cumulative_co2" && (
            <div className="secondary">{compareEmissions(info.value)}</div>
          )}
          <div className="muted">Click to select</div>
        </>
      );
    }
    case "facility": {
      const f = info.facility;
      return (
        <>
          <strong>{f.name}</strong>
          <div className="muted">
            {f.iso3} · {f.subsector.replace(/-/g, " ")}
            {f.type ? ` · ${f.type}` : ""}
          </div>
          <div className="map-tooltip__value mono">
            {formatNumber(f.co2e / 1e6, 1)} <span className="muted">Mt CO₂e in {info.year}</span>
          </div>
          <div className="secondary">{compareEmissions(f.co2e / 1e6)}</div>
          <div className="muted">Modelled by Climate TRACE</div>
        </>
      );
    }
    case "fire":
      return (
        <>
          <strong>Active fire detection</strong>
          <div className="mono">{formatNumber(info.fire[2], 1)} MW radiative power</div>
          <div className="muted">{new Date(info.fire[3]).toUTCString().slice(5, 22)} UTC</div>
        </>
      );
    case "natural":
      return (
        <>
          <strong>{info.event.title}</strong>
          <div className="muted">
            {info.event.category} · {info.event.date.slice(0, 10)}
          </div>
          {info.event.magnitude && (
            <div className="mono">
              {info.event.magnitude.value} {info.event.magnitude.unit}
            </div>
          )}
          <div className="muted">Click to open the source</div>
        </>
      );
    case "attribution":
      return (
        <>
          <strong>{info.event.title}</strong>
          <div className="muted">
            Study published {info.event.date} · {info.event.place?.name}
          </div>
          {info.event.attribution?.hazards.length ? <div className="muted">{info.event.attribution.hazards.join(", ")}</div> : null}
          <div className="muted">World Weather Attribution · click to show in the graph</div>
        </>
      );
    case "disaster":
      return (
        <>
          <strong>{info.alert.name}</strong>
          <div className="muted">
            {DISASTER_LABEL[info.alert.type]} · {info.alert.alert} alert · {info.alert.from}
            {info.alert.to !== info.alert.from ? ` → ${info.alert.to}` : ""}
          </div>
          {info.alert.severity && <div className="secondary">{info.alert.severity}</div>}
          <div className="muted">GDACS · impact alert, not climate attribution · click for report</div>
        </>
      );
  }
}
