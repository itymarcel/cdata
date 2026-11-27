import type {
  AttributionStudy,
  ClimateLaw,
  Co2Data,
  CopConference,
  SeaIceData,
  SourceId,
  TemperatureData,
  TimelineEvent,
} from "@shared/types.ts";
import { ymdToDecimalYear } from "@shared/time.ts";
import type { SourceStore } from "../lib/source-store.ts";
import type { CountriesGeoJson } from "../sources/geo.ts";
import { createGeocoder } from "./geocode.ts";
import { co2Thresholds, seaIceRecords, temperatureRecords } from "./records.ts";

const toT = (iso: string) => {
  const [y, m = 7, d = 1] = iso.split("-").map(Number);
  return ymdToDecimalYear(y!, m, d);
};

/** "COP21 · Paris", falling back to Wikidata's label when the session number is unknown. */
function copTitle(c: CopConference): string {
  const place = c.place ?? c.country;
  return c.number ? `${c.number}${place ? ` · ${place}` : ""}` : c.label;
}

export interface EventsBundle {
  events: TimelineEvent[];
  /** Per-source status for the stamps, keyed by source id. */
  sources: SourceId[];
}

/**
 * Merges every real-world event feed into one timeline. Each feed degrades on
 * its own: if one upstream is down its events are missing, the rest still show.
 */
export async function buildEvents(store: SourceStore): Promise<EventsBundle> {
  const safe = async <T>(id: SourceId) => {
    try {
      return await store.get<T>(id);
    } catch {
      return null;
    }
  };
  const [cops, laws, studies, countries, temp, co2, ice] = await Promise.all([
    safe<CopConference[]>("cops"),
    safe<ClimateLaw[]>("climateLaws"),
    safe<AttributionStudy[]>("wwaStudies"),
    safe<CountriesGeoJson>("countries"),
    safe<TemperatureData>("temperature"),
    safe<Co2Data>("co2"),
    safe<SeaIceData>("seaIce"),
  ]);

  const events: TimelineEvent[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const labelOf = new Map(countries?.data.features.map((f) => [f.properties.iso3, f.properties.label]) ?? []);

  if (cops) {
    for (const c of cops.data) {
      if (c.start > today) continue;
      const label = c.countryIso3 ? labelOf.get(c.countryIso3) : undefined;
      const lon = c.lon ?? label?.[0];
      const lat = c.lat ?? label?.[1];
      events.push({
        id: `cop-${c.id}`,
        date: c.start,
        t: toT(c.start),
        kind: "cop",
        title: copTitle(c),
        summary: `${c.label}${c.country ? `, ${c.country}` : ""}.`,
        place:
          lon !== undefined && lat !== undefined
            ? { name: c.place ?? c.country ?? "", lon, lat, iso3: c.countryIso3 ?? undefined }
            : undefined,
        sourceUrl: c.url,
        sourceName: "Wikidata",
        evidence: "reported",
      });
    }
  }

  if (laws) {
    for (const l of laws.data) {
      if (!l.date) continue;
      const label = l.countryIso3 ? labelOf.get(l.countryIso3) : undefined;
      events.push({
        id: `law-${l.id}`,
        date: l.date,
        t: toT(l.date),
        kind: "law",
        title: l.label,
        summary: l.country ? `Climate law, ${l.country}.` : "Climate law or agreement.",
        place: label ? { name: l.country ?? "", lon: label[0], lat: label[1], iso3: l.countryIso3 ?? undefined } : undefined,
        sourceUrl: l.url,
        sourceName: "Wikidata",
        evidence: "reported",
      });
    }
  }

  if (studies) {
    const geocoder = countries ? createGeocoder(countries.data) : null;
    for (const s of studies.data) {
      const located = geocoder?.locate(s.title, s.summary);
      const p = located?.primary;
      events.push({
        id: s.id,
        date: s.published,
        t: toT(s.published),
        kind: "attribution",
        title: s.title,
        summary: s.summary,
        place: p ? { name: p.name, lon: p.lon, lat: p.lat, iso3: p.iso3 } : undefined,
        attribution: { finding: s.title, study: "World Weather Attribution", hazards: s.hazards, url: s.url },
        sourceUrl: s.url,
        sourceName: "World Weather Attribution",
        evidence: "modelled",
      });
    }
  }

  if (temp) events.push(...temperatureRecords(temp.data, temp.source.url));
  if (co2) events.push(...co2Thresholds(co2.data, co2.source.url));
  if (ice) events.push(...seaIceRecords(ice.data, ice.source.url));

  events.sort((a, b) => a.t - b.t);
  return { events, sources: ["cops", "climateLaws", "wwaStudies", "temperature", "co2", "seaIce"] };
}
