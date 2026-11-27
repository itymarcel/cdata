import type { Point } from "@shared/types.ts";

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Least-squares slope and intercept for points (x, y). */
export function linearFit(points: Point[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Thins a dense series to roughly `target` points, keeping the last point. */
export function downsample(points: Point[], target: number): Point[] {
  if (points.length <= target) return points;
  const step = points.length / target;
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]!);
  const last = points.at(-1)!;
  if (out.at(-1) !== last) out.push(last);
  return out;
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
