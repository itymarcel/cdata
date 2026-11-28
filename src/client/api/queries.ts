import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type {
  CarbonMajorsData,
  Co2Data,
  ContextData,
  VitalHistory,
  VitalId,
  DisasterAlertsData,
  SubsidiesData,
  CountrySeries,
  EmissionsMatrix,
  EmissionsMetric,
  EnergyMix,
  Envelope,
  FacilitiesData,
  FiresData,
  FlowsView,
  MapMeasureData,
  TradeCommodity,
  GraphData,
  NaturalEventsData,
  PledgeGap,
  SeaIceData,
  SourceStatus,
  TemperatureData,
  TimelineEvent,
  TreeCoverLossData,
  VitalSign,
  WorldByFuel,
} from "@shared/types.ts";
import type { AskResponse, Catalog, Query, QueryResponse } from "@shared/query.ts";
import type { FeatureCollection, Geometry } from "./geo-types.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const MINUTE = 60_000;

/**
 * One hook per endpoint. Refetch intervals follow how fast each upstream changes,
 * so fast layers stay fresh and the slow ones don't keep polling.
 */
export const useVitals = () =>
  useQuery({ queryKey: ["vitals"], queryFn: () => get<VitalSign[]>("/api/vitals"), refetchInterval: MINUTE });

export const useSources = (enabled = true) =>
  useQuery({
    queryKey: ["sources"],
    queryFn: () => get<SourceStatus[]>("/api/sources"),
    refetchInterval: MINUTE,
    enabled,
  });

export const useTemperature = () =>
  useQuery({
    queryKey: ["source", "temperature"],
    queryFn: () => get<Envelope<TemperatureData>>("/api/source/temperature"),
    staleTime: 60 * MINUTE,
  });

export const useCo2 = () =>
  useQuery({
    queryKey: ["source", "co2"],
    queryFn: () => get<Envelope<Co2Data>>("/api/source/co2"),
    staleTime: 60 * MINUTE,
  });

export const useSeaIce = () =>
  useQuery({
    queryKey: ["source", "seaIce"],
    queryFn: () => get<Envelope<SeaIceData>>("/api/source/seaIce"),
    staleTime: 60 * MINUTE,
  });

export const useFires = (enabled: boolean) =>
  useQuery({
    queryKey: ["source", "fires"],
    queryFn: () => get<Envelope<FiresData>>("/api/source/fires"),
    refetchInterval: 5 * MINUTE,
    enabled,
  });

export const useNaturalEvents = (enabled: boolean) =>
  useQuery({
    queryKey: ["source", "naturalEvents"],
    queryFn: () => get<Envelope<NaturalEventsData>>("/api/source/naturalEvents"),
    refetchInterval: 5 * MINUTE,
    enabled,
  });

export const useFacilities = (enabled: boolean) =>
  useQuery({
    queryKey: ["source", "facilities"],
    queryFn: () => get<Envelope<FacilitiesData>>("/api/source/facilities"),
    staleTime: 60 * MINUTE,
    enabled,
  });

export const useTreeCoverLoss = () =>
  useQuery({
    queryKey: ["source", "treeCoverLoss"],
    queryFn: () => get<Envelope<TreeCoverLossData>>("/api/source/treeCoverLoss"),
    staleTime: 60 * MINUTE,
  });

export const useCountries = () =>
  useQuery({
    queryKey: ["source", "countries"],
    queryFn: () =>
      get<Envelope<FeatureCollection<Geometry, { iso3: string; name: string }>>>("/api/source/countries"),
    staleTime: Infinity,
  });

/** Exporter → importer trade flows for one commodity (UN Comtrade, latest year with good coverage). */
export const useFlows = (commodity: TradeCommodity, enabled: boolean) =>
  useQuery({
    queryKey: ["flows", commodity],
    queryFn: () => get<Envelope<FlowsView | null>>(`/api/flows/${commodity}`),
    staleTime: 60 * MINUTE,
    // `data: null` means the server is still reading Comtrade: ask again shortly.
    refetchInterval: (q) => (q.state.data && q.state.data.data === null ? 15_000 : false),
    enabled,
  });

/** Any per-country catalog measure as a year × country table, for the map. */
export const useMapMeasure = (id: string | null) =>
  useQuery({
    queryKey: ["map-measure", id],
    queryFn: () => get<MapMeasureData>(`/api/map/${id}`),
    staleTime: 60 * MINUTE,
    placeholderData: keepPreviousData,
    enabled: id !== null,
  });

/** Several map measures at once (same cache entries as `useMapMeasure`). */
export const useMapMeasures = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({
      queryKey: ["map-measure", id],
      queryFn: () => get<MapMeasureData>(`/api/map/${id}`),
      staleTime: 60 * MINUTE,
    })),
  });

export const useEmissionsMatrix = (metric: EmissionsMetric) =>
  useQuery({
    queryKey: ["emissions", "matrix", metric],
    queryFn: () => get<Envelope<EmissionsMatrix>>(`/api/emissions/matrix/${metric}`),
    staleTime: 60 * MINUTE,
    placeholderData: keepPreviousData,
  });

export const useWorldByFuel = () =>
  useQuery({
    queryKey: ["emissions", "worldByFuel"],
    queryFn: () => get<Envelope<WorldByFuel>>("/api/emissions/world-by-fuel"),
    staleTime: 60 * MINUTE,
  });

export const useCountrySeries = (iso3: string | null) =>
  useQuery({
    queryKey: ["emissions", "country", iso3],
    queryFn: () => get<Envelope<CountrySeries>>(`/api/emissions/country/${iso3}`),
    staleTime: 60 * MINUTE,
    enabled: !!iso3,
  });

export const useEnergyMix = (iso3: string) =>
  useQuery({
    queryKey: ["energy", iso3],
    queryFn: () => get<Envelope<EnergyMix>>(`/api/energy/${iso3}`),
    staleTime: 60 * MINUTE,
    placeholderData: keepPreviousData,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

export interface PledgesResponse {
  gaps: PledgeGap[];
  sources: { targets: SourceStatus; emissions: SourceStatus };
}
export const usePledges = () =>
  useQuery({
    queryKey: ["pledges"],
    queryFn: () => get<Envelope<PledgesResponse>>("/api/pledges"),
    staleTime: 60 * MINUTE,
  });

export interface TimelineResponse {
  events: TimelineEvent[];
  sources: SourceStatus[];
}
/** Events change when a new study, COP or record lands: hourly is plenty. */
/** Long records change at most daily; the explorer can keep them for a while. */
export const historyQuery = (id: VitalId | null) => ({
  queryKey: ["history", id],
  queryFn: () => get<VitalHistory>(`/api/history/${id}`),
  enabled: id !== null,
  staleTime: 10 * MINUTE,
});
export const useHistory = (id: VitalId | null) => useQuery(historyQuery(id));

/** What the Ask bar can address: measures, countries, lists. */
export const useCatalog = (enabled = true) =>
  useQuery({ queryKey: ["catalog"], queryFn: () => get<Catalog>("/api/catalog"), staleTime: 5 * MINUTE, enabled });

export const runQuery = (query: Query) => post<QueryResponse>("/api/query", query);
export const askModel = (text: string) => post<AskResponse>("/api/ask", { text });

export const useClimateContext = (enabled = true) =>
  useQuery({ queryKey: ["context"], queryFn: () => get<ContextData>("/api/context"), staleTime: 60 * MINUTE, enabled });

export const useTimeline = () =>
  useQuery({
    queryKey: ["timeline"],
    queryFn: () => get<TimelineResponse>("/api/timeline"),
    staleTime: 30 * MINUTE,
    refetchInterval: 60 * MINUTE,
  });

export const useGraph = () =>
  useQuery({ queryKey: ["graph"], queryFn: () => get<GraphData>("/api/graph"), staleTime: 60 * MINUTE });

export const useDisasterAlerts = (enabled: boolean) =>
  useQuery({
    queryKey: ["source", "disasterAlerts"],
    queryFn: () => get<Envelope<DisasterAlertsData>>("/api/source/disasterAlerts"),
    refetchInterval: 30 * MINUTE,
    enabled,
  });

export const useSubsidies = () =>
  useQuery({
    queryKey: ["source", "subsidies"],
    queryFn: () => get<Envelope<SubsidiesData>>("/api/source/subsidies"),
    staleTime: 60 * MINUTE,
  });

/** 424 means "not connected" (needs a manual download); don't retry that. */
export const useCarbonMajors = () =>
  useQuery({
    queryKey: ["source", "carbonMajors"],
    queryFn: () => get<Envelope<CarbonMajorsData>>("/api/source/carbonMajors"),
    staleTime: 60 * MINUTE,
    retry: (count, err) => !(err instanceof ApiError && err.status === 424) && count < 2,
  });
