import { WEEK } from "@shared/time.ts";
import { fetchJson } from "../lib/http.ts";
import { round } from "../lib/stats.ts";
import { defineSource } from "./types.ts";

interface NEFeature {
  type: "Feature";
  properties: Record<string, string | number | null>;
  geometry: { type: string; coordinates: unknown };
}

export interface CountryProps {
  iso3: string;
  name: string;
  /** Natural Earth's label point: a sensible "centre" even for countries with overseas territories. */
  label: [number, number];
  /** Alternative names, used to match countries mentioned in text. */
  names: string[];
}

export interface CountriesGeoJson {
  type: "FeatureCollection";
  /**
   * Label point per ISO3 from the 1:50m file, which also has the small states
   * the 1:110m outlines leave out (Singapore, Hong Kong, Bahrain…). Flow arcs
   * start and end here.
   */
  labelPoints: Record<string, [number, number]>;
  /** Natural Earth's short name per ISO3 from the same file ("Hong Kong", not Comtrade's "China, Hong Kong SAR"). */
  labelNames: Record<string, string>;
  features: {
    type: "Feature";
    properties: CountryProps;
    geometry: { type: string; coordinates: unknown };
  }[];
}

/** Rounds coordinates to ~1 km to shrink the payload; 110m geometry doesn't need more. */
function roundCoords(c: unknown): unknown {
  return Array.isArray(c) ? (typeof c[0] === "number" ? c.map((n) => round(n as number, 2)) : c.map(roundCoords)) : c;
}

/** ISO_A3 is "-99" for some states (France, Norway, Kosovo…); fall back sensibly. */
function isoOf(p: NEFeature["properties"]): string {
  const iso3 = [p.ISO_A3, p.ISO_A3_EH, p.ADM0_A3].map(String).find((c) => c && c !== "-99") ?? "UNK";
  return iso3 === "KOS" ? "XKX" : iso3;
}

export const countriesSource = defineSource<CountriesGeoJson>({
  version: 4, // v2: label points and alternative names; v3: 1:50m label points for every country; v4: 1:50m names
  meta: {
    id: "countries",
    name: "Country boundaries (1:110m)",
    publisher: "Natural Earth",
    url: "https://www.naturalearthdata.com/",
    evidence: "curated",
    cadence: "rarely",
    refreshMs: 4 * WEEK,
    licence: "Public domain",
    note: "Boundaries are de facto, as drawn by Natural Earth; they are not an endorsement.",
  },
  async load() {
    const base = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
    const [fc, fine] = await Promise.all([
      fetchJson<{ features: NEFeature[] }>(`${base}/ne_110m_admin_0_countries.geojson`),
      fetchJson<{ features: NEFeature[] }>(`${base}/ne_50m_admin_0_countries.geojson`, { timeoutMs: 120_000 }),
    ]);
    const labelPoints: Record<string, [number, number]> = {};
    const labelNames: Record<string, string> = {};
    for (const f of fine.features) {
      const x = Number(f.properties.LABEL_X);
      const y = Number(f.properties.LABEL_Y);
      const iso3 = isoOf(f.properties);
      if (Number.isFinite(x) && Number.isFinite(y)) labelPoints[iso3] ??= [round(x, 3), round(y, 3)];
      if (typeof f.properties.NAME === "string") labelNames[iso3] ??= f.properties.NAME;
    }
    const features = fc.features.map((f) => {
      const p = f.properties;
      const iso3 = isoOf(p);
      const names = [p.NAME, p.NAME_LONG, p.ADMIN, p.NAME_EN, p.FORMAL_EN, p.NAME_SORT]
        .filter((n): n is string => typeof n === "string" && n.length > 2)
        .filter((n, i, a) => a.indexOf(n) === i);
      return {
        type: "Feature" as const,
        properties: {
          iso3,
          name: String(p.NAME ?? p.ADMIN ?? iso3),
          label: [round(Number(p.LABEL_X), 3), round(Number(p.LABEL_Y), 3)] as [number, number],
          names,
        },
        geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
      };
    });
    for (const f of features) labelPoints[f.properties.iso3] ??= f.properties.label;
    return { data: { type: "FeatureCollection", labelPoints, labelNames, features }, dataAsOf: null };
  },
});
