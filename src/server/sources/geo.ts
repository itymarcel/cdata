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

export const countriesSource = defineSource<CountriesGeoJson>({
  version: 2, // v2: label points and alternative names
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
    const fc = await fetchJson<{ features: NEFeature[] }>(
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    );
    const features = fc.features.map((f) => {
      const p = f.properties;
      // ISO_A3 is "-99" for some states (France, Norway, Kosovo…); fall back sensibly.
      const candidates = [p.ISO_A3, p.ISO_A3_EH, p.ADM0_A3].map(String);
      const iso3 = candidates.find((c) => c && c !== "-99") ?? "UNK";
      const names = [p.NAME, p.NAME_LONG, p.ADMIN, p.NAME_EN, p.FORMAL_EN, p.NAME_SORT]
        .filter((n): n is string => typeof n === "string" && n.length > 2)
        .filter((n, i, a) => a.indexOf(n) === i);
      return {
        type: "Feature" as const,
        properties: {
          iso3: iso3 === "KOS" ? "XKX" : iso3,
          name: String(p.NAME ?? p.ADMIN ?? iso3),
          label: [round(Number(p.LABEL_X), 3), round(Number(p.LABEL_Y), 3)] as [number, number],
          names,
        },
        geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
      };
    });
    return { data: { type: "FeatureCollection", features }, dataAsOf: null };
  },
});
