import { describe, expect, test } from "bun:test";
import type { Point } from "../src/shared/types.ts";
import {
  annualMeans,
  byYear,
  clip,
  decimatedPath,
  formatT,
  linearFit,
  quadraticFit,
  ratePerYear,
  runningMean,
  toCsv,
} from "../src/client/features/explorer/transform.ts";
import { makeTimeScale } from "../src/client/features/explorer/HistoryChart.tsx";
import { ensoEpisodes } from "../src/server/sources/history.ts";

const monthly = (from: number, years: number, f: (t: number) => number): Point[] =>
  Array.from({ length: years * 12 }, (_, i) => {
    const t = from + (i + 0.5) / 12;
    return [t, f(t)];
  });

describe("explorer transforms", () => {
  test("clip keeps one point either side of the window", () => {
    const pts: Point[] = [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
    expect(clip(pts, 2.5, 3.5).map((p) => p[0])).toEqual([2, 3, 4]);
    expect(clip(pts, 0, 10)).toHaveLength(5);
  });

  test("running mean over a year removes a seasonal cycle", () => {
    const pts = monthly(2000, 10, (t) => 2 * t + Math.sin(2 * Math.PI * t) * 5);
    const smooth = runningMean(pts, 1);
    for (const [t, v] of smooth.slice(12, -12)) expect(Math.abs(v - 2 * t)).toBeLessThan(0.5);
  });

  test("annual means and change per year", () => {
    const pts = monthly(2000, 5, (t) => 3 * t);
    const annual = annualMeans(pts, "monthly");
    expect(annual).toHaveLength(5);
    expect(annual[0]![0]).toBe(2000.5);
    const rate = ratePerYear(pts, "monthly");
    for (const [, v] of rate) expect(v).toBeCloseTo(3, 6);
  });

  test("annual means skip years with too few samples", () => {
    const pts = monthly(2000, 2, () => 1).filter(([t]) => t < 2001.3);
    expect(annualMeans(pts, "monthly").map((p) => p[0])).toEqual([2000.5]);
  });

  test("fits recover slope and acceleration", () => {
    const pts: Point[] = Array.from({ length: 50 }, (_, i) => [1990 + i, 3 + 0.5 * i + 0.04 * i * i]);
    const q = quadraticFit(pts)!;
    expect(2 * q.c).toBeCloseTo(0.08, 6);
    const lin = linearFit(pts.map(([t]) => [t, 2 * t] as Point))!;
    expect(lin.slope).toBeCloseTo(2, 9);
  });

  test("byYear splits into fractions of the year", () => {
    const years = byYear(monthly(2020, 2, () => 1));
    expect([...years.keys()]).toEqual([2020, 2021]);
    expect(years.get(2021)![0]![0]).toBeCloseTo(0.5 / 12, 6);
  });

  test("decimation keeps the extremes in each pixel column", () => {
    const pts: Point[] = Array.from({ length: 1000 }, (_, i) => [i / 1000, i === 500 ? 100 : 0]);
    const d = decimatedPath(pts, (t) => t * 10, (v) => -v);
    expect(d).toContain(",-100.0");
    expect(d.split(/[ML]/).length - 1).toBeLessThan(60);
  });

  test("decimation breaks the line at gaps", () => {
    const pts: Point[] = [[0, 0], [0.1, 0], [5, 0], [5.1, 0]];
    const d = decimatedPath(pts, (t) => t * 100, (v) => v, 1);
    expect(d.match(/M/g)).toHaveLength(2);
  });

  test("time labels adapt to the span", () => {
    expect(formatT(-798_000, 800_000, 2026)).toBe("800k yrs ago");
    expect(formatT(-500, 3000, 2026)).toBe("501 BCE");
    expect(formatT(1850.2, 170, 2026)).toBe("1850");
    expect(formatT(2024.2, 2, 2026)).toBe("Mar 2024");
  });

  test("log time scale is reversible and orders time left to right", () => {
    const s = makeTimeScale("log", [-800_000, 2026], [0, 1000], 2026);
    expect(s(-800_000)).toBeCloseTo(0, 6);
    expect(s(2026)).toBeCloseTo(1000, 6);
    expect(s(1900)).toBeLessThan(s(2000));
    expect(s.invert(s(1850))).toBeCloseTo(1850, 6);
  });

  test("CSV quotes labels with commas", () => {
    expect(toCsv([{ label: "Tide gauges, UHSLC", points: [[2000, 1]] }], "mm")).toBe(
      'series,decimal_year,value (mm)\n"Tide gauges, UHSLC",2000,1',
    );
  });
});

describe("ENSO episodes", () => {
  test("need five consecutive seasons past the threshold", () => {
    const oni: Point[] = [0.6, 0.7, 0.9, 1.2, 0.8, 0.2, -0.6, -0.7, -0.8, -0.5, 0.0].map((v, i) => [2000 + i / 12, v]);
    const eps = ensoEpisodes(oni);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.phase).toBe("elNino");
    expect(eps[0]!.peak).toBe(1.2);
  });
});
