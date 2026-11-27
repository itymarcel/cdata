import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer, ScatterplotLayer, type GeoJsonLayerProps, type ScatterplotLayerProps } from "@deck.gl/layers";
import { max } from "d3-array";
import { scaleSqrt } from "d3-scale";
import { useMemo } from "react";
import type { DisasterAlert, DisasterType, EmissionsMatrix, Facility, FirePoint, NaturalEvent, TimelineEvent } from "@shared/types.ts";
import {
  useCountries,
  useDisasterAlerts,
  useEmissionsMatrix,
  useFacilities,
  useFires,
  useNaturalEvents,
  useTimeline,
} from "../../api/queries.ts";
import { FACILITY_SECTOR_COLOR, SERIES, emissionsColor, toRgb } from "../../lib/colors.ts";
import { useCursorYear, useDashboard, useIsLive } from "../../state/store.ts";

export type HoverInfo =
  | { kind: "country"; x: number; y: number; iso3: string; name: string; value: number | null; matrix: EmissionsMatrix; year: number }
  | { kind: "facility"; x: number; y: number; facility: Facility; year: number }
  | { kind: "fire"; x: number; y: number; fire: FirePoint }
  | { kind: "natural"; x: number; y: number; event: NaturalEvent }
  | { kind: "attribution"; x: number; y: number; event: TimelineEvent }
  | { kind: "disaster"; x: number; y: number; alert: DisasterAlert };

type CountryProps = { iso3: string; name: string };

/**
 * Interleaved deck layers sit beneath this basemap layer, so country borders and
 * labels draw on top. The forest-loss raster goes higher still (see MapView).
 */
const LABEL_LAYER = "boundary_country_outline";
/** `beforeId` is read by MapboxOverlay but isn't part of deck's layer prop types. */
function belowLabels<P extends object>(props: P): P {
  return { ...props, beforeId: LABEL_LAYER };
}

const rgba = (css: string, a = 255) => [...toRgb(css), a] as [number, number, number, number];
const NATURAL_COLOR: Record<string, string> = {
  wildfires: SERIES[1],
  severeStorms: SERIES[0],
  volcanoes: SERIES[7],
  floods: SERIES[2],
  seaLakeIce: SERIES[6],
  drought: SERIES[3],
  tempExtremes: SERIES[4],
};

export const DISASTER_COLOR: Record<DisasterType, string> = {
  FL: SERIES[0],
  TC: SERIES[6],
  DR: SERIES[3],
  WF: SERIES[1],
};
export const DISASTER_LABEL: Record<DisasterType, string> = {
  FL: "Flood",
  TC: "Tropical cyclone",
  DR: "Drought",
  WF: "Wildfire",
};

/** Builds the deck.gl layer stack from dashboard state and data queries. */
export function useMapLayers(onHover: (h: HoverInfo | null) => void) {
  const year = useCursorYear();
  const layersOn = useDashboard((s) => s.layers);
  const metric = useDashboard((s) => s.metric);
  const country = useDashboard((s) => s.country);
  const selectCountry = useDashboard((s) => s.selectCountry);
  const selectNode = useDashboard((s) => s.selectNode);
  const isLive = useIsLive();

  const countries = useCountries();
  const matrix = useEmissionsMatrix(metric);
  const fires = useFires(layersOn.fires);
  const natural = useNaturalEvents(layersOn.naturalEvents);
  const facilities = useFacilities(layersOn.facilities);
  const timeline = useTimeline();
  const disasters = useDisasterAlerts(layersOn.disasters);

  const m = matrix.data?.data;
  // Annual data: clamp the cursor to the matrix's range so "now" shows the latest year.
  const yearIdx = m ? Math.min(m.years.length - 1, Math.max(0, year - m.years[0]!)) : -1;
  const shownYear = m ? m.years[yearIdx]! : year;

  // Studies published up to the cursor year (cumulative): attribution evidence accumulates.
  const studies = useMemo(
    () => (timeline.data?.events ?? []).filter((e) => e.kind === "attribution" && e.place && e.t < year + 1),
    [timeline.data, year],
  );
  // Disaster alerts in the cursor year; at "now", the last twelve months.
  const alerts = useMemo(() => {
    const all = disasters.data?.data.alerts ?? [];
    if (isLive) {
      const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      return all.filter((a) => a.to >= cutoff);
    }
    return all.filter((a) => Number(a.from.slice(0, 4)) <= year && Number(a.to.slice(0, 4)) >= year);
  }, [disasters.data, year, isLive]);

  // Fixed colour domain across all years, so playback shows growth rather than re-normalising.
  const { byIso, scale } = useMemo(() => {
    const byIso = new Map<string, number>();
    if (!m) return { byIso, scale: null };
    m.countries.forEach((c, i) => {
      if (c.iso3.length === 3 && c.iso3 !== "WLD") byIso.set(c.iso3, i);
    });
    const top = max([...byIso.values()].flatMap((i) => m.values[i]!.filter((v): v is number => v !== null))) ?? 1;
    return { byIso, scale: scaleSqrt().domain([0, top]).range([0, 1]).clamp(true) };
  }, [m]);

  return useMemo(() => {
    const layers: Layer[] = [];

    if (layersOn.emissions && countries.data && m && scale) {
      layers.push(
        new GeoJsonLayer<CountryProps>(belowLabels<GeoJsonLayerProps<CountryProps>>({
          id: "emissions",
          data: countries.data.data.features as GeoJsonLayerProps<CountryProps>["data"],
          pickable: true,
          stroked: true,
          filled: true,
          getFillColor: (f) => {
            const i = byIso.get(f.properties.iso3);
            const v = i === undefined ? null : m.values[i]![yearIdx];
            return v === null || v === undefined ? [30, 34, 40, 160] : rgba(emissionsColor(scale(v)), 210);
          },
          getLineColor: (f) => (f.properties.iso3 === country ? [255, 255, 255, 255] : [7, 9, 12, 255]),
          getLineWidth: (f) => (f.properties.iso3 === country ? 2 : 0.6),
          lineWidthUnits: "pixels",
          updateTriggers: { getFillColor: [yearIdx, m.metric], getLineColor: country, getLineWidth: country },
          onHover: (info) => {
            if (!info.object) return onHover(null);
            const i = byIso.get(info.object.properties.iso3);
            onHover({
              kind: "country",
              x: info.x,
              y: info.y,
              iso3: info.object.properties.iso3,
              name: info.object.properties.name,
              value: i === undefined ? null : (m.values[i]![yearIdx] ?? null),
              matrix: m,
              year: shownYear,
            });
          },
          onClick: (info) => {
            if (info.object) selectCountry(info.object.properties.iso3);
          },
        })),
      );
    }

    if (layersOn.facilities && facilities.data) {
      const fac = facilities.data.data;
      const radius = scaleSqrt().domain([0, max(fac.facilities, (f) => f.co2e) ?? 1]).range([1.5, 16]);
      layers.push(
        new ScatterplotLayer<Facility>(belowLabels<ScatterplotLayerProps<Facility>>({
          id: "facilities",
          data: fac.facilities,
          pickable: true,
          radiusUnits: "pixels",
          getPosition: (f) => [f.lon, f.lat],
          getRadius: (f) => radius(f.co2e),
          getFillColor: (f) => rgba(FACILITY_SECTOR_COLOR[f.sector] ?? SERIES[7], 190),
          stroked: true,
          getLineColor: [14, 17, 22, 255],
          lineWidthMinPixels: 1,
          onHover: (info) =>
            onHover(info.object ? { kind: "facility", x: info.x, y: info.y, facility: info.object, year: fac.year } : null),
        })),
      );
    }

    if (layersOn.fires && isLive && fires.data) {
      layers.push(
        new ScatterplotLayer<FirePoint>({
          id: "fires",
          data: fires.data.data.points,
          pickable: true,
          radiusUnits: "pixels",
          getPosition: (p) => [p[0], p[1]],
          getRadius: (p) => (p[2] > 50 ? 2.2 : 1.3),
          radiusMinPixels: 1,
          // Yellow keeps fires distinct from the orange emissions ramp; hotter fires are brighter.
          getFillColor: (p) => (p[2] > 50 ? [255, 250, 200, 230] : p[2] > 10 ? [255, 222, 89, 170] : [240, 200, 60, 110]),
          onHover: (info) => onHover(info.object ? { kind: "fire", x: info.x, y: info.y, fire: info.object } : null),
        }),
      );
    }

    if (layersOn.naturalEvents && isLive && natural.data) {
      layers.push(
        new ScatterplotLayer<NaturalEvent>({
          id: "natural-events",
          data: natural.data.data.events,
          pickable: true,
          radiusUnits: "pixels",
          getPosition: (e) => [e.lon, e.lat],
          getRadius: 7,
          stroked: true,
          filled: true,
          getFillColor: (e) => rgba(NATURAL_COLOR[e.category] ?? SERIES[6], 60),
          getLineColor: (e) => rgba(NATURAL_COLOR[e.category] ?? SERIES[6], 255),
          lineWidthMinPixels: 2,
          onHover: (info) => onHover(info.object ? { kind: "natural", x: info.x, y: info.y, event: info.object } : null),
          onClick: (info) => {
            if (info.object) window.open(info.object.link, "_blank", "noopener");
          },
        }),
      );
    }

    if (layersOn.disasters && disasters.data) {
      layers.push(
        new ScatterplotLayer<DisasterAlert>({
          id: "disasters",
          data: alerts,
          pickable: true,
          radiusUnits: "pixels",
          getPosition: (a) => [a.lon, a.lat],
          getRadius: (a) => (a.alert === "Red" ? 9 : 6),
          stroked: true,
          filled: true,
          getFillColor: (a) => rgba(DISASTER_COLOR[a.type], a.alert === "Red" ? 90 : 40),
          getLineColor: (a) => rgba(DISASTER_COLOR[a.type], 255),
          lineWidthMinPixels: 1.5,
          onHover: (info) => onHover(info.object ? { kind: "disaster", x: info.x, y: info.y, alert: info.object } : null),
          onClick: (info) => {
            if (info.object) window.open(info.object.url, "_blank", "noopener");
          },
        }),
      );
    }

    if (layersOn.attribution && timeline.data) {
      layers.push(
        new ScatterplotLayer<TimelineEvent>({
          id: "attribution",
          data: studies,
          pickable: true,
          radiusUnits: "pixels",
          getPosition: (e) => [e.place!.lon, e.place!.lat],
          getRadius: 6,
          stroked: true,
          filled: true,
          getFillColor: rgba(SERIES[7], 210),
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 1.5,
          onHover: (info) => onHover(info.object ? { kind: "attribution", x: info.x, y: info.y, event: info.object } : null),
          onClick: (info) => {
            if (info.object) selectNode(info.object.id);
          },
        }),
      );
    }

    return { layers, shownYear, isLive, matrixSource: matrix.data?.source ?? null };
  }, [
    layersOn,
    countries.data,
    m,
    scale,
    byIso,
    yearIdx,
    shownYear,
    country,
    facilities.data,
    fires.data,
    natural.data,
    timeline.data,
    studies,
    disasters.data,
    alerts,
    isLive,
    matrix.data?.source,
    onHover,
    selectCountry,
    selectNode,
  ]);
}
