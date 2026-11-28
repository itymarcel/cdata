import { ACTION_DATASETS, type ActionDataset, type ClimateActionData, type CountryInfo, type CountryTableData } from "@shared/types.ts";
import { WEEK } from "@shared/time.ts";
import { num, parseCsv } from "../lib/csv.ts";
import { fetchText } from "../lib/http.ts";
import { defineSource } from "./types.ts";

/**
 * What countries are doing about it: clean power built, electric cars sold,
 * forest planted and land protected. Each is an OWID grapher table that
 * compiles one primary publisher; `ACTION_ORIGIN` credits that publisher.
 */
export const ACTION_ORIGIN: Record<
  ActionDataset,
  { slug: string; column: string; name: string; publisher: string; unit: string; decimals: number; note?: string }
> = {
  solar: {
    slug: "installed-solar-pv-capacity",
    column: "solar__total_gw",
    name: "Installed solar capacity",
    publisher: "IRENA Renewable Capacity Statistics, via Our World in Data",
    unit: "GW",
    decimals: 1,
    note: "On- and off-grid photovoltaic and concentrated solar power.",
  },
  wind: {
    slug: "cumulative-installed-wind-energy-capacity-gigawatts",
    column: "wind__total_gw",
    name: "Installed wind capacity",
    publisher: "IRENA Renewable Capacity Statistics, via Our World in Data",
    unit: "GW",
    decimals: 1,
    note: "Onshore and offshore.",
  },
  evShare: {
    slug: "electric-car-sales-share",
    column: "ev_sales_share",
    name: "Share of new cars sold that are electric",
    publisher: "IEA Global EV Outlook, via Our World in Data",
    unit: "% of new cars",
    decimals: 1,
    note: "Battery-electric and plug-in hybrid cars.",
  },
  forestChange: {
    slug: "annual-change-forest-area",
    column: "net_change_forest_area",
    name: "Net change in forest area",
    publisher: "FAO Global Forest Resources Assessment, via Our World in Data",
    unit: "ha per year",
    decimals: 0,
    note: "Forest expansion (afforestation and natural expansion) minus deforestation. FAO reports it as a yearly average over each assessment period, so neighbouring years repeat.",
  },
  afforestation: {
    slug: "annual-afforestation",
    column: "_1d_afforestation",
    name: "Afforestation",
    publisher: "FAO Global Forest Resources Assessment, via Our World in Data",
    unit: "ha per year",
    decimals: 0,
    note: "Forest established by planting or deliberate seeding on land that was not forest. A yearly average over each FAO assessment period.",
  },
  protectedLand: {
    slug: "terrestrial-protected-areas",
    column: "er_lnd_ptld_zs",
    name: "Protected land",
    publisher: "UNEP-WCMC & IUCN Protected Planet (WDPA), via World Bank and Our World in Data",
    unit: "% of land area",
    decimals: 1,
  },
};

export const grapherUrl = (slug: string) => `https://ourworldindata.org/grapher/${slug}`;

/** OWID's codes for the aggregates the rest of the dashboard names "WLD" and "EU27". */
const AGGREGATES: Record<string, string> = { OWID_WRL: "WLD", OWID_EU27: "EU27" };

/** Reads an OWID grapher CSV (entity, code, year, value) into a year × country table. World becomes "WLD". */
export function readGrapherTable(csv: string, column: string): CountryTableData {
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw new Error("Grapher CSV empty");
  const iEntity = header.indexOf("entity");
  const iCode = header.indexOf("code");
  const iYear = header.indexOf("year");
  const iValue = header.indexOf(column);
  if (iEntity < 0 || iCode < 0 || iYear < 0 || iValue < 0) throw new Error(`Grapher CSV: column ${column} missing`);

  const countries: CountryInfo[] = [];
  const index = new Map<string, number>();
  const cells: { c: number; y: number; v: number }[] = [];
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const r of rows) {
    const code = AGGREGATES[r[iCode] ?? ""] ?? r[iCode] ?? "";
    // Countries (three-letter ISO), the world and the EU; OWID's other regions carry OWID_ codes.
    if (!/^[A-Z]{3}$/.test(code) && code !== "EU27") continue;
    const y = num(r[iYear]);
    const v = num(r[iValue]);
    if (y === null || v === null) continue;
    let c = index.get(code);
    if (c === undefined) {
      c = countries.length;
      index.set(code, c);
      countries.push({ iso3: code, name: r[iEntity] ?? code });
    }
    cells.push({ c, y, v });
    minYear = Math.min(minYear, y);
    maxYear = Math.max(maxYear, y);
  }
  if (!cells.length) throw new Error(`Grapher CSV: no values in ${column}`);
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  const values = countries.map(() => years.map(() => null as number | null));
  for (const { c, y, v } of cells) values[c]![y - minYear] = v;
  return { years, countries, values };
}

export const climateActionSource = defineSource<ClimateActionData>({
  meta: {
    id: "climateAction",
    name: "Climate action: clean power, electric cars, forests, protected land",
    publisher: "Our World in Data (IRENA, IEA, FAO, UNEP-WCMC)",
    url: "https://ourworldindata.org/",
    evidence: "reported",
    cadence: "annual",
    refreshMs: WEEK,
    lag: "~6 months (capacity, EVs); FAO every five years",
    licence: "CC BY 4.0",
    note: "National statistics compiled by each agency. Forest figures are FAO's period averages.",
  },
  async load() {
    const tables = await Promise.all(
      ACTION_DATASETS.map(async (id) => {
        const o = ACTION_ORIGIN[id];
        const csv = await fetchText(`${grapherUrl(o.slug)}.csv?v=1&csvType=full&useColumnShortNames=true`, { timeoutMs: 60_000 });
        return [id, readGrapherTable(csv, o.column)] as const;
      }),
    );
    const data = Object.fromEntries(tables) as ClimateActionData;
    const newest = Math.max(data.solar.years.at(-1)!, data.wind.years.at(-1)!);
    return { data, dataAsOf: String(newest) };
  },
});
