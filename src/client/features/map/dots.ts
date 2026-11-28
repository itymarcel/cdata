/**
 * The globe's land as a grid of dots, one country per dot, so the choropleth
 * colours dots rather than polygons. Rows are `step` degrees apart; along a
 * row the spacing widens by 1/cos(latitude) so dots sit about equally far
 * apart on the ground, and every other row is offset by half a step (a hex
 * pattern). Pure, tested in tests/arcs.test.ts.
 */

type Ring = [number, number][];
type Polygon = Ring[];

export interface DotFeature {
  properties: { iso3: string };
  geometry: { type: string; coordinates: unknown };
}

export interface LandDots {
  /** Flat [lon, lat, lon, lat, …] positions. */
  positions: Float32Array;
  /** Index into `isos` per dot. */
  country: Uint16Array;
  isos: string[];
  count: number;
}

interface Shape {
  iso: number;
  polygons: Polygon[];
  box: [number, number, number, number];
}

function polygonsOf(geometry: DotFeature["geometry"]): Polygon[] {
  if (geometry.type === "Polygon") return [geometry.coordinates as Polygon];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Polygon[];
  return [];
}

/** Even-odd ray casting in lon/lat; holes are just more rings. Natural Earth splits shapes at the antimeridian, so planar is fine. */
function inPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function landDots(features: DotFeature[], step = 0.7): LandDots {
  const isos: string[] = [];
  const shapes: Shape[] = [];
  for (const f of features) {
    const polygons = polygonsOf(f.geometry);
    if (!polygons.length) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of polygons)
      for (const [x, y] of p[0] ?? []) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    shapes.push({ iso: isos.push(f.properties.iso3) - 1, polygons, box: [x0, y0, x1, y1] });
  }

  const pos: number[] = [];
  const ctry: number[] = [];
  let row = 0;
  for (let lat = -90 + step / 2; lat < 90; lat += step, row++) {
    const stepLon = step / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    // Shapes whose box spans this latitude: most rows test a few dozen.
    const band = shapes.filter((s) => s.box[1] <= lat && s.box[3] >= lat);
    if (!band.length) continue;
    for (let lon = -180 + (row % 2 ? stepLon / 2 : 0); lon < 180; lon += stepLon) {
      for (const s of band) {
        if (lon < s.box[0] || lon > s.box[2]) continue;
        if (s.polygons.some((p) => inPolygon(lon, lat, p))) {
          pos.push(lon, lat);
          ctry.push(s.iso);
          break;
        }
      }
    }
  }
  return { positions: Float32Array.from(pos), country: Uint16Array.from(ctry), isos, count: ctry.length };
}
