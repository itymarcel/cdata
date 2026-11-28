import type { Layer } from "@deck.gl/core";
import { GeoJsonLayer, PathLayer, ScatterplotLayer, type GeoJsonLayerProps, type ScatterplotLayerProps } from "@deck.gl/layers";
import { max } from "d3-array";
import { scaleSqrt } from "d3-scale";
import { useMemo } from "react";
import type {
  DisasterAlert,
  DisasterType,
  EmissionsMatrix,
  Facility,
  FirePoint,
  FlowsView,
  MapMeasureData,
  NaturalEvent,
  TimelineEvent,
  TradeFlow,
} from "@shared/types.ts";
import {
  useCountries,
  useDisasterAlerts,
  useEmissionsMatrix,
  useFacilities,
  useFires,
  useFlows,
  useMapMeasure,
  useNaturalEvents,
  useTimeline,
} from "../../api/queries.ts";
import { FACILITY_SECTOR_COLOR, FLOW_COLOR, SERIES, actionColor, divergingActionColor, emissionsColor, toRgb } from "../../lib/colors.ts";
import type { Pulse } from "./AnimatedDeck.tsx";
import { arcPath, routePhase, type ArcVertex } from "./arcs.ts";
import { actionMapMeasure, colourScale, valueAtYear } from "./choropleth.ts";
import { landDots } from "./dots.ts";
import { useCursorYear, useDashboard, useIsLive } from "../../state/store.ts";

export type HoverInfo =
  | { kind: "country"; x: number; y: number; iso3: string; name: string; value: number | null; matrix: EmissionsMatrix; year: number }
  | { kind: "facility"; x: number; y: number; facility: Facility; year: number }
  | { kind: "fire"; x: number; y: number; fire: FirePoint }
  | { kind: "natural"; x: number; y: number; event: NaturalEvent }
  | { kind: "attribution"; x: number; y: number; event: TimelineEvent }
  | { kind: "disaster"; x: number; y: number; alert: DisasterAlert }
  | {
      kind: "action";
      x: number;
      y: number;
      iso3: string;
      name: string;
      shown: { value: number; year: number } | null;
      measure: MapMeasureData;
      /** Rank among countries with a value that year (1 = highest), and how many there are. */
      rank: number | null;
      of: number;
    }
  | { kind: "flow"; x: number; y: number; flow: TradeFlow; view: FlowsView; exporterTotal: number | null };

/** One drawn route: the flow, its lifted great-circle path, and when its pulse sets off. */
export interface FlowArc {
  flow: TradeFlow;
  path: ArcVertex[];
  /** In [0, 1): a stable per-route delay so pulses don't all leave together. */
  phase: number;
}

/** How many routes to draw with no country selected: the largest by value. */
export const TOP_FLOWS = 60;

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

/**
 * Country polygons on the globe: deck triangulates them flat, so a large
 * country's triangles cut under the sphere and the globe's depth hides them.
 * We draw them without the depth test and cull back faces instead, which
 * hides the far side of the globe just the same.
 */
const GLOBE_FILL = { depthCompare: "always", cullMode: "back" } as const;

/**
 * Light adds up: overlapping arcs and glows brighten rather than cover each
 * other, which is what makes the routes read as lit lines on a dark globe.
 */
export const ADDITIVE = {
  blend: true,
  blendColorOperation: "add",
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaOperation: "add",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one-minus-src-alpha",
} as const;

/** Mix a colour toward white by `k` ∈ [0, 1], for the bright cores of glowing lines. */
export const lighten = ([r, g, b]: readonly [number, number, number], k: number): [number, number, number] => [
  Math.round(r + (255 - r) * k),
  Math.round(g + (255 - g) * k),
  Math.round(b + (255 - b) * k),
];

/** Land dots of countries without a value (or with country colours off): steel blue, like the sphere's rim. */
const DOT_NO_DATA: [number, number, number, number] = [86, 110, 140, 150];
/** Under the dots, each country is a faint wash of its colour; it also takes the hover and click. */
const TINT_ALPHA = 44;

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
  const projection = useDashboard((s) => s.projection);
  const fillParameters = projection === "globe" ? GLOBE_FILL : undefined;

  const countries = useCountries();
  const matrix = useEmissionsMatrix(metric);
  const fires = useFires(layersOn.fires);
  const natural = useNaturalEvents(layersOn.naturalEvents);
  const facilities = useFacilities(layersOn.facilities);
  const timeline = useTimeline();
  const disasters = useDisasterAlerts(layersOn.disasters);
  const actionId = useDashboard((s) => s.actionMeasure);
  const action = useMapMeasure(layersOn.emissions ? actionId : null);
  const commodity = useDashboard((s) => s.flowCommodity);
  const flowsQuery = useFlows(commodity, layersOn.flows);

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

  // Climate-action choropleth: values per country for the cursor year, plus ranks for the tooltip.
  const actionDef = actionMapMeasure(actionId);
  const a = actionId && action.data?.id === actionId ? action.data : null;
  const actionShown = useMemo(() => {
    if (!a || !actionDef) return null;
    const scale = colourScale(a, actionDef.kind);
    const shown = new Map<string, { value: number; year: number }>();
    a.countries.forEach((c, i) => {
      if (!/^[A-Z]{3}$/.test(c.iso3) || c.iso3 === "WLD") return;
      const v = valueAtYear(a, a.values[i]!, year, actionDef.lookback);
      if (v) shown.set(c.iso3, v);
    });
    const ranked = [...shown].sort((x, y) => y[1].value - x[1].value).map(([iso3]) => iso3);
    const rank = new Map(ranked.map((iso3, i) => [iso3, i + 1]));
    const years = [...shown.values()].map((v) => v.year);
    return { scale, shown, rank, latestYear: years.length ? Math.max(...years) : null };
  }, [a, actionDef, year]);

  // Trade flows: the largest routes, or every route of the selected country.
  const flowsData = flowsQuery.data?.data ?? null;
  const flowsView = layersOn.flows && flowsData?.commodity === commodity ? flowsData : null;
  const arcs = useMemo(() => {
    if (!flowsView) return [];
    const { places } = flowsView;
    const picked = country
      ? flowsView.flows.filter((f) => f.from === country || f.to === country)
      : flowsView.flows.slice(0, TOP_FLOWS);
    return picked.flatMap((flow): FlowArc[] => {
      const p = places[flow.from];
      const q = places[flow.to];
      if (!p || !q) return [];
      const path = arcPath([p.lon, p.lat], [q.lon, q.lat]);
      if (path.length < 2) return [];
      return [{ flow, path, phase: routePhase(`${flow.from}>${flow.to}`) }];
    });
  }, [flowsView, country]);
  const exporterTotals = useMemo(() => new Map((flowsView?.exporters ?? []).map((e) => [e.iso3, e.value])), [flowsView]);

  // One colour per country for whatever the countries are coloured by; null where there's no value.
  const colourOf = useMemo((): ((iso3: string) => [number, number, number] | null) | null => {
    if (!layersOn.emissions) return null;
    if (actionShown && a) {
      const paint = actionDef?.kind === "diverging" ? divergingActionColor : actionColor;
      return (iso3) => {
        const v = actionShown.shown.get(iso3);
        return v ? toRgb(paint(actionShown.scale.t(v.value))) : null;
      };
    }
    if (m && scale && !actionId) {
      return (iso3) => {
        const i = byIso.get(iso3);
        const v = i === undefined ? null : m.values[i]![yearIdx];
        return v === null || v === undefined ? null : toRgb(emissionsColor(scale(v)));
      };
    }
    return null;
  }, [layersOn.emissions, actionShown, a, actionDef, m, scale, actionId, byIso, yearIdx]);

  // Land as dots (computed once from the country shapes), coloured per country.
  const dots = useMemo(() => (countries.data ? landDots(countries.data.data.features) : null), [countries.data]);
  const dotColours = useMemo(() => (dots ? dots.isos.map((iso3) => colourOf?.(iso3) ?? null) : []), [dots, colourOf]);

  return useMemo(() => {
    const layers: Layer[] = [];
    let pulse: Pulse | null = null;

    if (layersOn.emissions && countries.data && actionShown && a) {
      const { scale: sc, shown, rank } = actionShown;
      const paint = actionDef?.kind === "diverging" ? divergingActionColor : actionColor;
      layers.push(
        new GeoJsonLayer<CountryProps>(belowLabels<GeoJsonLayerProps<CountryProps>>({
          id: "action",
          data: countries.data.data.features as GeoJsonLayerProps<CountryProps>["data"],
          parameters: fillParameters,
          pickable: true,
          stroked: true,
          filled: true,
          getFillColor: (f) => {
            const v = shown.get(f.properties.iso3);
            return v ? rgba(paint(sc.t(v.value)), TINT_ALPHA) : [30, 34, 40, TINT_ALPHA];
          },
          getLineColor: (f) => (f.properties.iso3 === country ? [255, 255, 255, 255] : [0, 0, 0, 0]),
          getLineWidth: (f) => (f.properties.iso3 === country ? 2 : 0),
          lineWidthUnits: "pixels",
          updateTriggers: { getFillColor: [shown, a.id], getLineColor: country, getLineWidth: country },
          onHover: (info) => {
            if (!info.object) return onHover(null);
            const iso3 = info.object.properties.iso3;
            onHover({
              kind: "action",
              x: info.x,
              y: info.y,
              iso3,
              name: info.object.properties.name,
              shown: shown.get(iso3) ?? null,
              measure: a,
              rank: rank.get(iso3) ?? null,
              of: rank.size,
            });
          },
          onClick: (info) => {
            if (info.object) selectCountry(info.object.properties.iso3);
          },
        })),
      );
    } else if (layersOn.emissions && countries.data && m && scale && !actionId) {
      layers.push(
        new GeoJsonLayer<CountryProps>(belowLabels<GeoJsonLayerProps<CountryProps>>({
          id: "emissions",
          data: countries.data.data.features as GeoJsonLayerProps<CountryProps>["data"],
          parameters: fillParameters,
          pickable: true,
          stroked: true,
          filled: true,
          getFillColor: (f) => {
            const i = byIso.get(f.properties.iso3);
            const v = i === undefined ? null : m.values[i]![yearIdx];
            return v === null || v === undefined ? [30, 34, 40, TINT_ALPHA] : rgba(emissionsColor(scale(v)), TINT_ALPHA);
          },
          getLineColor: (f) => (f.properties.iso3 === country ? [255, 255, 255, 255] : [0, 0, 0, 0]),
          getLineWidth: (f) => (f.properties.iso3 === country ? 2 : 0),
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

    if (dots) {
      layers.push(
        new ScatterplotLayer<null>(belowLabels<ScatterplotLayerProps<null>>({
          id: "land-dots",
          data: { length: dots.count, attributes: { getPosition: { value: dots.positions, size: 2 } } } as unknown as ScatterplotLayerProps<null>["data"],
          getFillColor: (_, { index }) => {
            const c = dotColours[dots.country[index]!];
            return c ? [...lighten(c, 0.15), 240] : DOT_NO_DATA;
          },
          radiusUnits: "meters",
          getRadius: 21_000,
          radiusMinPixels: 0.6,
          radiusMaxPixels: 3.5,
          stroked: false,
          pickable: false,
          updateTriggers: { getFillColor: dotColours },
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

    if (flowsView && arcs.length) {
      const colour = toRgb(FLOW_COLOR[flowsView.group]);
      const top = max(arcs, (d) => d.flow.value) ?? 1;
      const width = scaleSqrt().domain([0, top]).range([0.5, 4]);
      const alpha = scaleSqrt().domain([0, top]).range([90, 230]);
      const core = lighten(colour, 0.45);
      layers.push(
        // A soft halo under each route…
        new PathLayer<FlowArc>({
          id: "flow-glow",
          data: arcs,
          getPath: (d) => d.path,
          // Square joints: rounded ones overlap at each vertex and bead a translucent line.
          getColor: (d) => [...colour, alpha(d.flow.value) / 5] as [number, number, number, number],
          getWidth: (d) => width(d.flow.value) * 3 + 4,
          widthUnits: "pixels",
          parameters: ADDITIVE,
        }),
        // …and a bright core on top.
        new PathLayer<FlowArc>({
          id: "flow-arcs",
          data: arcs,
          pickable: true,
          parameters: ADDITIVE,
          getPath: (d) => d.path,
          getColor: (d) => [...core, alpha(d.flow.value)] as [number, number, number, number],
          getWidth: (d) => width(d.flow.value),
          widthUnits: "pixels",
          autoHighlight: true,
          highlightColor: [255, 255, 255, 230],
          onHover: (info) =>
            onHover(
              info.object
                ? {
                    kind: "flow",
                    x: info.x,
                    y: info.y,
                    flow: info.object.flow,
                    view: flowsView,
                    exporterTotal: info.object.flow.reportedBy === "exporter" ? (exporterTotals.get(info.object.flow.from) ?? null) : null,
                  }
                : null,
            ),
          onClick: (info) => {
            if (info.object) selectCountry(info.object.flow.from === country ? info.object.flow.to : info.object.flow.from);
          },
        }),
      );
      // Endpoints: one dot per country on a drawn route, larger for the selected one.
      const ends = [...new Set(arcs.flatMap((d) => [d.flow.from, d.flow.to]))].flatMap((iso3) => {
        const p = flowsView.places[iso3];
        return p ? [{ iso3, position: [p.lon, p.lat] as [number, number] }] : [];
      });
      layers.push(
        new ScatterplotLayer<{ iso3: string; position: [number, number] }>({
          id: "flow-ends-glow",
          data: ends,
          radiusUnits: "pixels",
          getPosition: (d) => d.position,
          getRadius: (d) => (d.iso3 === country ? 12 : 7),
          getFillColor: [...colour, 70],
          parameters: ADDITIVE,
          updateTriggers: { getRadius: country, getFillColor: flowsView.group },
        }),
        new ScatterplotLayer<{ iso3: string; position: [number, number] }>({
          id: "flow-ends",
          data: ends,
          radiusUnits: "pixels",
          getPosition: (d) => d.position,
          getRadius: (d) => (d.iso3 === country ? 4 : 2),
          getFillColor: (d) => (d.iso3 === country ? [255, 255, 255, 255] : [...lighten(colour, 0.7), 255]),
          parameters: ADDITIVE,
          updateTriggers: { getRadius: country, getFillColor: [country, flowsView.group] },
        }),
      );
      pulse = {
        arcs,
        colour: lighten(colour, 0.35),
        width: (d) => width(d.flow.value),
      };
    }

    return {
      layers,
      pulse,
      shownYear: actionShown?.latestYear ?? shownYear,
      isLive,
      matrixSource: matrix.data?.source ?? null,
      action: a && actionDef ? { data: a, def: actionDef, scale: actionShown?.scale ?? null } : null,
      flows: flowsView,
      flowsSource: flowsQuery.data?.source ?? null,
      flowsLoading: layersOn.flows && !flowsView && !flowsQuery.isError,
      // While the server is still reading, its last error (e.g. the call quota) explains the wait.
      flowsError: layersOn.flows
        ? flowsQuery.isError
          ? (flowsQuery.error as Error).message
          : flowsQuery.data?.data === null
            ? flowsQuery.data.source.error
            : null
        : null,
      arcCount: arcs.length,
    };
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
    actionShown,
    fillParameters,
    a,
    actionDef,
    actionId,
    flowsView,
    arcs,
    exporterTotals,
    flowsQuery.data?.source,
    flowsQuery.data,
    flowsQuery.isError,
    flowsQuery.error,
    dots,
    dotColours,
    onHover,
    selectCountry,
    selectNode,
  ]);
}
