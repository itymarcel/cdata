import { scaleLinear } from "d3-scale";
import { useMemo, useRef } from "react";
import { useSize } from "../../lib/useSize.ts";
import type { ChartSeries } from "./HistoryChart.tsx";
import { makeTimeScale } from "./HistoryChart.tsx";
import { decimatedPath } from "./transform.ts";

interface Props {
  series: ChartSeries[];
  extent: [number, number];
  window: [number, number];
  scale: "linear" | "log";
  now: number;
  onChange: (window: [number, number]) => void;
}

const PAD = { left: 50, right: 14 };
const H = 40;

/**
 * The whole range in miniature, with the visible window as a handle: drag it
 * to move, drag its edges to resize, or drag across empty space to pick a new
 * window.
 */
export function Overview({ series, extent, window: win, scale, now, onChange }: Props) {
  const [ref, size] = useSize<HTMLDivElement>();
  const drag = useRef<{ kind: "move" | "left" | "right" | "new"; x0: number; win: [number, number] } | null>(null);
  const right = Math.max(PAD.left + 10, size.width - PAD.right);
  const x = useMemo(() => makeTimeScale(scale, extent, [PAD.left, right], now), [scale, extent, right, now]);
  const y = useMemo(() => {
    const vals = series.flatMap((s) => s.points.filter(([t]) => t >= extent[0] && t <= extent[1]).map((p) => p[1]));
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    return scaleLinear().domain([lo, hi]).range([H - 4, 4]);
  }, [series, extent]);

  if (size.width === 0) return <div ref={ref} className="xp-overview" />;
  const wx0 = Math.max(PAD.left, x(win[0]));
  const wx1 = Math.min(right, x(win[1]));

  const local = (e: React.PointerEvent) => e.clientX - (e.currentTarget as Element).getBoundingClientRect().left;
  const onDown = (e: React.PointerEvent) => {
    const px = local(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const kind = Math.abs(px - wx0) < 6 ? "left" : Math.abs(px - wx1) < 6 ? "right" : px > wx0 && px < wx1 ? "move" : "new";
    drag.current = { kind, x0: px, win };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const px = Math.min(right, Math.max(PAD.left, local(e)));
    const a = x(d.win[0]);
    const b = x(d.win[1]);
    const dx = px - d.x0;
    let next: [number, number];
    if (d.kind === "move") next = [x.invert(a + dx), x.invert(b + dx)];
    else if (d.kind === "left") next = [x.invert(Math.min(px, b - 4)), d.win[1]];
    else if (d.kind === "right") next = [d.win[0], x.invert(Math.max(px, a + 4))];
    else {
      if (Math.abs(dx) < 4) return;
      next = [x.invert(Math.min(d.x0, px)), x.invert(Math.max(d.x0, px))];
    }
    onChange(next);
  };

  return (
    <div ref={ref} className="xp-overview">
      <svg
        width={size.width}
        height={H}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        aria-label="Overview. Drag the highlighted window to move through time."
      >
        <rect x={PAD.left} y={0} width={right - PAD.left} height={H} className="xp-overview__bg" />
        {series.map((s) => (
          <path key={s.id} d={decimatedPath(s.points.filter(([t]) => t >= extent[0] && t <= extent[1]), x, y, s.maxGap)} stroke={s.color} className="xp-overview__line" />
        ))}
        <rect x={PAD.left} y={0} width={Math.max(0, wx0 - PAD.left)} height={H} className="xp-overview__shade" />
        <rect x={wx1} y={0} width={Math.max(0, right - wx1)} height={H} className="xp-overview__shade" />
        <rect x={wx0} y={0.5} width={Math.max(2, wx1 - wx0)} height={H - 1} className="xp-overview__window" />
        <rect x={wx0 - 3} y={H / 2 - 8} width={6} height={16} rx={2} className="xp-overview__handle" />
        <rect x={wx1 - 3} y={H / 2 - 8} width={6} height={16} rx={2} className="xp-overview__handle" />
      </svg>
    </div>
  );
}
