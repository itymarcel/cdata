/**
 * Great-circle arcs lifted off the globe: the shortest route between two
 * points, raised in the middle in proportion to its length, so long routes
 * arch high and short hops stay low. Pure maths, tested in tests/arcs.test.ts.
 */

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

type LonLat = readonly [number, number];
export type ArcVertex = [lon: number, lat: number, altitudeM: number];

function toVec([lon, lat]: LonLat): [number, number, number] {
  const φ = lat * RAD;
  const λ = lon * RAD;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

/** Central angle between two points, in radians. */
export function centralAngle(a: LonLat, b: LonLat): number {
  const [ax, ay, az] = toVec(a);
  const [bx, by, bz] = toVec(b);
  return Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
}

export interface ArcOptions {
  /** Peak height as a fraction of the route's length on the ground. */
  lift?: number;
  /** Vertices per radian of route; short routes get at least `minSegments`. */
  density?: number;
  minSegments?: number;
}

/**
 * Vertices along the great circle from `a` to `b`, with a sine-shaped
 * altitude profile (0 at both ends). Longitudes are unwrapped so consecutive
 * vertices never jump by 360°: a route across the Pacific runs 170 → 190
 * rather than 170 → −170, which keeps flat-map paths from crossing the world.
 * Antipodal points have no unique great circle; we bend through the pole-ward
 * side rather than divide by zero.
 */
export function arcPath(a: LonLat, b: LonLat, opts: ArcOptions = {}): ArcVertex[] {
  const { lift = 0.09, density = 24, minSegments = 12 } = opts;
  const d = centralAngle(a, b);
  if (d < 1e-6) return [];
  const n = Math.max(minSegments, Math.ceil(d * density));
  const va = toVec(a);
  let vb = toVec(b);
  // Nudge exact antipodes so the slerp has a plane to work in.
  if (Math.PI - d < 1e-6) vb = toVec([b[0] + 1e-3, b[1] + (b[1] >= 0 ? -1e-3 : 1e-3)]);
  const dd = centralAngle(a, [Math.atan2(vb[1], vb[0]) / RAD, Math.asin(vb[2]) / RAD]);
  const s = Math.sin(dd);
  const peak = EARTH_RADIUS_M * d * lift;

  const out: ArcVertex[] = [];
  let prevLon = a[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ka = Math.sin((1 - t) * dd) / s;
    const kb = Math.sin(t * dd) / s;
    const x = ka * va[0] + kb * vb[0];
    const y = ka * va[1] + kb * vb[1];
    const z = ka * va[2] + kb * vb[2];
    const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
    let lon = Math.atan2(y, x) / RAD;
    // Unwrap relative to the previous vertex.
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    out.push([lon, lat, peak * Math.sin(Math.PI * t)]);
  }
  return out;
}

/** The point at fraction `f` ∈ [0, 1] along a path whose vertices are evenly spaced in t. */
function pointAt(path: ArcVertex[], f: number): ArcVertex {
  const x = Math.max(0, Math.min(1, f)) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(x));
  const k = x - i;
  const a = path[i]!;
  const b = path[i + 1]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * A comet on the path at progress `p`: its head at p, its tail `trail` behind,
 * both clipped to the path. Null before it starts and once its tail has
 * arrived (p outside [0, 1 + trail]).
 */
export function cometAt(path: ArcVertex[], p: number, trail: number): { path: ArcVertex[]; head: ArcVertex } | null {
  if (path.length < 2 || p <= 0 || p >= 1 + trail) return null;
  const from = Math.max(0, p - trail);
  const to = Math.min(1, p);
  const n = path.length - 1;
  const out: ArcVertex[] = [pointAt(path, from)];
  for (let i = Math.ceil(from * n); i <= Math.floor(to * n); i++) if (i / n > from && i / n < to) out.push(path[i]!);
  const head = pointAt(path, to);
  out.push(head);
  return { path: out, head };
}

/** A stable pseudo-random phase in [0, 1) per route, so pulses don't all leave together. */
export function routePhase(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}
