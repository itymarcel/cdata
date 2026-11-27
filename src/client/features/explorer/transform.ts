import type { HistorySeries, Point, Resolution } from "@shared/types.ts";

/** Index of the first point with t ≥ x (points sorted by t). */
export function lowerBound(points: Point[], x: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Points inside [x0, x1], plus one either side so lines run to the edges. */
export function clip<P extends [number, ...number[]]>(points: P[], x0: number, x1: number): P[] {
  const a = Math.max(0, lowerBound(points as unknown as Point[], x0) - 1);
  const b = Math.min(points.length, lowerBound(points as unknown as Point[], x1) + 1);
  return points.slice(a, b);
}

/** Nearest point to x, or null for an empty series. */
export function nearest(points: Point[], x: number): Point | null {
  if (points.length === 0) return null;
  const i = lowerBound(points, x);
  const a = points[Math.max(0, i - 1)]!;
  const b = points[Math.min(points.length - 1, i)]!;
  return Math.abs(a[0] - x) <= Math.abs(b[0] - x) ? a : b;
}

/** Typical spacing of a series in years, used to decide whether smoothing changes it. */
export const STEP: Record<Resolution, number> = {
  daily: 1 / 365,
  monthly: 1 / 12,
  quarterly: 1 / 4,
  annual: 1,
  multiYear: 10,
};

/**
 * Centred running mean over `years`, by time rather than by count, so gaps and
 * uneven spacing (sea-ice records were every other day until 1987) are handled.
 * Edges where the window is less than half full are dropped rather than biased.
 */
export function runningMean(points: Point[], years: number): Point[] {
  if (years <= 0 || points.length < 2) return points;
  const half = years / 2;
  const out: Point[] = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  const first = points[0]![0];
  const last = points.at(-1)![0];
  for (const [t] of points) {
    while (hi < points.length && points[hi]![0] <= t + half) sum += points[hi++]![1];
    while (points[lo]![0] < t - half) sum -= points[lo++]![1];
    if (t - first < half / 2 || last - t < half / 2) continue;
    out.push([t, sum / (hi - lo)]);
  }
  return out;
}

/** Calendar-year means, centred mid-year; years with under 80% of the usual samples are skipped. */
export function annualMeans(points: Point[], resolution: Resolution): Point[] {
  const perYear = Math.round(1 / STEP[resolution]);
  const groups = new Map<number, number[]>();
  for (const [t, v] of points) {
    const y = Math.floor(t);
    const g = groups.get(y);
    if (g) g.push(v);
    else groups.set(y, [v]);
  }
  const out: Point[] = [];
  for (const [y, vals] of groups) {
    if (vals.length >= perYear * 0.8 || perYear <= 1) out.push([y + 0.5, vals.reduce((a, b) => a + b, 0) / vals.length]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Change per year. Sub-annual series are first reduced to calendar-year means
 * so the seasonal cycle doesn't swamp the change; coarser series use the slope
 * between consecutive points.
 */
export function ratePerYear(points: Point[], resolution: Resolution): Point[] {
  const base = STEP[resolution] < 1 ? annualMeans(points, resolution) : points;
  const out: Point[] = [];
  for (let i = 1; i < base.length; i++) {
    const [t0, v0] = base[i - 1]!;
    const [t1, v1] = base[i]!;
    if (t1 > t0) out.push([(t0 + t1) / 2, (v1 - v0) / (t1 - t0)]);
  }
  return out;
}

/** Least-squares line. */
export function linearFit(points: Point[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

/**
 * Least-squares quadratic y = a + b·u + c·u², with u = t − t0 for numerical
 * stability. 2c is the acceleration in units per year².
 */
export function quadraticFit(points: Point[]): { t0: number; a: number; b: number; c: number } | null {
  const n = points.length;
  if (n < 5) return null;
  const t0 = points.reduce((s, [t]) => s + t, 0) / n;
  // Normal equations for [a, b, c].
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (const [t, y] of points) {
    const u = t - t0;
    const u2 = u * u;
    s1 += u;
    s2 += u2;
    s3 += u2 * u;
    s4 += u2 * u2;
    y0 += y;
    y1 += y * u;
    y2 += y * u2;
  }
  const m = [
    [n, s1, s2, y0],
    [s1, s2, s3, y1],
    [s2, s3, s4, y2],
  ];
  // Gaussian elimination.
  for (let i = 0; i < 3; i++) {
    const p = m[i]![i]!;
    if (Math.abs(p) < 1e-12) return null;
    for (let j = i + 1; j < 3; j++) {
      const f = m[j]![i]! / p;
      for (let k = i; k < 4; k++) m[j]![k]! -= f * m[i]![k]!;
    }
  }
  const c = m[2]![3]! / m[2]![2]!;
  const b = (m[1]![3]! - m[1]![2]! * c) / m[1]![1]!;
  const a = (m[0]![3]! - m[0]![1]! * b - m[0]![2]! * c) / m[0]![0]!;
  return { t0, a, b, c };
}

/** Splits a series into calendar years: year → points with x as the fraction of the year (0–1). */
export function byYear(points: Point[]): Map<number, Point[]> {
  const out = new Map<number, Point[]>();
  for (const [t, v] of points) {
    const y = Math.floor(t);
    const p: Point = [t - y, v];
    const g = out.get(y);
    if (g) g.push(p);
    else out.set(y, [p]);
  }
  return out;
}

/**
 * SVG path for a long series, keeping at most four points per pixel column
 * (first, min, max, last) so spikes survive and 30,000-point records draw fast.
 * Gaps longer than `maxGap` years break the line.
 */
export function decimatedPath(points: Point[], x: (t: number) => number, y: (v: number) => number, maxGap = Infinity): string {
  let d = "";
  let col = Number.NaN;
  let first: Point | null = null;
  let min: Point | null = null;
  let max: Point | null = null;
  let last: Point | null = null;
  let prevT = Number.NaN;
  let pen = false;
  const emit = () => {
    if (!first) return;
    const pts = [first, min!, max!, last!].sort((a, b) => a[0] - b[0]);
    let prev: Point | null = null;
    for (const p of pts) {
      if (p === prev) continue;
      d += `${pen ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`;
      pen = true;
      prev = p;
    }
  };
  for (const p of points) {
    if (t_gap(prevT, p[0], maxGap)) {
      emit();
      first = min = max = last = null;
      col = Number.NaN;
      pen = false;
    }
    prevT = p[0];
    const c = Math.floor(x(p[0]));
    if (c !== col) {
      emit();
      col = c;
      first = min = max = last = p;
      continue;
    }
    if (p[1] < min![1]) min = p;
    if (p[1] > max![1]) max = p;
    last = p;
  }
  emit();
  return d;
}
const t_gap = (prev: number, t: number, maxGap: number) => Number.isFinite(prev) && t - prev > maxGap;

/** Area path for an uncertainty band ([t, lo, hi]). */
export function bandPath(band: [number, number, number][], x: (t: number) => number, y: (v: number) => number): string {
  if (band.length < 2) return "";
  const top = band.map(([t, , hi]) => `${x(t).toFixed(1)},${y(hi).toFixed(1)}`);
  const bottom = band
    .slice()
    .reverse()
    .map(([t, lo]) => `${x(t).toFixed(1)},${y(lo).toFixed(1)}`);
  return `M${top.join("L")}L${bottom.join("L")}Z`;
}

/** "800k yrs ago", "10,050 BCE", "1850", "Mar 2024", depending on how wide the view is. */
export function formatT(t: number, span: number, now: number): string {
  if (span > 30_000) {
    const ago = now - t;
    return ago >= 1000 ? `${Math.round(ago / 1000).toLocaleString("en")}k yrs ago` : String(Math.round(t));
  }
  if (t < 0.5) return `${Math.round(1 - t).toLocaleString("en")} BCE`;
  if (span < 3) {
    const year = Math.floor(t);
    const month = Math.min(11, Math.floor((t - year) * 12));
    return new Date(Date.UTC(year, month, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return String(Math.floor(t));
}

/** Long-format CSV of what's in view: series, decimal year, value. */
export function toCsv(series: { label: string; points: Point[] }[], unit: string): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [`series,decimal_year,value (${unit})`];
  for (const s of series) for (const [t, v] of s.points) lines.push(`${esc(s.label)},${t},${v}`);
  return lines.join("\n");
}

/** Gap that should break a line: four times the series' normal spacing, at least 2 months. */
export const maxGapFor = (s: Pick<HistorySeries, "resolution">) =>
  s.resolution === "multiYear" ? Infinity : Math.max(STEP[s.resolution] * 4, 1 / 6);
