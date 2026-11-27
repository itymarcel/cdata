import type {
  BandPoint,
  BerkeleyEarthData,
  Co2IceCoreData,
  EnsoData,
  EnsoEpisode,
  PaleoTemperatureData,
  Point,
  SeaLevelLongData,
  Volcano,
  VolcanoesData,
} from "@shared/types.ts";
import { DAY, WEEK, ymdToDecimalYear } from "@shared/time.ts";
import { num, parseCsvRecords } from "../lib/csv.ts";
import { fetchJson, fetchText } from "../lib/http.ts";
import { mean, round } from "../lib/stats.ts";
import { defineSource } from "./types.ts";

/**
 * Long records and context for the vital-sign explorer: proxy reconstructions
 * that reach back before the instruments, and the natural events (El Niño,
 * eruptions) that explain the wiggles in the instrumental record.
 */

const PALEO = "https://www.ncei.noaa.gov/pub/data/paleo";
/** Radiocarbon and ice-core ages count back from 1950 ("before present"). */
const fromBP = (ageBP: number) => 1950 - ageBP;

/** Tab- or whitespace-separated data lines, skipping `#`/`%` comment lines. */
function dataLines(text: string, comment: string): string[][] {
  return text
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith(comment))
    .map((l) => l.trim().split(/\s+/));
}

export const co2IceCoreSource = defineSource<Co2IceCoreData>({
  meta: {
    id: "co2IceCore",
    name: "Antarctic ice-core CO₂ composite, 800,000 years",
    publisher: "Bereiter et al. (2015), via NOAA NCEI Paleoclimatology",
    url: "https://www.ncei.noaa.gov/access/paleo-search/study/17975",
    evidence: "observed",
    cadence: "static (published 2015)",
    refreshMs: 4 * WEEK,
    licence: "Public domain (NOAA)",
    note: "Air bubbles trapped in Antarctic ice, from several cores. Ends in 2001.",
  },
  async load() {
    const text = await fetchText(`${PALEO}/icecore/antarctica/antarctica2015co2composite.txt`);
    const points: Point[] = [];
    for (const [age, ppm] of dataLines(text, "#")) {
      const a = num(age);
      const v = num(ppm);
      if (a !== null && v !== null) points.push([round(fromBP(a), 2), v]);
    }
    if (points.length < 100) throw new Error("Ice-core CO₂ composite too short");
    points.sort((a, b) => a[0] - b[0]);
    return { data: { points }, dataAsOf: String(Math.floor(points.at(-1)![0])) };
  },
});

export const paleoTemperatureSource = defineSource<PaleoTemperatureData>({
  meta: {
    id: "paleoTemperature",
    name: "Global temperature reconstructions (PAGES 2k, Temp12k)",
    publisher: "Neukom et al. (2019); Kaufman et al. (2020), via NOAA NCEI Paleoclimatology",
    url: "https://www.ncei.noaa.gov/access/paleo-search/study/26872",
    evidence: "modelled",
    cadence: "static (published 2019–2020)",
    refreshMs: 4 * WEEK,
    licence: "Public domain (NOAA)",
    note: "Statistical reconstructions from tree rings, corals, ice and sediments. PAGES 2k is rebased to its own 1850–1900 mean; Temp12k is relative to 1800–1900.",
  },
  async load() {
    const [pages, temp12k] = await Promise.all([
      fetchText(`${PALEO}/pages2k/neukom2019temp/recons/Full_ensemble_median_and_95pct_range.txt`),
      fetchText(`${PALEO}/reconstructions/kaufman2020/temp12k_allmethods_percentiles.csv`),
    ]);

    // PAGES 2k: Year, target, median, 2.5, 97.5, filtered target, filtered median, filtered 2.5, filtered 97.5.
    // Anomalies are vs 1961–1990; rebase on the unfiltered median's 1850–1900 mean.
    const rows = dataLines(pages, "#")
      .slice(1)
      .map((r) => r.map((c) => num(c, ["NA"])));
    const base = mean(rows.filter((r) => r[0]! >= 1850 && r[0]! <= 1900 && r[2] != null).map((r) => r[2]!));
    if (base === null) throw new Error("PAGES 2k baseline missing");
    const common: PaleoTemperatureData["common"] = { median: [], band: [] };
    for (const r of rows) {
      const [year, , , , , , med, lo, hi] = r;
      if (year == null || med == null || lo == null || hi == null) continue;
      common.median.push([year, round(med - base, 3)]);
      common.band.push([year, round(lo - base, 3), round(hi - base, 3)]);
    }

    // Temp12k: ages (BP), global_5, global_median, global_95, … in 100-year bins.
    const holocene: PaleoTemperatureData["holocene"] = { median: [], band: [] };
    for (const r of parseCsvRecords(temp12k.replace(/, /g, ","))) {
      const age = num(r.ages);
      const med = num(r.global_median);
      const lo = num(r.global_5);
      const hi = num(r.global_95);
      if (age === null || med === null || lo === null || hi === null) continue;
      const t = fromBP(age);
      holocene.median.push([t, round(med, 3)]);
      holocene.band.push([t, round(lo, 3), round(hi, 3)]);
    }
    holocene.median.sort((a, b) => a[0] - b[0]);
    holocene.band.sort((a, b) => a[0] - b[0]);
    if (!common.median.length || !holocene.median.length) throw new Error("Temperature reconstructions empty");
    return { data: { common, holocene }, dataAsOf: String(common.median.at(-1)![0]) };
  },
});

export const berkeleyEarthSource = defineSource<BerkeleyEarthData>({
  meta: {
    id: "berkeleyEarth",
    name: "Global surface temperature (Berkeley Earth)",
    publisher: "Berkeley Earth",
    url: "https://berkeleyearth.org/data/",
    evidence: "observed",
    cadence: "annual summary, updated monthly",
    refreshMs: WEEK,
    lag: "~1 month after year end",
    licence: "CC BY-NC 4.0",
    note: "Land and ocean, air temperature over sea ice. Rebased from 1951–1980 to 1850–1900.",
  },
  async load() {
    const text = await fetchText("https://berkeley-earth-temperature.s3.us-west-1.amazonaws.com/Global/Land_and_Ocean_summary.txt");
    const raw: { year: number; v: number; unc: number }[] = [];
    for (const r of dataLines(text, "%")) {
      const year = num(r[0]);
      const v = num(r[1], ["NaN"]);
      const unc = num(r[2], ["NaN"]);
      if (year !== null && v !== null && unc !== null) raw.push({ year, v, unc });
    }
    const base = mean(raw.filter((r) => r.year <= 1900).map((r) => r.v));
    if (base === null) throw new Error("Berkeley Earth baseline missing");
    return {
      data: {
        annual: raw.map((r) => [r.year, round(r.v - base, 3)]),
        band: raw.map((r) => [r.year, round(r.v - base - r.unc, 3), round(r.v - base + r.unc, 3)]),
      },
      dataAsOf: String(raw.at(-1)!.year),
    };
  },
});

export const seaLevelLongSource = defineSource<SeaLevelLongData>({
  meta: {
    id: "seaLevelLong",
    name: "Global sea level from tide gauges, since 1880",
    publisher: "Church & White (2011); University of Hawaii Sea Level Center, via Our World in Data",
    url: "https://ourworldindata.org/grapher/sea-level",
    evidence: "observed",
    cadence: "irregular",
    refreshMs: 4 * WEEK,
    licence: "CC BY 4.0",
    note: "Rebased so that 1993 averages zero, matching the satellite record.",
  },
  async load() {
    const rows = parseCsvRecords(
      await fetchText("https://ourworldindata.org/grapher/sea-level.csv?v=1&csvType=full&useColumnShortNames=true"),
    );
    const cw: Point[] = [];
    const uh: Point[] = [];
    for (const r of rows) {
      if (r.entity !== "World") continue;
      const m = r.quarter?.match(/^(\d{4})-Q([1-4])$/);
      if (!m) continue;
      const t = Number(m[1]) + (Number(m[2]) - 1) / 4 + 0.125;
      const a = num(r.sea_level_church_and_white_2011);
      const b = num(r.sea_level_uhslc);
      if (a !== null) cw.push([t, a]);
      if (b !== null) uh.push([t, b]);
    }
    const rebase = (pts: Point[]): Point[] => {
      const base = mean(pts.filter(([t]) => t >= 1993 && t < 1994).map(([, v]) => v));
      return base === null ? [] : pts.map(([t, v]) => [t, round(v - base, 1)]);
    };
    const churchWhite = rebase(cw);
    const uhslc = rebase(uh);
    if (!churchWhite.length) throw new Error("Sea level reconstruction empty");
    return { data: { churchWhite, uhslc }, dataAsOf: String(Math.floor((uhslc.at(-1) ?? churchWhite.at(-1)!)[0])) };
  },
});

const ONI_SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"];

/** NOAA's definition: five or more consecutive overlapping seasons at or beyond ±0.5 °C. */
export function ensoEpisodes(oni: Point[]): EnsoEpisode[] {
  const out: EnsoEpisode[] = [];
  let run: Point[] = [];
  let phase: EnsoEpisode["phase"] | null = null;
  const flush = () => {
    if (phase && run.length >= 5) {
      const peak = phase === "elNino" ? Math.max(...run.map((p) => p[1])) : Math.min(...run.map((p) => p[1]));
      out.push({ phase, start: round(run[0]![0] - 1 / 24, 3), end: round(run.at(-1)![0] + 1 / 24, 3), peak });
    }
    run = [];
    phase = null;
  };
  for (const p of oni) {
    const ph = p[1] >= 0.5 ? "elNino" : p[1] <= -0.5 ? "laNina" : null;
    if (ph !== phase) flush();
    if (ph) {
      phase = ph;
      run.push(p);
    }
  }
  flush();
  return out;
}

export const ensoSource = defineSource<EnsoData>({
  meta: {
    id: "enso",
    name: "El Niño / La Niña (Oceanic Niño Index)",
    publisher: "NOAA Climate Prediction Center",
    url: "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php",
    evidence: "observed",
    cadence: "monthly",
    refreshMs: DAY,
    lag: "~1 week after month end",
    licence: "Public domain (US Government)",
    note: "Episodes: five or more overlapping 3-month seasons at or beyond ±0.5 °C.",
  },
  async load() {
    const text = await fetchText("https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt");
    const oni: Point[] = [];
    for (const r of dataLines(text, "#")) {
      const season = ONI_SEASONS.indexOf(r[0] ?? "");
      const year = num(r[1]);
      const anom = num(r[3]);
      if (season < 0 || year === null || anom === null) continue;
      oni.push([round(year + (season + 0.5) / 12, 3), anom]);
    }
    if (!oni.length) throw new Error("ONI empty");
    return { data: { oni, episodes: ensoEpisodes(oni) }, dataAsOf: String(oni.at(-1)![0]) };
  },
});

interface HazelVolcano {
  year: number;
  month?: number;
  day?: number;
  name: string;
  country: string;
  vei?: number;
}

export const volcanoesSource = defineSource<VolcanoesData>({
  meta: {
    id: "volcanoes",
    name: "Large volcanic eruptions since 1800 (VEI ≥ 5)",
    publisher: "NOAA NCEI Significant Volcanic Eruptions Database",
    url: "https://www.ngdc.noaa.gov/hazel/view/hazards/volcano/event-search",
    evidence: "observed",
    cadence: "as eruptions happen",
    refreshMs: 4 * WEEK,
    licence: "Public domain (US Government)",
    note: "Eruptions large enough to put sulphate into the stratosphere can cool the planet for a year or two.",
  },
  async load() {
    const res = await fetchJson<{ items: HazelVolcano[] }>(
      "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/volcanoes?minVei=5&minYear=1800",
    );
    const seen = new Set<string>();
    const eruptions: Volcano[] = [];
    for (const v of res.items) {
      if (!v.vei || v.vei < 5) continue;
      const key = `${v.name}-${v.year}`;
      if (seen.has(key)) continue; // the database lists one row per effect (tsunami, deaths…)
      seen.add(key);
      eruptions.push({
        t: round(ymdToDecimalYear(v.year, v.month ?? 7, v.day ?? 1), 3),
        name: v.name.replace(/^(.+), (.+)$/, "$2 $1"), // "Chichon, El" → "El Chichon"
        country: v.country,
        vei: v.vei,
      });
    }
    eruptions.sort((a, b) => a.t - b.t);
    return { data: { eruptions }, dataAsOf: eruptions.length ? String(Math.floor(eruptions.at(-1)!.t)) : null };
  },
});
