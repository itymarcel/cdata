/**
 * Everything the Ask bar can address. Each measure pairs words people use for
 * it (vocabulary, not data) with a loader that reads the same source payloads
 * the dashboard already serves. Units, coverage, country lists, evidence and
 * sources are all read from the data, so the catalog can't drift from it.
 */
import type {
  ActionDataset,
  Ch4Data,
  ClimateActionData,
  CountryInfo,
  EnsoData,
  Envelope,
  Evidence,
  Point,
  Resolution,
  SourceId,
  SubsidiesData,
  TreeCoverLossData,
  VitalHistory,
  VitalId,
} from "@shared/types.ts";
import { ENERGY_SOURCES, FUELS, LOSS_DRIVERS } from "@shared/types.ts";
import type { Catalog, CatalogCountry, ListInfo, Measure } from "@shared/query.ts";
import type { SourceStore } from "../lib/source-store.ts";
import { ACTION_ORIGIN, grapherUrl } from "../sources/action.ts";
import type { CountriesGeoJson } from "../sources/geo.ts";
import type { Co2Column, EnergyColumn, OwidTable } from "../sources/owid.ts";
import { createEmissionsViews } from "./emissions.ts";
import { buildHistory } from "./history.ts";

/** A year × country table, the shape every per-country measure is read into. */
export interface CountryTable {
  years: number[];
  countries: CountryInfo[];
  /** values[countryIndex][yearIndex] */
  values: (number | null)[][];
  /** For per-person measures: rankings leave out countries under a million people. */
  population?: (number | null)[][];
}

export interface Loaded {
  evidence: Evidence;
  source: Measure["source"];
  resolution: Resolution;
  unit: string;
  decimals: number;
  global?: Point[];
  table?: CountryTable;
}

type Vocab = Pick<Measure, "id" | "label" | "short" | "group" | "scale" | "terms"> & Partial<Pick<Measure, "context" | "countryTwin">>;
interface MeasureDef extends Vocab {
  vital?: { id: VitalId; series: string; primary: boolean };
  load(ctx: LoadContext): Promise<Loaded | null>;
}

export interface LoadContext {
  get<T>(id: SourceId): Promise<Envelope<T> | null>;
  history(id: VitalId): Promise<VitalHistory>;
  emissions: ReturnType<typeof createEmissionsViews>;
}

const meta = (env: Envelope<unknown>) => ({
  evidence: env.source.evidence,
  source: { name: env.source.name, publisher: env.source.publisher, url: env.source.url },
});

// ---------------------------------------------------------------------------
// Vital-sign series, read from the explorer's own history so they match it.
// ---------------------------------------------------------------------------

function vitalSeries(v: Omit<Vocab, "group"> & { vital: VitalId; series: string; primary?: boolean; group?: Measure["group"] }): MeasureDef {
  return {
    group: "vital",
    ...v,
    vital: { id: v.vital, series: v.series, primary: v.primary ?? false },
    async load(ctx) {
      const h = await ctx.history(v.vital);
      const s = h.series.find((x) => x.id === v.series);
      if (!s || s.points.length === 0) return null;
      return { evidence: s.evidence, source: s.source, resolution: s.resolution, unit: h.unit, decimals: h.decimals, global: s.points };
    },
  };
}

const CO2_WORDS = ["co2", "carbon dioxide", "co 2"];

const VITALS: MeasureDef[] = [
  vitalSeries({
    id: "co2", vital: "co2", series: "mloMonthly", primary: true, scale: "ratio",
    label: "Atmospheric CO₂ (Mauna Loa, monthly)", short: "Atmospheric CO₂",
    terms: [...CO2_WORDS, "co2 concentration", "atmospheric co2", "co2 in the atmosphere", "co2 levels", "carbon in the air", "ppm", "keeling curve", "mauna loa", "co2 ppm"],
    context: ["atmosphere", "air", "concentration"],
    countryTwin: "emissions.co2",
  }),
  vitalSeries({
    id: "co2.daily", vital: "co2", series: "mloDaily", scale: "ratio",
    label: "Atmospheric CO₂ (Mauna Loa, daily)", short: "CO₂ daily",
    terms: ["daily co2", "co2 daily", "daily mauna loa"],
    context: CO2_WORDS,
  }),
  vitalSeries({
    id: "co2.iceCore", vital: "co2", series: "iceCore", scale: "ratio",
    label: "Atmospheric CO₂ from Antarctic ice cores", short: "CO₂ (ice cores)",
    terms: ["ice core", "ice cores", "ice-core", "ice core co2", "antarctic ice", "paleo co2", "ancient co2"],
    context: CO2_WORDS,
  }),
  vitalSeries({
    id: "temperature", vital: "temperature", series: "gistemp", primary: true, scale: "interval",
    label: "Global temperature (NASA GISTEMP, monthly)", short: "Global temperature",
    terms: ["temperature", "temperatures", "global temperature", "global warming", "warming", "surface temperature", "temperature anomaly", "how hot", "gistemp", "nasa"],
    context: ["global", "average", "mean"],
  }),
  vitalSeries({
    id: "temperature.hadcrut", vital: "temperature", series: "hadcrutAnnual", scale: "interval",
    label: "Global temperature (HadCRUT5, annual)", short: "HadCRUT5",
    terms: ["hadcrut", "hadcrut5", "met office", "annual temperature", "yearly temperature"],
    context: ["temperature", "global"],
  }),
  vitalSeries({
    id: "temperature.berkeley", vital: "temperature", series: "berkeley", scale: "interval",
    label: "Global temperature (Berkeley Earth, annual)", short: "Berkeley Earth",
    terms: ["berkeley", "berkeley earth"],
    context: ["temperature", "global"],
  }),
  vitalSeries({
    id: "temperature.pages2k", vital: "temperature", series: "pages2k", scale: "interval",
    label: "Temperature reconstruction (PAGES 2k)", short: "PAGES 2k",
    terms: ["pages 2k", "pages2k", "2000 year temperature", "medieval", "little ice age"],
    context: ["temperature", "reconstruction"],
  }),
  vitalSeries({
    id: "temperature.temp12k", vital: "temperature", series: "temp12k", scale: "interval",
    label: "Temperature reconstruction (Temp12k)", short: "Temp12k",
    terms: ["temp12k", "holocene", "since the ice age", "12000 year temperature"],
    context: ["temperature", "reconstruction"],
  }),
  vitalSeries({
    id: "era5", vital: "era5", series: "era5", primary: true, scale: "interval",
    label: "Daily global air temperature (ERA5)", short: "Daily air temperature",
    terms: ["daily temperature", "air temperature", "era5", "daily global temperature", "hottest day", "hottest days", "today's temperature"],
  }),
  vitalSeries({
    id: "seaIce", vital: "seaIce", series: "arctic", primary: true, scale: "ratio",
    label: "Arctic sea ice extent (daily)", short: "Arctic sea ice",
    terms: ["sea ice", "arctic sea ice", "arctic ice", "ice extent", "sea-ice", "arctic"],
    context: ["extent", "daily"],
  }),
  vitalSeries({
    id: "seaIce.min", vital: "seaIce", series: "arcticMin", scale: "ratio",
    label: "Arctic sea ice, yearly minimum", short: "Arctic ice minimum",
    terms: ["sea ice minimum", "ice minimum", "september minimum", "minimum extent", "yearly minimum", "summer ice", "arctic minimum"],
    context: ["sea ice", "arctic"],
  }),
  vitalSeries({
    id: "seaIce.max", vital: "seaIce", series: "arcticMax", scale: "ratio",
    label: "Arctic sea ice, yearly maximum", short: "Arctic ice maximum",
    terms: ["sea ice maximum", "ice maximum", "maximum extent", "yearly maximum", "winter ice", "arctic maximum"],
    context: ["sea ice", "arctic"],
  }),
  vitalSeries({
    id: "seaIce.antarctic", vital: "seaIce", series: "antarctic", scale: "ratio",
    label: "Antarctic sea ice extent (daily)", short: "Antarctic sea ice",
    terms: ["antarctic sea ice", "antarctic ice", "antarctic", "southern ocean ice", "south pole ice"],
    context: ["sea ice", "extent"],
  }),
  vitalSeries({
    id: "seaLevel", vital: "seaLevel", series: "satellite", primary: true, scale: "interval",
    label: "Global mean sea level (satellite altimetry)", short: "Sea level",
    terms: ["sea level", "sea levels", "sea-level", "sea level rise", "rising seas", "satellite altimetry", "ocean level"],
  }),
  vitalSeries({
    id: "seaLevel.tideGauges", vital: "seaLevel", series: "churchWhite", scale: "interval",
    label: "Global mean sea level (tide gauges, Church & White)", short: "Sea level (tide gauges)",
    terms: ["tide gauge", "tide gauges", "church and white", "church & white"],
    context: ["sea level"],
  }),
  vitalSeries({
    id: "seaLevel.uhslc", vital: "seaLevel", series: "uhslc", scale: "interval",
    label: "Global mean sea level (tide gauges, UHSLC)", short: "Sea level (UHSLC)",
    terms: ["uhslc", "university of hawaii"],
    context: ["sea level", "tide gauges"],
  }),
  vitalSeries({
    id: "oceanHeat", vital: "oceanHeat", series: "noaa", primary: true, scale: "interval",
    label: "Ocean heat content, 0–2000 m (NOAA)", short: "Ocean heat",
    terms: ["ocean heat", "ocean heat content", "ocean warming", "heat in the ocean", "ohc", "ocean temperature"],
  }),
  vitalSeries({
    id: "oceanHeat.mri", vital: "oceanHeat", series: "mri", scale: "interval",
    label: "Ocean heat content, 0–2000 m (Japan MRI)", short: "Ocean heat (MRI)",
    terms: ["mri", "japan mri", "japanese ocean heat"],
    context: ["ocean heat"],
  }),
  vitalSeries({
    id: "carbonBudget", vital: "carbonBudget", series: "cumulative", primary: true, scale: "ratio",
    label: "Cumulative CO₂ emitted since 1850 (world, fossil + land use)", short: "Cumulative CO₂ (world)",
    terms: ["carbon budget", "co2 budget", "1.5 budget", "remaining budget", "total co2 ever emitted", "cumulative global emissions"],
  }),
];

// ---------------------------------------------------------------------------
// Other global series
// ---------------------------------------------------------------------------

const GLOBAL: MeasureDef[] = [
  {
    id: "ch4", group: "atmosphere", scale: "ratio",
    label: "Atmospheric methane (NOAA, monthly)", short: "Atmospheric methane",
    terms: ["methane", "ch4", "atmospheric methane", "methane concentration", "methane levels"],
    context: ["atmosphere", "air", "concentration", "levels"],
    countryTwin: "emissions.methane",
    async load(ctx) {
      const env = await ctx.get<Ch4Data>("ch4");
      return env ? { ...meta(env), resolution: "monthly", unit: "ppb", decimals: 1, global: env.data.monthly } : null;
    },
  },
  {
    id: "oni", group: "ocean", scale: "interval",
    label: "Oceanic Niño Index (El Niño / La Niña)", short: "El Niño index",
    terms: ["oni", "oceanic nino index", "el nino index", "enso index", "nino 3.4", "el nino", "la nina", "enso"],
    async load(ctx) {
      const env = await ctx.get<EnsoData>("enso");
      return env ? { ...meta(env), resolution: "monthly", unit: "°C (Niño 3.4 anomaly)", decimals: 1, global: env.data.oni } : null;
    },
  },
];

// ---------------------------------------------------------------------------
// Per-country tables
// ---------------------------------------------------------------------------

const EMISSIONS_CONTEXT = ["co2", "carbon", "emissions", "emission", "emitted", "emitters", "carbon dioxide"];

function emissionsMetric(
  id: string,
  metric: "co2" | "co2_per_capita" | "cumulative_co2" | "consumption_co2" | "total_ghg",
  v: Omit<Vocab, "id" | "group">,
): MeasureDef {
  return {
    id, group: "emissions", ...v,
    async load(ctx) {
      const env = await ctx.emissions.matrix(metric).catch(() => null);
      if (!env) return null;
      const m = env.data;
      return {
        ...meta(env), resolution: "annual", unit: m.unit, decimals: metric === "co2_per_capita" ? 2 : 1,
        table: { years: m.years, countries: m.countries, values: m.values, population: m.population },
      };
    },
  };
}

async function owidCo2Column(ctx: LoadContext, col: Co2Column, unit: string): Promise<Loaded | null> {
  const env = await ctx.get<OwidTable<Co2Column>>("owidCo2");
  if (!env) return null;
  const t = env.data;
  return { ...meta(env), resolution: "annual", unit, decimals: 1, table: { years: t.years, countries: t.countries, values: t.columns[col] } };
}

/** A per-country climate-action table, credited to the agency that compiled it rather than to OWID alone. */
function actionMeasure(id: string, dataset: ActionDataset, v: Omit<Vocab, "id" | "group">): MeasureDef {
  return {
    id, group: "action", ...v,
    async load(ctx) {
      const env = await ctx.get<ClimateActionData>("climateAction");
      if (!env) return null;
      const o = ACTION_ORIGIN[dataset];
      return {
        evidence: env.source.evidence,
        source: { name: o.name, publisher: o.publisher, url: grapherUrl(o.slug) },
        resolution: "annual", unit: o.unit, decimals: o.decimals, table: env.data[dataset],
      };
    },
  };
}

const FUEL_LABEL: Record<(typeof FUELS)[number], { label: string; terms: string[] }> = {
  coal: { label: "coal", terms: ["coal", "coal emissions", "emissions from coal", "co2 from coal", "coal co2"] },
  oil: { label: "oil", terms: ["oil", "oil emissions", "emissions from oil", "co2 from oil", "oil co2", "petroleum emissions"] },
  gas: { label: "gas", terms: ["gas", "natural gas", "gas emissions", "emissions from gas", "co2 from gas", "gas co2", "natural gas emissions"] },
  cement: { label: "cement", terms: ["cement emissions", "emissions from cement", "cement", "cement co2"] },
  flaring: { label: "flaring", terms: ["flaring", "gas flaring", "flaring emissions"] },
  land_use_change: { label: "land-use change", terms: ["land use emissions", "land-use emissions", "land use change", "land-use change", "deforestation emissions"] },
};

const ENERGY_LABEL: Record<(typeof ENERGY_SOURCES)[number], { label: string; terms: string[] }> = {
  coal: { label: "Coal", terms: ["coal power", "coal electricity", "coal share", "coal generation", "electricity from coal", "coal-fired"] },
  gas: { label: "Gas", terms: ["gas power", "gas electricity", "gas share", "gas generation", "electricity from gas"] },
  oil: { label: "Oil", terms: ["oil power", "oil electricity", "oil share", "electricity from oil"] },
  nuclear: { label: "Nuclear", terms: ["nuclear", "nuclear power", "nuclear energy", "nuclear electricity", "nuclear share"] },
  hydro: { label: "Hydro", terms: ["hydro", "hydropower", "hydroelectric", "hydro power"] },
  wind: { label: "Wind", terms: ["wind", "wind power", "wind energy", "wind share", "wind electricity"] },
  solar: { label: "Solar", terms: ["solar", "solar power", "solar energy", "solar share", "solar electricity", "photovoltaic", "pv"] },
  other_renewables: { label: "Other renewables", terms: ["bioenergy", "biomass", "geothermal", "other renewables"] },
};

const ELECTRICITY_CONTEXT = ["electricity", "power", "share", "generation", "grid", "mix"];

/** Memoised per payload: derived tables are rebuilt only when the source refreshes. */
const derived = new WeakMap<object, Map<string, CountryTable>>();
function memo(data: object, key: string, build: () => CountryTable): CountryTable {
  let m = derived.get(data);
  if (!m) derived.set(data, (m = new Map()));
  let v = m.get(key);
  if (!v) m.set(key, (v = build()));
  return v;
}

/** Sum of several share columns, only for years where every part is reported. */
function sumColumns(t: OwidTable<EnergyColumn>, cols: EnergyColumn[]): CountryTable {
  return {
    years: t.years,
    countries: t.countries,
    values: t.countries.map((_, c) =>
      t.years.map((_, y) => {
        let sum = 0;
        for (const col of cols) {
          const v = t.columns[col][c]?.[y];
          if (v === null || v === undefined) return null;
          sum += v;
        }
        return Math.round(sum * 100) / 100;
      }),
    ),
  };
}

const COUNTRY_MEASURES: MeasureDef[] = [
  emissionsMetric("emissions.co2", "co2", {
    label: "CO₂ emissions (fossil fuels and industry)", short: "CO₂ emissions", scale: "ratio",
    terms: ["co2 emissions", "carbon emissions", "emissions", "emitters", "polluters", "fossil emissions", "carbon dioxide emissions", "emits", "emitter", "carbon footprint"],
    context: EMISSIONS_CONTEXT,
  }),
  emissionsMetric("emissions.perCapita", "co2_per_capita", {
    label: "CO₂ emissions per person", short: "CO₂ per person", scale: "ratio",
    terms: ["per capita", "per person", "per head", "per-capita", "per inhabitant", "per citizen"],
    context: EMISSIONS_CONTEXT,
  }),
  emissionsMetric("emissions.cumulative", "cumulative_co2", {
    label: "Cumulative CO₂ emissions since 1850", short: "Cumulative CO₂", scale: "ratio",
    terms: ["cumulative", "historical emissions", "historic emissions", "total since 1850", "all-time emissions", "historical responsibility", "ever emitted"],
    context: EMISSIONS_CONTEXT,
  }),
  emissionsMetric("emissions.consumption", "consumption_co2", {
    label: "Consumption-based CO₂ emissions", short: "Consumption CO₂", scale: "ratio",
    terms: ["consumption", "consumption-based", "consumption based", "imported emissions", "trade-adjusted", "footprint"],
    context: EMISSIONS_CONTEXT,
  }),
  emissionsMetric("emissions.ghg", "total_ghg", {
    label: "Greenhouse gas emissions (all gases, incl. land use)", short: "All greenhouse gases", scale: "ratio",
    terms: ["greenhouse gas", "greenhouse gases", "ghg", "all gases", "co2e", "co2 equivalent", "total emissions"],
    context: EMISSIONS_CONTEXT,
  }),
  {
    id: "emissions.methane", group: "emissions", scale: "ratio",
    label: "Methane emissions", short: "Methane emissions",
    terms: ["methane emissions", "ch4 emissions", "emissions of methane"],
    context: ["methane", "emissions"],
    load: (ctx) => owidCo2Column(ctx, "methane", "Mt CO₂e"),
  },
  ...FUELS.map(
    (f): MeasureDef => ({
      id: `emissions.${f}`, group: "emissions", scale: "ratio",
      label: `CO₂ emissions from ${FUEL_LABEL[f].label}`, short: `CO₂ from ${FUEL_LABEL[f].label}`,
      terms: FUEL_LABEL[f].terms,
      context: EMISSIONS_CONTEXT,
      load: (ctx) => owidCo2Column(ctx, `${f}_co2`, "Mt CO₂"),
    }),
  ),
  ...ENERGY_SOURCES.map(
    (s): MeasureDef => ({
      id: `energy.${s}`, group: "energy", scale: "ratio",
      label: `${ENERGY_LABEL[s].label} share of electricity`, short: `${ENERGY_LABEL[s].label} electricity`,
      terms: ENERGY_LABEL[s].terms,
      context: ELECTRICITY_CONTEXT,
      async load(ctx) {
        const env = await ctx.get<OwidTable<EnergyColumn>>("owidEnergy");
        if (!env) return null;
        const t = env.data;
        return { ...meta(env), resolution: "annual", unit: "% of electricity", decimals: 1, table: { years: t.years, countries: t.countries, values: t.columns[`${s}_share_elec`] } };
      },
    }),
  ),
  {
    id: "energy.renewables", group: "energy", scale: "ratio",
    label: "Renewable share of electricity (hydro, wind, solar, other)", short: "Renewable electricity",
    terms: ["renewables", "renewable", "renewable energy", "renewable electricity", "clean energy", "green energy", "renewable share"],
    context: ELECTRICITY_CONTEXT,
    async load(ctx) {
      const env = await ctx.get<OwidTable<EnergyColumn>>("owidEnergy");
      if (!env) return null;
      const table = memo(env.data, "renewables", () =>
        sumColumns(env.data, ["hydro_share_elec", "wind_share_elec", "solar_share_elec", "other_renewables_share_elec"]),
      );
      return { ...meta(env), resolution: "annual", unit: "% of electricity", decimals: 1, table };
    },
  },
  {
    id: "energy.fossil", group: "energy", scale: "ratio",
    label: "Fossil share of electricity (coal, gas, oil)", short: "Fossil electricity",
    terms: ["fossil electricity", "fossil power", "fossil share", "fossil fuel electricity", "fossil fuels share"],
    context: ELECTRICITY_CONTEXT,
    async load(ctx) {
      const env = await ctx.get<OwidTable<EnergyColumn>>("owidEnergy");
      if (!env) return null;
      const table = memo(env.data, "fossil", () => sumColumns(env.data, ["coal_share_elec", "gas_share_elec", "oil_share_elec"]));
      return { ...meta(env), resolution: "annual", unit: "% of electricity", decimals: 1, table };
    },
  },
  {
    id: "forest.loss", group: "land", scale: "ratio",
    label: "Tree cover loss (all drivers)", short: "Tree cover loss",
    terms: ["tree cover loss", "forest loss", "deforestation", "forests", "forest", "tree loss", "trees lost", "logging"],
    async load(ctx) {
      const env = await ctx.get<TreeCoverLossData>("treeCoverLoss");
      if (!env) return null;
      const d = env.data;
      const table = memo(d, "loss", () => {
        const world = d.years.map((_, y) => {
          const parts = LOSS_DRIVERS.map((k) => d.world[k][y]).filter((v): v is number => v !== null && v !== undefined);
          return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
        });
        return {
          years: d.years,
          countries: [{ iso3: "WLD", name: "World" }, ...d.byCountry.map((c) => ({ iso3: c.iso3, name: c.name }))],
          values: [world, ...d.byCountry.map((c) => c.values)],
        };
      });
      return { ...meta(env), resolution: "annual", unit: "hectares", decimals: 0, table };
    },
  },
  {
    id: "energy.lowCarbon", group: "energy", scale: "ratio",
    label: "Low-carbon share of electricity (renewables and nuclear)", short: "Low-carbon electricity",
    terms: ["low carbon electricity", "low-carbon electricity", "low carbon power", "low-carbon power", "clean electricity", "clean power", "carbon free electricity", "low carbon share"],
    context: ELECTRICITY_CONTEXT,
    async load(ctx) {
      const env = await ctx.get<OwidTable<EnergyColumn>>("owidEnergy");
      if (!env) return null;
      const table = memo(env.data, "lowCarbon", () =>
        sumColumns(env.data, ["nuclear_share_elec", "hydro_share_elec", "wind_share_elec", "solar_share_elec", "other_renewables_share_elec"]),
      );
      return { ...meta(env), resolution: "annual", unit: "% of electricity", decimals: 1, table };
    },
  },
  actionMeasure("action.solar", "solar", {
    label: "Installed solar capacity", short: "Solar capacity", scale: "ratio",
    terms: ["solar capacity", "installed solar", "solar installed", "solar installations", "solar pv capacity", "solar panels installed", "gigawatts of solar", "solar gw", "solar build out", "solar buildout"],
  }),
  actionMeasure("action.wind", "wind", {
    label: "Installed wind capacity", short: "Wind capacity", scale: "ratio",
    terms: ["wind capacity", "installed wind", "wind installed", "wind turbines installed", "wind farms", "gigawatts of wind", "wind gw", "offshore wind", "onshore wind"],
  }),
  actionMeasure("action.evShare", "evShare", {
    label: "Electric share of new car sales", short: "Electric car sales", scale: "ratio",
    terms: ["electric cars", "electric car", "electric car sales", "ev sales", "evs", "ev share", "electric vehicles", "electric vehicle sales", "share of electric cars", "ev adoption", "electric car share"],
    context: ["cars", "sales", "share", "new cars"],
  }),
  actionMeasure("forest.change", "forestChange", {
    label: "Net change in forest area (FAO)", short: "Net forest change", scale: "interval",
    terms: ["forest area change", "net forest change", "forest change", "change in forest area", "forest gain", "forest growth", "forest cover change", "net forest"],
    context: ["forest", "forests", "net", "area"],
  }),
  actionMeasure("forest.afforestation", "afforestation", {
    label: "Afforestation: new forest planted or seeded (FAO)", short: "Afforestation", scale: "ratio",
    terms: ["afforestation", "tree planting", "planting trees", "trees planted", "planted forests", "forest planting", "new forest", "new forests"],
    context: ["planting", "planted", "trees", "forest"],
  }),
  actionMeasure("land.protected", "protectedLand", {
    label: "Protected land (% of land area)", short: "Protected land", scale: "ratio",
    terms: ["protected areas", "protected area", "protected land", "nature reserves", "conservation areas", "land protected", "protected nature"],
    context: ["protected", "conservation", "nature"],
  }),
  {
    id: "subsidies", group: "finance", scale: "ratio",
    label: "Fossil-fuel subsidies", short: "Fossil-fuel subsidies",
    terms: ["subsidies", "fossil fuel subsidies", "fossil-fuel subsidies", "fuel subsidies", "subsidy"],
    async load(ctx) {
      const env = await ctx.get<SubsidiesData>("subsidies");
      if (!env) return null;
      const d = env.data;
      const table = memo(d, "subsidies", () => ({
        years: d.years,
        countries: [...(d.world ? [{ iso3: "WLD", name: "World" }] : []), ...d.countries.map((c) => ({ iso3: c.iso3, name: c.name }))],
        values: [...(d.world ? [d.world] : []), ...d.countries.map((c) => c.values)],
      }));
      return { ...meta(env), resolution: "annual", unit: d.unit, decimals: 1, table };
    },
  },
];

export const MEASURE_DEFS: MeasureDef[] = [...VITALS, ...GLOBAL, ...COUNTRY_MEASURES];

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const LISTS: { id: ListInfo["id"]; label: string; filters: ListInfo["filters"]; sources: SourceId[] }[] = [
  { id: "attribution", label: "Attribution studies", filters: ["country", "hazard", "span"], sources: ["wwaStudies"] },
  { id: "disasters", label: "Disaster alerts", filters: ["country", "hazard", "span"], sources: ["disasterAlerts"] },
  { id: "laws", label: "Climate laws", filters: ["country", "span"], sources: ["climateLaws"] },
  { id: "cops", label: "UN climate conferences (COPs)", filters: ["country", "span"], sources: ["cops"] },
  { id: "records", label: "Records in the data", filters: ["span"], sources: ["temperature", "co2", "seaIce"] },
  { id: "eruptions", label: "Large volcanic eruptions", filters: ["country", "span"], sources: ["volcanoes"] },
  { id: "enso", label: "El Niño and La Niña episodes", filters: ["span", "phase"], sources: ["enso"] },
  { id: "pledges", label: "Climate pledges (NDC and net-zero targets)", filters: ["country"], sources: ["ndcTargets"] },
];

// ---------------------------------------------------------------------------
// Registry: catalog plus loaded data, rebuilt every few minutes
// ---------------------------------------------------------------------------

export interface Registry {
  catalog: Catalog;
  loaded: Map<string, Loaded>;
  ctx: LoadContext;
}

/** Last year with any value in a table row. */
function rowCoverage(years: number[], row: (number | null)[]): [number, number] | null {
  let a = -1;
  let b = -1;
  row.forEach((v, i) => {
    if (v === null) return;
    if (a < 0) a = i;
    b = i;
  });
  return a < 0 ? null : [years[a]!, years[b]!];
}

export function createRegistry(store: SourceStore, opts: { askAvailable: () => boolean; ttlMs?: number }) {
  const emissions = createEmissionsViews(store);
  const histories = new Map<VitalId, { at: number; value: Promise<VitalHistory> }>();
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const ctx: LoadContext = {
    async get<T>(id: SourceId) {
      try {
        return await store.get<T>(id);
      } catch {
        return null;
      }
    },
    history(id) {
      const hit = histories.get(id);
      if (hit && Date.now() - hit.at < ttl) return hit.value;
      const value = buildHistory(store, id);
      histories.set(id, { at: Date.now(), value });
      value.catch(() => histories.delete(id));
      return value;
    },
    emissions,
  };

  let current: { at: number; value: Promise<Registry> } | null = null;

  async function build(): Promise<Registry> {
    const loaded = new Map<string, Loaded>();
    const measures: Measure[] = [];
    const results = await Promise.all(MEASURE_DEFS.map((d) => d.load(ctx).catch(() => null)));
    MEASURE_DEFS.forEach((def, i) => {
      const l = results[i];
      if (!l) return;
      let coverage: [number, number] | null = null;
      let countries: string[] | undefined;
      if (l.global) {
        if (l.global.length === 0) return;
        coverage = [l.global[0]![0], l.global.at(-1)![0]];
      } else if (l.table) {
        countries = [];
        for (let c = 0; c < l.table.countries.length; c++) {
          const cov = rowCoverage(l.table.years, l.table.values[c] ?? []);
          if (!cov) continue;
          countries.push(l.table.countries[c]!.iso3);
          coverage = coverage ? [Math.min(coverage[0], cov[0]), Math.max(coverage[1], cov[1])] : cov;
        }
      }
      if (!coverage) return;
      loaded.set(def.id, l);
      const { load: _load, ...vocab } = def;
      measures.push({
        ...vocab,
        unit: l.unit,
        decimals: l.decimals,
        evidence: l.evidence,
        source: l.source,
        coverage,
        resolution: l.resolution,
        ...(countries ? { countries } : {}),
      });
    });

    // Countries: OWID's list (it covers every per-country measure), with Natural Earth's alternative names for matching.
    const owid = await ctx.get<OwidTable<Co2Column>>("owidCo2");
    const ne = await ctx.get<CountriesGeoJson>("countries");
    const names = new Map(ne?.data.features.map((f) => [f.properties.iso3, f.properties.names]) ?? []);
    const seen = new Map<string, CatalogCountry>();
    for (const c of owid?.data.countries ?? []) seen.set(c.iso3, { iso3: c.iso3, name: c.name, names: names.get(c.iso3)?.filter((n) => n && n !== c.name) ?? [] });
    for (const m of measures) for (const iso3 of m.countries ?? []) if (!seen.has(iso3)) seen.set(iso3, { iso3, name: iso3, names: [] });
    // Table names fill in codes OWID's CO₂ table doesn't carry.
    for (const l of loaded.values())
      for (const c of l.table?.countries ?? []) {
        const e = seen.get(c.iso3);
        if (e && e.name === e.iso3) e.name = c.name;
      }
    if (!seen.has("WLD")) seen.set("WLD", { iso3: "WLD", name: "World", names: [] });

    const lists: ListInfo[] = LISTS.flatMap((l) => {
      const statuses = l.sources.map((id) => store.status(id)).filter((s) => s.connected);
      if (statuses.length === 0) return [];
      return [{ id: l.id, label: l.label, filters: l.filters, sources: statuses.map((s) => ({ name: s.name, url: s.url, evidence: s.evidence })) }];
    });

    return { catalog: { measures, countries: [...seen.values()], lists, askAvailable: opts.askAvailable() }, loaded, ctx };
  }

  return {
    get(): Promise<Registry> {
      if (!current || Date.now() - current.at > ttl) {
        const value = build();
        current = { at: Date.now(), value };
        value.catch(() => (current = null));
      }
      return current.value.then((r) => ({ ...r, catalog: { ...r.catalog, askAvailable: opts.askAvailable() } }));
    },
  };
}

export type RegistryHandle = ReturnType<typeof createRegistry>;
