import type { Ch4Data, Co2Data, Point } from "@shared/types.ts";
import { DAY, HOUR, decimalYearToDate, isoDate, ymdToDecimalYear } from "@shared/time.ts";
import { num, parseCsv } from "../lib/csv.ts";
import { fetchText } from "../lib/http.ts";
import { defineSource } from "./types.ts";

/** NOAA files start with `#` comment lines, then a header row. */
function noaaRows(text: string): string[][] {
  const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  return parseCsv(lines.slice(1).join("\n"));
}

export const co2Source = defineSource<Co2Data>({
  meta: {
    id: "co2",
    name: "Atmospheric CO₂ at Mauna Loa",
    publisher: "NOAA Global Monitoring Laboratory",
    url: "https://gml.noaa.gov/ccgg/trends/",
    evidence: "observed",
    cadence: "daily (preliminary), monthly (reviewed)",
    refreshMs: 6 * HOUR,
    lag: "1–3 days",
    licence: "Public domain (US Government)",
  },
  async load() {
    const [dailyCsv, monthlyCsv] = await Promise.all([
      fetchText("https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv"),
      fetchText("https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv"),
    ]);

    // monthly: year,month,decimal date,average,deseasonalized,...
    const monthly: Point[] = [];
    for (const r of noaaRows(monthlyCsv)) {
      const t = num(r[2]);
      const v = num(r[3], ["-99.99"]);
      if (t !== null && v !== null && v > 0) monthly.push([t, v]);
    }

    // daily: year,month,day,decimal,value (no header line in this file)
    const daily: Point[] = [];
    for (const line of dailyCsv.split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const r = line.split(",");
      const t = num(r[3]);
      const v = num(r[4]);
      if (t !== null && v !== null && v > 0) daily.push([t, v]);
    }

    const latestPoint = daily.at(-1) ?? monthly.at(-1);
    if (!latestPoint) throw new Error("CO₂ series empty");
    const [t, ppm] = latestPoint;

    // Daily values from roughly a year earlier (±10 days), averaged, for a fair YoY.
    const window = daily.filter(([dt]) => Math.abs(dt - (t - 1)) < 10 / 365);
    const yearAgo = window.length ? window.reduce((a, [, v]) => a + v, 0) / window.length : null;

    return {
      data: {
        monthly,
        daily: daily.filter(([dt]) => dt >= t - 3),
        latest: { t, date: isoDate(decimalYearToDate(t)), ppm },
        yearAgo,
      },
      dataAsOf: isoDate(decimalYearToDate(t)),
    };
  },
});

export const ch4Source = defineSource<Ch4Data>({
  meta: {
    id: "ch4",
    name: "Global atmospheric methane",
    publisher: "NOAA Global Monitoring Laboratory",
    url: "https://gml.noaa.gov/ccgg/trends_ch4/",
    evidence: "observed",
    cadence: "monthly",
    refreshMs: DAY,
    lag: "~4 months",
    licence: "Public domain (US Government)",
  },
  async load() {
    const text = await fetchText("https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.csv");
    const monthly: Point[] = [];
    let latest: Ch4Data["latest"] | null = null;
    for (const r of noaaRows(text)) {
      const year = num(r[0]);
      const month = num(r[1]);
      const v = num(r[3]);
      if (year === null || month === null || v === null || v <= 0) continue;
      const t = ymdToDecimalYear(year, month);
      monthly.push([t, v]);
      latest = { t, date: `${year}-${String(month).padStart(2, "0")}`, ppb: v };
    }
    if (!latest) throw new Error("CH₄ series empty");
    return { data: { monthly, latest }, dataAsOf: latest.date };
  },
});
