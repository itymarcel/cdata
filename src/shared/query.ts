/**
 * The Ask bar's query language. Natural language never reaches the data: the
 * parser (or, optionally, a language model) turns a sentence into an `Intent`,
 * `buildQuery` turns that into a validated `Query` against the catalog, and the
 * server's executor answers it from the same series the dashboard shows. Every
 * number in a result is computed there, never written by a model.
 */
import type { Evidence, Hazard, Point, Resolution, RichText, VitalId } from "./types.ts";

// ---------------------------------------------------------------------------
// Catalog: everything a query can address
// ---------------------------------------------------------------------------

export type MeasureGroup = "vital" | "atmosphere" | "emissions" | "energy" | "action" | "land" | "finance" | "ocean";

export interface Measure {
  /** "co2", "temperature.berkeley", "emissions.co2", "energy.solar". */
  id: string;
  label: string;
  /** Chip-sized label, e.g. "CO₂ per person". */
  short: string;
  group: MeasureGroup;
  unit: string;
  decimals: number;
  /**
   * "ratio" quantities have a true zero, so percentages and ratios mean
   * something (emissions, ppm, km²). "interval" ones are anomalies against a
   * baseline (temperature, sea level vs 1993), where they don't.
   */
  scale: "ratio" | "interval";
  evidence: Evidence;
  source: { name: string; publisher: string; url: string };
  /** First and last decimal year with data. */
  coverage: [number, number];
  resolution: Resolution;
  /** Per-country measures list the ISO3 codes with data; "WLD" is the world total. */
  countries?: string[];
  /** The explorer view and series this measure is drawn from. */
  vital?: { id: VitalId; series: string; primary: boolean };
  /** Phrases that name this measure. Any one is enough to pick it. */
  terms: string[];
  /** Words that strengthen a match but don't pick the measure on their own. */
  context?: string[];
  /** For a global measure: the per-country measure to use when a country is named. */
  countryTwin?: string;
}

export interface CatalogCountry {
  iso3: string;
  name: string;
  /** Other names to match in text (from Natural Earth, plus common short forms). */
  names: string[];
}

export const LIST_DATASETS = ["attribution", "disasters", "laws", "cops", "records", "eruptions", "enso", "pledges"] as const;
export type ListDataset = (typeof LIST_DATASETS)[number];

export interface ListInfo {
  id: ListDataset;
  label: string;
  /** Which filters the list understands. */
  filters: ("country" | "hazard" | "span" | "phase")[];
  sources: { name: string; url: string; evidence: Evidence }[];
}

export interface Catalog {
  measures: Measure[];
  countries: CatalogCountry[];
  lists: ListInfo[];
  /** True when the server has a language model configured for questions the parser can't read. */
  askAvailable: boolean;
}

/** A series is a measure, optionally for one country: "emissions.co2@DEU". */
export const seriesRef = (measure: string, iso3?: string | null) => (iso3 ? `${measure}@${iso3}` : measure);
export function splitRef(ref: string): { measure: string; iso3: string | null } {
  const at = ref.indexOf("@");
  return at < 0 ? { measure: ref, iso3: null } : { measure: ref.slice(0, at), iso3: ref.slice(at + 1) };
}

// ---------------------------------------------------------------------------
// Intent: the flat shape both the parser and the model produce
// ---------------------------------------------------------------------------

export const INTENT_KINDS = ["series", "map", "rank", "list", "open", "unsupported"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
export const RANK_BY = ["value", "change", "percent"] as const;
export type RankBy = (typeof RANK_BY)[number];
export const HAZARDS: Hazard[] = ["heatwave", "rainfall", "drought", "storm", "wildfire", "cold", "other"];
export const HAZARD_LABEL: Record<Hazard, string> = {
  heatwave: "Heatwaves",
  rainfall: "Floods and heavy rain",
  drought: "Droughts",
  storm: "Storms and cyclones",
  wildfire: "Wildfires",
  cold: "Cold spells",
  other: "Other hazards",
};
export const ENSO_PHASES = ["elNino", "laNina"] as const;
export type EnsoPhase = (typeof ENSO_PHASES)[number];
export const UNSUPPORTED_REASONS = ["not_in_data", "explanation", "forecast", "unclear"] as const;
export type UnsupportedReason = (typeof UNSUPPORTED_REASONS)[number];
export const VIEWS = ["map", "co2", "temperature", "era5", "seaIce", "seaLevel", "oceanHeat", "carbonBudget"] as const;
export type ViewId = (typeof VIEWS)[number];

export const CHART_TYPES = ["lines", "stacked"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface Intent {
  kind: IntentKind;
  /** Catalog measure ids. */
  measures: string[];
  /** ISO3 codes; "WLD" for the world. */
  countries: string[];
  /** Inclusive calendar years; null leaves that end at the data's edge. */
  from: number | null;
  to: number | null;
  display: "values" | "change";
  /** Running mean in years; 0 = off. */
  smoothing: number;
  /** Lines, or stacked areas for parts of a whole (an electricity mix, emissions by fuel). */
  chart: ChartType;
  rankBy: RankBy;
  order: "desc" | "asc";
  top: number;
  /** For "series": chart the top `top` countries by `measures[0]` instead of named ones. */
  topCountries: boolean;
  dataset: ListDataset | null;
  hazard: Hazard | null;
  phase: EnsoPhase | null;
  view: ViewId | null;
  reason: UnsupportedReason | null;
  /** For "explanation" questions: the vital whose context notes answer it. */
  relatedVital: VitalId | null;
}

export const emptyIntent = (): Intent => ({
  kind: "series",
  measures: [],
  countries: [],
  from: null,
  to: null,
  display: "values",
  smoothing: 0,
  chart: "lines",
  rankBy: "value",
  order: "desc",
  top: 10,
  topCountries: false,
  dataset: null,
  hazard: null,
  phase: null,
  view: null,
  reason: null,
  relatedVital: null,
});

// ---------------------------------------------------------------------------
// Query: what the executor runs
// ---------------------------------------------------------------------------

/** Inclusive calendar years; [1990, 2000] covers 1 Jan 1990 to 31 Dec 2000. Null = the data's edge. */
export type YearSpan = [number | null, number | null];

export type Query =
  | {
      kind: "series";
      series: string[];
      span: YearSpan;
      display: "values" | "change";
      smoothing: number;
      chart: ChartType;
      /**
       * "Chart the top 5 emitters": the server picks the countries by ranking
       * `series[0]`'s measure at the end of the span, then charts them.
       */
      top: { n: number; order: "desc" | "asc" } | null;
    }
  | { kind: "map"; measure: string; span: YearSpan; by: RankBy }
  | { kind: "rank"; measure: string; span: YearSpan; by: RankBy; order: "desc" | "asc"; top: number }
  | { kind: "list"; dataset: ListDataset; country: string | null; hazard: Hazard | null; phase: EnsoPhase | null; span: YearSpan; limit: number }
  | { kind: "open"; view: ViewId; series: string[]; span: YearSpan; display: "values" | "change"; smoothing: number };

export const MAX_SERIES = 8;
export const MAX_TOP = 50;
export const MAX_LIST = 100;

/** Plain-language replies for questions the data can't answer. Templates, no numbers. */
export const UNSUPPORTED_TEXT: Record<UnsupportedReason, string> = {
  not_in_data: "The dashboard doesn’t have a dataset for that. Try one of the measures listed below.",
  explanation:
    "That’s a question about causes, which the data alone can’t answer. The history explorer’s context notes explain each measure with the IPCC’s own wording.",
  forecast: "The dashboard only shows observations and reconstructions, not forecasts.",
  unclear: "I couldn’t tell which data you mean. Try naming a measure, a country or a period.",
};

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
/** "Sea level" → "sea level", but acronyms stay: "CO₂ emissions". */
export const lowerFirst = (s: string) => (/^[A-Z][A-Z₂0-9]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const isYear = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1_000_000;

function span(from: number | null, to: number | null): YearSpan {
  const a = isYear(from) ? Math.round(from) : null;
  const b = isYear(to) ? Math.round(to) : null;
  return a !== null && b !== null && a > b ? [b, a] : [a, b];
}

export interface Built {
  query: Query | null;
  /** Things the reader should know: substitutions, missing countries, dropped series. */
  notes: string[];
}

/**
 * Turns an intent into a runnable query, checking every id against the
 * catalog. Anything that doesn't resolve is dropped with a note rather than
 * guessed at.
 */
export function buildQuery(intent: Intent, catalog: Catalog): Built {
  const notes: string[] = [];
  const byId = new Map(catalog.measures.map((m) => [m.id, m]));
  const countryName = (iso3: string) => catalog.countries.find((c) => c.iso3 === iso3)?.name ?? iso3;
  const countries = [...new Set(intent.countries.map((c) => c.toUpperCase()))].filter((c) => {
    const ok = catalog.countries.some((x) => x.iso3 === c);
    if (!ok) notes.push(`Unknown country code ${c}.`);
    return ok;
  });
  const measures = [...new Set(intent.measures)].filter((id) => {
    const ok = byId.has(id);
    if (!ok) notes.push(`Unknown measure “${id}”.`);
    return ok;
  });
  const s = span(intent.from, intent.to);
  const display = intent.display === "change" ? "change" : "values";
  const smoothing = Number.isFinite(intent.smoothing) ? clampInt(intent.smoothing, 0, 100) : 0;
  const chart: ChartType = intent.chart === "stacked" ? "stacked" : "lines";
  /** The per-country measure an intent is about, falling back through twins to CO₂ emissions. */
  const perCountry = (what: string) => {
    let m = measures.map((id) => byId.get(id)!).find((x) => x.countries);
    if (!m) {
      const twin = measures.map((id) => byId.get(id)!.countryTwin).find((t) => t && byId.has(t));
      m = byId.get(twin ?? "emissions.co2");
      if (m && measures.length) notes.push(`${what} ${lowerFirst(m.short)}, the closest per-country measure.`);
    }
    return m;
  };

  switch (intent.kind) {
    case "unsupported":
      return { query: null, notes: [UNSUPPORTED_TEXT[intent.reason ?? "unclear"], ...notes] };

    case "list": {
      if (!intent.dataset || !LIST_DATASETS.includes(intent.dataset)) return { query: null, notes: [UNSUPPORTED_TEXT.unclear, ...notes] };
      const info = catalog.lists.find((l) => l.id === intent.dataset);
      if (!info) return { query: null, notes: [`The ${intent.dataset} list is unavailable right now.`, ...notes] };
      const country = info.filters.includes("country") ? (countries.find((c) => c !== "WLD") ?? null) : null;
      if (!info.filters.includes("country") && countries.some((c) => c !== "WLD"))
        notes.push(`${info.label} can’t be filtered by country, so this shows all of them.`);
      const hazard = info.filters.includes("hazard") && intent.hazard && HAZARDS.includes(intent.hazard) ? intent.hazard : null;
      const phase = info.filters.includes("phase") && intent.phase && ENSO_PHASES.includes(intent.phase) ? intent.phase : null;
      return {
        query: { kind: "list", dataset: intent.dataset, country, hazard, phase, span: s, limit: clampInt(intent.top > 10 ? intent.top : 25, 1, MAX_LIST) },
        notes,
      };
    }

    case "map": {
      const m = perCountry("Mapping");
      if (!m) return { query: null, notes: ["Country data is unavailable right now.", ...notes] };
      const by = RANK_BY.includes(intent.rankBy) ? intent.rankBy : "value";
      return { query: { kind: "map", measure: m.id, span: s, by: by === "percent" && m.scale !== "ratio" ? "change" : by }, notes };
    }

    case "rank": {
      const m = perCountry("Ranking countries by");
      if (!m) return { query: null, notes: ["Country rankings are unavailable right now.", ...notes] };
      const by = RANK_BY.includes(intent.rankBy) ? intent.rankBy : "value";
      if (by === "percent" && m.scale !== "ratio") return { query: { kind: "rank", measure: m.id, span: s, by: "change", order: intent.order, top: clampInt(intent.top, 1, MAX_TOP) }, notes };
      return { query: { kind: "rank", measure: m.id, span: s, by, order: intent.order === "asc" ? "asc" : "desc", top: clampInt(intent.top || 10, 1, MAX_TOP) }, notes };
    }

    case "open": {
      const firstVital = measures.map((id) => byId.get(id)!.vital?.id).find(Boolean);
      const view = intent.view && VIEWS.includes(intent.view) ? intent.view : (firstVital ?? null);
      if (!view) return { query: null, notes: [UNSUPPORTED_TEXT.unclear, ...notes] };
      const series = measures.filter((id) => byId.get(id)!.vital?.id === view);
      return { query: { kind: "open", view, series, span: s, display, smoothing }, notes };
    }

    case "series": {
      // "Chart the top 5 emitters since 1990": countries picked by the server from a ranking.
      if (intent.topCountries && intent.countries.filter((c) => c !== "WLD").length === 0) {
        const m = perCountry("Charting the top countries by");
        if (!m) return { query: null, notes: ["Country data is unavailable right now.", ...notes] };
        const n = clampInt(intent.top, 1, MAX_SERIES);
        if (intent.top > MAX_SERIES) notes.push(`A chart shows at most ${MAX_SERIES} countries.`);
        return { query: { kind: "series", series: [m.id], span: s, display, smoothing, chart, top: { n, order: intent.order } }, notes };
      }
      const refs: string[] = [];
      const wanted = measures.length ? [...measures] : countries.length ? ["emissions.co2"] : [];
      // A vital sign's main record often starts late (Mauna Loa in 1958, satellites in 1993). When the
      // period reaches further back, add the record of the same vital that covers it: ice cores, tide gauges.
      for (const id of [...wanted]) {
        const m = byId.get(id)!;
        if (!m.vital?.primary || s[0] === null || s[0] >= m.coverage[0]) continue;
        const end = s[1] ?? Infinity;
        const siblings = catalog.measures
          .filter((x) => x.vital?.id === m.vital!.id && x.id !== m.id && x.coverage[0] < m.coverage[0] && x.coverage[1] >= s[0]! && x.coverage[0] <= end)
          // The closest fit: the latest start that still reaches back to the period's start, else the earliest.
          .sort((a, b) => (a.coverage[0] <= s[0]! ? 0 : 1) - (b.coverage[0] <= s[0]! ? 0 : 1) || (a.coverage[0] <= s[0]! ? b.coverage[0] - a.coverage[0] : a.coverage[0] - b.coverage[0]));
        const sib = siblings[0];
        if (!sib || wanted.includes(sib.id)) continue;
        if (end < m.coverage[0]) {
          wanted.splice(wanted.indexOf(id), 1, sib.id);
          notes.push(`${m.label} starts in ${Math.floor(m.coverage[0])}, so this uses ${lowerFirst(sib.label)}.`);
        } else {
          wanted.splice(wanted.indexOf(id) + 1, 0, sib.id);
          notes.push(`${m.label} starts in ${Math.floor(m.coverage[0])}; ${lowerFirst(sib.label)} covers the years before.`);
        }
      }
      for (const id of wanted) {
        let m = byId.get(id);
        if (!m) continue;
        const named = countries.filter((c) => c !== "WLD");
        if (!m.countries && named.length) {
          const twin = m.countryTwin ? byId.get(m.countryTwin) : undefined;
          if (twin) {
            notes.push(`${m.short} is one global figure, so this shows ${twin.short.toLowerCase()} for ${named.map(countryName).join(", ")}.`);
            m = twin;
          } else {
            notes.push(`${m.short} has no per-country series here; showing the global figure.`);
          }
        }
        if (!m.countries) {
          refs.push(m.id);
          continue;
        }
        const targets = countries.length ? countries : ["WLD"];
        for (const c of targets) {
          if (m.countries.includes(c)) refs.push(seriesRef(m.id, c));
          else notes.push(c === "WLD" ? `${m.short} has no world total; name a country.` : `No ${m.short.toLowerCase()} data for ${countryName(c)}.`);
        }
      }
      const unique = [...new Set(refs)];
      if (unique.length === 0) return { query: null, notes: notes.length ? notes : [UNSUPPORTED_TEXT.unclear] };
      if (unique.length > MAX_SERIES) notes.push(`Showing the first ${MAX_SERIES} of ${unique.length} series.`);
      return { query: { kind: "series", series: unique.slice(0, MAX_SERIES), span: s, display, smoothing, chart, top: null }, notes };
    }
  }
}

/**
 * Checks an untrusted query (from the browser) against the catalog. Returns
 * a cleaned copy, or an error naming the first problem.
 */
export function validateQuery(input: unknown, catalog: Catalog): { query: Query } | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "Query must be an object" };
  const q = input as Record<string, unknown>;
  const spanOf = (v: unknown): YearSpan => (Array.isArray(v) ? span((v[0] ?? null) as number | null, (v[1] ?? null) as number | null) : [null, null]);
  const byId = new Map(catalog.measures.map((m) => [m.id, m]));
  const refOk = (ref: unknown): ref is string => {
    if (typeof ref !== "string") return false;
    const { measure, iso3 } = splitRef(ref);
    const m = byId.get(measure);
    if (!m) return false;
    return iso3 === null ? !m.countries || m.countries.includes("WLD") : !!m.countries?.includes(iso3);
  };
  const display = q.display === "change" ? "change" : "values";
  const smoothing = typeof q.smoothing === "number" && Number.isFinite(q.smoothing) ? clampInt(q.smoothing, 0, 100) : 0;
  const chart: ChartType = q.chart === "stacked" ? "stacked" : "lines";
  switch (q.kind) {
    case "series": {
      const series = Array.isArray(q.series) ? q.series : [];
      const t = q.top as { n?: unknown; order?: unknown } | null | undefined;
      const top = t && typeof t.n === "number" ? { n: clampInt(t.n, 1, MAX_SERIES), order: t.order === "asc" ? ("asc" as const) : ("desc" as const) } : null;
      if (top) {
        const m = typeof series[0] === "string" ? byId.get(splitRef(series[0]).measure) : undefined;
        if (!m?.countries || series.length !== 1) return { error: "A top-countries chart needs one per-country measure" };
        return { query: { kind: "series", series: [m.id], span: spanOf(q.span), display, smoothing, chart, top } };
      }
      const bad = series.find((r) => !refOk(r));
      if (bad !== undefined) return { error: `Unknown series ${String(bad)}` };
      if (series.length === 0 || series.length > MAX_SERIES) return { error: `A chart takes 1 to ${MAX_SERIES} series` };
      return { query: { kind: "series", series: series as string[], span: spanOf(q.span), display, smoothing, chart, top: null } };
    }
    case "map": {
      const m = typeof q.measure === "string" ? byId.get(q.measure) : undefined;
      if (!m?.countries) return { error: "Maps need a per-country measure" };
      const by = RANK_BY.includes(q.by as RankBy) ? (q.by as RankBy) : "value";
      return { query: { kind: "map", measure: m.id, span: spanOf(q.span), by } };
    }
    case "rank": {
      const m = typeof q.measure === "string" ? byId.get(q.measure) : undefined;
      if (!m?.countries) return { error: "Rankings need a per-country measure" };
      const by = RANK_BY.includes(q.by as RankBy) ? (q.by as RankBy) : "value";
      const top = typeof q.top === "number" ? clampInt(q.top, 1, MAX_TOP) : 10;
      return { query: { kind: "rank", measure: m.id, span: spanOf(q.span), by, order: q.order === "asc" ? "asc" : "desc", top } };
    }
    case "list": {
      if (!LIST_DATASETS.includes(q.dataset as ListDataset)) return { error: "Unknown list" };
      const country = typeof q.country === "string" && catalog.countries.some((c) => c.iso3 === q.country) ? q.country : null;
      const hazard = HAZARDS.includes(q.hazard as Hazard) ? (q.hazard as Hazard) : null;
      const phase = ENSO_PHASES.includes(q.phase as EnsoPhase) ? (q.phase as EnsoPhase) : null;
      const limit = typeof q.limit === "number" ? clampInt(q.limit, 1, MAX_LIST) : 25;
      return { query: { kind: "list", dataset: q.dataset as ListDataset, country, hazard, phase, span: spanOf(q.span), limit } };
    }
    case "open": {
      if (!VIEWS.includes(q.view as ViewId)) return { error: "Unknown view" };
      const series = (Array.isArray(q.series) ? q.series : []).filter(refOk);
      return { query: { kind: "open", view: q.view as ViewId, series, span: spanOf(q.span), display, smoothing } };
    }
    default:
      return { error: "Unknown query kind" };
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** A sentence built from a template; `basis` names the series and calculation behind its figures. */
export interface Sentence {
  text: RichText;
  basis: string;
}

export interface StatPoint {
  t: number;
  v: number;
  /** "1990", "1990 average", "Sep 2012", "17 Sep 2012". */
  label: string;
}

export interface SeriesStats {
  ref: string;
  first: StatPoint | null;
  last: StatPoint | null;
  change: number | null;
  /** Only for ratio-scale measures with a positive start. */
  percent: number | null;
  min: StatPoint | null;
  max: StatPoint | null;
  /** Least-squares slope through the yearly values, per year. */
  trendPerYear: number | null;
  /** How many values the figures were computed from. */
  count: number;
  /** True when start and end are yearly averages of a sub-annual series. */
  averaged: boolean;
  basis: string;
}

export interface ResultSeries {
  ref: string;
  label: string;
  short: string;
  country: { iso3: string; name: string } | null;
  unit: string;
  decimals: number;
  scale: Measure["scale"];
  resolution: Resolution;
  evidence: Evidence;
  source: Measure["source"];
  points: Point[];
  /** True when the points were thinned for drawing (extremes are kept). */
  thinned: boolean;
  vital: Measure["vital"] | null;
}

export interface RankRow {
  rank: number;
  iso3: string;
  name: string;
  value: number;
  /** For change rankings: the start value. */
  start: number | null;
}

export interface ListItem {
  id: string;
  t: number;
  /** ISO date or year, as precise as the source. */
  date: string;
  title: string;
  detail: string | null;
  place: { name: string; iso3: string | null } | null;
  url: string | null;
  evidence: Evidence;
  tags: string[];
}

export type QueryResult =
  | {
      kind: "series";
      title: string;
      /** The span actually covered by data, in decimal years. */
      extent: [number, number];
      series: ResultSeries[];
      stats: SeriesStats[];
      sentences: Sentence[];
      display: "values" | "change";
      smoothing: number;
      chart: ChartType;
    }
  | {
      kind: "map";
      title: string;
      measure: Pick<Measure, "id" | "label" | "short" | "unit" | "decimals" | "scale" | "evidence" | "source">;
      by: RankBy;
      /** Base year for change maps. */
      base: number | null;
      years: number[];
      /** The year the slider starts on: the latest that enough countries report. */
      year: number;
      /** Countries only (no aggregates); values align with `years`. `ranked` is false for countries rankings leave out (under a million people, for per-person measures). */
      countries: { iso3: string; name: string; values: (number | null)[]; ranked: boolean }[];
      world: (number | null)[] | null;
      basis: string;
      sentences: Sentence[];
    }
  | {
      kind: "rank";
      title: string;
      measure: Pick<Measure, "id" | "label" | "short" | "unit" | "decimals" | "evidence" | "source">;
      by: RankBy;
      order: "desc" | "asc";
      from: number | null;
      to: number;
      unit: string;
      rows: RankRow[];
      /** Countries in the ranking before cutting to `top`. */
      total: number;
      basis: string;
      sentences: Sentence[];
    }
  | {
      kind: "list";
      title: string;
      dataset: ListDataset;
      items: ListItem[];
      /** Matching items before the limit. */
      total: number;
      sources: ListInfo["sources"];
      basis: string;
    }
  | { kind: "open"; title: string };

export interface QueryResponse {
  query: Query;
  result: QueryResult;
  notes: string[];
}

export interface AskResponse {
  intent: Intent;
  query: Query | null;
  result: QueryResult | null;
  notes: string[];
}

/** Turns an executed series query into explorer settings, when every series lives in one vital's explorer. */
export function explorerTarget(series: { vital: Measure["vital"] | null }[]): VitalId | null {
  const ids = new Set(series.map((s) => s.vital?.id ?? null));
  if (ids.size !== 1) return null;
  const [id] = ids;
  return id ?? null;
}
