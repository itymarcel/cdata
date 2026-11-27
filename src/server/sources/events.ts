import type {
  AttributionStudy,
  ClimateLaw,
  CopConference,
  DisasterAlert,
  DisasterAlertsData,
  DisasterType,
  Hazard,
} from "@shared/types.ts";
import { DAY, HOUR } from "@shared/time.ts";
import { fetchJson } from "../lib/http.ts";
import { decodeEntities, htmlToText } from "../lib/text.ts";
import { parseWktPoint, qid, sparql } from "../lib/wikidata.ts";
import { defineSource } from "./types.ts";

// ---------------------------------------------------------------------------
// World Weather Attribution: every published study, via the site's WordPress API
// ---------------------------------------------------------------------------

const WWA = "https://www.worldweatherattribution.org";
const WWA_HAZARDS: Record<string, Hazard> = {
  heatwave: "heatwave",
  rainfall: "rainfall",
  drought: "drought",
  storms: "storm",
  wildfire: "wildfire",
  "cold-spells": "cold",
};

interface WpPost {
  id: number;
  date: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  categories: number[];
}

export const wwaStudiesSource = defineSource<AttributionStudy[]>({
  meta: {
    id: "wwaStudies",
    name: "Extreme-event attribution studies",
    publisher: "World Weather Attribution",
    url: WWA,
    evidence: "modelled",
    cadence: "as studies are published (several a month)",
    refreshMs: 6 * HOUR,
    lag: "studies follow events by days to months",
    licence: "© WWA; headlines and links only",
    note: "Each study's own headline is shown as its finding. Locations are matched from country and region names in the study text.",
  },
  async load() {
    const cats = await fetchJson<{ id: number; slug: string }[]>(
      `${WWA}/wp-json/wp/v2/categories?per_page=100&_fields=id,slug`,
    );
    const hazardByCat = new Map(cats.flatMap((c) => (WWA_HAZARDS[c.slug] ? [[c.id, WWA_HAZARDS[c.slug]!]] : [])));
    const include = [...hazardByCat.keys()].join(",");

    const posts: WpPost[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await fetchJson<WpPost[]>(
        `${WWA}/wp-json/wp/v2/posts?per_page=100&page=${page}&categories=${include}&_fields=id,date,link,title,excerpt,categories`,
      ).catch((err) => {
        // WordPress answers 400 past the last page.
        if (page > 1) return [];
        throw err;
      });
      posts.push(...batch);
      if (batch.length < 100) break;
    }
    if (posts.length === 0) throw new Error("WWA returned no studies");

    const studies: AttributionStudy[] = posts.map((p) => ({
      id: `wwa-${p.id}`,
      published: p.date.slice(0, 10),
      title: decodeEntities(p.title.rendered).trim(),
      summary: htmlToText(p.excerpt.rendered).replace(/\s*\[…\]\s*$/, "…"),
      hazards: [...new Set(p.categories.flatMap((c) => (hazardByCat.has(c) ? [hazardByCat.get(c)!] : [])))],
      url: p.link,
    }));
    studies.sort((a, b) => a.published.localeCompare(b.published));
    return { data: studies, dataAsOf: studies.at(-1)!.published };
  },
});

// ---------------------------------------------------------------------------
// Wikidata: UN climate conferences and climate laws
// ---------------------------------------------------------------------------

const COP_QUERY = `
SELECT ?c ?cLabel ?start ?coord ?locLabel ?locAdminLabel ?country ?countryLabel ?iso3 ?article ?alias WHERE {
  ?c wdt:P31 wd:Q7888355 .
  OPTIONAL { ?c skos:altLabel ?alias FILTER(LANG(?alias) = "en" && STRSTARTS(?alias, "COP")) }
  OPTIONAL { ?c wdt:P580 ?start }
  OPTIONAL { ?c wdt:P276 ?loc . OPTIONAL { ?loc wdt:P625 ?locCoord } OPTIONAL { ?loc wdt:P131 ?locAdmin } }
  OPTIONAL { ?c wdt:P625 ?ownCoord }
  OPTIONAL { ?c wdt:P17 ?country . OPTIONAL { ?country wdt:P298 ?iso3 } OPTIONAL { ?country wdt:P625 ?countryCoord } }
  BIND(COALESCE(?ownCoord, ?locCoord, ?countryCoord) AS ?coord)
  OPTIONAL { ?article schema:about ?c ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}`;

const VENUE = /\b(cent(er|re|ro)|hotel|hall|office|exhibition|exposiciones|expo|stadium|palace|complex)\b/i;

/** Picks the session name from aliases: "COP21" over "COP 21"; "COP6-2" for resumed sessions. */
function copNumber(aliases: Set<string> | undefined): string | null {
  if (!aliases) return null;
  const list = [...aliases];
  const resumed = list.find((a) => /^COP ?\d+(-2| part 2)$/i.test(a));
  if (resumed) return `COP${resumed.match(/\d+/)![0]}-2`;
  const plain = list.find((a) => /^COP ?\d+$/i.test(a));
  return plain ? `COP${plain.match(/\d+/)![0]}` : null;
}

export const copsSource = defineSource<CopConference[]>({
  version: 4, // v4: venue → administrative area, session numbers
  meta: {
    id: "cops",
    name: "UN Climate Change Conferences (COPs)",
    publisher: "Wikidata",
    url: "https://www.wikidata.org/wiki/Q7888355",
    evidence: "reported",
    cadence: "community-edited",
    refreshMs: DAY,
    licence: "CC0",
    note: "Where Wikidata's start date contradicts the year in the conference name, the name's year is used.",
  },
  async load() {
    const rows = await sparql(COP_QUERY);
    const byId = new Map<string, CopConference>();
    const aliases = new Map<string, Set<string>>();
    for (const r of rows) {
      const id = qid(r.c!);
      if (r.alias) aliases.set(id, (aliases.get(id) ?? new Set()).add(r.alias));
      const label = r.cLabel ?? id;
      const labelYear = label.match(/\b(19|20)\d{2}\b/)?.[0];
      let start = r.start?.slice(0, 10) ?? (labelYear ? `${labelYear}-11-15` : null);
      if (!start) continue;
      // Guard against data-entry slips, e.g. Bali 2007 recorded with a 2017 start date.
      if (labelYear && !start.startsWith(labelYear)) start = `${labelYear}${start.slice(4)}`;
      const point = parseWktPoint(r.coord);
      const existing = byId.get(id);
      // Several rows per item (one per location or alias); keep the first with coordinates.
      if (existing && (existing.lon !== null || !point)) continue;
      byId.set(id, {
        id,
        label,
        number: null,
        start,
        // Venues ("Maritim Hotel Bonn", "SEC Centre") read better as the place they're in.
        place: (VENUE.test(r.locLabel ?? "") ? r.locAdminLabel : r.locLabel) ?? r.locLabel ?? null,
        country: r.countryLabel ?? null,
        countryIso3: r.iso3 ?? null,
        lon: point?.[0] ?? null,
        lat: point?.[1] ?? null,
        url: r.article ?? `https://www.wikidata.org/wiki/${id}`,
      });
    }
    for (const [id, c] of byId) c.number = copNumber(aliases.get(id));
    const cops = [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
    if (cops.length < 10) throw new Error(`Only ${cops.length} COPs returned`);
    const past = cops.filter((c) => c.start <= new Date().toISOString().slice(0, 10));
    return { data: cops, dataAsOf: past.at(-1)?.start ?? null };
  },
});

/** Laws whose main subject is climate change or emissions. Coverage on Wikidata is partial. */
const LAW_QUERY = `
SELECT DISTINCT ?l ?lLabel ?date ?country ?countryLabel ?iso3 ?article WHERE {
  ?l wdt:P31/wdt:P279* wd:Q820655 .
  ?l wdt:P921 ?topic .
  # global warming, climate change, climate change mitigation, greenhouse gas, GHG emissions,
  # CO2 emissions, carbon neutrality, net-zero, emission trading, carbon emission trading
  VALUES ?topic { wd:Q7942 wd:Q125928 wd:Q898653 wd:Q167336 wd:Q106358009 wd:Q3588927 wd:Q1774424 wd:Q138030486 wd:Q8348417 wd:Q5037988 }
  OPTIONAL { ?l wdt:P577|wdt:P571|wdt:P7588|wdt:P585 ?date }
  OPTIONAL { ?l wdt:P17|wdt:P1001 ?country . OPTIONAL { ?country wdt:P298 ?iso3 } }
  OPTIONAL { ?article schema:about ?l ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}`;

export const climateLawsSource = defineSource<ClimateLaw[]>({
  version: 2, // v2: verified topic ids
  meta: {
    id: "climateLaws",
    name: "Climate laws (Wikidata)",
    publisher: "Wikidata",
    url: "https://www.wikidata.org/",
    evidence: "reported",
    cadence: "community-edited",
    refreshMs: DAY,
    licence: "CC0",
    note: "Partial coverage. The comprehensive database (Climate Change Laws of the World) needs an API token.",
  },
  async load() {
    const rows = await sparql(LAW_QUERY);
    const byId = new Map<string, ClimateLaw>();
    for (const r of rows) {
      const id = qid(r.l!);
      const label = r.lLabel ?? id;
      if (/^Q\d+$/.test(label)) continue; // no English label
      const prev = byId.get(id);
      const date = r.date?.slice(0, 10) ?? null;
      // Keep the earliest date recorded for the law.
      if (prev && (!date || (prev.date && prev.date <= date))) continue;
      byId.set(id, {
        id,
        label,
        date,
        country: r.countryLabel ?? null,
        countryIso3: r.iso3 ?? null,
        url: r.article ?? `https://www.wikidata.org/wiki/${id}`,
      });
    }
    const laws = [...byId.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    return { data: laws, dataAsOf: laws.filter((l) => l.date).at(-1)?.date ?? null };
  },
});

// ---------------------------------------------------------------------------
// GDACS: orange and red alerts for floods, cyclones, droughts and wildfires
// ---------------------------------------------------------------------------

const GDACS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";
const GDACS_FROM = 2000;

interface GdacsFeature {
  geometry: { type: string; coordinates: number[] };
  properties: {
    eventtype: DisasterType;
    eventid: number;
    episodeid: number;
    name: string;
    eventname: string;
    alertlevel: "Green" | "Orange" | "Red";
    fromdate: string;
    todate: string;
    iso3: string;
    severitydata?: { severitytext?: string };
    url?: { report?: string };
  };
}

export const disasterAlertsSource = defineSource<DisasterAlertsData>({
  meta: {
    id: "disasterAlerts",
    name: "Disaster alerts (orange & red)",
    publisher: "GDACS (UN OCHA & European Commission JRC)",
    url: "https://www.gdacs.org/",
    evidence: "modelled",
    cadence: "continuous",
    refreshMs: 3 * HOUR,
    lag: "minutes to hours",
    licence: "GDACS terms (attribution)",
    note: "Alert levels estimate humanitarian impact from hazard models. They are not climate attribution.",
  },
  async load() {
    const thisYear = new Date().getUTCFullYear();
    const years = Array.from({ length: thisYear - GDACS_FROM + 1 }, (_, i) => GDACS_FROM + i);
    const alerts: DisasterAlert[] = [];
    // Sequential: GDACS is a public humanitarian service; don't hammer it.
    for (const y of years) {
      const fc = await fetchJson<{ features?: GdacsFeature[] }>(
        `${GDACS}?eventlist=FL;TC;DR;WF&fromDate=${y}-01-01&toDate=${y}-12-31&alertlevel=Orange;Red`,
        { timeoutMs: 60_000 },
      );
      for (const f of fc.features ?? []) {
        const p = f.properties;
        if (p.alertlevel === "Green" || f.geometry.type !== "Point") continue;
        const [lon, lat] = f.geometry.coordinates;
        if (lon === undefined || lat === undefined) continue;
        alerts.push({
          id: `${p.eventtype}-${p.eventid}`,
          type: p.eventtype,
          name: (p.name || p.eventname).replace(/,\s*,/g, ",").trim(),
          alert: p.alertlevel,
          from: p.fromdate.slice(0, 10),
          to: p.todate.slice(0, 10),
          lon,
          lat,
          iso3: p.iso3 || null,
          severity: p.severitydata?.severitytext ?? null,
          url: p.url?.report ?? "https://www.gdacs.org/",
        });
      }
    }
    // Multi-year events (droughts) appear in several yearly queries.
    const unique = [...new Map(alerts.map((a) => [a.id, a])).values()].sort((a, b) => a.from.localeCompare(b.from));
    return { data: { alerts: unique, fromYear: GDACS_FROM }, dataAsOf: unique.at(-1)?.from ?? null };
  },
});
