import type { Facility, FacilitiesData, FirePoint, FiresData, NaturalEvent, NaturalEventsData } from "@shared/types.ts";
import { DAY, MINUTE } from "@shared/time.ts";
import { num, parseCsv } from "../lib/csv.ts";
import { fetchJson, fetchText } from "../lib/http.ts";
import { round } from "../lib/stats.ts";
import { defineSource } from "./types.ts";

/**
 * NASA FIRMS publishes open 24-hour global CSVs that need no MAP_KEY.
 * VIIRS on NOAA-20 resolves fires at 375 m.
 */
export const firesSource = defineSource<FiresData>({
  meta: {
    id: "fires",
    name: "Active fires, last 24 h (VIIRS NOAA-20)",
    publisher: "NASA FIRMS",
    url: "https://firms.modaps.eosdis.nasa.gov/",
    evidence: "observed",
    cadence: "near real-time (~3 h after overpass)",
    refreshMs: 10 * MINUTE,
    lag: "≤ 3 hours",
    licence: "NASA open data (attribution)",
    note: "Thermal anomalies; includes some gas flares and industrial heat sources. Low-confidence detections removed.",
  },
  async load() {
    const csv = await fetchText(
      "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
      { timeoutMs: 90_000 },
    );
    const [header, ...rows] = parseCsv(csv);
    if (!header) throw new Error("FIRMS CSV empty");
    const i = (n: string) => header.indexOf(n);
    const [iLat, iLon, iFrp, iDate, iTime, iConf] = [
      i("latitude"),
      i("longitude"),
      i("frp"),
      i("acq_date"),
      i("acq_time"),
      i("confidence"),
    ];
    const confRank: Record<string, number> = { l: 0, n: 1, h: 2, low: 0, nominal: 1, high: 2 };
    const points: FirePoint[] = [];
    let newest = 0;
    for (const r of rows) {
      const conf = confRank[(r[iConf] ?? "").toLowerCase()] ?? 1;
      if (conf === 0) continue;
      const lat = num(r[iLat]);
      const lon = num(r[iLon]);
      if (lat === null || lon === null) continue;
      const hhmm = (r[iTime] ?? "0000").padStart(4, "0");
      const ts = Date.parse(`${r[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
      newest = Math.max(newest, ts || 0);
      points.push([round(lon, 3), round(lat, 3), round(num(r[iFrp]) ?? 0, 1), ts || 0, conf]);
    }
    return {
      data: { satellite: "VIIRS NOAA-20", points, windowHours: 24 },
      dataAsOf: newest ? new Date(newest).toISOString() : null,
    };
  },
});

interface EonetResponse {
  events: {
    id: string;
    title: string;
    link: string;
    categories: { id: string; title: string }[];
    sources: { id: string; url: string }[];
    geometry: {
      date: string;
      type: "Point" | "Polygon";
      coordinates: number[] | number[][][];
      magnitudeValue: number | null;
      magnitudeUnit: string | null;
    }[];
  }[];
}

/** NASA EONET: curated, near-real-time natural events (storms, fires, volcanoes, floods…). */
export const naturalEventsSource = defineSource<NaturalEventsData>({
  meta: {
    id: "naturalEvents",
    name: "Natural events (open)",
    publisher: "NASA Earth Observatory Natural Event Tracker (EONET)",
    url: "https://eonet.gsfc.nasa.gov/",
    evidence: "observed",
    cadence: "continuous",
    refreshMs: 15 * MINUTE,
    lag: "hours",
    licence: "NASA open data",
    note: "Events are logged by NASA from partner feeds. Inclusion does not imply climate attribution.",
  },
  async load() {
    const res = await fetchJson<EonetResponse>("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60");
    const events: NaturalEvent[] = [];
    let newest = "";
    for (const e of res.events) {
      const g = e.geometry.at(-1);
      if (!g) continue;
      let lon: number | undefined;
      let lat: number | undefined;
      if (g.type === "Point") [lon, lat] = g.coordinates as number[];
      else {
        // Polygon: use the centroid of the outer ring's vertices.
        const ring = (g.coordinates as number[][][])[0] ?? [];
        lon = ring.reduce((a, p) => a + (p[0] ?? 0), 0) / (ring.length || 1);
        lat = ring.reduce((a, p) => a + (p[1] ?? 0), 0) / (ring.length || 1);
      }
      if (lon === undefined || lat === undefined) continue;
      if (g.date > newest) newest = g.date;
      events.push({
        id: e.id,
        title: e.title,
        category: e.categories[0]?.id ?? "other",
        lon,
        lat,
        date: g.date,
        link: e.sources[0]?.url ?? e.link,
        magnitude:
          g.magnitudeValue !== null && g.magnitudeUnit ? { value: g.magnitudeValue, unit: g.magnitudeUnit } : undefined,
      });
    }
    return { data: { events }, dataAsOf: newest || null };
  },
});

interface TraceAsset {
  Id: number;
  Name: string;
  Country: string;
  Sector: string;
  AssetType: string;
  Centroid: { Geometry: [number, number] } | null;
  EmissionsSummary: { Gas: string; EmissionsQuantity: number | null }[];
}

const TRACE_SECTORS = ["power", "manufacturing", "fossil-fuel-operations", "mineral-extraction", "waste"] as const;
const PER_SECTOR = 500;

async function loadTraceYear(year: number): Promise<Facility[]> {
  const batches = await Promise.all(
    TRACE_SECTORS.map((sector) =>
      fetchJson<{ assets: TraceAsset[] | null }>(
        `https://api.climatetrace.org/v6/assets?limit=${PER_SECTOR}&sectors=${sector}&year=${year}`,
        { timeoutMs: 90_000 },
      ).then((res) => ({ sector, assets: res.assets ?? [] })),
    ),
  );
  const out: Facility[] = [];
  for (const { sector, assets } of batches) {
    for (const a of assets) {
      const co2e = a.EmissionsSummary.find((e) => e.Gas === "co2e_100yr")?.EmissionsQuantity;
      const [lon, lat] = a.Centroid?.Geometry ?? [];
      if (!co2e || lon === undefined || lat === undefined) continue;
      out.push({
        id: a.Id,
        name: a.Name,
        iso3: a.Country,
        sector,
        subsector: a.Sector,
        type: a.AssetType,
        lon,
        lat,
        co2e,
      });
    }
  }
  return out;
}

/** Climate TRACE: the largest emitting facilities per sector, from satellite + AI models. */
export const facilitiesSource = defineSource<FacilitiesData>({
  meta: {
    id: "facilities",
    name: "Largest emitting facilities",
    publisher: "Climate TRACE",
    url: "https://climatetrace.org/",
    evidence: "modelled",
    cadence: "monthly releases",
    refreshMs: DAY,
    lag: "~2 months to a year depending on sector",
    licence: "CC BY 4.0",
    note: `Top ${PER_SECTOR} assets per sector, CO₂e over 100 years. Estimates come from remote sensing and models, with per-asset confidence.`,
  },
  async load() {
    // Use the most recent full year that has data.
    const thisYear = new Date().getUTCFullYear();
    for (const year of [thisYear - 1, thisYear - 2, thisYear - 3]) {
      const facilities = await loadTraceYear(year);
      if (facilities.length > 100) return { data: { year, facilities }, dataAsOf: String(year) };
    }
    throw new Error("Climate TRACE returned no assets for recent years");
  },
});
