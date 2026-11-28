import { quantile } from "d3-array";
import { scaleSqrt } from "d3-scale";
import type { MapMeasureData } from "@shared/types.ts";

/**
 * Climate-action measures the map can colour countries by. Each is a catalog
 * measure (so the Ask bar answers the same series); the map only adds how to
 * colour it.
 */
export const ACTION_MAP_MEASURES: {
  id: string;
  label: string;
  title: string;
  /** "diverging" for quantities that can go either way (net forest change). */
  kind: "sequential" | "diverging";
  /** How many years back to reach for a value when the cursor year has none (FAO reports every 5–10 years). */
  lookback: number;
}[] = [
  { id: "action.solar", label: "Solar capacity", title: "Installed solar power, GW", kind: "sequential", lookback: 1 },
  { id: "action.wind", label: "Wind capacity", title: "Installed wind power, GW", kind: "sequential", lookback: 1 },
  { id: "energy.renewables", label: "Renewable electricity", title: "Share of electricity from hydro, wind, solar and other renewables", kind: "sequential", lookback: 1 },
  { id: "energy.lowCarbon", label: "Low-carbon electricity", title: "Share of electricity from renewables and nuclear", kind: "sequential", lookback: 1 },
  { id: "action.evShare", label: "Electric car sales", title: "Share of new cars sold that are electric, incl. plug-in hybrids", kind: "sequential", lookback: 1 },
  { id: "forest.change", label: "Net forest change", title: "Forest gained minus forest lost per year", kind: "diverging", lookback: 1 },
  { id: "forest.afforestation", label: "Afforestation", title: "New forest planted or seeded per year (yearly average over each assessment period)", kind: "sequential", lookback: 10 },
  { id: "land.protected", label: "Protected land", title: "Share of land in protected areas", kind: "sequential", lookback: 2 },
];
export const actionMapMeasure = (id: string | null) => ACTION_MAP_MEASURES.find((m) => m.id === id) ?? null;

const isCountry = (iso3: string) => /^[A-Z]{3}$/.test(iso3) && iso3 !== "WLD";

/**
 * The value shown for a country in `year`: the latest one at or before it,
 * at most `lookback` years old. The cursor is clamped to the table's years,
 * so "now" shows the newest figure.
 */
export function valueAtYear(
  data: Pick<MapMeasureData, "years">,
  values: (number | null)[],
  year: number,
  lookback: number,
): { value: number; year: number } | null {
  const { years } = data;
  if (!years.length) return null;
  const y = Math.min(years.at(-1)!, Math.max(years[0]!, Math.floor(year)));
  const i = y - years[0]!;
  for (let k = 0; k < lookback && i - k >= 0; k++) {
    const v = values[i - k];
    if (v !== null && v !== undefined) return { value: v, year: years[i - k]! };
  }
  return null;
}

/**
 * One colour scale across every year and country, so moving the timeline
 * shows growth rather than re-normalising. The top end is the 99.5th
 * percentile, so one giant (China's solar) doesn't wash everyone else out;
 * diverging scales are symmetric around zero.
 */
export function colourScale(data: MapMeasureData, kind: "sequential" | "diverging"): { t: (v: number) => number; lo: number; hi: number } {
  const all: number[] = [];
  data.countries.forEach((c, i) => {
    if (!isCountry(c.iso3)) return;
    for (const v of data.values[i] ?? []) if (v !== null) all.push(kind === "diverging" ? Math.abs(v) : v);
  });
  all.sort((a, b) => a - b);
  const top = quantile(all, 0.995) ?? 1;
  const hi = top > 0 ? top : 1;
  const sqrt = scaleSqrt().domain([0, hi]).range([0, 1]).clamp(true);
  if (kind === "diverging") return { t: (v) => Math.sign(v) * sqrt(Math.abs(v)), lo: -hi, hi };
  return { t: (v) => sqrt(Math.max(0, v)), lo: 0, hi };
}
