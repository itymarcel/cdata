import type { TimelineEvent, TimelineKind } from "@shared/types.ts";

export interface Cluster {
  key: string;
  kind: TimelineKind;
  x: number;
  y: number;
  events: TimelineEvent[];
}

/** Width a cluster's mark takes on screen: a glyph for one event, a counted pill for several. */
export const markWidth = (n: number) => (n === 1 ? 9 : 6 + Math.min(3, String(n).length) * 5.5);

/**
 * Groups one lane's events so that no two marks overlap: start with one cluster
 * per event, then repeatedly merge the closest overlapping neighbours until every
 * mark has room. Each cluster sits at the mean position of its events.
 */
export function clusterLane(events: TimelineEvent[], x: (t: number) => number, y: number, kind: TimelineKind): Cluster[] {
  let cs: Cluster[] = events.map((e) => ({ key: `${kind}-${e.id}`, kind, x: x(e.t), y, events: [e] }));
  for (;;) {
    let worst = -1;
    let worstOverlap = 0;
    for (let i = 0; i < cs.length - 1; i++) {
      const a = cs[i]!;
      const b = cs[i + 1]!;
      const overlap = (markWidth(a.events.length) + markWidth(b.events.length)) / 2 + 2 - (b.x - a.x);
      if (overlap > worstOverlap) {
        worstOverlap = overlap;
        worst = i;
      }
    }
    if (worst < 0) return cs;
    const a = cs[worst]!;
    const b = cs[worst + 1]!;
    const merged = [...a.events, ...b.events];
    const mx = merged.reduce((acc, e) => acc + x(e.t), 0) / merged.length;
    cs = [...cs.slice(0, worst), { key: a.key, kind, x: mx, y, events: merged }, ...cs.slice(worst + 2)];
  }
}

