/**
 * Types shared by the Bun server and the React client.
 * Every number the dashboard shows travels inside an `Envelope`, so the UI
 * always knows where it came from, how fresh it is, and how it was produced.
 */

/** How a number was produced. Shown as a badge next to every figure. */
export type Evidence =
  | "observed" // measured by instruments (satellites, stations, buoys)
  | "modelled" // derived from models or reanalysis, or computed by us
  | "reported" // self-reported by governments or companies
  | "curated"; // hand-assembled from published studies; verify against the cited source

export type SourceId =
  | "wwaStudies"
  | "cops"
  | "climateLaws"
  | "disasterAlerts"
  | "igcc"
  | "ndcTargets"
  | "subsidies"
  | "carbonMajors"
  | "co2"
  | "ch4"
  | "temperature"
  | "gistemp"
  | "era5Daily"
  | "seaIce"
  | "seaLevel"
  | "oceanHeat"
  | "owidCo2"
  | "owidEnergy"
  | "treeCoverLoss"
  | "fires"
  | "naturalEvents"
  | "facilities"
  | "countries"
  | "co2IceCore"
  | "paleoTemperature"
  | "berkeleyEarth"
  | "seaLevelLong"
  | "enso"
  | "volcanoes";

export interface SourceMeta {
  id: SourceId;
  /** Shown when the source can't run without user action (key, licence, manual download). */
  setup?: string;
  name: string;
  publisher: string;
  url: string;
  evidence: Evidence;
  /** Human-readable update cadence of the upstream, e.g. "daily", "annual". */
  cadence: string;
  /** How often our server re-fetches it. */
  refreshMs: number;
  /** Typical publication lag, shown next to the "data as of" stamp. */
  lag?: string;
  licence?: string;
  note?: string;
}

export interface SourceStatus extends SourceMeta {
  /** False when a source needs something we don't have yet (a key, a manual download). */
  connected: boolean;
  fetchedAt: string | null;
  dataAsOf: string | null;
  ok: boolean;
  error: string | null;
  nextRefreshAt: string | null;
}

export interface Envelope<T> {
  source: SourceStatus;
  data: T;
}

/** [decimalYear, value]. Decimal years keep every series on the scrubber's axis. */
export type Point = [number, number];

// ---------------------------------------------------------------------------
// Source payloads
// ---------------------------------------------------------------------------

export interface Co2Data {
  monthly: Point[]; // ppm, 1958 → now
  daily: Point[]; // ppm, last ~3 years
  latest: { t: number; date: string; ppm: number };
  yearAgo: number | null;
}

export interface Ch4Data {
  monthly: Point[]; // ppb
  latest: { t: number; date: string; ppb: number };
}

export interface TemperatureData {
  /** Anomaly vs 1850–1900 (°C). */
  annual: Point[];
  monthly: Point[];
  baseline: string;
  latestCompleteYear: number;
}

export interface GistempData {
  /** Monthly anomaly vs 1880–1900 (°C), rebased from NASA's 1951–1980 baseline. */
  monthly: Point[];
  latest: { t: number; date: string; anomaly: number };
  baseline: string;
}

export interface Era5DailyData {
  year: number;
  /** Day-of-year → absolute °C for the current year. */
  current: (number | null)[];
  climatology: number[]; // 1991–2020 mean per day of year
  recordYear: { year: number; values: (number | null)[] } | null;
  latest: { date: string; dayOfYear: number; tempC: number; anomaly: number };
  /** Every year since 1940: day-of-year → absolute °C. */
  years: { year: number; values: (number | null)[] }[];
}

export interface SeaIceHemisphere {
  latest: { date: string; extent: number; climatology: number; anomaly: number };
  last365: Point[];
  /** The whole daily record since 1978 (every other day until mid-1987). */
  daily: Point[];
  annualMinimum: Point[]; // year → minimum daily extent
  annualMaximum: Point[];
}
export interface SeaIceData {
  north: SeaIceHemisphere;
  south: SeaIceHemisphere;
}

export interface SeaLevelData {
  series: Point[]; // mm vs 1993 start, satellite record
  latest: { t: number; mm: number };
  trendMmPerYear: number | null;
}

export interface OceanHeatData {
  annual: Point[]; // 10^22 J, 0–2000 m, NOAA NCEI
  /** The same quantity from Japan's Meteorological Research Institute, for comparison. */
  mri: Point[];
  latest: { year: number; value: number };
}

// ---------------------------------------------------------------------------
// Long history and context, for the vital-sign explorer
// ---------------------------------------------------------------------------

export interface Co2IceCoreData {
  /** Antarctic ice-core composite: [decimal year CE (negative = BCE), ppm]. */
  points: Point[];
}

/** [t, low, high] uncertainty band. */
export type BandPoint = [number, number, number];

export interface PaleoTemperatureData {
  /** PAGES 2k (Neukom et al. 2019), 31-year filtered ensemble median, years 16–1985 CE, °C vs 1850–1900. */
  common: { median: Point[]; band: BandPoint[] };
  /** Temp12k (Kaufman et al. 2020), 100-year bins, °C vs 1800–1900. */
  holocene: { median: Point[]; band: BandPoint[] };
}

export interface BerkeleyEarthData {
  /** Annual anomaly vs 1850–1900, °C, with the 95% uncertainty. */
  annual: Point[];
  band: BandPoint[];
}

export interface SeaLevelLongData {
  /** Church & White (2011) tide-gauge reconstruction, quarterly, mm relative to 1993. */
  churchWhite: Point[];
  /** University of Hawaii Sea Level Center tide-gauge average, quarterly, mm relative to 1993. */
  uhslc: Point[];
}

export interface EnsoEpisode {
  phase: "elNino" | "laNina";
  start: number;
  end: number;
  /** Strongest 3-month ONI value in the episode. */
  peak: number;
}
export interface EnsoData {
  /** Oceanic Niño Index, 3-month running mean SST anomaly in the Niño 3.4 region, °C. */
  oni: Point[];
  episodes: EnsoEpisode[];
}

export interface Volcano {
  t: number;
  name: string;
  country: string;
  vei: number;
}
export interface VolcanoesData {
  eruptions: Volcano[];
}

// ---------------------------------------------------------------------------
// Emissions & energy (Our World in Data)
// ---------------------------------------------------------------------------

export type EmissionsMetric =
  | "co2"
  | "co2_per_capita"
  | "cumulative_co2"
  | "consumption_co2"
  | "total_ghg";

export interface CountryInfo {
  iso3: string;
  name: string;
}

/** Dense year × country matrix for one metric. values[c][y] aligns with years[y]. */
export interface EmissionsMatrix {
  metric: EmissionsMetric;
  unit: string;
  years: number[];
  countries: CountryInfo[];
  values: (number | null)[][];
  /** Only for per-capita metrics, so rankings can exclude micro-states. */
  population?: (number | null)[][];
}

export const FUELS = ["coal", "oil", "gas", "cement", "flaring", "land_use_change"] as const;
export type Fuel = (typeof FUELS)[number];

export interface WorldByFuel {
  years: number[];
  series: Record<Fuel, (number | null)[]>;
  unit: string;
}

export const ENERGY_SOURCES = [
  "coal",
  "gas",
  "oil",
  "nuclear",
  "hydro",
  "wind",
  "solar",
  "other_renewables",
] as const;
export type EnergySource = (typeof ENERGY_SOURCES)[number];

export interface EnergyMix {
  iso3: string;
  name: string;
  years: number[];
  /** Share of electricity generation, %. */
  shares: Record<EnergySource, (number | null)[]>;
}

export interface CountrySeries {
  iso3: string;
  name: string;
  years: number[];
  co2: (number | null)[];
  totalGhg: (number | null)[];
  consumptionCo2: (number | null)[];
  population: (number | null)[];
}

// ---------------------------------------------------------------------------
// Forests
// ---------------------------------------------------------------------------

export const LOSS_DRIVERS = [
  "permanent_agriculture",
  "hard_commodities",
  "shifting_cultivation",
  "logging",
  "wildfire",
  "settlements_infrastructure",
  "other_natural_disturbances",
] as const;
export type LossDriver = (typeof LOSS_DRIVERS)[number];

export interface TreeCoverLossData {
  years: number[];
  /** Global hectares per driver per year. */
  world: Record<LossDriver, (number | null)[]>;
  /** Per-country total hectares per year. */
  byCountry: { iso3: string; name: string; values: (number | null)[] }[];
}

// ---------------------------------------------------------------------------
// Live layers
// ---------------------------------------------------------------------------

/** [lon, lat, frp (MW), epochMs, confidence 0-2] */
export type FirePoint = [number, number, number, number, number];
export interface FiresData {
  satellite: string;
  points: FirePoint[];
  windowHours: number;
}

export interface NaturalEvent {
  id: string;
  title: string;
  category: string;
  lon: number;
  lat: number;
  date: string;
  link: string;
  magnitude?: { value: number; unit: string };
}
export interface NaturalEventsData {
  events: NaturalEvent[];
}

export interface Facility {
  id: number;
  name: string;
  iso3: string;
  sector: string;
  subsector: string;
  type: string;
  lon: number;
  lat: number;
  /** Tonnes CO₂e (100-yr GWP) for the reported year. */
  co2e: number;
}
export interface FacilitiesData {
  year: number;
  facilities: Facility[];
}

// ---------------------------------------------------------------------------
// Real-world event feeds
// ---------------------------------------------------------------------------

export type Hazard = "heatwave" | "rainfall" | "drought" | "storm" | "wildfire" | "cold" | "other";

/** A World Weather Attribution study. The headline is the study's own finding. */
export interface AttributionStudy {
  id: string;
  published: string; // ISO date
  title: string;
  summary: string;
  hazards: Hazard[];
  url: string;
}

export interface CopConference {
  id: string; // Wikidata QID
  label: string;
  /** Official session name from Wikidata's aliases, e.g. "COP21" or "COP6-2". */
  number: string | null;
  start: string; // ISO date
  place: string | null;
  country: string | null;
  countryIso3: string | null;
  lon: number | null;
  lat: number | null;
  url: string;
}

export interface ClimateLaw {
  id: string; // Wikidata QID
  label: string;
  date: string | null;
  country: string | null;
  countryIso3: string | null;
  url: string;
}

export type DisasterType = "FL" | "TC" | "DR" | "WF";
export interface DisasterAlert {
  id: string;
  type: DisasterType;
  name: string;
  alert: "Orange" | "Red";
  from: string;
  to: string;
  lon: number;
  lat: number;
  iso3: string | null;
  severity: string | null;
  url: string;
}
export interface DisasterAlertsData {
  alerts: DisasterAlert[];
  fromYear: number;
}

/** IGCC (Indicators of Global Climate Change) assessment values. */
export interface IgccData {
  edition: string; // e.g. "IGCC-2025a"
  budget: {
    targetC: number;
    likelihood: number;
    gtCO2: number;
    /** Range across the assessment's parameter sets, for honesty about uncertainty. */
    rangeGtCO2: [number, number];
    fromYear: number; // budget counted from 1 Jan of this year
  };
  /** Latest annual CO₂ emissions (fossil + land use), Gt. */
  co2Emissions: { year: number; gt: number };
  /** Warming contribution by emitted compound, °C relative to 1750 (p5, p50, p95). */
  warmingBySpecies: { compound: string; p5: number; p50: number; p95: number }[];
}

export interface NdcTarget {
  iso3: string;
  country: string;
  /** The target text exactly as recorded by Climate Watch. */
  text: string;
  /** Parsed, when the text states an economy-wide % cut against a base year. */
  parsed: { reduction: number; reductionLabel: string; baseYear: number; targetYear: number } | null;
  /** Order of appearance; later entries come from later NDC submissions. */
  order: number;
}
export interface NetZeroTarget {
  iso3: string;
  country: string;
  status: string;
  year: number | null;
}
export interface NdcData {
  targets: NdcTarget[];
  netZero: NetZeroTarget[];
}

export interface SubsidiesData {
  unit: string;
  years: number[];
  /** OWID's world aggregate, when published. */
  world: (number | null)[] | null;
  countries: { iso3: string; name: string; values: (number | null)[] }[];
}

export interface CarbonMajor {
  entity: string;
  type: string; // Investor-owned / State-owned / Nation state
  commodities: string[];
  cumulativeMt: number;
  sinceYear: number;
  latestYear: number;
  latestMt: number;
  /** Wikidata item, matched by LEI or name; absent when no match was found. */
  wikidata?: string;
  /** Hostname of the official website. */
  website?: string;
  /** Commons file name of the logo, or of the flag for nation states. */
  image?: string;
}
export interface CarbonMajorsData {
  entities: CarbonMajor[];
  totalMt: number;
}

// ---------------------------------------------------------------------------
// Derived: timeline, connections graph, pledges
// ---------------------------------------------------------------------------

export type TimelineKind = "cop" | "law" | "record" | "attribution";

export interface TimelineEvent {
  id: string;
  date: string; // ISO date
  t: number; // decimal year
  kind: TimelineKind;
  title: string;
  summary: string;
  place?: { name: string; lon: number; lat: number; iso3?: string };
  attribution?: Attribution;
  sourceUrl: string;
  sourceName: string;
  evidence: Evidence;
}

export interface Attribution {
  /** The study's headline finding, verbatim. */
  finding: string;
  study: string;
  hazards: Hazard[];
  url: string;
}

export type NodeKind = "indicator" | "driver" | "actor" | "event" | "place" | "policy";

/** Solid = documented, dashed = attributed by a study, dotted = claimed or contested. */
export type LinkEvidence = "documented" | "attributed" | "contested";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  description: string;
  t?: number;
  lon?: number;
  lat?: number;
  zoom?: number;
  iso3?: string;
  /** Links node to a live indicator for its value. */
  indicator?: SourceId;
  sourceUrl?: string;
  sourceName?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  evidence: LinkEvidence;
  confidence?: "high" | "medium" | "low";
  note?: string;
  sourceUrl?: string;
  sourceName?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PledgeTarget {
  year: number;
  reduction: number;
  rangeLabel: string;
  baseYear: number;
  text: string;
}

export interface PledgeGap {
  iso3: string;
  name: string;
  targets: PledgeTarget[];
  /** Targets that couldn't be parsed into a plottable number (intensity, peaking, BAU…). */
  otherCommitments: string[];
  netZero?: { year: number | null; status: string };
  years: number[];
  actual: (number | null)[]; // Mt CO₂e
  targetPoints: { year: number; value: number; baseValue: number; label: string }[];
  /** Straight line from the latest actual year to each target. */
  requiredPath: Point[];
  /** Linear extension of the last 10 years. */
  currentTrend: Point[];
  latestYear: number | null;
  sourceUrl: string;
}

export type VitalId = "co2" | "temperature" | "era5" | "seaIce" | "seaLevel" | "oceanHeat" | "carbonBudget";

/** Context layers the explorer can blend over a chart. */
export type OverlayId = "references" | "uncertainty" | "trend" | "enso" | "volcanoes" | "events";

export type Resolution = "daily" | "monthly" | "quarterly" | "annual" | "multiYear";

export interface HistorySeries {
  id: string;
  label: string;
  /** primary: the vital itself; alternative: another dataset of the same thing; reconstruction: proxies; projection: computed forward. */
  role: "primary" | "alternative" | "reconstruction" | "projection";
  resolution: Resolution;
  points: Point[];
  band?: BandPoint[];
  evidence: Evidence;
  source: { name: string; publisher: string; url: string };
  note?: string;
  /** Shown when the explorer opens. */
  visible: boolean;
}

export interface VitalHistory {
  id: VitalId;
  label: string;
  unit: string;
  decimals: number;
  explainer: string;
  series: HistorySeries[];
  /** Horizontal reference lines, each derived from data or a cited agreement. */
  references: { y: number; label: string; note: string }[];
  /** Range presets; `from` is a decimal year, the range always ends now. */
  ranges: { id: string; label: string; from: number }[];
  defaultRange: string;
  /** "seasonal" lays each year over one calendar; only for daily or monthly primaries. */
  defaultMode?: "timeline" | "seasonal";
  overlays: OverlayId[];
  defaultOverlays: OverlayId[];
  /** Fit a quadratic as well as a line, to show acceleration (sea level). */
  acceleration?: boolean;
}

export interface ContextData {
  enso: EnsoData | null;
  volcanoes: Volcano[];
}

export interface VitalSign {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  decimals: number;
  /** Plain-language context, e.g. "+2.6 ppm vs a year ago". */
  context: string | null;
  /** Whether a higher value is worse, for colouring the delta. */
  higherIsWorse: boolean;
  spark: Point[];
  source: SourceStatus | null;
  evidence: Evidence;
  asOf: string | null;
  /** For values the client animates between refreshes: value = start − rate × (t − startT). */
  live?: { start: number; startT: number; ratePerYear: number };
  /** Plain-text explanation of the method, shown in the detail view. */
  method?: string;
}
