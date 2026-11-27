import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import type { Point } from "@shared/types.ts";

/** Trend line for stat tiles: de-emphasised line, accent end-dot on the latest value. */
export function Sparkline({ points, width = 120, height = 28, label }: { points: Point[]; width?: number; height?: number; label: string }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const [x0, x1] = extent(points, (p) => p[0]) as [number, number];
  const [y0, y1] = extent(points, (p) => p[1]) as [number, number];
  const pad = 3;
  const x = scaleLinear().domain([x0, x1]).range([pad, width - pad]);
  const y = scaleLinear().domain([y0, y1 === y0 ? y0 + 1 : y1]).range([height - pad, pad]);
  const d = line<Point>().x((p) => x(p[0])).y((p) => y(p[1]))(points) ?? "";
  const a = area<Point>().x((p) => x(p[0])).y0(height).y1((p) => y(p[1]))(points) ?? "";
  const last = points.at(-1)!;
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="sparkline">
      <path d={a} fill="var(--text-secondary)" opacity={0.08} />
      <path d={d} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r={3} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}
