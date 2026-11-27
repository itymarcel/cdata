import type { OceanHeatData, Point, SeaIceData, SeaIceHemisphere, SeaLevelData } from "@shared/types.ts";
import { DAY, HOUR, WEEK, dayOfYear, isoDate, ymdToDecimalYear } from "@shared/time.ts";
import { num, parseCsv, parseCsvRecords } from "../lib/csv.ts";
import { fetchText } from "../lib/http.ts";
import { mean, round } from "../lib/stats.ts";
import { defineSource } from "./types.ts";

const NSIDC = "https://noaadata.apps.nsidc.org/NOAA/G02135";

async function loadHemisphere(hemi: "north" | "south"): Promise<SeaIceHemisphere> {
  const p = hemi === "north" ? "N" : "S";
  const [dailyCsv, climCsv] = await Promise.all([
    fetchText(`${NSIDC}/${hemi}/daily/data/${p}_seaice_extent_daily_v4.0.csv`),
    fetchText(`${NSIDC}/${hemi}/daily/data/${p}_seaice_extent_climatology_1981-2010_v4.0.csv`),
  ]);

  // Climatology: first line is a note, second the header; DOY → average extent.
  const climatology = new Map<number, number>();
  for (const r of parseCsv(climCsv.split("\n").slice(2).join("\n"))) {
    const doy = num(r[0]);
    const avg = num(r[1]);
    if (doy !== null && avg !== null) climatology.set(doy, avg);
  }

  // Daily: two header lines, then Year, Month, Day, Extent, Missing, Source.
  const days: { date: Date; t: number; extent: number }[] = [];
  for (const r of parseCsv(dailyCsv.split("\n").slice(2).join("\n"))) {
    const y = num(r[0]);
    const m = num(r[1]);
    const d = num(r[2]);
    const extent = num(r[3], ["-9999"]);
    if (y === null || m === null || d === null || extent === null || extent <= 0) continue;
    days.push({ date: new Date(Date.UTC(y, m - 1, d)), t: ymdToDecimalYear(y, m, d), extent });
  }
  const last = days.at(-1);
  if (!last) throw new Error(`Sea ice ${hemi} empty`);

  const minByYear = new Map<number, number>();
  const maxByYear = new Map<number, number>();
  const countByYear = new Map<number, number>();
  for (const d of days) {
    const y = d.date.getUTCFullYear();
    minByYear.set(y, Math.min(minByYear.get(y) ?? Infinity, d.extent));
    maxByYear.set(y, Math.max(maxByYear.get(y) ?? -Infinity, d.extent));
    countByYear.set(y, (countByYear.get(y) ?? 0) + 1);
  }
  // Only years with (near-)complete daily coverage: 1979 onwards were every-other-day until 1987.
  const complete = (y: number) => (countByYear.get(y) ?? 0) >= 150 && y < last.date.getUTCFullYear();
  const clim = climatology.get(dayOfYear(last.date)) ?? Number.NaN;

  return {
    latest: {
      date: isoDate(last.date),
      extent: last.extent,
      climatology: clim,
      anomaly: round(last.extent - clim, 3),
    },
    last365: days.filter((d) => d.t >= last.t - 1).map((d) => [d.t, d.extent] as Point),
    daily: days.map((d) => [round(d.t, 4), d.extent] as Point),
    annualMinimum: [...minByYear].filter(([y]) => complete(y)).map(([y, v]) => [y, v] as Point),
    annualMaximum: [...maxByYear].filter(([y]) => complete(y)).map(([y, v]) => [y, v] as Point),
  };
}

export const seaIceSource = defineSource<SeaIceData>({
  version: 2, // v2: full daily record
  meta: {
    id: "seaIce",
    name: "Sea Ice Index (daily extent)",
    publisher: "National Snow and Ice Data Center (NSIDC)",
    url: "https://nsidc.org/data/g02135",
    evidence: "observed",
    cadence: "daily",
    refreshMs: 6 * HOUR,
    lag: "1–2 days",
    licence: "Public domain (NOAA/NSIDC)",
    note: "Anomaly vs the 1981–2010 average for the same day of year.",
  },
  async load() {
    const [north, south] = await Promise.all([loadHemisphere("north"), loadHemisphere("south")]);
    return { data: { north, south }, dataAsOf: north.latest.date };
  },
});

export const seaLevelSource = defineSource<SeaLevelData>({
  meta: {
    id: "seaLevel",
    name: "Global mean sea level (satellite altimetry)",
    publisher: "NOAA Laboratory for Satellite Altimetry",
    url: "https://www.star.nesdis.noaa.gov/socd/lsa/SeaLevelRise/",
    evidence: "observed",
    cadence: "~monthly, irregular",
    refreshMs: DAY,
    lag: "can lag by a year or more",
    licence: "Public domain (credit NOAA LSA)",
    note: "Seasonal signal removed; no glacial isostatic adjustment. Change shown relative to 1993.",
  },
  async load() {
    const text = await fetchText(
      "https://www.star.nesdis.noaa.gov/socd/lsa/SeaLevelRise/slr/slr_sla_gbl_free_ref_90.csv",
    );
    const trendMatch = text.match(/#trend = ([\d.]+) mm\/year/);
    const raw: Point[] = [];
    for (const r of parseCsv(text.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("year")).join("\n"))) {
      const t = num(r[0]);
      // One column per satellite mission; each row has a value in exactly one.
      const v = r.slice(1).map((c) => num(c)).find((x) => x !== null) ?? null;
      if (t !== null && v !== null) raw.push([t, v]);
    }
    if (raw.length === 0) throw new Error("Sea level empty");
    const base = mean(raw.filter(([t]) => t < 1994).map(([, v]) => v)) ?? 0;
    const series: Point[] = raw.map(([t, v]) => [round(t, 4), round(v - base, 2)]);
    // Smooth the headline over the last ~2 months of passes to avoid 10-day noise.
    const tail = series.slice(-6).map(([, v]) => v);
    const last = series.at(-1)!;
    return {
      data: {
        series,
        latest: { t: last[0], mm: round(mean(tail)!, 1) },
        trendMmPerYear: trendMatch ? Number(trendMatch[1]) : null,
      },
      dataAsOf: isoDate(new Date(Date.UTC(Math.floor(last[0]), 0, 1 + Math.round((last[0] % 1) * 365)))),
    };
  },
});

export const oceanHeatSource = defineSource<OceanHeatData>({
  version: 2, // v2: MRI series alongside NOAA
  meta: {
    id: "oceanHeat",
    name: "Ocean heat content, 0–2000 m",
    publisher: "NOAA NCEI, via Our World in Data",
    url: "https://ourworldindata.org/grapher/ocean-heat-top-2000m",
    evidence: "observed",
    cadence: "annual",
    refreshMs: WEEK,
    lag: "~3 months after year end",
    licence: "CC BY 4.0",
    note: "Heat content anomaly in 10²² joules, NOAA NCEI series.",
  },
  async load() {
    const rows = parseCsvRecords(
      await fetchText(
        "https://ourworldindata.org/grapher/ocean-heat-top-2000m.csv?v=1&csvType=full&useColumnShortNames=true",
      ),
    );
    const annual: Point[] = [];
    const mri: Point[] = [];
    for (const r of rows) {
      if (r["entity"] !== "World") continue;
      const year = num(r["year"]);
      if (year === null) continue;
      const v = num(r["ocean_heat_content_noaa_2000m"]);
      const m = num(r["ocean_heat_content_mri_2000m"]);
      if (v !== null) annual.push([year, v]);
      if (m !== null) mri.push([year, m]);
    }
    const last = annual.at(-1);
    if (!last) throw new Error("Ocean heat empty");
    return { data: { annual, mri, latest: { year: last[0], value: last[1] } }, dataAsOf: String(last[0]) };
  },
});

