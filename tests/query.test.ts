import { describe, expect, test } from "bun:test";
import type { Point, RichText } from "../src/shared/types.ts";
import type { StatPoint } from "../src/shared/query.ts";
import { daysInYear } from "../src/shared/time.ts";
import { round } from "../src/server/lib/stats.ts";
import {
  MIN_POPULATION,
  type Named,
  comparisonSentence,
  compositionSentence,
  createQueryEngine,
  deltaUnit,
  relativeChange,
  inSpan,
  peakSentence,
  periodValues,
  rankSentences,
  rankTable,
  reportedYear,
  seriesSentences,
  seriesStats,
  thin,
  whenLabel,
  yearLabel,
} from "../src/server/views/query.ts";
import type { CountryTable } from "../src/server/views/catalog.ts";
import { coerceIntent, intentSchema } from "../src/shared/nl/model.ts";
import { catalog } from "./ask-parse.test.ts";

const text = (r: RichText) => r.map((p) => (typeof p === "string" ? p : p.em)).join("");
const annual = (from: number, to: number, f: (y: number) => number): Point[] => Array.from({ length: to - from + 1 }, (_, i) => [from + i, f(from + i)]);
const monthly = (from: number, to: number, f: (t: number) => number): Point[] => {
  const out: Point[] = [];
  for (let y = from; y <= to; y++) for (let m = 0; m < 12; m++) out.push([round(y + (m + 0.5) / 12, 4), f(y + m / 12)]);
  return out;
};
const named = (patch: Partial<Named> = {}): Named => ({ ref: "x", name: "CO₂ emissions in Germany", short: "CO₂ emissions", country: "Germany", unit: "Mt CO₂", decimals: 1, scale: "ratio", ...patch });
const sp = (t: number, v: number): StatPoint => ({ t, v, label: String(Math.floor(t)) });

describe("labels", () => {
  test("years, BCE and deep time", () => {
    expect(yearLabel(1850, 2026)).toBe("1850");
    expect(yearLabel(-9999, 2026)).toBe("10,000 BCE");
    expect(yearLabel(-797_974, 2026.9)).toBe("800,000 years ago");
  });
  test("dates as precise as the series", () => {
    expect(whenLabel(2012 + 0.5 / 12, "monthly", 2026)).toBe("Jan 2012");
    expect(whenLabel(2012.25, "quarterly", 2026)).toBe("Q2 2012");
    // NSIDC stamps midnight, ERA5 noon: both are 16 September 2012.
    const day = 259; // 0-based day of year
    expect(whenLabel(round(2012 + day / daysInYear(2012), 4), "daily", 2026)).toBe("16 Sep 2012");
    expect(whenLabel(round(2012 + (day + 0.5) / daysInYear(2012), 4), "daily", 2026)).toBe("16 Sep 2012");
  });
  test("a change carries the unit, not its baseline", () => {
    expect(deltaUnit("°C vs 1850–1900")).toBe("°C");
    expect(deltaUnit("% of electricity")).toBe("percentage points");
    expect(deltaUnit("°C (Niño 3.4 anomaly)")).toBe("°C");
  });
});

describe("inSpan", () => {
  test("is inclusive of whole calendar years", () => {
    const pts = monthly(1999, 2001, () => 1);
    const s = inSpan(pts, [2000, 2000]);
    expect(s.length).toBe(12);
    expect(Math.floor(s[0]![0])).toBe(2000);
    expect(Math.floor(s.at(-1)![0])).toBe(2000);
  });
});

describe("periodValues", () => {
  test("sub-annual series are read as complete calendar years", () => {
    const pts = monthly(2000, 2002, (t) => t).slice(0, -3); // 2002 stops in September
    const { values, averaged } = periodValues(pts, "monthly", 2026);
    expect(averaged).toBe(true);
    expect(values.map((v) => v.label)).toEqual(["2000", "2001"]);
  });
  test("the every-other-day early sea-ice record still counts as complete", () => {
    const pts: Point[] = [];
    for (let d = 0; d < 365; d += 2) pts.push([round(1980 + d / 366, 4), 10]);
    expect(periodValues(pts, "daily", 2026).values).toHaveLength(1);
  });
  test("annual series are used as they are", () => {
    expect(periodValues(annual(2000, 2002, () => 1), "annual", 2026)).toMatchObject({ averaged: false, values: [{ label: "2000" }, { label: "2001" }, { label: "2002" }] });
  });
});

describe("seriesStats", () => {
  test("start, end, change, percent, extremes and trend", () => {
    const s = seriesStats("x", annual(1990, 2020, (y) => 100 + (y - 1990)), "annual", "ratio", 2026, "Mt CO₂");
    expect(s.first).toMatchObject({ v: 100, label: "1990" });
    expect(s.last).toMatchObject({ v: 130, label: "2020" });
    expect(s.change).toBe(30);
    expect(s.percent).toBeCloseTo(30);
    expect(s.trendPerYear).toBeCloseTo(1);
    expect(s.max).toMatchObject({ v: 130 });
  });
  test("no percentage for anomalies or for shares", () => {
    expect(seriesStats("x", annual(1990, 2020, (y) => y - 1990), "annual", "interval", 2026, "°C vs 1850–1900").percent).toBeNull();
    expect(seriesStats("x", annual(1990, 2020, (y) => 10 + y - 1990), "annual", "ratio", 2026, "% of electricity").percent).toBeNull();
  });
  test("no yearly trend for reconstructions", () => {
    const pts: Point[] = Array.from({ length: 40 }, (_, i) => [-10_000 + i * 250, 200 + i]);
    expect(seriesStats("x", pts, "multiYear", "ratio", 2026).trendPerYear).toBeNull();
  });
  test("a single year gives a value but no change", () => {
    const s = seriesStats("x", monthly(2012, 2012, () => 10), "monthly", "ratio", 2026);
    expect(s.change).toBeNull();
    expect(s.averaged).toBe(true);
    expect(text(seriesSentences([named({ name: "Arctic sea ice", unit: "M km²", decimals: 2 })], [s])[0]!.text)).toBe("Arctic sea ice, 2012 average: 10.00 M km².");
  });
});

describe("series sentences", () => {
  test("rose / fell, with a percentage only where it means something", () => {
    const up = seriesStats("x", annual(1990, 2000, (y) => 100 + y - 1990), "annual", "ratio", 2026, "Mt CO₂");
    expect(text(seriesSentences([named()], [up])[0]!.text)).toBe("CO₂ emissions in Germany rose from 100.0 Mt CO₂ in 1990 to 110.0 Mt CO₂ in 2000 (+10%).");
    const t = seriesStats("x", annual(1990, 2000, (y) => 1 - (y - 1990) / 100), "annual", "interval", 2026, "°C vs 1850–1900");
    expect(text(seriesSentences([named({ name: "Global temperature", unit: "°C vs 1850–1900", scale: "interval", decimals: 2 })], [t])[0]!.text)).toBe(
      "Global temperature fell from 1.00 °C vs 1850–1900 in 1990 to 0.90 °C vs 1850–1900 in 2000 (−0.10 °C).",
    );
  });
  test("deep time reads 'years ago', not 'in … years ago'", () => {
    const s = seriesStats("x", [[-797_000, 200], [-500_000, 250], [2001, 368]], "multiYear", "ratio", 2026, "ppm");
    expect(text(seriesSentences([named({ name: "CO₂ (ice cores)", unit: "ppm" })], [s])[0]!.text)).toContain("200.0 ppm 799,026 years ago to 368.0 ppm in 2001");
  });
  test("unchanged when the change rounds to nothing", () => {
    const s = seriesStats("x", annual(1990, 2000, () => 5), "annual", "ratio", 2026);
    expect(text(seriesSentences([named()], [s])[0]!.text)).toContain("was unchanged at 5.0 Mt CO₂");
  });
});

describe("peakSentence", () => {
  const values = (vs: number[]) => vs.map((v, i) => sp(2000 + i, v));
  test("an interior peak well above the end", () => {
    const s = peakSentence(named(), values([100, 150, 120]));
    expect(s && text(s.text)).toBe("CO₂ emissions in Germany peaked at 150.0 Mt CO₂ in 2001; 2002 was 20% lower.");
  });
  test("must not appear when the latest value is the peak", () => {
    expect(peakSentence(named(), values([100, 120, 150]))).toBeNull();
  });
  test("must not appear when the end is within 5% of the peak", () => {
    expect(peakSentence(named(), values([100, 150, 146]))).toBeNull();
  });
  test("must not appear for anomalies", () => {
    expect(peakSentence(named({ scale: "interval" }), values([0.1, 0.9, 0.2]))).toBeNull();
  });
});

describe("comparisonSentence", () => {
  const a = named({ ref: "a", country: "China", name: "CO₂ emissions in China" });
  const b = named({ ref: "b", country: "Germany" });
  test("the ratio in the latest year both cover", () => {
    const s = comparisonSentence([a, b], [[sp(2022, 600), sp(2023, 640)], [sp(2022, 100), sp(2023, 100), sp(2024, 90)]]);
    expect(s && text(s.text)).toBe("In 2023, China’s CO₂ emissions were 6.4 times Germany’s.");
  });
  test("'about the same' below a 10% difference", () => {
    const s = comparisonSentence([a, b], [[sp(2023, 105)], [sp(2023, 100)]]);
    expect(s && text(s.text)).toContain("about the same as");
  });
  test("must not appear for anomalies, mixed units or no shared year", () => {
    expect(comparisonSentence([{ ...a, scale: "interval" }, { ...b, scale: "interval" }], [[sp(2023, 2)], [sp(2023, 1)]])).toBeNull();
    expect(comparisonSentence([a, { ...b, unit: "ppm" }], [[sp(2023, 2)], [sp(2023, 1)]])).toBeNull();
    expect(comparisonSentence([a, b], [[sp(2022, 2)], [sp(2023, 1)]])).toBeNull();
  });
});

describe("thin", () => {
  test("keeps every extreme and stays under the limit", () => {
    const pts: Point[] = Array.from({ length: 10_000 }, (_, i) => [i, Math.sin(i / 50) * 10 + (i === 4321 ? 100 : 0)]);
    const { points, thinned } = thin(pts, 1000);
    expect(thinned).toBe(true);
    expect(points.length).toBeLessThanOrEqual(1000);
    expect(Math.max(...points.map((p) => p[1]))).toBe(Math.max(...pts.map((p) => p[1])));
    expect(points.every((p, i) => i === 0 || p[0] > points[i - 1]![0])).toBe(true);
  });
});

describe("rankings", () => {
  const table: CountryTable = {
    years: [2010, 2011, 2012],
    countries: [
      { iso3: "WLD", name: "World" },
      { iso3: "EU27", name: "European Union (27)" },
      { iso3: "AAA", name: "Alpha" },
      { iso3: "BBB", name: "Beta" },
      { iso3: "CCC", name: "Gamma" },
      { iso3: "DDD", name: "Delta" },
    ],
    values: [
      [1000, 1100, 1200],
      [300, 290, 280],
      [100, 150, 300],
      [400, 350, 200],
      [50, 60, null],
      [10, 5, 20],
    ],
  };
  const opts = { by: "value" as const, order: "desc" as const, top: 10, from: null, to: null };

  test("leaves out aggregates and uses the last well-reported year", () => {
    const r = rankTable(table, opts)!;
    expect(r.year).toBe(2012);
    expect(r.rows.map((x) => x.iso3)).toEqual(["AAA", "BBB", "DDD"]);
  });
  test("falls back to an earlier year when too few countries report, and says so", () => {
    const sparse: CountryTable = { ...table, years: [2010, 2011, 2012, 2013], values: table.values.map((row, i) => [...row, i === 2 ? 1 : null]) };
    expect(reportedYear(sparse, null)).toBe(2012);
    const r = rankTable(sparse, { ...opts, to: 2013 })!;
    expect(r.notes.join(" ")).toContain("uses 2012");
  });
  test("change over a period, with a note when no start year was given", () => {
    const r = rankTable(table, { ...opts, by: "change", order: "asc", from: 2010 })!;
    expect(r.rows[0]).toMatchObject({ iso3: "BBB", value: -200, start: 400 });
    const d = rankTable({ ...table, years: [2002, 2011, 2012] }, { ...opts, by: "change" })!;
    expect(d.fromYear).toBe(2002);
    expect(d.notes.join(" ")).toContain("ten years");
  });
  test("per-person rankings leave out countries under a million people", () => {
    const pop = table.values.map((_, i) => [0, 0, i === 2 ? MIN_POPULATION - 1 : 5e7]);
    const r = rankTable({ ...table, population: pop }, opts)!;
    expect(r.rows.map((x) => x.iso3)).not.toContain("AAA");
    expect(r.basisParts.join(" ")).toContain("1,000,000 people");
  });
  test("sentences: the leader, and a world share only for additive totals", () => {
    const r = rankTable(table, opts)!;
    const m = { short: "CO₂ emissions", unit: "Mt CO₂", decimals: 0, scale: "ratio" as const };
    const s = rankSentences(m, r, opts).map((x) => text(x.text));
    expect(s[0]).toBe("Alpha had the highest in 2012: 300 Mt CO₂, ahead of Beta (200 Mt CO₂).");
    expect(s[1]).toBe("Together, these 3 countries account for 43% of the world total in 2012.");
    expect(rankSentences({ ...m, unit: "t CO₂ per person" }, r, opts)).toHaveLength(1);
    expect(rankSentences({ ...m, unit: "% of electricity" }, r, opts)).toHaveLength(1);
  });
  test("a decrease is called a decrease", () => {
    const o = { ...opts, by: "change" as const, order: "asc" as const, from: 2010 };
    const r = rankTable(table, o)!;
    expect(text(rankSentences({ short: "x", unit: "Mt CO₂", decimals: 0, scale: "ratio" }, r, o)[0]!.text)).toContain("had the largest decrease from 2010 to 2012");
  });
});

describe("model output", () => {
  test("the schema requires every field and closes the object", () => {
    const s = intentSchema(catalog) as { required: string[]; properties: Record<string, { items?: { enum?: string[] } }>; additionalProperties: boolean };
    expect(s.additionalProperties).toBe(false);
    expect(new Set(s.required)).toEqual(new Set(Object.keys(s.properties)));
    expect(s.properties.measures!.items!.enum).toEqual(catalog.measures.map((m) => m.id));
  });
  test("whatever comes back is coerced into a well-formed intent", () => {
    expect(coerceIntent("nonsense")).toMatchObject({ kind: "unsupported", reason: "unclear" });
    const i = coerceIntent({ kind: "rank", measures: ["emissions.co2", 4], countries: ["deu"], from: 1990.4, top: "ten", order: "sideways", dataset: "secrets" });
    expect(i).toMatchObject({ kind: "rank", measures: ["emissions.co2"], countries: ["DEU"], from: 1990, top: 10, order: "desc", dataset: null });
  });
});

describe("relativeChange", () => {
  test("a percentage, or 'N times as much' past tenfold", () => {
    expect(relativeChange(48, 100, 1)).toBe("+48%");
    expect(relativeChange(-4.25, 100, 1)).toBe("−4.3%");
    expect(relativeChange(1300, 10, 1)).toBe("14 times as much");
  });
  test("nothing when the start rounds to zero", () => {
    expect(relativeChange(5_744_773, 0.01, 1)).toBeNull();
    expect(relativeChange(null, 100, 1)).toBeNull();
  });
});

describe("compositionSentence", () => {
  const part = (short: string) => named({ ref: short, short, name: `${short} in Germany`, unit: "% of electricity" });
  test("the largest parts of the latest shared year", () => {
    const s = compositionSentence([part("Coal electricity"), part("Wind electricity"), part("Solar electricity")], [[sp(2024, 20)], [sp(2024, 30)], [sp(2024, 10)]]);
    expect(s && text(s.text)).toBe("In 2024, the largest part was wind electricity (50%), followed by coal electricity (33%).");
  });
  test("must not appear for mixed units or anomalies", () => {
    expect(compositionSentence([part("A"), { ...part("B"), unit: "Mt CO₂" }], [[sp(2024, 1)], [sp(2024, 2)]])).toBeNull();
    expect(compositionSentence([{ ...part("A"), scale: "interval" }, { ...part("B"), scale: "interval" }], [[sp(2024, 1)], [sp(2024, 2)]])).toBeNull();
  });
});

describe("engine: maps and top countries", () => {
  const years = Array.from({ length: 21 }, (_, i) => 2000 + i);
  const row = (f: (y: number) => number | null) => years.map(f);
  const table: CountryTable = {
    years,
    countries: [
      { iso3: "WLD", name: "World" },
      { iso3: "AAA", name: "Alpha" },
      { iso3: "BBB", name: "Beta" },
      { iso3: "CCC", name: "Gamma" },
      { iso3: "EU27", name: "European Union (27)" },
    ],
    values: [row((y) => 1000 + y - 2000), row((y) => 100 + 10 * (y - 2000)), row((y) => 400 - 2 * (y - 2000)), row((y) => (y < 2010 ? null : 50)), row(() => 300)],
  };
  const measure = { ...catalog.measures.find((m) => m.id === "emissions.co2")!, countries: ["WLD", "AAA", "BBB", "CCC", "EU27"] };
  const registry = {
    get: async () => ({
      catalog: { ...catalog, measures: [measure], countries: table.countries.map((c) => ({ ...c, names: [] })) },
      loaded: new Map([["emissions.co2", { evidence: "reported" as const, source: measure.source, resolution: "annual" as const, unit: "Mt CO₂", decimals: 1, table }]]),
      ctx: {} as never,
    }),
  };
  const engine = createQueryEngine(registry);

  test("a value map covers every year with data, countries only, starting on the latest", async () => {
    const { result } = await engine.run({ kind: "map", measure: "emissions.co2", span: [null, null], by: "value" });
    if (result.kind !== "map") throw new Error(result.kind);
    expect(result.years[0]).toBe(2000);
    expect(result.year).toBe(2020);
    expect(result.countries.map((c) => c.iso3)).toEqual(["AAA", "BBB", "CCC"]);
    expect(result.world?.at(-1)).toBe(1020);
    expect(text(result.sentences[0]!.text)).toContain("Beta had the highest in 2020");
  });
  test("a map 'in 2010' keeps the slider and starts on 2010", async () => {
    const { result } = await engine.run({ kind: "map", measure: "emissions.co2", span: [2010, 2010], by: "value" });
    if (result.kind !== "map") throw new Error(result.kind);
    expect(result.years).toHaveLength(21);
    expect(result.year).toBe(2010);
  });
  test("a change map starts at its base year", async () => {
    const r = await engine.run({ kind: "map", measure: "emissions.co2", span: [2005, null], by: "change" });
    if (r.result.kind !== "map") throw new Error(r.result.kind);
    expect(r.result.base).toBe(2005);
    expect(r.result.years[0]).toBe(2005);
    expect(text(r.result.sentences[0]!.text)).toContain("Alpha had the largest increase from 2005 to 2020");
  });
  test("chart the top countries: picked by the latest values, with a note", async () => {
    const r = await engine.run({ kind: "series", series: ["emissions.co2"], span: [null, null], display: "values", smoothing: 0, chart: "lines", top: { n: 2, order: "desc" } });
    if (r.result.kind !== "series") throw new Error(r.result.kind);
    expect(r.result.series.map((s) => s.ref)).toEqual(["emissions.co2@BBB", "emissions.co2@AAA"]);
    expect(r.notes[0]).toBe("The 2 countries with the highest CO₂ emissions in 2020.");
  });
});
