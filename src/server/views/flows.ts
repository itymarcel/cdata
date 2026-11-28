import { TRADE_INFO, inSentence, usd } from "@shared/trade.ts";
import type { Envelope, FlowsView, RichText, StoryFact, TradeCommodity, TradeFlowsData } from "@shared/types.ts";
import type { SourceStore } from "../lib/source-store.ts";
import type { CountriesGeoJson } from "../sources/geo.ts";

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** The possessive ending: "China’s", but "Netherlands’". */
const apostrophe = (name: string) => (name.endsWith("s") ? "’" : "’s");

/**
 * Plain-language facts about one commodity's trade, every figure computed
 * from the payload. Shares are of exports *reported* for the year, and say so:
 * countries that don't report aren't in the denominator.
 */
export function flowFacts(d: TradeFlowsData, name: (iso3: string) => string): StoryFact[] {
  const info = TRADE_INFO[d.commodity];
  const what = inSentence(info.label);
  const facts: StoryFact[] = [];
  const basisWorld = `UN Comtrade HS ${d.hs}, ${d.year}: exports to the world summed over the ${d.reporters} countries that reported them`;

  const top = d.exporters[0];
  if (top && d.worldExports > 0) {
    facts.push({
      text: [{ em: name(top.iso3) }, `${apostrophe(name(top.iso3))} exports were `, { em: pct(top.value / d.worldExports) }, ` of all ${what} exports reported for ${d.year} (`, { em: usd(d.worldExports) }, ")."],
      basis: `${basisWorld}; ${name(top.iso3)}'s own reported exports ÷ that sum.`,
    });
  }
  if (d.exporters.length >= 3 && d.worldExports > 0) {
    const n = 3;
    const share = d.exporters.slice(0, n).reduce((s, e) => s + e.value, 0) / d.worldExports;
    facts.push({
      text: [`The top ${n} exporters (`, d.exporters.slice(0, n).map((e) => name(e.iso3)).join(", "), ") shipped ", { em: pct(share) }, " of it."],
      basis: `${basisWorld}; the three largest reporters' exports ÷ that sum.`,
    });
  }
  const biggest = d.flows[0];
  if (biggest) {
    const by = biggest.reportedBy === "importer" ? ` (as recorded by ${name(biggest.to)})` : "";
    facts.push({
      text: ["The largest single route: ", { em: `${name(biggest.from)} → ${name(biggest.to)}` }, ", ", { em: usd(biggest.value) }, `${by}.`],
      basis: `UN Comtrade HS ${d.hs}, ${d.year}: the largest exporter-to-partner value among the flows read (the ${d.exporters.length} largest exporters' records and the ${d.importers.length} largest importers' records).`,
    });
  }
  if (d.previous && d.previous.value > 0) {
    const change = d.previous.current / d.previous.value - 1;
    const text: RichText =
      Math.abs(change) < 0.01
        ? [`Reported exports were about flat between ${d.previous.year} and ${d.year}.`]
        : [`Reported exports `, change > 0 ? "rose " : "fell ", { em: pct(Math.abs(change)) }, ` from ${d.previous.year} to ${d.year}, like for like.`];
    facts.push({
      text,
      basis: `UN Comtrade HS ${d.hs}: exports to the world in ${d.previous.year} and ${d.year}, summed over the ${d.previous.reporters} countries that reported both years. Values are in current US dollars, so price changes count.`,
    });
  }
  const silent = d.silentExporters[0];
  if (silent && silent.value >= 0.01 * d.worldExports) {
    facts.push({
      text: [{ em: name(silent.iso3) }, ` filed no ${d.year} export figure; its `, { em: usd(silent.value) }, " shown here comes from its customers’ import records."],
      basis: `UN Comtrade HS ${d.hs}, ${d.year}: ${name(silent.iso3)} is not among the reporters of exports; the value sums imports from it recorded by the largest importers.`,
    });
  }
  return facts;
}

/**
 * The flows for the map. A first load reads a dozen or more Comtrade tables
 * under a rate limit and a call quota, so it can take minutes: rather than
 * hold the request open, we start it and answer `data: null` with the
 * source's status (its error says when the quota refills). The client polls.
 */
export async function buildFlows(store: SourceStore, commodity: TradeCommodity): Promise<Envelope<FlowsView | null>> {
  const id = `trade.${commodity}` as const;
  const env = store.peek<TradeFlowsData>(id);
  if (!env) {
    void store.refresh(id);
    return { source: store.status(id), data: null };
  }
  void store.get(id); // refreshes in the background when stale
  const geo = await store.get<CountriesGeoJson>("countries");
  const d = env.data;
  const neName = new Map(geo.data.features.map((f) => [f.properties.iso3, f.properties.name]));
  const name = (iso3: string) => neName.get(iso3) ?? geo.data.labelNames?.[iso3] ?? d.names[iso3] ?? iso3;
  const points = geo.data.labelPoints ?? {};

  const places: FlowsView["places"] = {};
  const flows = d.flows.filter((f) => {
    for (const iso3 of [f.from, f.to]) {
      const p = points[iso3];
      if (!p) return false;
      places[iso3] ??= { name: name(iso3), lon: p[0], lat: p[1] };
    }
    return true;
  });
  const info = TRADE_INFO[commodity];
  return {
    source: env.source,
    data: {
      commodity,
      label: info.label,
      group: info.group,
      hs: d.hs,
      year: d.year,
      flows,
      places,
      worldExports: d.worldExports,
      exporters: d.exporters,
      facts: flowFacts(d, name),
    },
  };
}
