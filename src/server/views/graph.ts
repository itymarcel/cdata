import {
  FUELS,
  LOSS_DRIVERS,
  type Fuel,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type CarbonMajorsData,
  type IgccData,
  type LossDriver,
  type SourceId,
  type TimelineEvent,
  type TreeCoverLossData,
} from "@shared/types.ts";
import type { SourceStore } from "../lib/source-store.ts";
import type { CountriesGeoJson } from "../sources/geo.ts";
import type { Co2Column, OwidTable } from "../sources/owid.ts";
import { buildEvents } from "./events.ts";

const IPCC_AR6 = "https://www.ipcc.ch/report/ar6/wg1/";
const OWID_CO2 = "https://github.com/owid/co2-data";
const IGCC = "https://github.com/ClimateIndicator/data";
const TOP_EMITTERS = 10;
const TOP_FOREST_LOSS = 6;
const TOP_PRODUCERS = 10;

const FUEL_LABEL: Record<Fuel, string> = {
  coal: "Coal",
  oil: "Oil",
  gas: "Gas",
  cement: "Cement",
  flaring: "Gas flaring",
  land_use_change: "Land-use change",
};
const LOSS_LABEL: Record<LossDriver, string> = {
  permanent_agriculture: "Permanent agriculture",
  hard_commodities: "Mining & energy",
  shifting_cultivation: "Shifting cultivation",
  logging: "Logging",
  wildfire: "Wildfire",
  settlements_infrastructure: "Settlements & infrastructure",
  other_natural_disturbances: "Other natural disturbances",
};
/** IGCC compounds shown as drivers of warming. CO₂ and CH₄ map onto the live indicators. */
const COMPOUND_NODE: Record<string, { id: string; label: string }> = {
  CO2: { id: "ind-co2", label: "CO₂" },
  CH4: { id: "ind-ch4", label: "Methane" },
  N2O: { id: "drv-n2o", label: "Nitrous oxide" },
  SO2: { id: "drv-so2", label: "Sulphur dioxide (aerosols)" },
  "CFC+HCFC+HFC": { id: "drv-fgases", label: "Halocarbons (CFCs, HFCs)" },
  "Black carbon": { id: "drv-bc", label: "Black carbon (soot)" },
};

const fmtMt = (mt: number) => (mt >= 1000 ? `${(mt / 1000).toFixed(1)} Gt` : `${Math.round(mt)} Mt`);
const fmtHa = (ha: number) => (ha >= 1e6 ? `${(ha / 1e6).toFixed(1)} Mha` : `${Math.round(ha / 1000)} kha`);

/** Latest year index where the series has a value. */
function lastIdx(series: (number | null)[]): number {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null) return i;
  return -1;
}

/**
 * Builds the connections graph from the live datasets. Every node and link
 * carries the dataset it came from. The only hand-written links are four
 * physical relationships assessed by IPCC AR6, cited as such.
 */
export async function buildGraphFromData(store: SourceStore): Promise<GraphData> {
  const safe = async <T>(id: SourceId) => {
    try {
      return await store.get<T>(id);
    } catch {
      return null;
    }
  };
  const [owid, forest, igcc, countries, majors, bundle] = await Promise.all([
    safe<OwidTable<Co2Column>>("owidCo2"),
    safe<TreeCoverLossData>("treeCoverLoss"),
    safe<IgccData>("igcc"),
    safe<CountriesGeoJson>("countries"),
    safe<CarbonMajorsData>("carbonMajors"), // optional: only when the file is present
    buildEvents(store),
  ]);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let seq = 0;
  const addNode = (n: GraphNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };
  const addEdge = (e: Omit<GraphEdge, "id">) => {
    if (nodes.has(e.source) && nodes.has(e.target)) edges.push({ id: `e${++seq}`, ...e });
  };
  const label = new Map(countries?.data.features.map((f) => [f.properties.iso3, f.properties]) ?? []);
  const countryNode = (iso3: string, name: string, description = "") => {
    const p = label.get(iso3);
    return addNode({
      id: `country-${iso3}`,
      kind: "actor",
      label: name,
      description: description || `Country. Select it to filter the map and charts.`,
      iso3,
      lon: p?.label[0],
      lat: p?.label[1],
      zoom: 3.5,
    });
  };

  // ---- Indicators (live) ----------------------------------------------------
  addNode({ id: "ind-co2", kind: "indicator", label: "Atmospheric CO₂", description: "Measured at Mauna Loa since 1958.", indicator: "co2", lon: -155.58, lat: 19.54, zoom: 4 });
  addNode({ id: "ind-ch4", kind: "indicator", label: "Methane", description: "Global mean atmospheric methane (NOAA).", indicator: "ch4" });
  addNode({ id: "ind-temp", kind: "indicator", label: "Global temperature", description: "Surface temperature anomaly vs 1850–1900.", indicator: "temperature" });
  addNode({ id: "ind-ocean-heat", kind: "indicator", label: "Ocean heat", description: "Heat stored in the upper 2,000 m of ocean (NOAA).", indicator: "oceanHeat" });
  addNode({ id: "ind-sea-level", kind: "indicator", label: "Sea level", description: "Global mean sea level from satellite altimetry (NOAA).", indicator: "seaLevel" });
  addNode({ id: "ind-sea-ice", kind: "indicator", label: "Arctic sea ice", description: "Daily Arctic sea-ice extent (NSIDC).", indicator: "seaIce", lon: 0, lat: 80, zoom: 2 });
  addNode({ id: "ind-forest", kind: "indicator", label: "Tree cover loss", description: "Annual tree cover loss (UMD / Global Forest Watch).", indicator: "treeCoverLoss" });

  // ---- Fuels → CO₂, and top emitters → fuels (OWID / Global Carbon Project) ---
  if (owid) {
    const t = owid.data;
    const w = t.countries.findIndex((c) => c.iso3 === "WLD");
    if (w >= 0) {
      const yi = lastIdx(t.columns.coal_co2[w]!);
      const year = t.years[yi]!;
      const total = FUELS.reduce((a, f) => a + (t.columns[`${f}_co2` as Co2Column][w]![yi] ?? 0), 0);
      for (const f of FUELS) {
        const v = t.columns[`${f}_co2` as Co2Column][w]![yi];
        if (!v) continue;
        const id = f === "land_use_change" ? "drv-landuse" : `drv-${f}`;
        addNode({
          id,
          kind: "driver",
          label: FUEL_LABEL[f],
          description: `${fmtMt(v)} CO₂ worldwide in ${year}, ${Math.round((v / total) * 100)}% of the total.`,
          sourceUrl: OWID_CO2,
          sourceName: "Global Carbon Project via OWID",
        });
        addEdge({
          source: id,
          target: "ind-co2",
          relation: `${fmtMt(v)} CO₂ in ${year} (${Math.round((v / total) * 100)}%)`,
          evidence: f === "land_use_change" ? "attributed" : "documented",
          confidence: f === "land_use_change" ? "medium" : undefined,
          note: f === "land_use_change" ? "Land-use emissions are estimated with bookkeeping models and carry wide uncertainty." : undefined,
          sourceUrl: OWID_CO2,
          sourceName: "Global Carbon Project via OWID",
        });
      }
      const mi = lastIdx(t.columns.methane[w]!);
      const methane = t.columns.methane[w]![mi];
      if (methane) {
        addNode({
          id: "drv-methane",
          kind: "driver",
          label: "Methane emissions",
          description: `${fmtMt(methane)} CO₂-equivalent of methane in ${t.years[mi]}, from agriculture, fossil fuels and waste.`,
          sourceUrl: OWID_CO2,
          sourceName: "Jones et al. via OWID",
        });
        addEdge({ source: "drv-methane", target: "ind-ch4", relation: `${fmtMt(methane)} CO₂e in ${t.years[mi]}`, evidence: "documented", sourceUrl: OWID_CO2, sourceName: "Jones et al. via OWID" });
      }
    }

    // Top emitters by latest-year CO₂, each linked to its two largest fuels.
    const ranked = t.countries
      .map((c, i) => ({ c, i, yi: lastIdx(t.columns.co2[i]!) }))
      .filter(({ c, yi }) => c.iso3.length === 3 && c.iso3 !== "WLD" && yi >= 0)
      .sort((a, b) => (t.columns.co2[b.i]![b.yi] ?? 0) - (t.columns.co2[a.i]![a.yi] ?? 0))
      .slice(0, TOP_EMITTERS);
    for (const { c, i, yi } of ranked) {
      const co2 = t.columns.co2[i]![yi]!;
      const year = t.years[yi]!;
      const id = countryNode(c.iso3, c.name, `${fmtMt(co2)} CO₂ in ${year}.`);
      const fuels = (["coal", "oil", "gas", "cement"] as const)
        .map((f) => ({ f, v: t.columns[`${f}_co2` as Co2Column][i]![yi] ?? 0 }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 2);
      for (const { f, v } of fuels) {
        if (v <= 0) continue;
        addEdge({
          source: id,
          target: `drv-${f}`,
          relation: `${fmtMt(v)} CO₂ from ${f} in ${year} (${Math.round((v / co2) * 100)}% of its total)`,
          evidence: "documented",
          sourceUrl: OWID_CO2,
          sourceName: "Global Carbon Project via OWID",
        });
      }
    }
  }

  // ---- Fossil-fuel producers (Carbon Majors, when connected) ----------------
  if (majors) {
    const d = majors.data;
    for (const e of d.entities.slice(0, TOP_PRODUCERS)) {
      const id = addNode({
        id: `producer-${e.entity}`,
        kind: "actor",
        label: e.entity,
        description: `${e.type}. ${fmtMt(e.cumulativeMt)} CO₂e traced to its production, ${e.sinceYear}–${e.latestYear}.`,
        sourceUrl: majors.source.url,
        sourceName: "Carbon Majors (InfluenceMap)",
      });
      addEdge({
        source: id,
        target: "ind-co2",
        relation: `${fmtMt(e.cumulativeMt)} CO₂e since ${e.sinceYear} (${((e.cumulativeMt / d.totalMt) * 100).toFixed(1)}% of the Carbon Majors total)`,
        evidence: "documented",
        note: "Emissions from burning the fuels and cement the entity produced, as compiled by Carbon Majors.",
        sourceUrl: majors.source.url,
        sourceName: "Carbon Majors (InfluenceMap)",
      });
    }
  }

  // ---- Warming by compound (IGCC assessment) ------------------------------
  if (igcc) {
    for (const s of igcc.data.warmingBySpecies) {
      const meta = COMPOUND_NODE[s.compound];
      if (!meta) continue;
      if (!nodes.has(meta.id)) {
        addNode({ id: meta.id, kind: "driver", label: meta.label, description: `Emitted compound assessed by IGCC.`, sourceUrl: IGCC, sourceName: "IGCC" });
      }
      const sameSign = Math.sign(s.p5) === Math.sign(s.p95);
      addEdge({
        source: meta.id,
        target: "ind-temp",
        relation: `${s.p50 >= 0 ? "warms" : "cools"} ${s.p50 >= 0 ? "+" : "−"}${Math.abs(s.p50).toFixed(2)} °C since 1750`,
        evidence: "attributed",
        confidence: sameSign ? "high" : "medium",
        note: `Range ${s.p5.toFixed(2)} to ${s.p95.toFixed(2)} °C (5–95%), ${igcc.data.edition}.`,
        sourceUrl: IGCC,
        sourceName: `IGCC ${igcc.data.edition}`,
      });
    }
  }

  // ---- Forests (UMD / GFW via OWID) ------------------------------------------
  if (forest) {
    const d = forest.data;
    const yi = d.years.length - 1;
    const year = d.years[yi]!;
    const total = LOSS_DRIVERS.reduce((a, k) => a + (d.world[k][yi] ?? 0), 0);
    addEdge({
      source: "ind-forest",
      target: "drv-landuse",
      relation: `${fmtHa(total)} lost in ${year}`,
      evidence: "documented",
      sourceUrl: forest.source.url,
      sourceName: "UMD / Global Forest Watch",
    });
    const drivers = LOSS_DRIVERS.map((k) => ({ k, v: d.world[k][yi] ?? 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3);
    for (const { k, v } of drivers) {
      const id = addNode({
        id: `loss-${k}`,
        kind: "driver",
        label: LOSS_LABEL[k],
        description: `Dominant driver of ${fmtHa(v)} of tree cover loss in ${year} (${Math.round((v / total) * 100)}%).`,
        sourceUrl: forest.source.url,
        sourceName: "UMD / Global Forest Watch",
      });
      addEdge({ source: id, target: "ind-forest", relation: `${fmtHa(v)} in ${year} (${Math.round((v / total) * 100)}%)`, evidence: "documented", sourceUrl: forest.source.url, sourceName: "UMD / Global Forest Watch" });
    }
    const topLoss = d.byCountry
      .map((c) => ({ c, v: c.values[yi] ?? 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, TOP_FOREST_LOSS);
    for (const { c, v } of topLoss) {
      const id = countryNode(c.iso3, c.name);
      addEdge({ source: id, target: "ind-forest", relation: `lost ${fmtHa(v)} of tree cover in ${year}`, evidence: "documented", sourceUrl: forest.source.url, sourceName: "UMD / Global Forest Watch" });
    }
  }

  // ---- Events: COPs, laws, attribution studies, records ----------------------
  const events = bundle.events;
  const cops = events.filter((e) => e.kind === "cop");
  const eventNode = (e: TimelineEvent, kind: GraphNode["kind"]) =>
    addNode({
      id: e.id,
      kind,
      label: e.title,
      description: e.summary,
      t: e.t,
      lon: e.place?.lon,
      lat: e.place?.lat,
      zoom: e.place ? 4 : undefined,
      sourceUrl: e.sourceUrl,
      sourceName: e.sourceName,
    });

  cops.forEach((e, i) => {
    eventNode(e, "policy");
    if (i > 0) addEdge({ source: cops[i - 1]!.id, target: e.id, relation: "followed by", evidence: "documented", sourceUrl: e.sourceUrl, sourceName: "Wikidata" });
    if (e.place?.iso3) addEdge({ source: countryNode(e.place.iso3, label.get(e.place.iso3)?.name ?? e.place.name), target: e.id, relation: "hosted", evidence: "documented", sourceUrl: e.sourceUrl, sourceName: "Wikidata" });
  });

  for (const e of events.filter((x) => x.kind === "law")) {
    eventNode(e, "policy");
    if (e.place?.iso3) addEdge({ source: countryNode(e.place.iso3, label.get(e.place.iso3)?.name ?? e.place.name), target: e.id, relation: "enacted", evidence: "documented", sourceUrl: e.sourceUrl, sourceName: "Wikidata" });
  }

  for (const e of events.filter((x) => x.kind === "attribution")) {
    eventNode(e, "event");
    addEdge({
      source: "ind-temp",
      target: e.id,
      relation: "attribution study",
      evidence: "attributed",
      note: `${e.attribution?.finding ?? e.title} (headline of the study).`,
      sourceUrl: e.sourceUrl,
      sourceName: "World Weather Attribution",
    });
    if (e.place) {
      const placeId = e.place.iso3
        ? countryNode(e.place.iso3, label.get(e.place.iso3)?.name ?? e.place.name)
        : addNode({ id: `place-${e.place.name}`, kind: "place", label: e.place.name, description: "Region named in attribution studies.", lon: e.place.lon, lat: e.place.lat, zoom: 3 });
      addEdge({ source: e.id, target: placeId, relation: "occurred in", evidence: "documented", note: "Location matched from the study text.", sourceUrl: e.sourceUrl, sourceName: "World Weather Attribution" });
    }
  }

  const RECORD_INDICATOR: Record<string, string> = { "rec-temp": "ind-temp", "rec-co2": "ind-co2", "rec-ice": "ind-sea-ice" };
  for (const e of events.filter((x) => x.kind === "record")) {
    eventNode(e, "event");
    const ind = Object.entries(RECORD_INDICATOR).find(([prefix]) => e.id.startsWith(prefix))?.[1];
    if (ind) addEdge({ source: ind, target: e.id, relation: "record in the data", evidence: "documented", sourceUrl: e.sourceUrl, sourceName: e.sourceName });
  }

  // ---- Physical links assessed by IPCC AR6 (the only hand-written edges) ----
  const ipcc = (source: string, target: string, relation: string, note: string) =>
    addEdge({ source, target, relation, evidence: "attributed", confidence: "high", note: `IPCC AR6 WG1: ${note}`, sourceUrl: IPCC_AR6, sourceName: "IPCC AR6 (curated)" });
  ipcc("ind-co2", "ind-ocean-heat", "heats", "extremely likely that human influence is the main driver of upper-ocean warming since the 1970s.");
  ipcc("ind-ocean-heat", "ind-sea-level", "thermal expansion", "thermal expansion explained about half of sea level rise over 1971–2018.");
  ipcc("ind-temp", "ind-sea-level", "melts land ice", "human influence was very likely the main driver of sea level rise since at least 1971.");
  ipcc("ind-temp", "ind-sea-ice", "shrinks", "human influence is very likely the main driver of Arctic sea-ice decrease since 1979.");

  return { nodes: [...nodes.values()], edges };
}
