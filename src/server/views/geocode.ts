import type { CountriesGeoJson } from "../sources/geo.ts";

export interface Place {
  name: string;
  lon: number;
  lat: number;
  iso3?: string;
}

/**
 * Common short forms and sub-national names that studies use instead of the
 * country name. This is a lookup table for matching text, not data.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  UK: "GBR",
  Britain: "GBR",
  England: "GBR",
  Scotland: "GBR",
  Wales: "GBR",
  US: "USA",
  "U.S.": "USA",
  America: "USA",
  California: "USA",
  Texas: "USA",
  Florida: "USA",
  Louisiana: "USA",
  "Pacific Northwest": "USA",
  Alaska: "USA",
  Hawaii: "USA",
  "Puerto Rico": "USA",
  Siberia: "RUS",
  Quebec: "CAN",
  "British Columbia": "CAN",
  Sicily: "ITA",
  Sardinia: "ITA",
  Bavaria: "DEU",
  Catalonia: "ESP",
  Valencia: "ESP",
  Andalusia: "ESP",
  "Rio Grande do Sul": "BRA",
  Queensland: "AUS",
  "New South Wales": "AUS",
  Kerala: "IND",
  Sindh: "PAK",
  Balochistan: "PAK",
  "Hong Kong": "CHN",
  "Great Barrier Reef": "AUS",
  Australian: "AUS",
  "Cape Town": "ZAF",
  "Emilia-Romagna": "ITA",
  Pantanal: "BRA",
  Brazilian: "BRA",
  Canadian: "CAN",
  Chinese: "CHN",
  Indian: "IND",
  Mexican: "MEX",
  Japanese: "JPN",
  Pakistani: "PAK",
  Italian: "ITA",
  Spanish: "ESP",
  Greek: "GRC",
  French: "FRA",
  German: "DEU",
  Türkiye: "TUR",
  Turkiye: "TUR",
  Czechia: "CZE",
  "DR Congo": "COD",
  "Democratic Republic of Congo": "COD",
  "Ivory Coast": "CIV",
  "Côte d'Ivoire": "CIV",
};

/** Multi-country regions, placed at a representative point. */
const REGIONS: Record<string, [number, number]> = {
  Mediterranean: [15, 38],
  Sahel: [2, 14],
  "Horn of Africa": [44, 6],
  "East Africa": [37, 0],
  "West Africa": [-3, 10],
  "Southern Africa": [25, -22],
  "North Africa": [10, 30],
  "South Asia": [78, 22],
  "Southeast Asia": [105, 12],
  "South East Asia": [105, 12],
  "Central America": [-86, 14],
  "South America": [-60, -15],
  Caribbean: [-72, 18],
  Scandinavia: [15, 63],
  Balkans: [20, 43],
  "Western Europe": [5, 49],
  "Central Europe": [15, 50],
  "Southern Europe": [10, 40],
  "Northern Europe": [15, 58],
  Europe: [12, 50],
  "Middle East": [45, 29],
  "Central Asia": [65, 43],
  Arctic: [0, 80],
  "North Pole": [0, 88],
  Antarctica: [0, -80],
  "La Plata": [-58, -30],
  Amazon: [-62, -4],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds a matcher that finds the first country or region named in a piece of text. */
export function createGeocoder(countries: CountriesGeoJson) {
  const byIso = new Map(countries.features.map((f) => [f.properties.iso3, f.properties]));
  const entries: { term: string; place: Place }[] = [];

  for (const f of countries.features) {
    const p = f.properties;
    for (const n of p.names) entries.push({ term: n, place: { name: p.name, lon: p.label[0], lat: p.label[1], iso3: p.iso3 } });
  }
  for (const [term, iso3] of Object.entries(COUNTRY_ALIASES)) {
    const p = byIso.get(iso3);
    if (p) entries.push({ term, place: { name: p.name, lon: p.label[0], lat: p.label[1], iso3 } });
  }
  for (const [term, [lon, lat]] of Object.entries(REGIONS)) entries.push({ term, place: { name: term, lon, lat } });

  // Longest terms first, so "South Sudan" wins over "Sudan" and "Southern Europe" over "Europe".
  entries.sort((a, b) => b.term.length - a.term.length);
  const pattern = new RegExp(`(?<![\\w-])(${entries.map((e) => escape(e.term)).join("|")})(?![\\w-])`, "g");
  const lookup = new Map(entries.map((e) => [e.term, e.place]));

  /** All places in order of appearance, deduplicated. */
  function findAll(text: string): Place[] {
    const out: Place[] = [];
    for (const m of text.matchAll(pattern)) {
      const place = lookup.get(m[1]!);
      if (place && !out.some((p) => p.name === place.name)) out.push(place);
    }
    return out;
  }

  return {
    /** Prefers a place named in the title; falls back to the summary. */
    locate(title: string, summary: string): { primary: Place | null; all: Place[] } {
      const fromTitle = findAll(title);
      const all = [...fromTitle, ...findAll(summary).filter((p) => !fromTitle.some((q) => q.name === p.name))];
      return { primary: all[0] ?? null, all };
    },
  };
}
