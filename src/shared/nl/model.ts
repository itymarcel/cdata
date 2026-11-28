/**
 * What a language model is given and what it may give back, shared by both
 * readers: the server's Claude reader (`server/lib/ask.ts`) and the optional
 * in-browser model (`client/features/ask/localModel.ts`).
 *
 * A model only translates a question into an `Intent`. Its reply is held to a
 * JSON schema built from the catalog and then coerced field by field, so
 * nothing it writes reaches the UI: the intent goes through `buildQuery` and
 * the executor like the parser's, and every figure comes from the data.
 */
import {
  CHART_TYPES,
  ENSO_PHASES,
  HAZARDS,
  INTENT_KINDS,
  LIST_DATASETS,
  RANK_BY,
  UNSUPPORTED_REASONS,
  VIEWS,
  emptyIntent,
  type Catalog,
  type Intent,
} from "../query.ts";
import { parse } from "./parse.ts";

const VITAL_IDS = VIEWS.filter((v) => v !== "map");
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

const FIELDS = ["kind", "measures", "countries", "from", "to", "display", "smoothing", "chart", "rankBy", "order", "top", "topCountries", "dataset", "hazard", "phase", "view", "reason", "relatedVital"] as const;

/**
 * The flat schema the model must fill. By default every field is required and
 * "nothing" is null or empty. `brief` requires only what nearly every question
 * uses (kind, measures, countries, from, to) and lets the model leave out the
 * rest (`coerceIntent` fills them in): a model in the browser pays for every
 * token it writes. Leaving countries and years optional too made a 4B model
 * drop them (12/19 against 17/19 in scripts/eval-ask.ts).
 */
export function intentSchema(catalog: Catalog, opts: { brief?: boolean } = {}) {
  return {
    type: "object",
    additionalProperties: false,
    required: opts.brief ? ["kind", "measures", "countries", "from", "to"] : [...FIELDS],
    properties: {
      kind: { type: "string", enum: [...INTENT_KINDS] },
      measures: { type: "array", items: { type: "string", enum: catalog.measures.map((m) => m.id) } },
      countries: { type: "array", items: { type: "string" } },
      from: nullable({ type: "integer" }),
      to: nullable({ type: "integer" }),
      display: { type: "string", enum: ["values", "change"] },
      smoothing: { type: "integer" },
      chart: { type: "string", enum: [...CHART_TYPES] },
      rankBy: { type: "string", enum: [...RANK_BY] },
      order: { type: "string", enum: ["desc", "asc"] },
      top: { type: "integer" },
      topCountries: { type: "boolean" },
      dataset: nullable({ type: "string", enum: [...LIST_DATASETS] }),
      hazard: nullable({ type: "string", enum: HAZARDS }),
      phase: nullable({ type: "string", enum: [...ENSO_PHASES] }),
      view: nullable({ type: "string", enum: [...VIEWS] }),
      reason: nullable({ type: "string", enum: [...UNSUPPORTED_REASONS] }),
      relatedVital: nullable({ type: "string", enum: VITAL_IDS }),
    },
  };
}

const year = (t: number) => Math.floor(t);

/**
 * The server model's system prompt: rules plus the whole catalog. It only
 * changes when the catalog does, so it is cached between questions.
 */
export function systemPrompt(catalog: Catalog): string {
  const measures = catalog.measures
    .map((m) => {
      const where = m.countries ? `per country (${m.countries.length} countries${m.countries.includes("WLD") ? ", WLD = world total" : ""})` : "global only";
      return `- ${m.id}: ${m.label} [${m.unit}; ${m.resolution}; ${year(m.coverage[0])} to ${year(m.coverage[1])}; ${where}${m.countryTwin ? `; per-country twin: ${m.countryTwin}` : ""}]`;
    })
    .join("\n");
  const lists = catalog.lists.map((l) => `- ${l.id}: ${l.label} (filters: ${l.filters.join(", ")})`).join("\n");
  const countries = catalog.countries.map((c) => `${c.iso3} ${c.name}`).join("; ");
  return `You translate questions about climate data into a JSON query for a dashboard. You never answer the question yourself and never state numbers: the dashboard computes every figure from its own datasets after you pick them.

Fill every field of the schema:
- kind: "series" to chart or compare measures over time (also for single values, e.g. "CO2 in 1990"); "map" to show a per-country measure on a world map with a year slider (any mention of a map, or "by country" without a ranking); "rank" to rank countries by a per-country measure; "list" for event lists; "open" when the user asks to open, go to or explore a view (an "open the map" with no measure is view "map"); "unsupported" when the data below can't answer it.
- measures: ids from the measure list. Use the most specific one ("per capita" means emissions.perCapita). A global measure named together with countries should use its per-country twin.
- countries: ISO3 codes from the country list; "WLD" for the world. Empty when none are named.
- from / to: inclusive calendar years, or null for the data's own edge. "Since 1990" is from 1990, to null. "Last 20 years" is from (current year minus 20). Years BCE are written as 1 minus the year (10,000 BCE is -9999). For "rank" by value, "in 1990" is from 1990 to 1990.
- display: "change" only when the user asks for the rate or change per year; otherwise "values".
- smoothing: running mean in years when asked ("10-year average" is 10), else 0.
- chart: "stacked" for parts of a whole (an electricity mix: all energy.* source measures; emissions by fuel: all emissions.<fuel> measures) or when asked; else "lines".
- topCountries: true for "chart the top N countries over time" (kind "series", no countries, the measure in measures, N in top, order as for rankings); else false.
- For "map": rankBy "change" or "percent" maps the change since from; otherwise "value".
- rankBy: "value" for the level in one year; "change" or "percent" for growth or cuts between from and to. order: "desc" for highest or biggest increase; "asc" for lowest or biggest cut. top: how many (default 10).
- dataset, hazard, phase: for lists only, else null. Hazards: heatwave, rainfall (floods), drought, storm (cyclones, hurricanes), wildfire, cold.
- view: for "open" only: "map" or a vital id.
- reason: for "unsupported" only: "not_in_data" (no such dataset here), "explanation" (asks why or how something works), "forecast" (asks about the future), "unclear". relatedVital: for "explanation", the vital whose context notes help (co2, temperature, era5, seaIce, seaLevel, oceanHeat, carbonBudget), else null.
Unused fields: empty arrays, null, "values", 0, "lines", "value", "desc", 10, false.

Measures:
${measures}

Lists:
${lists}

Countries: ${countries}`;
}

/**
 * The system prompt for a small in-browser model, whose context is 4,096
 * tokens: the rules and every measure, but not the 245 countries (the
 * question's own are named in its turn, see `localQuestion`, and any code the
 * model writes is checked by `resolveCountries`). It doesn't depend on the
 * question, so the browser keeps it in the model's KV cache between questions.
 * A few worked examples (none from the evaluation set) show the brief output
 * shape, which small models need more than large ones.
 */
export function compactPrompt(catalog: Catalog, nowYear: number): string {
  const measures = catalog.measures
    .map((m) => `- ${m.id}: ${m.label} [${m.unit}; ${year(m.coverage[0])}–${year(m.coverage[1])}; ${m.countries ? "per country" : "global"}${m.countryTwin ? `, by country: ${m.countryTwin}` : ""}]`)
    .join("\n");
  const lists = catalog.lists.map((l) => `- ${l.id}: ${l.label} (${l.filters.join(", ")})`).join("\n");
  return `You turn a question about climate data into a JSON query for a dashboard. Never answer the question and never write numbers of your own; the dashboard computes them. Reply with JSON only.

kind:
- "series": chart measures over time (also one value, e.g. "CO2 in 1990").
- "map": a per-country measure on a world map ("map", "by country", "colour the countries", "geographically").
- "rank": rank countries ("who emits most", "top 10", "biggest cuts").
- "list": events from one of the lists below.
- "open": go to a chart ("open", "take me to"); view is "map" or a vital id.
- "unsupported": reason "forecast" (the future), "explanation" (why or how), "not_in_data" (nothing below fits), "unclear".

Fields (kind, measures, countries, from and to always; leave out the others unless needed):
- measures: ids from the list below; pick the most specific. When countries are named, use per-country measures.
- countries: ISO3 codes; "WLD" is the world; [] when none are named.
- from, to: calendar years; null for an open end. "since 1990": from 1990. "last 20 years": from ${nowYear - 20}. A named event or period means its year. Years BCE: 1 minus the year (10,000 BCE is -9999). Rank by value "in 1990": from 1990, to 1990.
- display: "change" only for a rate or change per year.
- smoothing: N for an "N-year average".
- chart: "stacked" for parts of a whole: an electricity mix (${electricityMix(catalog).join(", ")}) or emissions by fuel (emissions.coal, emissions.oil, emissions.gas, emissions.cement, emissions.flaring).
- rankBy: "value" (level in one year), "change" or "percent" (growth or cut between from and to). order: "desc" for highest or biggest rise, "asc" for lowest or biggest cut. top: how many, default 10.
- topCountries: true only for a "series" of the top N countries over time, with no countries named.
- For "map", rankBy "change" or "percent" maps the change since from.
- dataset, hazard, phase: lists only. hazard: heatwave, rainfall (floods), drought, storm (cyclones, hurricanes), wildfire, cold.
- relatedVital: for "explanation", the vital it is about.

Measures:
${measures}

Lists:
${lists}

Vital ids: ${VITAL_IDS.join(", ")}.

Examples:
${examples(catalog, nowYear)
    .map(([q, e]) => `"${q}" → ${JSON.stringify(e)}`)
    .join("\n")}`;
}

/**
 * Worked examples for the compact prompt, none from the evaluation set, in the
 * brief shape: the five fields every reply has, then only what's needed.
 */
function examples(catalog: Catalog, nowYear: number): [string, Record<string, unknown>][] {
  const e = (kind: string, measures: string[], countries: string[], from: number | null, to: number | null, rest: Record<string, unknown> = {}) => ({ kind, measures, countries, from, to, ...rest });
  return [
    ["solar vs wind share in Spain since 2005", e("series", ["energy.solar", "energy.wind"], ["ESP"], 2005, null)],
    ["Japan's power by source", e("series", electricityMix(catalog), ["JPN"], null, null, { chart: "stacked" })],
    ["lowest emitters per person in 2020", e("rank", ["emissions.perCapita"], [], 2020, 2020, { rankBy: "value", order: "asc" })],
    ["which countries grew emissions most since 2000", e("rank", ["emissions.co2"], [], 2000, null, { rankBy: "change", order: "desc" })],
    ["solar capacity around the world", e("map", ["action.solar"], [], null, null)],
    ["floods in Nigeria", e("list", [], ["NGA"], null, null, { dataset: "disasters", hazard: "rainfall" })],
    ["methane over the last 30 years", e("series", ["ch4"], [], nowYear - 30, null)],
    ["how hot will it get by 2050", e("unsupported", [], [], null, null, { reason: "forecast" })],
    ["open the sea ice chart", e("open", [], [], null, null, { view: "seaIce" })],
  ];
}

/** The electricity sources that add up to a mix (not the renewables/fossil/low-carbon totals). */
const electricityMix = (catalog: Catalog) =>
  catalog.measures.filter((m) => m.id.startsWith("energy.") && !["energy.renewables", "energy.fossil", "energy.lowCarbon"].includes(m.id)).map((m) => m.id);

/** The in-browser model's user turn: the question, plus the countries the parser recognised in it. */
export function localQuestion(text: string, catalog: Catalog, nowYear: number): string {
  const found = parse(text, catalog, nowYear).intent.countries;
  const named = found.map((iso3) => `${iso3} ${catalog.countries.find((c) => c.iso3 === iso3)?.name ?? ""}`.trim());
  return `${questionMessage(text, nowYear)}\nCountries recognised in it: ${named.length ? named.join(", ") : "none"}.`;
}

/** The user turn, the same for both readers. */
export const questionMessage = (text: string, nowYear: number) => `Current year: ${nowYear}.\n\nQuestion: ${text.slice(0, 500)}`;

/** Coerces whatever came back into a well-formed intent; anything malformed falls back to the default. */
export function coerceIntent(raw: unknown): Intent {
  const base = emptyIntent();
  if (typeof raw !== "object" || raw === null) return { ...base, kind: "unsupported", reason: "unclear" };
  const r = raw as Record<string, unknown>;
  const oneOf = <T>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
  const int = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback);
  const intOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    kind: oneOf(r.kind, INTENT_KINDS, "unsupported"),
    measures: strings(r.measures),
    countries: strings(r.countries).map((c) => c.toUpperCase()),
    from: intOrNull(r.from),
    to: intOrNull(r.to),
    display: oneOf(r.display, ["values", "change"] as const, "values"),
    smoothing: int(r.smoothing, 0),
    chart: oneOf(r.chart, CHART_TYPES, "lines"),
    rankBy: oneOf(r.rankBy, RANK_BY, "value"),
    order: oneOf(r.order, ["desc", "asc"] as const, "desc"),
    top: int(r.top, 10),
    topCountries: r.topCountries === true,
    dataset: oneOf(r.dataset, [...LIST_DATASETS, null], null),
    hazard: oneOf(r.hazard, [...HAZARDS, null], null),
    phase: oneOf(r.phase, [...ENSO_PHASES, null], null),
    view: oneOf(r.view, [...VIEWS, null], null),
    reason: oneOf(r.reason, [...UNSUPPORTED_REASONS, null], null),
    relatedVital: oneOf(r.relatedVital, [...VITAL_IDS, null], null),
  };
}

/**
 * The compact prompt doesn't list every country, so a small model may write a
 * code that isn't one, or a name. Codes in the catalog are kept; anything else
 * is read as a name by the parser, and dropped if that finds nothing.
 */
export function resolveCountries(intent: Intent, catalog: Catalog, nowYear: number): Intent {
  const known = new Set(["WLD", ...catalog.countries.map((c) => c.iso3)]);
  const out: string[] = [];
  for (const c of intent.countries) {
    const found = known.has(c) ? [c] : parse(c.toLowerCase(), catalog, nowYear).intent.countries;
    for (const iso3 of found) if (!out.includes(iso3)) out.push(iso3);
  }
  return { ...intent, countries: out };
}

/**
 * The in-browser models the server will proxy: WebLLM's prebuilt builds. The
 * first is the one the Ask bar uses; the others are kept for comparison with
 * `scripts/eval-ask.ts --local`. On its 19 hard questions (M1 Pro, grammar
 * decoding, brief schema) Qwen3.5 4B read 17 correctly at about 4 s each; the
 * smaller ones read 6 to 11 with the full schema, against 10 for the parser.
 */
export const LOCAL_MODELS = [
  { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Qwen3.5 4B", licence: "Apache 2.0" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", licence: "Llama 3.2 Community" },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B", licence: "Apache 2.0" },
  { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen3.5 2B", licence: "Apache 2.0" },
] as const;
export type LocalModelId = (typeof LOCAL_MODELS)[number]["id"];
export const isLocalModel = (id: string): id is LocalModelId => LOCAL_MODELS.some((m) => m.id === id);
