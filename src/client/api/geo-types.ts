/** Minimal GeoJSON types, to avoid pulling in @types/geojson for three shapes. */
export interface Geometry {
  type: string;
  coordinates: unknown;
}

export interface Feature<G extends Geometry = Geometry, P = Record<string, unknown>> {
  type: "Feature";
  geometry: G;
  properties: P;
}

export interface FeatureCollection<G extends Geometry = Geometry, P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: Feature<G, P>[];
}
