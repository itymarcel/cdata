/**
 * Runs Ask queries against the catalog's data. Every figure and sentence in a
 * result is computed here from the series themselves; sentences are templates
 * whose claims ("peaked", "N times") are gated on the computed values, and
 * each carries a `basis` naming its calculation.
 */
import type {
  AttributionStudy,
  ClimateLaw,
  Co2Data,
  CopConference,
  DisasterAlertsData,
  DisasterType,
  EnsoData,
  Hazard,
  NdcData,
  Point,
  Resolution,
  RichText,
  SeaIceData,
  TemperatureData,
  VolcanoesData,
} from "@shared/types.ts";
import {
  type ListItem,
  type Measure,
  type Query,
  type QueryResponse,
  type QueryResult,
  type RankRow,
  type ResultSeries,
  type Sentence,
  type SeriesStats,
  type StatPoint,
  type YearSpan,
  HAZARD_LABEL,
  splitRef,
} from "@shared/query.ts";
import { toDecimalYear, ymdToDecimalYear } from "@shared/time.ts";
import { STEP, ratePerYear, runningMean } from "@client/features/explorer/transform.ts";
import { linearFit, mean, round } from "../lib/stats.ts";
import type { CountriesGeoJson } from "../sources/geo.ts";
import type { CountryTable, Loaded, Registry } from "./catalog.ts";
import { createGeocoder } from "./geocode.ts";
import { dateOf, num } from "./insights.ts";
import { co2Thresholds, seaIceRecords, temperatureRecords } from "./records.ts";

/** Points drawn per series; extremes survive the thinning. */
export const MAX_POINTS = 1600;
/** Same rule as the Industry panel's per-person ranking: micro-states would otherwise top it. */
export const MIN_POPULATION = 1_000_000;
const AGGREGATES = new Set(["WLD", "EU27"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SUB_ANNUAL: Resolution[] = ["daily", "monthly", "quarterly"];

// ---------------------------------------------------------------------------
// Pure helpers (tested in tests/query.test.ts)
// ---------------------------------------------------------------------------

/** "1850", "10,000 BCE", "805,000 years ago" (astronomical years: 0 = 1 BCE). */
export function yearLabel(y: number, now: number): string {
  if (y >= 1) return String(y);
  if (now - y > 50_000) return `${num(Math.floor(now) - y)} years ago`;
  return `${num(1 - y)} BCE`;
}

/** "in 1990", but "800,000 years ago" stands alone. */
export const at = (label: string) => (label.endsWith(" ago") ? label : `in ${label}`);
/** Numbers with a true minus sign. */
export const fmt = (v: number, decimals: number) => num(v, decimals).replace(/^-/, "−");

/** A point's date, as precisely as its series resolves it. */
export function whenLabel(t: number, resolution: Resolution, now: number): string {
  if (resolution === "daily") {
    const d = dateOf(t);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const year = Math.floor(t);
  if (resolution === "monthly") return `${MONTHS[Math.min(11, Math.floor((t - year) * 12))]} ${year}`;
  if (resolution === "quarterly") return `Q${Math.min(4, Math.floor((t - year) * 4) + 1)} ${year}`;
  return yearLabel(resolution === "multiYear" ? Math.round(t) : year, now);
}

/** Points inside the inclusive calendar-year span. */
export function inSpan(points: Point[], [from, to]: YearSpan): Point[] {
  const a = from ?? -Infinity;
  const b = to === null ? Infinity : to + 1;
  return points.filter(([t]) => t >= a && t < b);
}

/** Calendar year of a point; daily series are read by date so midnight stamps land on the right day. */
const yearOfPoint = (t: number, resolution: Resolution) => (resolution === "daily" ? dateOf(t).getUTCFullYear() : Math.floor(t));

/**
 * The values a span's figures are read from: yearly means of complete
 * calendar years for sub-annual series (so a partial year or the seasonal
 * cycle doesn't skew a comparison), the points themselves otherwise.
 */
export function periodValues(points: Point[], resolution: Resolution, now: number): { values: StatPoint[]; averaged: boolean } {
  if (!SUB_ANNUAL.includes(resolution)) return { values: points.map(([t, v]) => ({ t, v, label: whenLabel(t, resolution, now) })), averaged: false };
  const perYear = Math.round(1 / STEP[resolution]);
  const groups = new Map<number, Point[]>();
  for (const p of points) {
    const y = yearOfPoint(p[0], resolution);
    const g = groups.get(y);
    if (g) g.push(p);
    else groups.set(y, [p]);
  }
  const values: StatPoint[] = [];
  for (const [y, ps] of [...groups].sort((a, b) => a[0] - b[0])) {
    const first = ps[0]![0] - y;
    const last = ps.at(-1)![0] - y;
    // Complete: runs from early January to late December, with at least the every-other-day density of the early sea-ice record.
    if (first <= 0.15 && last >= 0.85 && ps.length >= perYear * 0.4) values.push({ t: y + 0.5, v: mean(ps.map((p) => p[1]))!, label: String(y) });
  }
  return { values, averaged: true };
}

/** Thins a series for drawing by keeping each bucket's lowest and highest point, in time order. */
export function thin(points: Point[], max = MAX_POINTS): { points: Point[]; thinned: boolean } {
  if (points.length <= max) return { points, thinned: false };
  const size = Math.ceil(points.length / (max / 2));
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += size) {
    let lo = points[i]!;
    let hi = points[i]!;
    for (let j = i; j < Math.min(points.length, i + size); j++) {
      const p = points[j]!;
      if (p[1] < lo[1]) lo = p;
      if (p[1] > hi[1]) hi = p;
    }
    if (lo === hi) out.push(lo);
    else out.push(...(lo[0] < hi[0] ? [lo, hi] : [hi, lo]));
  }
  return { points: out, thinned: true };
}

/**
 * Percentages need a true zero, and a percentage of a percentage ("solar +62%")
 * reads as a change in points; shares get their change in points instead.
 */
export const percentMeaningful = (m: { scale: Measure["scale"]; unit: string }) => m.scale === "ratio" && !m.unit.startsWith("%");

export function seriesStats(ref: string, points: Point[], resolution: Resolution, scale: Measure["scale"], now: number, unit = ""): SeriesStats {
  const empty: SeriesStats = { ref, first: null, last: null, change: null, percent: null, min: null, max: null, trendPerYear: null, count: 0, averaged: false, basis: "No values in this period." };
  if (points.length === 0) return empty;
  let { values, averaged } = periodValues(points, resolution, now);
  if (values.length === 0) {
    // Not one complete year in view: read the points as they are.
    values = points.map(([t, v]) => ({ t, v, label: whenLabel(t, resolution, now) }));
    averaged = false;
  }
  const first = values[0]!;
  const last = values.at(-1)!;
  const change = last.t > first.t ? last.v - first.v : null;
  const percent = change !== null && percentMeaningful({ scale, unit }) && first.v > 0 ? (change / first.v) * 100 : null;
  let lo = points[0]!;
  let hi = points[0]!;
  for (const p of points) {
    if (p[1] < lo[1]) lo = p;
    if (p[1] > hi[1]) hi = p;
  }
  const point = ([t, v]: Point): StatPoint => ({ t, v, label: whenLabel(t, resolution, now) });
  // No yearly rate for reconstructions smoothed over decades, as in the explorer.
  const fit = resolution !== "multiYear" && values.length >= 5 && last.t - first.t >= 5 ? linearFit(values.map((x) => [x.t, x.v] as Point)) : null;
  const what =
    averaged
      ? `Start and end are averages of the ${resolution} values in complete calendar years (${first.label}–${last.label})`
      : resolution === "multiYear"
        ? `Start and end are the reconstruction samples nearest the edges of the period (${first.label}, ${last.label})`
        : `Start and end are the ${resolution} values for ${first.label} and ${last.label}`;
  const extremes = `highest and lowest are single ${resolution === "multiYear" ? "samples" : `${resolution} values`}`;
  const trend = fit ? `; the trend is a least-squares line through ${values.length} ${averaged ? "yearly averages" : "values"}` : "";
  return {
    ref,
    first,
    last,
    change,
    percent,
    min: point(lo),
    max: point(hi),
    trendPerYear: fit?.slope ?? null,
    count: points.length,
    averaged,
    basis: `${what}; ${extremes}${trend}.`,
  };
}

/** "352.1 ppm", "12.3% of electricity". */
export const withUnit = (v: number, decimals: number, unit: string) => `${fmt(v, decimals)}${unit.startsWith("%") ? "" : " "}${unit}`;
const signed = (v: number, decimals: number) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v), decimals)}`;
/** "°C vs 1850–1900" → "°C", "% of electricity" → "percentage points": a change carries the unit, not the baseline. */
export const deltaUnit = (unit: string) =>
  unit.startsWith("%") ? "percentage points" : unit.replace(/\s+vs\s+.*$/, "").replace(/\s*\(.*\)$/, "");
/** "Sea level" → "sea level", but acronyms stay: "CO₂ emissions", "HadCRUT5". */
export const lowerFirst = (s: string) => (/^[A-Z][A-Z₂0-9]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
/** "CO₂ emissions were", "sea level was". */
const verb = (short: string) => (/(emissions|gases|subsidies)\b/i.test(short) ? "were" : "was");
/**
 * A relative change in words: "+48%", or "14 times as much" once it passes
 * tenfold. Nothing when the start rounds to zero, where a percentage would be
 * an artefact of rounding rather than a finding.
 */
export function relativeChange(percent: number | null, start: number, decimals: number): string | null {
  if (percent === null || Math.abs(start) < 0.5 * 10 ** -decimals) return null;
  const ratio = percent / 100 + 1;
  if (ratio >= 10) return `${num(ratio, 0)} times as much`;
  return `${signed(percent, pctDecimals(percent))}%`;
}
/** "Germany’s", "United States’". */
const possessive = (name: string) => (name.endsWith("s") ? `${name}’` : `${name}’s`);
/** Decimals for a percentage: whole numbers once it's large. */
const pctDecimals = (p: number) => (Math.abs(p) >= 10 ? 0 : 1);

export interface Named {
  ref: string;
  name: string;
  short: string;
  country: string | null;
  unit: string;
  decimals: number;
  scale: Measure["scale"];
}

/**
 * One sentence per series ("CO₂ emissions in Germany fell from … to …"), plus
 * a peak clause only when the peak is inside the period and the end is at
 * least 5% below it.
 */
export function seriesSentences(named: Named[], stats: SeriesStats[]): Sentence[] {
  const out: Sentence[] = [];
  named.forEach((n, i) => {
    const s = stats[i];
    if (!s?.first || !s.last) return;
    const { first, last } = s;
    if (s.change === null) {
      out.push({ text: [`${n.name}, ${last.label}${s.averaged ? " average" : ""}: `, { em: withUnit(last.v, n.decimals, n.unit) }, "."], basis: s.basis });
      return;
    }
    const still = Math.abs(s.change) < 0.5 * 10 ** -n.decimals;
    const text: RichText = still
      ? [`${n.name} was unchanged at `, { em: withUnit(last.v, n.decimals, n.unit) }, ` between ${first.label} and ${last.label}`]
      : [
          `${n.name} ${s.change > 0 ? "rose" : "fell"} from `,
          { em: withUnit(first.v, n.decimals, n.unit) },
          ` ${at(first.label)} to `,
          { em: withUnit(last.v, n.decimals, n.unit) },
          ` ${at(last.label)}`,
        ];
    if (!still) {
      const factor = relativeChange(s.percent, first.v, n.decimals);
      if (factor) text.push(" (", { em: factor }, ")");
      else text.push(" (", { em: `${signed(s.change, n.decimals)} ${deltaUnit(n.unit)}`.trim() }, ")");
    }
    text.push(".");
    out.push({ text, basis: s.basis });
  });
  return out;
}

/** "It peaked at … in …", only for ratio-scale series whose peak is inside the period and well above the end. */
export function peakSentence(n: Named, values: StatPoint[]): Sentence | null {
  if (n.scale !== "ratio" || values.length < 3) return null;
  let peak = 0;
  values.forEach((v, i) => {
    if (v.v > values[peak]!.v) peak = i;
  });
  const p = values[peak]!;
  const end = values.at(-1)!;
  if (peak === 0 || peak === values.length - 1 || end.v > p.v * 0.95) return null;
  return {
    text: [`${n.name} peaked at `, { em: withUnit(p.v, n.decimals, n.unit) }, ` ${at(p.label)}; ${end.label} was `, { em: `${num(((p.v - end.v) / p.v) * 100, 0)}%` }, " lower."],
    basis: `Highest of the ${values.length} yearly values in the period, compared with the last.`,
  };
}

/**
 * "In 2023, CO₂ emissions in China were 6.4 times those in Germany." Only for
 * two or more ratio-scale series in the same unit with values for the same year.
 */
export function comparisonSentence(named: Named[], values: StatPoint[][]): Sentence | null {
  const idx = named.map((_, i) => i).filter((i) => named[i]!.scale === "ratio");
  if (idx.length < 2 || new Set(idx.map((i) => named[i]!.unit)).size !== 1) return null;
  const byYear = idx.map((i) => new Map(values[i]!.map((v) => [Math.floor(v.t), v.v])));
  const years = [...byYear[0]!.keys()].filter((y) => byYear.every((m) => m.has(y))).sort((a, b) => b - a);
  const y = years[0];
  if (y === undefined) return null;
  const at = idx.map((i, k) => ({ i, v: byYear[k]!.get(y)! }));
  const hi = at.reduce((a, b) => (b.v > a.v ? b : a));
  const lo = at.reduce((a, b) => (b.v < a.v ? b : a));
  if (lo.v <= 0 || hi === lo) return null;
  const r = hi.v / lo.v;
  const A = named[hi.i]!;
  const B = named[lo.i]!;
  const sameMeasure = A.short === B.short && A.country && B.country;
  const ratio = r < 1.1 ? "about the same as" : `${num(r, r < 10 ? 1 : 0)} times`;
  const text: RichText = sameMeasure
    ? [`In ${y}, ${possessive(A.country!)} ${lowerFirst(A.short)} ${verb(A.short)} `, { em: ratio }, ` ${possessive(B.country!)}.`]
    : [`In ${y}, ${lowerFirst(A.name)} ${verb(A.short)} `, { em: ratio }, ` ${lowerFirst(B.name)}.`];
  return { text, basis: `Ratio of the ${y} values, the latest year all of these series cover.` };
}

/**
 * For stacked charts of parts of a whole: "In 2025, coal was the largest part
 * (61%), followed by gas (20%)." Only when every part is in the same unit and
 * the parts have values for the same year.
 */
export function compositionSentence(named: Named[], values: StatPoint[][]): Sentence | null {
  if (named.length < 2 || new Set(named.map((n) => n.unit)).size !== 1 || named.some((n) => n.scale !== "ratio")) return null;
  const byYear = values.map((vs) => new Map(vs.map((v) => [Math.floor(v.t), v.v])));
  const y = [...byYear[0]!.keys()].filter((k) => byYear.every((m) => m.has(k))).sort((a, b) => b - a)[0];
  if (y === undefined) return null;
  const parts = named.map((n, i) => ({ n, v: byYear[i]!.get(y)! })).filter((p) => p.v > 0).sort((a, b) => b.v - a.v);
  const total = parts.reduce((s, p) => s + p.v, 0);
  if (parts.length < 2 || total <= 0) return null;
  const share = (v: number) => `${num((v / total) * 100, 0)}%`;
  const [p1, p2] = parts as [(typeof parts)[0], (typeof parts)[0]];
  const label = (n: Named) => lowerFirst(n.country ? n.short : n.name);
  return {
    text: [`In ${y}, the largest part was ${label(p1.n)} (`, { em: share(p1.v) }, `), followed by ${label(p2.n)} (`, { em: share(p2.v) }, ")."],
    basis: `Each part's ${y} value divided by the sum of the ${parts.length} parts shown.`,
  };
}

export interface RankOptions {
  by: "value" | "change" | "percent";
  order: "desc" | "asc";
  top: number;
  from: number | null;
  to: number | null;
}

export interface Ranked {
  rows: RankRow[];
  total: number;
  year: number;
  fromYear: number | null;
  notes: string[];
  basisParts: string[];
  world: number | null;
}

/** Latest year at or before `target` that at least half as many countries report as the best-covered year. */
export function reportedYear(table: CountryTable, target: number | null): number | null {
  const counts = table.years.map((_, y) => table.values.reduce((n, row, c) => n + (row[y] !== null && row[y] !== undefined && !AGGREGATES.has(table.countries[c]!.iso3) ? 1 : 0), 0));
  const best = Math.max(0, ...counts);
  for (let y = table.years.length - 1; y >= 0; y--) if ((target === null || table.years[y]! <= target) && counts[y]! >= best / 2 && best > 0) return table.years[y]!;
  return null;
}

export function rankTable(table: CountryTable, opts: RankOptions): Ranked | null {
  const notes: string[] = [];
  const basisParts: string[] = [];
  const year = reportedYear(table, opts.to);
  if (year === null) return null;
  if (opts.to !== null && year !== opts.to) notes.push(`Too few countries report ${opts.to} yet, so this uses ${year}.`);
  const yi = table.years.indexOf(year);
  let fromYear: number | null = null;
  let fi = -1;
  if (opts.by !== "value") {
    fromYear = opts.from ?? year - 10;
    if (opts.from === null) notes.push(`No start year given, so the change is over the ten years to ${year}.`);
    if (fromYear >= year) return null;
    fi = table.years.indexOf(fromYear);
    if (fi < 0) return null;
  }
  const isCountry = (c: number) => /^[A-Z]{3}$/.test(table.countries[c]!.iso3) && !AGGREGATES.has(table.countries[c]!.iso3);
  const bigEnough = (c: number) => !table.population || (table.population[c]?.[yi] ?? 0) >= MIN_POPULATION;
  if (table.population) basisParts.push(`countries with at least ${num(MIN_POPULATION)} people in ${year}`);

  let rows: { c: number; value: number; start: number | null }[] = [];
  for (let c = 0; c < table.countries.length; c++) {
    if (!isCountry(c) || !bigEnough(c)) continue;
    const end = table.values[c]?.[yi];
    if (end === null || end === undefined) continue;
    if (opts.by === "value") {
      rows.push({ c, value: end, start: null });
      continue;
    }
    const start = table.values[c]?.[fi];
    if (start === null || start === undefined) continue;
    rows.push({ c, value: opts.by === "change" ? end - start : start > 0 ? ((end - start) / start) * 100 : NaN, start });
  }
  if (opts.by === "percent") {
    // A percentage of a tiny start is noise: rank only the 50 largest at the start.
    rows = rows.filter((r) => Number.isFinite(r.value)).sort((a, b) => b.start! - a.start!).slice(0, 50);
    basisParts.push(`the 50 largest in ${fromYear}`);
  }
  rows.sort((a, b) => (opts.order === "desc" ? b.value - a.value : a.value - b.value));
  const wi = table.countries.findIndex((c) => c.iso3 === "WLD");
  const world = wi >= 0 ? (table.values[wi]?.[yi] ?? null) : null;
  return {
    rows: rows.slice(0, opts.top).map((r, i) => ({ rank: i + 1, iso3: table.countries[r.c]!.iso3, name: table.countries[r.c]!.name, value: r.value, start: r.start })),
    total: rows.length,
    year,
    fromYear,
    notes,
    basisParts,
    world,
  };
}

/** Additive measures can be summed and expressed as a share of the world total. */
const additive = (m: Pick<Measure, "scale" | "unit">) => m.scale === "ratio" && !/per person|%|ppm|ppb/.test(m.unit);

export function rankSentences(m: Pick<Measure, "short" | "unit" | "decimals" | "scale">, r: Ranked, opts: RankOptions): Sentence[] {
  const out: Sentence[] = [];
  const [a, b] = r.rows;
  if (!a) return out;
  const unit = opts.by === "percent" ? "%" : opts.by === "change" ? deltaUnit(m.unit) : m.unit;
  const v = (x: number) => (opts.by === "percent" ? `${signed(x, pctDecimals(x))}%` : opts.by === "change" ? `${signed(x, m.decimals)} ${unit}` : withUnit(x, m.decimals, unit));
  const what = opts.by === "value" ? `in ${r.year}` : `from ${r.fromYear} to ${r.year}`;
  const lead =
    opts.by === "value"
      ? opts.order === "desc" ? "the highest" : "the lowest"
      : a.value >= 0
        ? opts.order === "desc" ? "the largest increase" : "the smallest increase"
        : opts.order === "asc" ? "the largest decrease" : "the smallest decrease";
  out.push({
    text: [`${a.name} had ${lead} ${what}: `, { em: v(a.value) }, b ? `, ahead of ${b.name} (${v(b.value)}).` : "."],
    basis: `${opts.by === "value" ? "Values" : opts.by === "change" ? "Differences between the two years" : "Percentage change between the two years"} for ${r.year}${r.basisParts.length ? `, among ${r.basisParts.join(" and ")}` : ""}.`,
  });
  if (opts.by === "value" && opts.order === "desc" && additive(m) && r.world && r.world > 0 && r.rows.length >= 2) {
    const sumTop = r.rows.reduce((s, x) => s + x.value, 0);
    const share = (sumTop / r.world) * 100;
    if (share <= 100)
      out.push({
        text: [`Together, these ${r.rows.length} countries account for `, { em: `${num(share, 0)}%` }, ` of the world total in ${r.year}.`],
        basis: `Sum of the ${r.rows.length} values divided by the world total in the same table, ${r.year}.`,
      });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function pointsFor(l: Loaded, iso3: string | null): Point[] {
  if (l.global) return l.global;
  const t = l.table!;
  const c = t.countries.findIndex((x) => x.iso3 === (iso3 ?? "WLD"));
  if (c < 0) return [];
  const row = t.values[c] ?? [];
  const out: Point[] = [];
  t.years.forEach((y, i) => {
    const v = row[i];
    if (v !== null && v !== undefined) out.push([y, v]);
  });
  return out;
}

const spanText = ([from, to]: YearSpan, now: number) =>
  from === null && to === null ? "" : from !== null && to !== null ? (from === to ? yearLabel(from, now) : `${yearLabel(from, now)}–${yearLabel(to, now)}`) : from !== null ? `since ${yearLabel(from, now)}` : `to ${yearLabel(to!, now)}`;

const HAZARD_TO_GDACS: Partial<Record<Hazard, DisasterType>> = { rainfall: "FL", storm: "TC", drought: "DR", wildfire: "WF" };
const GDACS_LABEL: Record<DisasterType, string> = { FL: "Flood", TC: "Tropical cyclone", DR: "Drought", WF: "Wildfire" };
const toT = (iso: string) => {
  const [y, m = 7, d = 1] = iso.split("-").map(Number);
  return ymdToDecimalYear(y!, m, d);
};

export function createQueryEngine(registry: { get(): Promise<Registry> }) {
  async function series(q: Extract<Query, { kind: "series" }>, reg: Registry, now: number): Promise<{ result: QueryResult; notes: string[] }> {
    const { catalog, loaded } = reg;
    const notes: string[] = [];
    const measureOf = new Map(catalog.measures.map((m) => [m.id, m]));
    const out: ResultSeries[] = [];
    const stats: SeriesStats[] = [];
    const named: Named[] = [];
    const yearly: StatPoint[][] = [];
    let refs = q.series;
    if (q.top) {
      // The leading countries at the end of the span, by the same rule as the ranking.
      const measure = splitRef(q.series[0]!).measure;
      const m = measureOf.get(measure);
      const t = loaded.get(measure)?.table;
      if (!m || !t) throw new QueryError("That measure can’t be split by country.");
      const r = rankTable(t, { by: "value", order: q.top.order, top: q.top.n, from: null, to: q.span[1] });
      if (!r || r.rows.length === 0) throw new QueryError(`No ${lowerFirst(m.short)} data for that period.`);
      refs = r.rows.map((x) => `${measure}@${x.iso3}`);
      notes.push(
        `The ${r.rows.length} countries with the ${q.top.order === "desc" ? "highest" : "lowest"} ${lowerFirst(m.short)} in ${r.year}${r.basisParts.length ? `, among ${r.basisParts.join(" and ")}` : ""}.`,
        ...r.notes,
      );
    }
    for (const ref of refs) {
      const { measure, iso3 } = splitRef(ref);
      const m = measureOf.get(measure);
      const l = loaded.get(measure);
      if (!m || !l) continue;
      const country = iso3 ? (catalog.countries.find((c) => c.iso3 === iso3) ?? null) : null;
      let raw = inSpan(pointsFor(l, iso3), q.span);
      const label = country ? `${m.short} · ${country.name}` : m.label;
      // Reconstructions are sampled every few decades: a question about one year gets the nearest sample.
      if (raw.length === 0 && l.resolution === "multiYear" && q.span[0] !== null && q.span[1] !== null && q.span[1] - q.span[0] < 50) {
        const mid = (q.span[0] + q.span[1] + 1) / 2;
        const near = pointsFor(l, iso3).reduce<Point | null>((best, p) => (!best || Math.abs(p[0] - mid) < Math.abs(best[0] - mid) ? p : best), null);
        if (near && Math.abs(near[0] - mid) <= 100) {
          raw = [near];
          notes.push(`${m.short} has no sample in ${spanText(q.span, now)}; the nearest is dated ${whenLabel(near[0], "multiYear", now)}.`);
        }
      }
      if (raw.length === 0) {
        notes.push(`${label}: no data ${spanText(q.span, now) || "available"} (the record covers ${yearLabel(Math.floor(m.coverage[0]), now)}–${yearLabel(Math.floor(m.coverage[1]), now)}).`);
        continue;
      }
      let drawn = raw;
      if (q.display === "change") {
        if (l.resolution === "multiYear") {
          notes.push(`${m.short}: a change per year isn’t meaningful for a reconstruction smoothed over decades, so it’s left out of the chart.`);
          drawn = [];
        } else drawn = ratePerYear(raw, l.resolution);
      }
      const stepAfter = q.display === "change" && STEP[l.resolution] < 1 ? 1 : STEP[l.resolution];
      if (q.smoothing > stepAfter * 1.5) drawn = runningMean(drawn, q.smoothing);
      const th = thin(drawn);
      const name = country && country.iso3 !== "WLD" ? `${m.short} in ${country.name}` : country?.iso3 === "WLD" ? `World ${lowerFirst(m.short)}` : m.short;
      out.push({
        ref,
        label,
        short: m.short,
        country: country ? { iso3: country.iso3, name: country.name } : null,
        unit: q.display === "change" ? `${deltaUnit(m.unit)} per year` : m.unit,
        decimals: m.decimals,
        scale: m.scale,
        resolution: l.resolution,
        evidence: m.evidence,
        source: m.source,
        points: th.points,
        thinned: th.thinned,
        vital: m.vital ?? null,
      });
      stats.push(seriesStats(ref, raw, l.resolution, m.scale, now, m.unit));
      named.push({ ref, name, short: m.short, country: country && country.iso3 !== "WLD" ? country.name : null, unit: m.unit, decimals: m.decimals, scale: m.scale });
      yearly.push(periodValues(raw, l.resolution, now).values);
    }
    if (out.length === 0) throw new QueryError(notes.join(" ") || "None of these series have data.");
    if (q.display === "change" || q.smoothing > 0) notes.push("The figures below are computed from the unsmoothed values.");
    if (out.some((s) => s.thinned)) notes.push("Dense series are thinned for drawing, keeping each stretch’s highest and lowest values.");
    // With many series, describe the three largest at the end rather than every one.
    const shown = named.length > 4 ? [...named.keys()].sort((a, b) => (stats[b]?.last?.v ?? -Infinity) - (stats[a]?.last?.v ?? -Infinity)).slice(0, 3).sort((a, b) => a - b) : [...named.keys()];
    const sentences = seriesSentences(shown.map((i) => named[i]!), shown.map((i) => stats[i]!));
    const comp = q.chart === "stacked" ? compositionSentence(named, yearly) : null;
    if (comp) sentences.unshift(comp);
    // Peaks only for one or two series; beyond that they crowd out the comparison.
    if (named.length <= 2)
      named.forEach((n, i) => {
        const p = peakSentence(n, yearly[i]!);
        if (p) sentences.push(p);
      });
    const cmp = comparisonSentence(named, yearly);
    if (cmp) sentences.push(cmp);
    const ts = out.flatMap((s) => [s.points[0]?.[0], s.points.at(-1)?.[0]]).filter((t): t is number => t !== undefined);
    const names = named.map((n) => n.name);
    const oneCountry = new Set(named.map((n) => n.country)).size === 1 ? named[0]!.country : null;
    const where = oneCountry ? ` in ${oneCountry}` : "";
    const groupTitle = named.length > 2 && named.every((n) => n.short.endsWith(" electricity")) ? `Electricity mix${where}` : named.length > 2 && named.every((n) => n.short.startsWith("CO₂ from ")) ? `CO₂ emissions by fuel${where}` : null;
    const title = groupTitle ? `${groupTitle}${spanText(q.span, now) ? `, ${spanText(q.span, now)}` : ""}` : `${names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(" vs ")}${spanText(q.span, now) ? `, ${spanText(q.span, now)}` : ""}`;
    return {
      result: { kind: "series", title, extent: [Math.min(...ts), Math.max(...ts)], series: out, stats, sentences, display: q.display, smoothing: q.smoothing, chart: q.chart },
      notes,
    };
  }

  async function map(q: Extract<Query, { kind: "map" }>, reg: Registry): Promise<{ result: QueryResult; notes: string[] }> {
    const m = reg.catalog.measures.find((x) => x.id === q.measure);
    const t = reg.loaded.get(q.measure)?.table;
    if (!m || !t) throw new QueryError("Only per-country measures can be mapped.");
    const notes: string[] = [];
    // A map "in 2020" keeps the whole slider and starts on 2020.
    const single = q.by === "value" && q.span[0] !== null && q.span[0] === q.span[1] ? q.span[0] : null;
    const last = reportedYear(t, single !== null ? null : q.span[1]);
    if (last === null) throw new QueryError(`No ${lowerFirst(m.short)} data for that period.`);
    if (single === null && q.span[1] !== null && last !== q.span[1]) notes.push(`Too few countries report ${q.span[1]} yet, so the map ends in ${last}.`);
    const isCountry = (iso3: string) => /^[A-Z]{3}$/.test(iso3) && !AGGREGATES.has(iso3);
    const firstWithData = t.years.find((_, y) => t.values.some((row, c) => isCountry(t.countries[c]!.iso3) && row[y] !== null && row[y] !== undefined)) ?? last;
    let base: number | null = null;
    let from = single !== null ? firstWithData : Math.max(firstWithData, q.span[0] ?? -Infinity);
    if (q.by !== "value") {
      base = q.span[0] ?? last - 10;
      if (q.span[0] === null) notes.push(`No start year given, so changes are measured from ${base}.`);
      if (!t.years.includes(base) || base >= last) throw new QueryError(`No ${lowerFirst(m.short)} data for ${base}.`);
      from = base;
    }
    const a = t.years.indexOf(from);
    const b = t.years.indexOf(last);
    const years = t.years.slice(a, b + 1);
    const d = m.decimals + 2;
    const slice = (row: (number | null)[] | undefined) => (row ?? []).slice(a, b + 1).map((v) => (v === null || v === undefined ? null : round(v, d)));
    const countries = t.countries.flatMap((c, i) => {
      if (!isCountry(c.iso3)) return [];
      const values = slice(t.values[i]);
      const ranked = !t.population || (t.population[i]?.[b] ?? 0) >= MIN_POPULATION;
      return values.some((v) => v !== null) ? [{ iso3: c.iso3, name: c.name, values, ranked }] : [];
    });
    const wi = t.countries.findIndex((c) => c.iso3 === "WLD");
    const opts: RankOptions = { by: q.by, order: "desc", top: 5, from: base, to: single ?? last };
    const ranked = rankTable(t, opts);
    const what = q.by === "value" ? lowerFirst(m.short) : q.by === "change" ? `change in ${lowerFirst(m.short)}` : `% change in ${lowerFirst(m.short)}`;
    return {
      result: {
        kind: "map",
        title: `${what.charAt(0).toUpperCase()}${what.slice(1)} by country${years.length > 1 ? `, ${base ?? years[0]}–${last}` : `, ${last}`}`,
        measure: { id: m.id, label: m.label, short: m.short, unit: m.unit, decimals: m.decimals, scale: m.scale, evidence: m.evidence, source: m.source },
        by: q.by,
        base,
        years,
        year: single !== null && years.includes(single) ? single : last,
        countries,
        world: wi >= 0 ? slice(t.values[wi]) : null,
        basis: `${m.label}, ${m.source.publisher}. ${q.by === "value" ? "One colour scale for every year, so moving the slider shows change over time; the brightest colour covers the top 1% of values." : `Each country compared with its own ${base} value.`} Grey: no data.`,
        sentences: ranked ? rankSentences(m, ranked, opts) : [],
      },
      notes,
    };
  }

  async function rank(q: Extract<Query, { kind: "rank" }>, reg: Registry): Promise<{ result: QueryResult; notes: string[] }> {
    const m = reg.catalog.measures.find((x) => x.id === q.measure);
    const l = reg.loaded.get(q.measure);
    if (!m || !l?.table) throw new QueryError("That measure can’t be ranked by country.");
    // A value ranking reads one year: the span's end ("in 1990" → 1990), or the latest ("since 1990" → latest).
    const opts: RankOptions = { by: q.by, order: q.order, top: q.top, from: q.span[0], to: q.span[1] };
    const r = rankTable(l.table, opts);
    if (!r) throw new QueryError(`No ${m.short.toLowerCase()} data for that period.`);
    const unit = q.by === "percent" ? "%" : q.by === "change" ? deltaUnit(m.unit) : m.unit;
    const what =
      q.by === "value"
        ? `${q.order === "desc" ? "Highest" : "Lowest"} ${lowerFirst(m.short)}`
        : `Largest${q.by === "percent" ? " %" : ""} ${q.order === "desc" ? "increase" : "decrease"} in ${lowerFirst(m.short)}`;
    return {
      result: {
        kind: "rank",
        title: `${what}, ${q.by === "value" ? r.year : `${r.fromYear}–${r.year}`}`,
        measure: { id: m.id, label: m.label, short: m.short, unit: m.unit, decimals: m.decimals, evidence: m.evidence, source: m.source },
        by: q.by,
        order: q.order,
        from: r.fromYear,
        to: r.year,
        unit,
        rows: r.rows,
        total: r.total,
        basis: `${m.label}, ${m.source.publisher}. ${r.basisParts.length ? `Countries ranked: ${r.basisParts.join(", ")}. ` : ""}Aggregates (world, EU) are left out.`,
        sentences: rankSentences(m, r, opts),
      },
      notes: r.notes,
    };
  }

  async function list(q: Extract<Query, { kind: "list" }>, reg: Registry, now: number): Promise<{ result: QueryResult; notes: string[] }> {
    const { ctx, catalog } = reg;
    const info = catalog.lists.find((l) => l.id === q.dataset);
    if (!info) throw new QueryError("That list is unavailable right now.");
    const country = q.country ? (catalog.countries.find((c) => c.iso3 === q.country) ?? null) : null;
    const nameOf = (iso3: string | null) => (iso3 ? (catalog.countries.find((c) => c.iso3 === iso3)?.name ?? iso3) : null);
    const notes: string[] = [];
    let items: ListItem[] = [];
    let basis = "";
    const today = new Date().toISOString().slice(0, 10);

    switch (q.dataset) {
      case "attribution": {
        const [studies, geo] = await Promise.all([ctx.get<AttributionStudy[]>("wwaStudies"), ctx.get<CountriesGeoJson>("countries")]);
        if (!studies) throw new QueryError("World Weather Attribution is unreachable right now.");
        const geocoder = geo ? createGeocoder(geo.data) : null;
        items = studies.data.map((s) => {
          const located = geocoder?.locate(s.title, s.summary);
          const p = located?.primary;
          return {
            id: s.id,
            t: toT(s.published),
            date: s.published,
            title: s.title,
            detail: s.summary.length > 280 ? `${s.summary.slice(0, 277).trimEnd()}…` : s.summary,
            place: p ? { name: p.name, iso3: p.iso3 ?? null } : null,
            url: s.url,
            evidence: "modelled" as const,
            tags: s.hazards,
            _all: located?.all.map((x) => x.iso3).filter(Boolean) ?? [],
            _hazards: s.hazards,
          };
        })
          .filter((s) => (!q.hazard || s._hazards.includes(q.hazard)) && (!country || s._all.includes(country.iso3)))
          .map(({ _all, _hazards, ...rest }) => rest);
        basis = "World Weather Attribution studies, newest first. Places are matched from each study’s title and summary.";
        break;
      }
      case "disasters": {
        const env = await ctx.get<DisasterAlertsData>("disasterAlerts");
        if (!env) throw new QueryError("GDACS is unreachable right now.");
        const type = q.hazard ? HAZARD_TO_GDACS[q.hazard] : undefined;
        if (q.hazard && !type) notes.push("GDACS issues alerts for floods, tropical cyclones, droughts and wildfires only, so this shows all alerts.");
        items = env.data.alerts
          .filter((a) => (!type || a.type === type) && (!country || a.iso3 === country.iso3))
          .map((a) => ({
            id: a.id,
            t: toT(a.from.slice(0, 10)),
            date: a.from.slice(0, 10),
            title: a.name,
            detail: `${a.from.slice(0, 10)} to ${a.to.slice(0, 10)}${a.severity ? ` · ${a.severity}` : ""}`,
            place: a.iso3 ? { name: nameOf(a.iso3)!, iso3: a.iso3 } : null,
            url: a.url,
            evidence: env.source.evidence,
            // GDACS spells levels both "Orange" and "ORANGE".
            tags: [`${a.alert.charAt(0)}${a.alert.slice(1).toLowerCase()} alert`, GDACS_LABEL[a.type]],
          }));
        basis = `GDACS orange and red alerts since ${env.data.fromYear}, newest first. Alert levels estimate humanitarian impact, not climate attribution.`;
        break;
      }
      case "laws": {
        const env = await ctx.get<ClimateLaw[]>("climateLaws");
        if (!env) throw new QueryError("Wikidata is unreachable right now.");
        items = env.data
          .filter((l) => l.date && (!country || l.countryIso3 === country.iso3))
          .map((l) => ({
            id: l.id,
            t: toT(l.date!),
            date: l.date!,
            title: l.label,
            detail: l.country,
            place: l.countryIso3 ? { name: l.country ?? nameOf(l.countryIso3)!, iso3: l.countryIso3 } : null,
            url: l.url,
            evidence: env.source.evidence,
            tags: [],
          }));
        basis = "Climate laws with a date in Wikidata, newest first. Coverage is partial.";
        break;
      }
      case "cops": {
        const env = await ctx.get<CopConference[]>("cops");
        if (!env) throw new QueryError("Wikidata is unreachable right now.");
        items = env.data
          .filter((c) => c.start <= today && (!country || c.countryIso3 === country.iso3))
          .map((c) => ({
            id: c.id,
            t: toT(c.start),
            date: c.start,
            title: c.number ? `${c.number}${c.place ? ` · ${c.place}` : ""}` : c.label,
            detail: c.label,
            place: c.country ? { name: c.country, iso3: c.countryIso3 } : null,
            url: c.url,
            evidence: env.source.evidence,
            tags: [],
          }));
        basis = "UN climate conferences from Wikidata, newest first.";
        break;
      }
      case "records": {
        const [temp, co2, ice] = await Promise.all([ctx.get<TemperatureData>("temperature"), ctx.get<Co2Data>("co2"), ctx.get<SeaIceData>("seaIce")]);
        const events = [
          ...(temp ? temperatureRecords(temp.data, temp.source.url) : []),
          ...(co2 ? co2Thresholds(co2.data, co2.source.url) : []),
          ...(ice ? seaIceRecords(ice.data, ice.source.url) : []),
        ];
        items = events.map((e) => ({ id: e.id, t: e.t, date: e.date, title: e.title, detail: e.summary, place: null, url: e.sourceUrl, evidence: e.evidence, tags: [e.sourceName] }));
        basis = "Records detected in the observations: new warmest years since 1990 (HadCRUT5), CO₂ thresholds, and record-low Arctic minima since 2000.";
        break;
      }
      case "eruptions": {
        const env = await ctx.get<VolcanoesData>("volcanoes");
        if (!env) throw new QueryError("NOAA’s volcano database is unreachable right now.");
        const matches = (name: string) => !country || [country.name, ...country.names].some((n) => n.toLowerCase() === name.toLowerCase());
        items = env.data.eruptions
          .filter((v) => matches(v.country))
          .map((v) => ({
            id: `${v.name}-${v.t}`,
            t: v.t,
            date: String(Math.floor(v.t)),
            title: v.name,
            detail: `VEI ${v.vei} · ${v.country}`,
            place: { name: v.country, iso3: null },
            url: env.source.url,
            evidence: env.source.evidence,
            tags: [`VEI ${v.vei}`],
          }));
        basis = "Eruptions of VEI 5 and above since 1800, NOAA NCEI Significant Volcanic Eruptions.";
        break;
      }
      case "enso": {
        const env = await ctx.get<EnsoData>("enso");
        if (!env) throw new QueryError("NOAA’s ENSO index is unreachable right now.");
        items = env.data.episodes
          .filter((e) => !q.phase || e.phase === q.phase)
          .map((e) => ({
            id: `${e.phase}-${e.start}`,
            t: e.start,
            date: whenLabel(e.start, "monthly", now),
            title: e.phase === "elNino" ? "El Niño" : "La Niña",
            detail: `${whenLabel(e.start, "monthly", now)} to ${whenLabel(e.end, "monthly", now)} · strongest 3-month ONI ${e.peak > 0 ? "+" : "−"}${num(Math.abs(e.peak), 1)} °C`,
            place: null,
            url: env.source.url,
            evidence: env.source.evidence,
            tags: [],
          }));
        basis = "NOAA’s rule: five or more overlapping 3-month seasons with the Oceanic Niño Index at ±0.5 °C or beyond.";
        break;
      }
      case "pledges": {
        const env = await ctx.get<NdcData>("ndcTargets");
        if (!env) throw new QueryError("Climate Watch is unreachable right now.");
        if (country) {
          const nz = env.data.netZero.filter((n) => n.iso3 === country.iso3);
          items = [
            ...nz.map((n) => ({
              id: `nz-${n.iso3}`,
              t: n.year ?? now,
              date: n.year ? String(n.year) : "—",
              title: `Net zero${n.year ? ` by ${n.year}` : ""}`,
              detail: n.status,
              place: { name: n.country, iso3: n.iso3 },
              url: env.source.url,
              evidence: env.source.evidence,
              tags: ["net zero"],
            })),
            ...env.data.targets
              .filter((x) => x.iso3 === country.iso3)
              .sort((a, b) => b.order - a.order)
              .map((x) => ({
                id: `ndc-${x.iso3}-${x.order}`,
                t: x.parsed?.targetYear ?? now,
                date: x.parsed ? String(x.parsed.targetYear) : "—",
                title: "NDC target",
                detail: x.text,
                place: { name: x.country, iso3: x.iso3 },
                url: env.source.url,
                evidence: env.source.evidence,
                tags: x.parsed ? [`${x.parsed.reductionLabel} vs ${x.parsed.baseYear}`] : [],
              })),
          ];
          basis = "Targets as Climate Watch records them, quoted verbatim.";
        } else {
          items = env.data.netZero
            .filter((n) => n.year !== null)
            .sort((a, b) => a.year! - b.year!)
            .map((n) => ({
              id: `nz-${n.iso3}`,
              t: n.year!,
              date: String(n.year),
              title: n.country,
              detail: `Net zero by ${n.year} · ${n.status}`,
              place: { name: n.country, iso3: n.iso3 },
              url: env.source.url,
              evidence: env.source.evidence,
              tags: [],
            }));
          basis = "Net-zero target years from Climate Watch, earliest first. Name a country to see its NDC targets.";
        }
        break;
      }
    }

    if (q.dataset !== "pledges") {
      items = inSpanItems(items, q.span);
      items.sort((a, b) => b.t - a.t);
    }
    const total = items.length;
    const hazardWord = q.hazard ? ` · ${HAZARD_LABEL[q.hazard].toLowerCase()}` : "";
    const phaseWord = q.phase ? ` · ${q.phase === "elNino" ? "El Niño" : "La Niña"}` : "";
    const span = q.dataset === "pledges" ? "" : spanText(q.span, now);
    return {
      result: {
        kind: "list",
        title: `${info.label}${country ? ` · ${country.name}` : ""}${hazardWord}${phaseWord}${span ? ` · ${span}` : ""}`,
        dataset: q.dataset,
        items: items.slice(0, q.limit),
        total,
        sources: info.sources,
        basis,
      },
      notes,
    };
  }

  return {
    async run(query: Query): Promise<QueryResponse> {
      const reg = await registry.get();
      const now = toDecimalYear(new Date());
      let r: { result: QueryResult; notes: string[] };
      switch (query.kind) {
        case "series":
          r = await series(query, reg, now);
          break;
        case "rank":
          r = await rank(query, reg);
          break;
        case "map":
          r = await map(query, reg);
          break;
        case "list":
          r = await list(query, reg, now);
          break;
        case "open":
          r = { result: { kind: "open", title: query.view === "map" ? "Map" : query.view }, notes: [] };
          break;
      }
      return { query, result: r.result, notes: r.notes };
    },
  };
}

function inSpanItems<T extends { t: number }>(items: T[], [from, to]: YearSpan): T[] {
  const a = from ?? -Infinity;
  const b = to === null ? Infinity : to + 1;
  return items.filter((i) => i.t >= a && i.t < b);
}

/** A query that ran but has nothing to show; the message is for the reader. */
export class QueryError extends Error {}

export type QueryEngine = ReturnType<typeof createQueryEngine>;
