import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineEvent, TimelineKind } from "@shared/types.ts";
import { useTemperature, useTimeline } from "../../api/queries.ts";
import { anomalyColor } from "../../lib/colors.ts";
import { formatMonthYear, formatSigned } from "../../lib/format.ts";
import { useSize } from "../../lib/useSize.ts";
import { TIMELINE_START, nowYear, useDashboard } from "../../state/store.ts";
import { clusterLane, markWidth, type Cluster } from "./cluster.ts";
import "./timeline.css";

const PLAY_SPEED_YEARS_PER_SEC = 6;
const LANE_H = 10;
const TICKS_H = 12;
const STRIPES_H = 22;

export const LANES: { kind: TimelineKind; label: string }[] = [
  { kind: "attribution", label: "Attribution studies" },
  { kind: "record", label: "Records in the data" },
  { kind: "law", label: "Climate laws" },
  { kind: "cop", label: "COPs" },
];
const LANE_SOURCE: Record<TimelineKind, string> = {
  attribution: "World Weather Attribution",
  record: "computed from NOAA, HadCRUT5 and NSIDC",
  law: "Wikidata (partial coverage)",
  cop: "Wikidata",
};


/** Marker glyphs: shape carries the kind, so lanes read without colour. */
function Glyph({ kind, x, y, active = false }: { kind: TimelineKind; x: number; y: number; active?: boolean }) {
  const cls = `tl-glyph tl-glyph--${kind}${active ? " is-active" : ""}`;
  switch (kind) {
    case "cop":
      return <rect x={x - 3} y={y - 3} width={6} height={6} transform={`rotate(45 ${x} ${y})`} className={cls} />;
    case "law":
      return <rect x={x - 3} y={y - 3} width={6} height={6} className={cls} />;
    case "record":
      return <circle cx={x} cy={y} r={3.3} className={cls} />;
    case "attribution":
      return <path d={`M${x} ${y - 4} L${x + 4} ${y + 3} L${x - 4} ${y + 3} Z`} className={cls} />;
  }
}

/** A counted pill for several events, sized to its number. */
function ClusterMark({ c, active }: { c: Cluster; active: boolean }) {
  const label = c.events.length > 99 ? "99+" : String(c.events.length);
  const w = markWidth(c.events.length);
  return (
    <g>
      <rect x={c.x - w / 2} y={c.y - 4.5} width={w} height={9} rx={4.5} className={`tl-pill tl-glyph--${c.kind}${active ? " is-active" : ""}`} />
      <text x={c.x} y={c.y + 0.5} className="tl-pill__count" textAnchor="middle" dominantBaseline="middle">
        {label}
      </text>
    </g>
  );
}

/** Warming stripes are static per width; memoised so drags don't re-render 170 rects. */
const Stripes = memo(function Stripes({ annual, x, top, height }: { annual: [number, number][]; x: (t: number) => number; top: number; height: number }) {
  const maxAbs = max(annual, (p) => Math.abs(p[1])) ?? 1.5;
  return (
    <g aria-hidden="true">
      {annual.map(([yr, v]) => (
        <rect key={yr} x={x(yr)} y={top} width={Math.max(1, x(yr + 1) - x(yr)) + 0.5} height={height} fill={anomalyColor(v, maxAbs)} />
      ))}
    </g>
  );
});

/** "Now" moves slowly; refresh it once a minute instead of on every render. */
function useNow(): number {
  const [now, setNow] = useState(nowYear);
  useEffect(() => {
    const id = setInterval(() => setNow(nowYear()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The backbone: one timeline, 1850 → today, that drives every panel. Behind it,
 * warming stripes; above it, four lanes of real-world events from live feeds.
 */
export function TimeScrubber() {
  const year = useDashboard((s) => s.year);
  const setYear = useDashboard((s) => s.setYear);
  const playing = useDashboard((s) => s.playing);
  const setPlaying = useDashboard((s) => s.setPlaying);
  const selectedNode = useDashboard((s) => s.selectedNode);
  const selectNode = useDashboard((s) => s.selectNode);
  const flyTo = useDashboard((s) => s.flyTo);

  const { data: temp } = useTemperature();
  const { data: timeline } = useTimeline();
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Cluster | null>(null);
  const [openCluster, setOpenCluster] = useState<Cluster | null>(null);
  const [hiddenLanes, setHiddenLanes] = useState<Set<TimelineKind>>(() => new Set());
  const dragging = useRef(false);

  const end = useNow();
  const lanesTop = 2;
  const stripesTop = lanesTop + LANES.length * LANE_H + 3;
  const height = stripesTop + STRIPES_H + TICKS_H;
  const x = useMemo(() => scaleLinear().domain([TIMELINE_START, end]).range([0, Math.max(1, width)]), [end, width]);

  const annual = useMemo(() => (temp?.data.annual ?? []) as [number, number][], [temp]);
  const currentAnomaly = annual.find((p) => p[0] === Math.floor(year))?.[1];
  const events = timeline?.events;

  const clusters = useMemo(() => {
    const out: Cluster[] = [];
    LANES.forEach(({ kind }, lane) => {
      if (hiddenLanes.has(kind)) return;
      const y = lanesTop + lane * LANE_H + LANE_H / 2;
      const laneEvents = (events ?? []).filter((e) => e.kind === kind && e.t <= end);
      out.push(...clusterLane(laneEvents, x, y, kind));
    });
    return out;
  }, [events, x, end, hiddenLanes]);

  const counts = useMemo(() => {
    const m = new Map<TimelineKind, number>();
    for (const e of events ?? []) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [events]);

  // Playback: advance the cursor smoothly; stop at the present.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // clamp after tab switches
      last = now;
      const next = useDashboard.getState().year + dt * PLAY_SPEED_YEARS_PER_SEC;
      if (next >= end) {
        setYear(end);
        setPlaying(false);
        return;
      }
      setYear(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, end, setYear, setPlaying]);

  // Close the cluster list on Escape or a click elsewhere.
  useEffect(() => {
    if (!openCluster) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenCluster(null);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".tl-popover, .tl-hit")) setOpenCluster(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [openCluster]);

  const yearFromPointer = useCallback((clientX: number, el: Element) => x.invert(clientX - el.getBoundingClientRect().left), [x]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") setYear(year - big);
    else if (e.key === "ArrowRight") setYear(year + big);
    else if (e.key === "Home") setYear(TIMELINE_START);
    else if (e.key === "End") setYear(end);
    else if (e.key === " ") setPlaying(!playing);
    else return;
    e.preventDefault();
  };

  const openEvent = (ev: TimelineEvent) => {
    setPlaying(false);
    setYear(ev.t);
    selectNode(ev.id);
    if (ev.place) flyTo(ev.place.lon, ev.place.lat, 4);
    setOpenCluster(null);
    setHover(null);
  };

  const toggleLane = (kind: TimelineKind) =>
    setHiddenLanes((s) => {
      const next = new Set(s);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const popoverLeft = (cx: number, w: number) => Math.min(Math.max(0, cx - w / 2), Math.max(0, width - w));

  return (
    <div className="scrubber">
      <div className="scrubber__controls">
        <button
          type="button"
          className="icon-btn scrubber__play"
          onClick={() => {
            if (!playing && year >= end - 0.05) setYear(TIMELINE_START);
            setPlaying(!playing);
          }}
          aria-label={playing ? "Pause" : "Play through time"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="scrubber__readout">
          <span className="scrubber__year mono">{year >= end - 0.02 ? "Now" : formatMonthYear(year)}</span>
          <span className="scrubber__anomaly">
            {currentAnomaly !== undefined ? `${formatSigned(currentAnomaly, 2)} °C vs 1850–1900` : " "}
          </span>
        </div>
        <button type="button" className="btn" onClick={() => setYear(end)} disabled={year >= end - 0.02}>
          Today
        </button>
      </div>

      <div ref={ref} className="scrubber__track">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="slider"
            tabIndex={0}
            aria-label="Timeline year"
            aria-valuemin={TIMELINE_START}
            aria-valuemax={Math.floor(end)}
            aria-valuenow={Math.floor(year)}
            aria-valuetext={formatMonthYear(year)}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              if ((e.target as Element).closest(".tl-hit")) return;
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setPlaying(false);
              setOpenCluster(null);
              setYear(yearFromPointer(e.clientX, e.currentTarget));
            }}
            onPointerMove={(e) => dragging.current && setYear(yearFromPointer(e.clientX, e.currentTarget))}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            {/* Lane guides */}
            {LANES.map((l, i) => (
              <line key={l.kind} x1={0} x2={width} y1={lanesTop + i * LANE_H + LANE_H / 2} y2={lanesTop + i * LANE_H + LANE_H / 2} className="tl-lane" />
            ))}

            <Stripes annual={annual} x={x} top={stripesTop} height={STRIPES_H} />
            {/* Dim the future relative to the cursor */}
            <rect x={x(year)} y={stripesTop} width={Math.max(0, width - x(year))} height={STRIPES_H} fill="rgba(7,9,12,0.55)" />

            {x.ticks(Math.floor(width / 70)).map((t) => (
              <text key={t} x={x(t)} y={height - 1} className="scrubber__tick" textAnchor="middle">
                {t}
              </text>
            ))}

            {clusters.map((c) => {
              const active = c.events.some((e) => e.id === selectedNode) || openCluster?.key === c.key;
              const w = markWidth(c.events.length) + 2;
              return (
                <g
                  key={c.key}
                  className="tl-hit"
                  role="button"
                  tabIndex={-1}
                  aria-label={c.events.length > 1 ? `${c.events.length} events` : c.events[0]!.title}
                  onPointerEnter={() => setHover(c)}
                  onPointerLeave={() => setHover((h) => (h?.key === c.key ? null : h))}
                  onClick={() => (c.events.length === 1 ? openEvent(c.events[0]!) : setOpenCluster(openCluster?.key === c.key ? null : c))}
                >
                  <rect x={c.x - w / 2} y={c.y - LANE_H / 2} width={w} height={LANE_H} fill="transparent" />
                  {c.events.length === 1 ? <Glyph kind={c.kind} x={c.x} y={c.y} active={active} /> : <ClusterMark c={c} active={active} />}
                </g>
              );
            })}

            {/* Cursor */}
            <line x1={x(year)} x2={x(year)} y1={stripesTop - 2} y2={stripesTop + STRIPES_H} className="scrubber__cursor" />
            <circle cx={x(year)} cy={stripesTop + STRIPES_H} r={5} className="scrubber__handle" />
          </svg>
        )}

        {hover && !openCluster && (
          <div className="scrubber__tooltip" style={{ left: popoverLeft(hover.x, 280) }} role="tooltip">
            {hover.events.length === 1 ? (
              <EventSummary ev={hover.events[0]!} />
            ) : (
              <>
                <div className="muted">
                  {hover.events.length} × {LANES.find((l) => l.kind === hover.kind)!.label.toLowerCase()} ·{" "}
                  {hover.events[0]!.date.slice(0, 4)}–{hover.events.at(-1)!.date.slice(0, 4)}
                </div>
                <ul className="tl-list tl-list--preview">
                  {hover.events.slice(0, 5).map((e) => (
                    <li key={e.id}>
                      <span className="mono muted">{e.date.slice(0, 7)}</span> {e.title}
                    </li>
                  ))}
                </ul>
                <div className="muted">Click to list {hover.events.length > 5 ? `all ${hover.events.length}` : "them"}</div>
              </>
            )}
          </div>
        )}

        {openCluster && (
          <div className="tl-popover" style={{ left: popoverLeft(openCluster.x, 340) }} role="dialog" aria-label="Events">
            <div className="tl-popover__head">
              <span>
                {openCluster.events.length} × {LANES.find((l) => l.kind === openCluster.kind)!.label.toLowerCase()}
              </span>
              <button type="button" className="icon-btn" onClick={() => setOpenCluster(null)} aria-label="Close list">
                ✕
              </button>
            </div>
            <ul className="tl-list">
              {openCluster.events.map((e) => (
                <li key={e.id}>
                  <button type="button" className="tl-list__item" onClick={() => openEvent(e)}>
                    <span className="mono muted">{e.date.slice(0, 10)}</span>
                    <span>{e.title}</span>
                    {e.place && <span className="muted">{e.place.name}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="tl-popover__foot muted">Source: {LANE_SOURCE[openCluster.kind]}</div>
          </div>
        )}
      </div>

      <ul className="scrubber__legend" aria-label="Timeline lanes (click to show or hide)">
        {LANES.map((l) => (
          <li key={l.kind}>
            <button
              type="button"
              className={`tl-legend-btn${hiddenLanes.has(l.kind) ? " is-off" : ""}`}
              aria-pressed={!hiddenLanes.has(l.kind)}
              title={`Source: ${LANE_SOURCE[l.kind]}`}
              onClick={() => toggleLane(l.kind)}
            >
              <svg width={12} height={12} aria-hidden="true">
                <Glyph kind={l.kind} x={6} y={6} />
              </svg>
              {l.label}
              <span className="muted mono">{counts.get(l.kind) ?? 0}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KIND_NAME: Record<TimelineKind, string> = {
  attribution: "Attribution study",
  record: "Record in the data",
  law: "Climate law",
  cop: "UN climate conference",
};

function EventSummary({ ev }: { ev: TimelineEvent }) {
  return (
    <>
      <div className="muted">
        {KIND_NAME[ev.kind]} · {ev.kind === "attribution" ? `published ${ev.date}` : ev.date.slice(0, ev.kind === "record" ? 7 : 10)}
        {ev.place ? ` · ${ev.place.name}` : ""}
      </div>
      <strong>{ev.title}</strong>
      {ev.kind !== "attribution" && <div className="scrubber__attr">{ev.summary}</div>}
      <div className="muted">{ev.sourceName}</div>
    </>
  );
}
