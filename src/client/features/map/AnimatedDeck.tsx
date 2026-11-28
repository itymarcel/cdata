import type { Layer } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { useEffect, useMemo, useState } from "react";
import { cometAt, type ArcVertex } from "./arcs.ts";
import { DeckOverlay } from "./DeckOverlay.tsx";
import { ADDITIVE, type FlowArc } from "./useMapLayers.ts";

/** Seconds for a pulse to travel one route; every route takes the same time, so long hauls move faster. */
const TRAVEL_S = 2.6;
/** Pulses start at a per-route phase in [0, 1); one cycle covers the latest start plus the trail. */
const CYCLE = 2.4;
/** Comet tail, as a fraction of the route. */
const TRAIL = 0.18;
const FRAME_MS = 1000 / 30;

export interface Pulse {
  arcs: FlowArc[];
  colour: [number, number, number];
  width: (a: FlowArc) => number;
}

/**
 * The static layers plus comets running along the trade routes, exporter →
 * importer. Only this component re-renders per frame (at 30 fps); deck reuses
 * every other layer as-is. The comets are a few hundred vertices, rebuilt on
 * the CPU each frame. No comets when motion is off.
 */
export function AnimatedDeck({ layers, pulse, animate }: { layers: Layer[]; pulse: Pulse | null; animate: boolean }) {
  const [t, setT] = useState(0);
  const running = animate && pulse !== null && pulse.arcs.length > 0;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (now - last >= FRAME_MS && document.visibilityState === "visible") {
        last = now;
        setT((now - start) / 1000 / TRAVEL_S);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const all = useMemo(() => {
    if (!running || !pulse) return layers;
    const comets: { arc: FlowArc; path: ArcVertex[]; head: ArcVertex }[] = [];
    for (const arc of pulse.arcs) {
      const c = cometAt(arc.path, (t + CYCLE - arc.phase) % CYCLE, TRAIL);
      if (c) comets.push({ arc, ...c });
    }
    const [r, g, b] = pulse.colour;
    return [
      ...layers,
      new PathLayer<(typeof comets)[number]>({
        id: "flow-comets-glow",
        data: comets,
        getPath: (d) => d.path,
        getColor: [r, g, b, 60],
        getWidth: (d) => pulse.width(d.arc) * 3 + 6,
        widthUnits: "pixels",
        parameters: ADDITIVE,
      }),
      new PathLayer<(typeof comets)[number]>({
        id: "flow-comets",
        data: comets,
        getPath: (d) => d.path,
        getColor: [r, g, b, 235],
        getWidth: (d) => pulse.width(d.arc) + 1,
        widthUnits: "pixels",
        parameters: ADDITIVE,
      }),
      new ScatterplotLayer<(typeof comets)[number]>({
        id: "flow-comet-heads",
        data: comets,
        getPosition: (d) => d.head,
        getRadius: (d) => 1.2 + pulse.width(d.arc) / 2,
        radiusUnits: "pixels",
        getFillColor: [255, 255, 255, 240],
        parameters: ADDITIVE,
      }),
    ];
  }, [layers, pulse, running, t]);
  return <DeckOverlay layers={all} />;
}
