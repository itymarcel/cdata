import type {
  BerkeleyEarthData,
  Co2Data,
  Co2IceCoreData,
  ContextData,
  Envelope,
  Era5DailyData,
  EnsoData,
  GistempData,
  HistorySeries,
  IgccData,
  OceanHeatData,
  PaleoTemperatureData,
  Point,
  SeaIceData,
  SeaLevelData,
  SeaLevelLongData,
  SourceId,
  TemperatureData,
  VitalHistory,
  VitalId,
  VolcanoesData,
} from "@shared/types.ts";
import { daysInYear, toDecimalYear } from "@shared/time.ts";
import type { SourceStore } from "../lib/source-store.ts";
import { mean, round } from "../lib/stats.ts";
import type { Co2Column, OwidTable } from "../sources/owid.ts";

export const VITAL_IDS: VitalId[] = ["co2", "temperature", "era5", "seaIce", "seaLevel", "oceanHeat", "carbonBudget"];
export const isVitalId = (v: string): v is VitalId => (VITAL_IDS as string[]).includes(v);

type Safe = <T>(id: SourceId) => Promise<Envelope<T> | null>;

/** Series metadata straight from the source's own description. */
function from(env: Envelope<unknown>): Pick<HistorySeries, "source" | "evidence"> {
  const { name, publisher, url, evidence } = env.source;
  return { source: { name, publisher, url }, evidence };
}

const yearsAgo = (n: number) => Math.floor(toDecimalYear(new Date()) - n);

/**
 * The long view of each vital sign: the instrumental record plus whatever
 * reaches further back (ice cores, tide gauges, proxy reconstructions), each
 * as its own series so the explorer can show where one record hands over to
 * the next. A missing source drops its series, never the whole chart.
 */
export async function buildHistory(store: SourceStore, id: VitalId): Promise<VitalHistory> {
  const safe: Safe = async <T>(sid: SourceId) => {
    try {
      return await store.get<T>(sid);
    } catch {
      return null;
    }
  };
  switch (id) {
    case "co2":
      return co2History(safe);
    case "temperature":
      return temperatureHistory(safe);
    case "era5":
      return era5History(safe);
    case "seaIce":
      return seaIceHistory(safe);
    case "seaLevel":
      return seaLevelHistory(safe);
    case "oceanHeat":
      return oceanHeatHistory(safe);
    case "carbonBudget":
      return carbonBudgetHistory(safe);
  }
}

async function co2History(safe: Safe): Promise<VitalHistory> {
  const [mlo, ice] = await Promise.all([safe<Co2Data>("co2"), safe<Co2IceCoreData>("co2IceCore")]);
  const series: HistorySeries[] = [];
  const references: VitalHistory["references"] = [];
  if (ice) {
    series.push({
      id: "iceCore",
      label: "Antarctic ice cores",
      role: "reconstruction",
      resolution: "multiYear",
      points: ice.data.points,
      visible: true,
      note: "Air trapped in ice, so each sample averages decades to centuries.",
      ...from(ice),
    });
    const pre = mean(ice.data.points.filter(([t]) => t >= 1700 && t < 1800).map(([, v]) => v));
    if (pre !== null)
      references.push({ y: round(pre, 0), label: "Pre-industrial", note: "Mean of the ice-core samples dated 1700–1800." });
    const maxBefore = Math.max(...ice.data.points.filter(([t]) => t < 1900).map(([, v]) => v));
    references.push({
      y: round(maxBefore, 0),
      label: "Highest in 800,000 years before 1900",
      note: "The highest ice-core value before the industrial rise.",
    });
  }
  if (mlo) {
    series.push({
      id: "mloMonthly",
      label: "Mauna Loa, monthly",
      role: "primary",
      resolution: "monthly",
      points: mlo.data.monthly,
      visible: true,
      ...from(mlo),
    });
    series.push({
      id: "mloDaily",
      label: "Mauna Loa, daily",
      role: "alternative",
      resolution: "daily",
      points: mlo.data.daily,
      visible: true,
      note: "Preliminary daily means, last three years.",
      ...from(mlo),
    });
  }
  return {
    id: "co2",
    label: "Atmospheric CO₂",
    unit: "ppm",
    decimals: 1,
    explainer:
      "CO₂ traps heat. Ice cores show it swinging between about 180 and 300 ppm through eight ice-age cycles; it has never been above 300 ppm in that time until the 20th century. The yearly sawtooth in the Mauna Loa record is Northern Hemisphere vegetation breathing in and out.",
    series,
    references,
    ranges: [
      { id: "800k", label: "800,000 yrs", from: -803_000 },
      { id: "12k", label: "12,000 yrs", from: -10_050 },
      { id: "2k", label: "2,000 yrs", from: 0 },
      { id: "1850", label: "Since 1850", from: 1850 },
      { id: "1958", label: "Since 1958", from: 1958 },
      { id: "10y", label: "10 yrs", from: yearsAgo(10) },
      { id: "2y", label: "2 yrs", from: yearsAgo(2) },
    ],
    defaultRange: "1850",
    overlays: ["references", "trend", "enso", "volcanoes", "events"],
    defaultOverlays: ["references", "events"],
  };
}

async function temperatureHistory(safe: Safe): Promise<VitalHistory> {
  const [gistemp, hadcrut, berkeley, paleo] = await Promise.all([
    safe<GistempData>("gistemp"),
    safe<TemperatureData>("temperature"),
    safe<BerkeleyEarthData>("berkeleyEarth"),
    safe<PaleoTemperatureData>("paleoTemperature"),
  ]);
  const series: HistorySeries[] = [];
  if (paleo) {
    series.push({
      id: "temp12k",
      label: "Temp12k (century means)",
      role: "reconstruction",
      resolution: "multiYear",
      points: paleo.data.holocene.median,
      band: paleo.data.holocene.band,
      visible: true,
      note: "Median of five statistical methods, 5–95% range. Relative to 1800–1900; each point is a 100-year mean, so it cannot show single hot years.",
      ...from(paleo),
    });
    series.push({
      id: "pages2k",
      label: "PAGES 2k (31-yr smoothed)",
      role: "reconstruction",
      resolution: "multiYear",
      points: paleo.data.common.median,
      band: paleo.data.common.band,
      visible: true,
      note: "Ensemble median of seven methods, 2.5–97.5% range, smoothed over 31 years.",
      ...from(paleo),
    });
  }
  if (berkeley) {
    series.push({
      id: "berkeley",
      label: "Berkeley Earth, annual",
      role: "alternative",
      resolution: "annual",
      points: berkeley.data.annual,
      band: berkeley.data.band,
      visible: false,
      ...from(berkeley),
    });
  }
  if (hadcrut) {
    series.push({
      id: "hadcrutAnnual",
      label: "HadCRUT5, annual",
      role: "alternative",
      resolution: "annual",
      points: hadcrut.data.annual,
      visible: true,
      ...from(hadcrut),
    });
    series.push({
      id: "hadcrutMonthly",
      label: "HadCRUT5, monthly",
      role: "alternative",
      resolution: "monthly",
      points: hadcrut.data.monthly,
      visible: false,
      ...from(hadcrut),
    });
  }
  if (gistemp) {
    series.push({
      id: "gistemp",
      label: "NASA GISTEMP, monthly",
      role: "primary",
      resolution: "monthly",
      points: gistemp.data.monthly,
      visible: true,
      ...from(gistemp),
    });
  }
  return {
    id: "temperature",
    label: "Global temperature",
    unit: "°C vs 1850–1900",
    decimals: 2,
    explainer:
      "Global surface temperature compared with the late 19th century. Before thermometers, it is reconstructed from tree rings, corals, ice and sediments; those records are smoothed over decades or centuries, so a single hot year today is not directly comparable with them. The Paris Agreement’s 1.5 °C refers to long-term (20-year) averages, not single months.",
    series,
    references: [
      { y: 1.5, label: "1.5 °C", note: "Paris Agreement, Article 2: pursue efforts to limit warming to 1.5 °C." },
      { y: 2, label: "2 °C", note: "Paris Agreement, Article 2: hold warming well below 2 °C." },
      { y: 0, label: "1850–1900 average", note: "The IPCC’s pre-industrial baseline." },
    ],
    ranges: [
      { id: "12k", label: "12,000 yrs", from: -10_050 },
      { id: "2k", label: "2,000 yrs", from: 0 },
      { id: "1850", label: "Since 1850", from: 1850 },
      { id: "50y", label: "50 yrs", from: yearsAgo(50) },
      { id: "10y", label: "10 yrs", from: yearsAgo(10) },
    ],
    defaultRange: "1850",
    overlays: ["references", "uncertainty", "trend", "enso", "volcanoes", "events"],
    defaultOverlays: ["references", "uncertainty", "events"],
  };
}

async function era5History(safe: Safe): Promise<VitalHistory> {
  const era5 = await safe<Era5DailyData>("era5Daily");
  const series: HistorySeries[] = [];
  if (era5) {
    const daily: Point[] = [];
    for (const { year, values } of era5.data.years) {
      const n = daysInYear(year);
      values.forEach((v, i) => {
        if (v !== null && i < n) daily.push([round(year + (i + 0.5) / n, 4), v]);
      });
    }
    const { year, climatology } = era5.data;
    const n = daysInYear(year);
    const clim: Point[] = climatology.flatMap((v, i) => (Number.isFinite(v) && i < n ? [[round(year + (i + 0.5) / n, 4), round(v, 2)] as Point] : []));
    series.push({ id: "era5", label: "ERA5 daily", role: "primary", resolution: "daily", points: daily, visible: true, ...from(era5) });
    series.push({
      id: "climatology",
      label: "1991–2020 average for the date",
      role: "alternative",
      resolution: "daily",
      points: clim,
      visible: true,
      note: "Drawn for the current year only.",
      ...from(era5),
    });
  }
  return {
    id: "era5",
    label: "Daily global air temperature",
    unit: "°C",
    decimals: 2,
    explainer:
      "Global mean air temperature 2 m above the surface, every day since 1940, from the ERA5 reanalysis. The planet is warmest in July because the Northern Hemisphere has more land. Switch to “by year” to lay every year over the same calendar.",
    series,
    references: [],
    ranges: [
      { id: "1940", label: "Since 1940", from: 1940 },
      { id: "10y", label: "10 yrs", from: yearsAgo(10) },
      { id: "2y", label: "2 yrs", from: yearsAgo(2) },
    ],
    defaultRange: "1940",
    defaultMode: "seasonal",
    overlays: ["trend", "enso", "volcanoes", "events"],
    defaultOverlays: [],
  };
}

async function seaIceHistory(safe: Safe): Promise<VitalHistory> {
  const ice = await safe<SeaIceData>("seaIce");
  const series: HistorySeries[] = [];
  const references: VitalHistory["references"] = [];
  if (ice) {
    const meta = from(ice);
    const { north, south } = ice.data;
    series.push({ id: "arctic", label: "Arctic, daily", role: "primary", resolution: "daily", points: north.daily, visible: true, ...meta });
    series.push({
      id: "arcticMin",
      label: "Arctic, yearly minimum",
      role: "alternative",
      resolution: "annual",
      points: north.annualMinimum,
      visible: true,
      note: "Lowest daily extent of each year, usually in September.",
      ...meta,
    });
    series.push({ id: "arcticMax", label: "Arctic, yearly maximum", role: "alternative", resolution: "annual", points: north.annualMaximum, visible: false, ...meta });
    series.push({ id: "antarctic", label: "Antarctic, daily", role: "alternative", resolution: "daily", points: south.daily, visible: false, ...meta });
    const baseMin = mean(north.annualMinimum.filter(([y]) => y >= 1981 && y <= 2010).map(([, v]) => v));
    if (baseMin !== null)
      references.push({ y: round(baseMin, 2), label: "1981–2010 average minimum", note: "Mean of the Arctic yearly minima, 1981–2010." });
  }
  return {
    id: "seaIce",
    label: "Arctic sea ice extent",
    unit: "M km²",
    decimals: 2,
    explainer:
      "Area of ocean with at least 15% ice cover, from satellites since late 1978. Arctic ice grows every winter and melts every summer; the September minimum shows the long-term loss most clearly. Antarctic ice behaves differently and fell sharply only from 2016.",
    series,
    references,
    ranges: [
      { id: "1979", label: "Since 1979", from: 1978.8 },
      { id: "10y", label: "10 yrs", from: yearsAgo(10) },
      { id: "2y", label: "2 yrs", from: yearsAgo(2) },
    ],
    defaultRange: "1979",
    overlays: ["references", "trend", "enso", "events"],
    defaultOverlays: ["references"],
  };
}

async function seaLevelHistory(safe: Safe): Promise<VitalHistory> {
  const [sat, long] = await Promise.all([safe<SeaLevelData>("seaLevel"), safe<SeaLevelLongData>("seaLevelLong")]);
  const series: HistorySeries[] = [];
  if (long) {
    series.push({
      id: "churchWhite",
      label: "Tide gauges (Church & White)",
      role: "reconstruction",
      resolution: "quarterly",
      points: long.data.churchWhite,
      visible: true,
      note: "Reconstructed global mean from coastal tide gauges.",
      ...from(long),
    });
    series.push({
      id: "uhslc",
      label: "Tide gauges (UHSLC)",
      role: "alternative",
      resolution: "quarterly",
      points: long.data.uhslc,
      visible: false,
      ...from(long),
    });
  }
  if (sat) {
    series.push({ id: "satellite", label: "Satellite altimetry", role: "primary", resolution: "monthly", points: sat.data.series, visible: true, ...from(sat) });
  }
  return {
    id: "seaLevel",
    label: "Global mean sea level",
    unit: "mm vs 1993",
    decimals: 0,
    explainer:
      "Sea level rises as the ocean warms and expands and as glaciers and ice sheets melt. Tide gauges reach back to 1880; satellites have measured the open ocean since 1993. The trend overlay fits a curve as well as a line: the rise is accelerating.",
    series,
    references: [{ y: 0, label: "1993", note: "All series are set to average zero in 1993." }],
    ranges: [
      { id: "1880", label: "Since 1880", from: 1880 },
      { id: "1993", label: "Since 1993", from: 1993 },
      { id: "10y", label: "10 yrs", from: yearsAgo(10) },
    ],
    defaultRange: "1880",
    overlays: ["references", "trend", "enso", "events"],
    defaultOverlays: ["trend"],
    acceleration: true,
  };
}

async function oceanHeatHistory(safe: Safe): Promise<VitalHistory> {
  const ohc = await safe<OceanHeatData>("oceanHeat");
  const series: HistorySeries[] = [];
  if (ohc) {
    series.push({ id: "noaa", label: "NOAA NCEI", role: "primary", resolution: "annual", points: ohc.data.annual, visible: true, ...from(ohc) });
    series.push({
      id: "mri",
      label: "Japan MRI",
      role: "alternative",
      resolution: "annual",
      points: ohc.data.mri,
      visible: true,
      note: "An independent analysis of the same ocean measurements.",
      ...from(ohc),
    });
  }
  return {
    id: "oceanHeat",
    label: "Ocean heat content, 0–2000 m",
    unit: "×10²² J",
    decimals: 1,
    explainer:
      "Heat stored in the upper 2,000 m of ocean, as an anomaly. The ocean absorbs more than 90% of the excess energy trapped by greenhouse gases, so this is the steadiest measure of global heating. 10²² J is roughly 20 years of humanity’s total energy use.",
    series,
    references: [],
    ranges: [
      { id: "1955", label: "Since 1955", from: 1955 },
      { id: "20y", label: "20 yrs", from: yearsAgo(20) },
    ],
    defaultRange: "1955",
    overlays: ["trend", "enso", "volcanoes", "events"],
    defaultOverlays: ["trend"],
  };
}

async function carbonBudgetHistory(safe: Safe): Promise<VitalHistory> {
  const [owid, igcc] = await Promise.all([safe<OwidTable<Co2Column>>("owidCo2"), safe<IgccData>("igcc")]);
  const series: HistorySeries[] = [];
  const references: VitalHistory["references"] = [];
  if (owid) {
    const w = owid.data.countries.findIndex((c) => c.iso3 === "WLD");
    const fossil = owid.data.columns.co2[w] ?? [];
    const land = owid.data.columns.land_use_change_co2[w] ?? [];
    const cumulative: Point[] = [];
    let sum = 0;
    owid.data.years.forEach((y, i) => {
      const f = fossil[i];
      if (f === null || f === undefined) return;
      sum += (f + (land[i] ?? 0)) / 1000;
      cumulative.push([y + 1, round(sum, 1)]); // emitted by the end of year y
    });
    series.push({
      id: "cumulative",
      label: "Emitted since 1850 (fossil + land use)",
      role: "primary",
      resolution: "annual",
      points: cumulative,
      visible: true,
      ...from(owid),
    });
    if (igcc) {
      const { budget, co2Emissions } = igcc.data;
      const atStart = cumulative.find(([t]) => t === budget.fromYear)?.[1] ?? null;
      if (atStart !== null) {
        const total = atStart + budget.gtCO2;
        references.push({
          y: round(total, 0),
          label: "1.5 °C budget (50% chance)",
          note: `Emitted to ${budget.fromYear} plus the ${budget.gtCO2} Gt remaining in ${igcc.data.edition} (range ${budget.rangeGtCO2[0]}–${budget.rangeGtCO2[1]} Gt).`,
        });
        const last = cumulative.at(-1)!;
        const projection: Point[] = [last];
        for (let t = last[0] + 1; projection.at(-1)![1] < total + co2Emissions.gt; t++)
          projection.push([t, round(last[1] + co2Emissions.gt * (t - last[0]), 1)]);
        series.push({
          id: "projection",
          label: `At today’s ${co2Emissions.gt} Gt a year`,
          role: "projection",
          resolution: "annual",
          points: projection,
          visible: true,
          evidence: "modelled",
          source: { name: igcc.source.name, publisher: igcc.source.publisher, url: igcc.source.url },
          note: "A straight-line projection, not a forecast.",
        });
      }
    }
  }
  return {
    id: "carbonBudget",
    label: "Cumulative CO₂ and the 1.5 °C budget",
    unit: "Gt CO₂ since 1850",
    decimals: 0,
    explainer:
      "Warming tracks the total CO₂ ever emitted, so the 1.5 °C limit is a ceiling on cumulative emissions. The line shows everything emitted since 1850 from fossil fuels, cement and land-use change; the dotted line continues at today’s rate until it crosses the IGCC budget.",
    series,
    references,
    ranges: [
      { id: "1850", label: "Since 1850", from: 1850 },
      { id: "1990", label: "Since 1990", from: 1990 },
      { id: "20y", label: "20 yrs", from: yearsAgo(20) },
    ],
    defaultRange: "1850",
    overlays: ["references", "trend", "events"],
    defaultOverlays: ["references", "events"],
  };
}

export async function buildContext(store: SourceStore): Promise<ContextData> {
  const [enso, volcanoes] = await Promise.all([
    store.get<EnsoData>("enso").catch(() => null),
    store.get<VolcanoesData>("volcanoes").catch(() => null),
  ]);
  return { enso: enso?.data ?? null, volcanoes: volcanoes?.data.eruptions ?? [] };
}
