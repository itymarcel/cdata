import { useRef } from "react";
import type { VitalId, VitalSign } from "@shared/types.ts";
import { useVitals } from "../../api/queries.ts";
import { EvidenceBadge } from "../../components/EvidenceBadge.tsx";
import { Sparkline } from "../../components/Sparkline.tsx";
import { formatAsOf, formatNumber } from "../../lib/format.ts";
import { type MainView, useDashboard } from "../../state/store.ts";
import { LAYERS } from "../map/LayerSwitcher.tsx";
import { useLiveValue } from "./useLiveBudget.ts";
import "./vitals.css";

export const MAIN_VIEW_ID = "main-view";

/**
 * Tabs for the big panel: the map first, then one per vital sign. Each vital
 * tab still answers "how bad is it right now?" at a glance; selecting it swaps
 * the map for that measure's full history.
 */
export function VitalsBar() {
  const { data, isLoading, isError } = useVitals();
  const view = useDashboard((s) => s.view);
  const setView = useDashboard((s) => s.setView);
  const listRef = useRef<HTMLDivElement>(null);

  const ids: MainView[] = ["map", ...((data ?? []).map((v) => v.id) as VitalId[])];
  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = ids.indexOf(view);
    const next =
      e.key === "ArrowRight" ? ids[(i + 1) % ids.length] : e.key === "ArrowLeft" ? ids[(i - 1 + ids.length) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids.at(-1) : null;
    if (!next) return;
    e.preventDefault();
    setView(next);
    listRef.current?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
  };

  return (
    <div className="vitals" role="tablist" aria-label="Main view" ref={listRef} onKeyDown={onKeyDown}>
      <MapTab active={view === "map"} onSelect={() => setView("map")} />
      {isLoading &&
        Array.from({ length: 7 }, (_, i) => <div key={i} className="vital vital--skeleton" aria-hidden="true" />)}
      {(isError || (!isLoading && !data)) && (
        <div className="vitals--error" role="alert">
          Vital signs are unavailable. The server could not reach its data sources.
        </div>
      )}
      {data?.map((v) => <VitalTab key={v.id} vital={v} active={view === v.id} onSelect={() => setView(v.id as VitalId)} />)}
    </div>
  );
}

function MapTab({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const layers = useDashboard((s) => s.layers);
  const on = LAYERS.filter((l) => layers[l.id]).map((l) => l.label.replace(/ by country$/, ""));
  return (
    <button
      type="button"
      role="tab"
      data-view="map"
      aria-selected={active}
      aria-controls={MAIN_VIEW_ID}
      tabIndex={active ? 0 : -1}
      className={`vital vital--map${active ? " is-active" : ""}`}
      onClick={onSelect}
    >
      <div className="vital__head">
        <span className="vital__label">World map</span>
      </div>
      <div className="vital__value">
        <svg className="vital__globe" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <ellipse cx="12" cy="12" rx="4.2" ry="9.5" />
          <path d="M2.5 12h19M4 7h16M4 17h16" />
        </svg>
        <span className="vital__map-title">Map</span>
      </div>
      <div className="vital__context vital__layers">{on.length ? on.join(" · ") : "No layers on"}</div>
    </button>
  );
}

function VitalTab({ vital, active, onSelect }: { vital: VitalSign; active: boolean; onSelect: () => void }) {
  const live = useLiveValue(vital.live);
  const value = live ?? vital.value;
  const stale = vital.source?.error;
  return (
    <button
      type="button"
      role="tab"
      data-view={vital.id}
      aria-selected={active}
      aria-controls={MAIN_VIEW_ID}
      tabIndex={active ? 0 : -1}
      className={`vital${active ? " is-active" : ""}`}
      onClick={onSelect}
      title={`${vital.label}: open the full history`}
    >
      <div className="vital__head">
        <span className="vital__label">{vital.label}</span>
        <EvidenceBadge evidence={vital.evidence} compact />
      </div>
      <div className="vital__value">
        <span className="vital__number">{value === null ? "—" : formatNumber(value, live !== null ? 3 : vital.decimals)}</span>
        <span className="vital__unit">{vital.unit}</span>
      </div>
      <div className="vital__foot">
        <div className="vital__context">
          {vital.context ?? " "}
          <div className="vital__asof">
            {stale ? "⚠ refresh failed · " : ""}as of {formatAsOf(vital.asOf)}
          </div>
        </div>
        <Sparkline points={vital.spark} label={`${vital.label} trend`} width={84} height={30} />
      </div>
    </button>
  );
}
