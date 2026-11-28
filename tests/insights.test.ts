import { describe, expect, test } from "bun:test";
import type { IgccData, Point, RichText, VitalStory } from "../src/shared/types.ts";
import { daysInYear, ymdToDecimalYear } from "../src/shared/time.ts";
import { round } from "../src/server/lib/stats.ts";
import {
  carbonBudgetStory,
  co2Story,
  completeYearMeans,
  dayKey,
  era5Story,
  extremesAreRecent,
  monthYear,
  oceanHeatStory,
  ordinal,
  rankOf,
  risingSince,
  seaIceStory,
  seaLevelStory,
  simpleRatio,
  temperatureStory,
} from "../src/server/views/insights.ts";
import { IPCC } from "../src/server/views/citations.ts";

const text = (r: RichText) => r.map((p) => (typeof p === "string" ? p : p.em)).join("");
const emphasised = (r: RichText) => r.flatMap((p) => (typeof p === "string" ? [] : [p.em]));
const monthly = (from: number, years: number, f: (t: number) => number): Point[] =>
  Array.from({ length: years * 12 }, (_, i) => {
    const t = from + (i + 0.5) / 12;
    return [round(t, 4), f(t)];
  });
const annual = (from: number, to: number, f: (y: number) => number): Point[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, f(from + i)]);
/** One value per day, stamped at noon (ERA5) or midnight (NSIDC), rounded like the sources. */
const daily = (from: number, to: number, f: (year: number, day: number) => number, stamp: "noon" | "midnight"): Point[] => {
  const out: Point[] = [];
  for (let y = from; y <= to; y++) {
    const n = daysInYear(y);
    for (let d = 0; d < n; d++) out.push([round(y + (d + (stamp === "noon" ? 0.5 : 0)) / n, 4), f(y, d)]);
  }
  return out;
};

describe("insight helpers", () => {
  test("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });

  test("rank counts strictly better values, so ties share a rank", () => {
    expect(rankOf([3, 5, 5, 1], 5)).toBe(1);
    expect(rankOf([3, 5, 5, 1], 3)).toBe(3);
    expect(rankOf([3, 5, 5, 1], 3, "asc")).toBe(2);
  });

  test("dates survive four-decimal rounding at midnight and at noon", () => {
    for (const [y, m, d] of [[2026, 11, 25], [2024, 1, 1], [2024, 12, 31], [2023, 3, 1], [2024, 2, 29]] as const) {
      const midnight = round(ymdToDecimalYear(y, m, d) - 1 / (daysInYear(y) * 24 * 4), 4); // a quarter-hour early
      const noon = round(ymdToDecimalYear(y, m, d) + 0.5 / daysInYear(y), 4);
      const key = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      expect(dayKey(midnight)).toBe(key);
      expect(dayKey(noon)).toBe(key);
    }
  });

  test("month labels read the month the point sits in", () => {
    expect(monthYear(2026.7917)).toBe("October 2026");
    expect(monthYear(2026.0417)).toBe("January 2026");
  });

  test("complete-year means skip partial years", () => {
    const pts = monthly(2000, 2, (t) => (t < 2001 ? 1 : 3)).slice(0, 20);
    expect(completeYearMeans(pts, 12)).toEqual([[2000, 1]]);
  });

  test("rising run is found from the end", () => {
    expect(risingSince(annual(2000, 2010, (y) => y))).toBe(2000);
    expect(risingSince([[2000, 1], [2001, 5], [2002, 2], [2003, 3], [2004, 4]])).toBe(2002);
    expect(risingSince([[2000, 2], [2001, 1]])).toBeNull();
    expect(risingSince([[2000, 1], [2002, 2], [2003, 3]])).toBe(2002); // a missing year breaks the run
  });

  test("extremes counted only while they are the most recent years, never the whole record", () => {
    const declining = annual(1980, 2019, (y) => 2020 - y); // every year lower than the last
    expect(extremesAreRecent(declining, "asc")).toBe(20);
    const blip: Point[] = declining.map(([y, v]) => [y, y === 2015 ? 100 : v]); // 2015 was high
    expect(extremesAreRecent(blip, "asc")).toBe(4); // 2016–2019 are the 4 lowest; the 5 lowest include 2014, not 2015
    expect(extremesAreRecent(annual(1980, 2019, (y) => y), "asc")).toBe(0);
  });
});

describe("stories", () => {
  test("CO₂: share above pre-industrial, rising streak and the 800,000-year claim", () => {
    const mlo = monthly(1958, 68, (t) => 315 + 1.6 * (t - 1958));
    const ice: Point[] = [[-803_000, 200], [-330_000, 299], [1000, 280], [1750, 278], [1790, 278], [1900, 296]];
    const s = co2Story(mlo, ice)!;
    expect(text(s.headline)).toContain("higher than at any time in the last 800,000 years");
    const latest12 = 315 + 1.6 * (2025.5 + 0.5 / 12 - 1958); // centre of the last 12 months
    expect(emphasised(s.headline)[0]).toBe(`${Math.round((latest12 / 278 - 1) * 100)}% higher`);
    expect(s.facts.some((f) => text(f.text).includes("every single year"))).toBe(true);
    expect(s.facts.every((f) => f.basis.length > 0)).toBe(true);
  });

  test("CO₂ without ice cores still has a headline, but no deep-time claim", () => {
    const s = co2Story(monthly(1958, 68, (t) => 315 + (t - 1958)), null)!;
    expect(text(s.headline)).toStartWith("CO₂ averaged");
    expect(text(s.headline)).not.toContain("800,000");
  });

  test("temperature: a record year leads the headline", () => {
    const years = annual(1850, 2025, (y) => (y < 1950 ? 0 : (y - 1950) * 0.02));
    expect(text(temperatureStory(years, [])!.headline)).toStartWith("2025 was the warmest year on record");
    const cooler: Point[] = years.map(([y, v]) => [y, y === 2025 ? 1.2 : v]);
    const s = temperatureStory(cooler, [])!;
    expect(text(s.headline)).toStartWith("Over the last ten years");
    expect(text(s.facts[0]!.text)).toContain("2025 was the 15th warmest");
  });

  test("ERA5: same-date record and year-to-date rank", () => {
    // Each year a little warmer than the last; the final year stops on 25 November.
    const pts = daily(1990, 2026, (y, d) => 14 + (y - 1990) * 0.01 + Math.sin((d / 365) * 2 * Math.PI), "noon").filter(
      ([t]) => t < ymdToDecimalYear(2026, 11, 26),
    );
    const clim: Point[] = daily(2026, 2026, (_, d) => 14.2 + Math.sin((d / 365) * 2 * Math.PI), "noon");
    const s = era5Story(pts, clim)!;
    expect(text(s.headline)).toStartWith("On 25 November the world was");
    expect(text(s.headline)).toContain("the warmest on record");
    expect(text(s.facts[0]!.text)).toContain("2026 has been the warmest such period since 1990");
  });

  test("sea ice: rank for the date, and the streak of recent lows", () => {
    const arctic = daily(1979, 2026, (y, d) => 12 - (y - 1979) * 0.05 + 3 * Math.cos((d / 365) * 2 * Math.PI), "midnight").filter(
      ([t]) => t < ymdToDecimalYear(2026, 11, 25) + 0.001,
    );
    const minima = annual(1979, 2025, (y) => 7 - (y - 1979) * 0.08);
    const s = seaIceStory(arctic, minima, 6.2, arctic)!;
    expect(text(s.headline)).toBe("Arctic sea ice is the lowest on record for 25 November, in 48 years of satellite data.");
    expect(s.facts.some((f) => text(f.text) === "The 23 lowest minima have all been in the last 23 years.")).toBe(true);
  });

  test("sea level: acceleration is only claimed when the recent rate is higher", () => {
    const accel = monthly(1993, 32, (t) => 2.5 * (t - 1993) + 0.04 * (t - 1993) ** 2);
    const tg = annual(1880, 2009, (y) => -200 + 1.5 * (y - 1880));
    expect(text(seaLevelStory(accel, tg, 2025.2)!.headline)).toContain("speeding up");
    const slowing = monthly(1993, 32, (t) => 4 * (t - 1993) - 0.04 * (t - 1993) ** 2);
    const s = seaLevelStory(slowing, tg, 2025.2)!;
    expect(text(s.headline)).not.toContain("speeding up");
    expect(s.facts.some((f) => text(f.text).includes("down from"))).toBe(true);
    expect(s.facts.some((f) => text(f.text).includes("currently ends"))).toBe(false); // not stale yet
    expect(seaLevelStory(slowing, tg, 2026.9)!.facts.some((f) => text(f.text).includes("currently ends"))).toBe(true);
  });

  test("ocean heat: records in the last ten years", () => {
    const s = oceanHeatStory(annual(1957, 2025, (y) => (y === 2020 ? 1000 : y - 1957)))!;
    expect(text(s.headline)).toBe("Ocean heat in 2025 was the 2nd highest on record.");
    // 2016–2020 each beat every earlier year; nothing after 2020 beats it.
    expect(s.facts.some((f) => text(f.text) === "5 of the last 10 years set a new record.")).toBe(true);
  });

  test("carbon budget: countdown, and past tense once it is spent", () => {
    const igcc: IgccData = {
      edition: "IGCC-test",
      budget: { targetC: 1.5, likelihood: 0.5, gtCO2: 100, rangeGtCO2: [50, 150], fromYear: 2025 },
      co2Emissions: { year: 2024, gt: 40 },
      warmingBySpecies: [],
    };
    const cumulative = annual(1851, 2025, (y) => (y - 1850) * 10);
    expect(text(carbonBudgetStory(cumulative, igcc, 2025.5)!.headline)).toBe(
      "At today’s emissions the carbon budget for 1.5 °C runs out in about 2 years, in mid 2027.",
    );
    expect(text(carbonBudgetStory(cumulative, igcc, 2028)!.headline)).toBe("At today’s emissions the carbon budget for 1.5 °C ran out in mid 2027.");
  });

  test("builders decline thin input instead of guessing", () => {
    expect(co2Story(monthly(2020, 2, () => 400), null)).toBeNull();
    expect(temperatureStory(annual(2000, 2020, () => 1), [])).toBeNull();
    expect(oceanHeatStory(annual(2000, 2020, (y) => y))).toBeNull();
  });
});

describe("context notes", () => {
  const igcc: IgccData = {
    edition: "IGCC-test",
    budget: { targetC: 1.5, likelihood: 0.5, gtCO2: 100, rangeGtCO2: [50, 150], fromYear: 2025 },
    co2Emissions: { year: 2024, gt: 40 },
    warmingBySpecies: [
      { compound: "CO2", p5: 0.8, p50: 1.1, p95: 1.5 },
      { compound: "CH4", p5: 0.4, p50: 0.56, p95: 0.8 },
    ],
  };
  const ice: Point[] = [[-803_000, 200], [-330_000, 299], ...annual(1000, 1749, () => 279), [1750, 278], [1790, 278], [1900, 296]];
  const mlo = monthly(1958, 68, (t) => 315 + 1.6 * (t - 1958));
  const arctic = daily(1979, 2026, (y, d) => 12 - (y - 1979) * 0.05 + 3 * Math.cos((d / 365) * 2 * Math.PI), "midnight").filter(
    ([t]) => t < ymdToDecimalYear(2026, 11, 25) + 0.001,
  );
  const era5 = daily(1990, 2026, (y, d) => 14 + (y - 1990) * 0.01 + Math.sin((d / 365) * 2 * Math.PI), "noon").filter(
    ([t]) => t < ymdToDecimalYear(2026, 11, 26),
  );
  const stories: [string, VitalStory | null][] = [
    ["co2", co2Story(mlo, ice, igcc)],
    ["temperature", temperatureStory(annual(1850, 2025, (y) => (y < 1900 ? ((y % 3) - 1) * 0.1 : (y - 1900) * 0.012)), monthly(2024, 2, () => 1.4))],
    ["era5", era5Story(era5, daily(2026, 2026, (_, d) => 14.2 + Math.sin((d / 365) * 2 * Math.PI), "noon"))],
    ["seaIce", seaIceStory(arctic, annual(1979, 2025, (y) => 7 - (y - 1979) * 0.08), 6.2, arctic)],
    ["seaLevel", seaLevelStory(monthly(1993, 32, (t) => 2.5 * (t - 1993) + 0.04 * (t - 1993) ** 2), annual(1880, 2009, (y) => -200 + 1.5 * (y - 1880)), 2025.2)],
    ["oceanHeat", oceanHeatStory(annual(1957, 2025, (y) => y - 1957))],
    ["carbonBudget", carbonBudgetStory(annual(1851, 2025, (y) => (y - 1850) * 10), igcc, 2025.5)],
  ];
  const numbers = (s: string) => (s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

  for (const [id, s] of stories)
    test(`${id}: every note a figure or fact points to exists, and every line says where it comes from`, () => {
      expect(s).not.toBeNull();
      const ids = new Set(s!.notes.map((n) => n.id));
      const refs = [
        ...s!.headline.flatMap((p) => (typeof p !== "string" && p.note ? [p.note] : [])),
        ...s!.facts.flatMap((f) => (f.note ? [f.note] : [])),
      ];
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(ids.has(r)).toBe(true);
      for (const n of s!.notes)
        for (const line of [...n.meaning, ...n.matters, ...n.howWeKnow]) expect(!!line.basis !== !!line.cite).toBe(true);
    });

  test("a cited line only uses numbers its quote contains", () => {
    for (const [id, s] of stories)
      for (const n of s!.notes)
        for (const line of [...n.meaning, ...n.matters, ...n.howWeKnow]) {
          if (!line.cite) continue;
          const quoted = new Set(numbers(line.cite.quote));
          const missing = numbers(text(line.text)).filter((x) => !quoted.has(x));
          expect({ id, note: n.id, missing }).toEqual({ id, note: n.id, missing: [] });
        }
  });

  test("citations point at a page of the report and carry a quote", () => {
    for (const c of Object.values(IPCC)) {
      expect(c.url).toMatch(/IPCC_AR6_WGI_SPM\.pdf#page=\d+$/);
      expect(c.quote.length).toBeGreaterThan(40);
      expect(c.quote).not.toMatch(/[a-z]\d{1,2} /); // no footnote markers glued to words
    }
  });

  test("simple ratios", () => {
    expect(simpleRatio(1.54)).toEqual([3, 2]);
    expect(simpleRatio(2.02)).toEqual([4, 2]);
    expect(simpleRatio(1.13)).toBeNull();
  });

  test("CO₂: 'more than any other emission' only when CO₂ leads the warming", () => {
    const lines = (s: VitalStory | null) => s!.notes.flatMap((n) => n.matters.map((l) => text(l.text)));
    expect(lines(co2Story(mlo, ice, igcc)).some((l) => l.includes("more than any other emission"))).toBe(true);
    const methaneFirst: IgccData = { ...igcc, warmingBySpecies: [{ compound: "CO2", p5: 0.8, p50: 1.1, p95: 1.5 }, { compound: "CH4", p5: 1, p50: 1.2, p95: 1.4 }] };
    const l = lines(co2Story(mlo, ice, methaneFirst));
    expect(l.some((x) => x.startsWith("The CO₂ people have added"))).toBe(true);
    expect(l.some((x) => x.includes("more than any other emission"))).toBe(false);
    expect(lines(co2Story(mlo, ice, null)).some((x) => x.startsWith("The CO₂ people have added"))).toBe(false);
  });

  test("sea level: the acceleration note only exists when the rise is speeding up", () => {
    const tg = annual(1880, 2009, (y) => -200 + 1.5 * (y - 1880));
    const slowing = seaLevelStory(monthly(1993, 32, (t) => 4 * (t - 1993) - 0.04 * (t - 1993) ** 2), tg, 2025.2)!;
    expect(slowing.notes.some((n) => n.id === "faster")).toBe(false);
    expect(seaLevelStory(monthly(1993, 32, (t) => 2.5 * (t - 1993) + 0.04 * (t - 1993) ** 2), tg, 2025.2)!.notes.some((n) => n.id === "faster")).toBe(true);
  });
});
