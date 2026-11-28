import { create } from "zustand";
import type { EmissionsMetric, OverlayId, TimelineKind, TradeCommodity, VitalId } from "@shared/types.ts";
import { toDecimalYear } from "@shared/time.ts";

export const TIMELINE_START = 1850;
export const nowYear = () => toDecimalYear(new Date());

export type MapLayerId =
  | "emissions"
  | "forestLoss"
  | "facilities"
  | "fires"
  | "naturalEvents"
  | "attribution"
  | "disasters"
  | "flows";

export type MapProjection = "globe" | "mercator";

export interface FlyTarget {
  lon: number;
  lat: number;
  zoom: number;
  /** Changes on every request so flying to the same place twice still triggers. */
  key: number;
}

export type BottomTab = "emitters" | "producers" | "fuels" | "energy" | "forests" | "action";

/** What the big panel under the tabs shows: the map, or one vital sign's history. */
export type MainView = "map" | VitalId;

/** Per-vital explorer settings, kept while switching tabs. */
export interface ExplorerSettings {
  rangeId: string;
  /** Visible time window [from, to] in decimal years; null = the range preset. */
  window: [number, number] | null;
  overlays: OverlayId[];
  eventKinds: TimelineKind[];
  /** Series switched away from their default visibility. */
  visible: Record<string, boolean>;
  /** Running mean in years; 0 = off. */
  smoothing: number;
  display: "values" | "change";
  scale: "linear" | "log";
  mode: "timeline" | "seasonal";
  compare: VitalId | null;
}

interface DashboardState {
  /** The global time cursor, in decimal years. Every panel reads this. */
  year: number;
  playing: boolean;
  /** ISO3 code (or EU27 / WLD) of the selected country. */
  country: string | null;
  metric: EmissionsMetric;
  /**
   * A climate-action measure (catalog id, e.g. "action.solar") to colour the
   * countries by instead of emissions; null shows `metric`.
   */
  actionMeasure: string | null;
  layers: Record<MapLayerId, boolean>;
  projection: MapProjection;
  flowCommodity: TradeCommodity;
  flyTarget: FlyTarget | null;
  selectedNode: string | null;
  graphExpanded: boolean;
  /** The map panel fills the window. */
  mapExpanded: boolean;
  bottomTab: BottomTab;
  view: MainView;
  explorer: Partial<Record<VitalId, ExplorerSettings>>;
  /** The explorer's side panel: the plain-language reading, or the data and layer switches. */
  explorerPanel: "facts" | "layers";
  sourcesOpen: boolean;
  /** The Ask bar (⌘K). */
  askOpen: boolean;

  setYear: (year: number) => void;
  setPlaying: (playing: boolean) => void;
  selectCountry: (iso3: string | null) => void;
  setMetric: (metric: EmissionsMetric) => void;
  setActionMeasure: (id: string | null) => void;
  toggleLayer: (id: MapLayerId) => void;
  setProjection: (projection: MapProjection) => void;
  setFlowCommodity: (commodity: TradeCommodity) => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  selectNode: (id: string | null) => void;
  setGraphExpanded: (expanded: boolean) => void;
  setMapExpanded: (expanded: boolean) => void;
  setBottomTab: (tab: BottomTab) => void;
  setView: (view: MainView) => void;
  setExplorer: (id: VitalId, patch: Partial<ExplorerSettings>, base: ExplorerSettings) => void;
  setExplorerPanel: (panel: "facts" | "layers") => void;
  setSourcesOpen: (open: boolean) => void;
  setAskOpen: (open: boolean) => void;
}

const clampYear = (y: number) => Math.min(nowYear(), Math.max(TIMELINE_START, y));

export const useDashboard = create<DashboardState>((set) => ({
  year: nowYear(),
  playing: false,
  country: null,
  metric: "co2",
  actionMeasure: null,
  projection: "globe",
  flowCommodity: "solar",
  layers: {
    emissions: true,
    forestLoss: false,
    facilities: false,
    fires: true,
    naturalEvents: false,
    attribution: true,
    disasters: false,
    flows: true,
  },
  flyTarget: null,
  selectedNode: null,
  graphExpanded: false,
  mapExpanded: false,
  bottomTab: "emitters",
  view: "map",
  explorer: {},
  explorerPanel: "facts",
  sourcesOpen: false,
  askOpen: false,

  setYear: (year) => set({ year: clampYear(year) }),
  setPlaying: (playing) => set({ playing }),
  selectCountry: (country) => set({ country }),
  setMetric: (metric) => set({ metric }),
  setActionMeasure: (actionMeasure) => set({ actionMeasure }),
  setProjection: (projection) => set({ projection }),
  setFlowCommodity: (flowCommodity) => set((s) => ({ flowCommodity, layers: { ...s.layers, flows: true } })),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  flyTo: (lon, lat, zoom = 4) => set({ flyTarget: { lon, lat, zoom, key: Date.now() } }),
  selectNode: (selectedNode) => set({ selectedNode }),
  setGraphExpanded: (graphExpanded) => set({ graphExpanded }),
  setMapExpanded: (mapExpanded) => set({ mapExpanded }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setView: (view) => set({ view }),
  setExplorer: (id, patch, base) =>
    set((s) => ({ explorer: { ...s.explorer, [id]: { ...(s.explorer[id] ?? base), ...patch } } })),
  setExplorerPanel: (explorerPanel) => set({ explorerPanel }),
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
  setAskOpen: (askOpen) => set({ askOpen }),
}));

/**
 * The whole year under the cursor. Annual datasets key off this, and because it
 * only changes once per year, panels using it don't re-render on every frame of
 * a drag or playback.
 */
export const useCursorYear = () => useDashboard((s) => Math.floor(s.year));

/** True when the cursor is at the present, where live layers make sense. */
export const LIVE_WINDOW_YEARS = 0.1;
export const useIsLive = () => useDashboard((s) => s.year >= nowYear() - LIVE_WINDOW_YEARS);
