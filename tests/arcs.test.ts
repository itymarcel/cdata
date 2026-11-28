import { describe, expect, test } from "bun:test";
import type { MapMeasureData } from "../src/shared/types.ts";
import { arcPath, centralAngle, cometAt, routePhase } from "../src/client/features/map/arcs.ts";
import { colourScale, valueAtYear } from "../src/client/features/map/choropleth.ts";
import { landDots } from "../src/client/features/map/dots.ts";

const SHANGHAI = [121.5, 31.2] as const;
const ROTTERDAM = [4.5, 51.9] as const;
const TOKYO = [139.7, 35.7] as const;
const LA = [-118.2, 34.1] as const;

describe("arcs", () => {
  test("start and end on the points, on the ground", () => {
    const p = arcPath(SHANGHAI, ROTTERDAM);
    expect(p[0]![0]).toBeCloseTo(SHANGHAI[0], 6);
    expect(p[0]![1]).toBeCloseTo(SHANGHAI[1], 6);
    expect(p[0]![2]).toBeCloseTo(0, 6);
    const end = p.at(-1)!;
    expect(((end[0] % 360) + 360) % 360).toBeCloseTo(ROTTERDAM[0], 4);
    expect(end[1]).toBeCloseTo(ROTTERDAM[1], 4);
    expect(end[2]).toBeCloseTo(0, 3);
  });
  test("rise highest in the middle, in proportion to the route's length", () => {
    const long = arcPath(SHANGHAI, ROTTERDAM);
    const short = arcPath([4.5, 51.9], [13.4, 52.5]);
    const peak = (p: ReturnType<typeof arcPath>) => Math.max(...p.map((v) => v[2]));
    expect(peak(long)).toBeGreaterThan(10 * peak(short));
    const mid = long[Math.floor(long.length / 2)]!;
    expect(mid[2]).toBeCloseTo(peak(long), -4);
  });
  test("follow the great circle: Shanghai → Rotterdam passes north of both", () => {
    const maxLat = Math.max(...arcPath(SHANGHAI, ROTTERDAM).map((v) => v[1]));
    expect(maxLat).toBeGreaterThan(55);
  });
  test("crossing the Pacific stays continuous instead of jumping 360°", () => {
    const p = arcPath(TOKYO, LA);
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i]![0] - p[i - 1]![0])).toBeLessThan(20);
    expect(p.at(-1)![0]).toBeGreaterThan(180); // unwrapped east of the antimeridian
  });
  test("antipodes and identical points don't produce NaN", () => {
    for (const v of arcPath([0, 0], [180, 0])) for (const x of v) expect(Number.isFinite(x)).toBe(true);
    expect(arcPath([10, 10], [10, 10])).toEqual([]);
  });
  test("central angle", () => {
    expect(centralAngle([0, 0], [90, 0])).toBeCloseTo(Math.PI / 2, 9);
  });
  test("a comet runs along the path from start to end, then disappears", () => {
    const p = arcPath(SHANGHAI, ROTTERDAM);
    expect(cometAt(p, 0, 0.2)).toBeNull();
    const early = cometAt(p, 0.1, 0.2)!;
    expect(early.path[0]).toEqual(p[0]!);
    const mid = cometAt(p, 0.5, 0.2)!;
    expect(mid.head[2]).toBeGreaterThan(early.head[2]);
    for (let i = 1; i < mid.path.length; i++) expect(mid.path[i]![0]).not.toBeNaN();
    const arriving = cometAt(p, 1.1, 0.2)!;
    expect(arriving.head[0]).toBeCloseTo(p.at(-1)![0], 6);
    expect(cometAt(p, 1.25, 0.2)).toBeNull();
  });
  test("route phases are stable and differ by direction", () => {
    expect(routePhase("CHN>NLD")).toBe(routePhase("CHN>NLD"));
    expect(routePhase("CHN>NLD")).not.toBe(routePhase("NLD>CHN"));
  });
});

describe("choropleth", () => {
  const data: MapMeasureData = {
    id: "forest.afforestation",
    label: "",
    short: "",
    unit: "ha per year",
    decimals: 0,
    evidence: "reported",
    source: { name: "", publisher: "", url: "" },
    years: [2010, 2011, 2012, 2013, 2014, 2015],
    countries: [
      { iso3: "WLD", name: "World" },
      { iso3: "CHN", name: "China" },
      { iso3: "BRA", name: "Brazil" },
    ],
    values: [
      [1e9, null, null, null, null, 1e9],
      [10, null, null, null, null, 20],
      [-40, -30, -20, -10, 0, 5],
    ],
  };
  test("reaches back for sparse values, no further than allowed", () => {
    expect(valueAtYear(data, data.values[1]!, 2014, 10)).toEqual({ value: 10, year: 2010 });
    expect(valueAtYear(data, data.values[1]!, 2014, 3)).toBeNull();
  });
  test("clamps the cursor to the table's years", () => {
    expect(valueAtYear(data, data.values[1]!, 2026, 1)).toEqual({ value: 20, year: 2015 });
    expect(valueAtYear(data, data.values[2]!, 1990, 1)).toEqual({ value: -40, year: 2010 });
  });
  test("one scale across all years; the world total doesn't set it; diverging is symmetric", () => {
    const seq = colourScale(data, "sequential");
    expect(seq.hi).toBeLessThan(1e6);
    const div = colourScale(data, "diverging");
    expect(div.lo).toBe(-div.hi);
    expect(div.t(-div.hi)).toBeCloseTo(-1, 9);
    expect(div.t(0)).toBe(0);
  });
});

describe("land dots", () => {
  // A 20° square "country" and one with a hole in the middle.
  const square = (iso3: string, x: number, y: number, s: number) => ({
    properties: { iso3 },
    geometry: { type: "Polygon", coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] },
  });
  test("dots fall only inside countries, each tagged with its country", () => {
    const d = landDots([square("AAA", 0, 0, 20), square("BBB", 40, 0, 20)], 2);
    expect(d.count).toBeGreaterThan(100);
    for (let i = 0; i < d.count; i++) {
      const lon = d.positions[2 * i]!;
      const iso = d.isos[d.country[i]!];
      expect(iso === "AAA" ? lon >= 0 && lon <= 20 : lon >= 40 && lon <= 60).toBe(true);
    }
    // Equal areas get about equal numbers of dots.
    const a = [...d.country].filter((c) => d.isos[c] === "AAA").length;
    expect(Math.abs(a - (d.count - a))).toBeLessThan(d.count * 0.1);
  });
  test("holes stay empty", () => {
    const ring = square("CCC", 0, 0, 30);
    (ring.geometry.coordinates as number[][][]).push([[10, 10], [10, 20], [20, 20], [20, 10], [10, 10]]);
    const d = landDots([ring], 1);
    for (let i = 0; i < d.count; i++) {
      const [x, y] = [d.positions[2 * i]!, d.positions[2 * i + 1]!];
      expect(x > 10.5 && x < 19.5 && y > 10.5 && y < 19.5).toBe(false);
    }
  });
  test("near the poles the spacing along a row widens, keeping dots apart on the ground", () => {
    const equator = landDots([square("EQ", 0, -5, 10)], 1).count;
    const north = landDots([square("NO", 0, 65, 10)], 1).count;
    expect(north).toBeLessThan(equator * 0.6);
  });
});
