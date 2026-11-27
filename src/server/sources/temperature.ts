import type { Era5DailyData, GistempData, Point, TemperatureData } from "@shared/types.ts";
import { DAY, HOUR, dayOfYear, isoDate, ymdToDecimalYear } from "@shared/time.ts";
import { num, parseCsv, parseCsvRecords } from "../lib/csv.ts";
import { fetchJson, fetchText } from "../lib/http.ts";
import { mean, round } from "../lib/stats.ts";
import { defineSource } from "./types.ts";

const HADCRUT_URL =
  "https://www.metoffice.gov.uk/hadobs/hadcrut5/data/HadCRUT.5.1.0.0/analysis/diagnostics/HadCRUT.5.1.0.0.analysis.summary_series.global.monthly.csv";

/**
 * HadCRUT5 monthly global anomalies, rebased from 1961–1990 to the IPCC's
 * 1850–1900 pre-industrial baseline. Drives the warming stripes.
 */
export const temperatureSource = defineSource<TemperatureData>({
  meta: {
    id: "temperature",
    name: "Global surface temperature (HadCRUT5)",
    publisher: "Met Office Hadley Centre & UEA Climatic Research Unit",
    url: "https://www.metoffice.gov.uk/hadobs/hadcrut5/",
    evidence: "observed",
    cadence: "monthly",
    refreshMs: DAY,
    lag: "1–3 months",
    licence: "Open Government Licence",
    note: "Anomalies rebased to the 1850–1900 average.",
  },
  async load() {
    const rows = parseCsvRecords(await fetchText(HADCRUT_URL));
    const raw: { year: number; month: number; v: number }[] = [];
    for (const r of rows) {
      const [y, m] = (r["Time"] ?? "").split("-").map(Number);
      const v = num(r["Anomaly (deg C)"]);
      if (y && m && v !== null) raw.push({ year: y, month: m, v });
    }
    const base = mean(raw.filter((r) => r.year >= 1850 && r.year <= 1900).map((r) => r.v));
    if (base === null) throw new Error("HadCRUT baseline period missing");

    const monthly: Point[] = raw.map((r) => [ymdToDecimalYear(r.year, r.month), round(r.v - base, 3)]);
    const byYear = new Map<number, number[]>();
    for (const r of raw) byYear.set(r.year, [...(byYear.get(r.year) ?? []), r.v - base]);
    const annual: Point[] = [];
    for (const [year, vals] of byYear) if (vals.length === 12) annual.push([year, round(mean(vals)!, 3)]);

    const last = raw.at(-1)!;
    return {
      data: { annual, monthly, baseline: "1850–1900", latestCompleteYear: annual.at(-1)![0] },
      dataAsOf: `${last.year}-${String(last.month).padStart(2, "0")}`,
    };
  },
});

/**
 * NASA GISTEMP v4 is published faster than HadCRUT, so it supplies the headline
 * "latest month" figure. Rebased to 1880–1900, the earliest period GISTEMP covers.
 */
export const gistempSource = defineSource<GistempData>({
  meta: {
    id: "gistemp",
    name: "Global surface temperature (GISTEMP v4)",
    publisher: "NASA Goddard Institute for Space Studies",
    url: "https://data.giss.nasa.gov/gistemp/",
    evidence: "observed",
    cadence: "monthly",
    refreshMs: 12 * HOUR,
    lag: "~2 weeks",
    licence: "Public domain (US Government)",
    note: "Rebased from 1951–1980 to the 1880–1900 average.",
  },
  async load() {
    const text = await fetchText("https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv");
    const rows = parseCsv(text.split("\n").slice(1).join("\n")); // first line is a title
    const header = rows[0] ?? [];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIdx = months.map((m) => header.indexOf(m));
    const raw: { year: number; month: number; v: number }[] = [];
    for (const r of rows.slice(1)) {
      const year = num(r[0]);
      if (year === null) continue;
      monthIdx.forEach((idx, m) => {
        const v = num(r[idx], ["***", "****"]);
        if (v !== null) raw.push({ year, month: m + 1, v });
      });
    }
    const base = mean(raw.filter((r) => r.year <= 1900).map((r) => r.v));
    if (base === null) throw new Error("GISTEMP baseline missing");
    const monthly: Point[] = raw.map((r) => [ymdToDecimalYear(r.year, r.month), round(r.v - base, 3)]);
    const last = raw.at(-1)!;
    const date = `${last.year}-${String(last.month).padStart(2, "0")}`;
    return {
      data: {
        monthly,
        latest: { t: monthly.at(-1)![0], date, anomaly: round(last.v - base, 2) },
        baseline: "1880–1900",
      },
      dataAsOf: date,
    };
  },
});

interface ReanalyzerSeries {
  name: string;
  data: (number | null)[];
}

/** ERA5 daily global mean 2 m air temperature via Climate Reanalyzer. */
export const era5DailySource = defineSource<Era5DailyData>({
  version: 2, // v2: every year since 1940, for the explorer
  meta: {
    id: "era5Daily",
    name: "Daily global air temperature (ERA5)",
    publisher: "Copernicus C3S, via Climate Reanalyzer (University of Maine)",
    url: "https://climatereanalyzer.org/clim/t2_daily/",
    evidence: "modelled",
    cadence: "daily",
    refreshMs: 6 * HOUR,
    lag: "~2 days",
    licence: "Copernicus licence (attribution)",
    note: "Reanalysis blends observations with a weather model.",
  },
  async load() {
    const series = await fetchJson<ReanalyzerSeries[]>(
      "https://climatereanalyzer.org/clim/t2_daily/json/era5_world_t2_day.json",
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; climate-dashboard/0.1)" } },
    );
    const years = series.filter((s) => /^\d{4}$/.test(s.name));
    const currentSeries = years.at(-1);
    const clim = series.find((s) => s.name === "1991-2020");
    if (!currentSeries || !clim) throw new Error("ERA5 series missing");
    const year = Number(currentSeries.name);

    // Warmest complete year by annual mean.
    let recordYear: Era5DailyData["recordYear"] = null;
    let best = -Infinity;
    for (const s of years) {
      if (Number(s.name) === year) continue;
      const vals = s.data.filter((v): v is number => v !== null);
      if (vals.length < 365) continue;
      const m = mean(vals)!;
      if (m > best) {
        best = m;
        recordYear = { year: Number(s.name), values: s.data };
      }
    }

    let lastIdx = -1;
    currentSeries.data.forEach((v, i) => {
      if (v !== null) lastIdx = i;
    });
    if (lastIdx < 0) throw new Error("ERA5 current year empty");
    const tempC = currentSeries.data[lastIdx]!;
    const climatology = clim.data.map((v) => v ?? Number.NaN);
    const date = new Date(Date.UTC(year, 0, lastIdx + 1));
    return {
      data: {
        year,
        current: currentSeries.data,
        climatology,
        recordYear,
        years: years.map((s) => ({ year: Number(s.name), values: s.data })),
        latest: {
          date: isoDate(date),
          dayOfYear: dayOfYear(date),
          tempC,
          anomaly: round(tempC - (climatology[lastIdx] ?? tempC), 2),
        },
      },
      dataAsOf: isoDate(date),
    };
  },
});
