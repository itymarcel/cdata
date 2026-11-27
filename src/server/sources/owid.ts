import {
  ENERGY_SOURCES,
  LOSS_DRIVERS,
  type CountryInfo,
  type EnergySource,
  type LossDriver,
  type TreeCoverLossData,
} from "@shared/types.ts";
import { WEEK } from "@shared/time.ts";
import { num, parseCsv } from "../lib/csv.ts";
import { fetchText } from "../lib/http.ts";
import { defineSource } from "./types.ts";

/**
 * Our World in Data is the cleanest single source for long country time series.
 * We parse the big CSVs once, keep only the columns we use, and store them as
 * dense year × country matrices so per-request work is just slicing.
 */
export interface OwidTable<C extends string> {
  years: number[];
  countries: CountryInfo[];
  /** columns[col][countryIndex][yearIndex] */
  columns: Record<C, (number | null)[][]>;
}

/** OWID leaves aggregates' iso_code blank. We give the ones we need stable codes. */
const AGGREGATE_CODES: Record<string, string> = {
  World: "WLD",
  "European Union (27)": "EU27",
};

function buildTable<C extends string>(
  csv: string,
  columns: readonly C[],
  opts: { minYear: number },
): OwidTable<C> {
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw new Error("OWID CSV empty");
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`OWID column missing: ${name}`);
    return i;
  };
  const iCountry = idx("country");
  const iYear = idx("year");
  const iIso = idx("iso_code");
  const colIdx = columns.map(idx);

  // First pass: collect entities and year range.
  const countryIndex = new Map<string, number>();
  const countries: CountryInfo[] = [];
  let maxYear = opts.minYear;
  const kept: { c: number; y: number; row: string[] }[] = [];
  for (const row of rows) {
    const name = row[iCountry] ?? "";
    const iso = (row[iIso] ?? "") || AGGREGATE_CODES[name] || "";
    if (!iso || iso.startsWith("OWID_")) continue;
    const year = Number(row[iYear]);
    if (!Number.isFinite(year) || year < opts.minYear) continue;
    let c = countryIndex.get(iso);
    if (c === undefined) {
      c = countries.length;
      countryIndex.set(iso, c);
      countries.push({ iso3: iso, name });
    }
    maxYear = Math.max(maxYear, year);
    kept.push({ c, y: year, row });
  }

  const years = Array.from({ length: maxYear - opts.minYear + 1 }, (_, i) => opts.minYear + i);
  const out = Object.fromEntries(
    columns.map((col) => [col, countries.map(() => years.map(() => null as number | null))]),
  ) as Record<C, (number | null)[][]>;
  for (const { c, y, row } of kept) {
    columns.forEach((col, k) => {
      out[col][c]![y - opts.minYear] = num(row[colIdx[k]!]);
    });
  }

  // Trim trailing years where no column has any data (OWID pre-creates rows).
  let last = years.length - 1;
  const hasData = (yi: number) => columns.some((col) => out[col].some((series) => series[yi] !== null));
  while (last > 0 && !hasData(last)) last--;
  const trimmedYears = years.slice(0, last + 1);
  for (const col of columns) out[col] = out[col].map((s) => s.slice(0, last + 1));

  return { years: trimmedYears, countries, columns: out };
}

export const CO2_COLUMNS = [
  "co2",
  "co2_per_capita",
  "cumulative_co2",
  "consumption_co2",
  "total_ghg",
  "population",
  "coal_co2",
  "oil_co2",
  "gas_co2",
  "cement_co2",
  "flaring_co2",
  "land_use_change_co2",
  "methane",
] as const;
export type Co2Column = (typeof CO2_COLUMNS)[number];

export const owidCo2Source = defineSource<OwidTable<Co2Column>>({
  version: 2, // v2: methane column
  meta: {
    id: "owidCo2",
    name: "CO₂ and greenhouse gas emissions",
    publisher: "Our World in Data (Global Carbon Project, Jones et al.)",
    url: "https://github.com/owid/co2-data",
    evidence: "reported",
    cadence: "annual",
    refreshMs: WEEK,
    lag: "~1 year",
    licence: "CC BY 4.0",
    note: "Territorial emissions from national inventories and GCP estimates. Consumption-based figures adjust for trade.",
  },
  async load() {
    const csv = await fetchText("https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv", {
      timeoutMs: 120_000,
    });
    const table = buildTable(csv, CO2_COLUMNS, { minYear: 1850 });
    return { data: table, dataAsOf: String(table.years.at(-1)) };
  },
});

export type EnergyColumn = `${EnergySource}_share_elec`;
export const ENERGY_COLUMNS = ENERGY_SOURCES.map((s) => `${s}_share_elec` as EnergyColumn);

export const owidEnergySource = defineSource<OwidTable<EnergyColumn>>({
  meta: {
    id: "owidEnergy",
    name: "Electricity mix",
    publisher: "Our World in Data (Ember, Energy Institute)",
    url: "https://github.com/owid/energy-data",
    evidence: "reported",
    cadence: "annual",
    refreshMs: WEEK,
    lag: "~6 months",
    licence: "CC BY 4.0",
  },
  async load() {
    const csv = await fetchText("https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv", {
      timeoutMs: 120_000,
    });
    const table = buildTable(csv, ENERGY_COLUMNS, { minYear: 1985 });
    return { data: table, dataAsOf: String(table.years.at(-1)) };
  },
});

const DRIVER_COLUMNS: Record<LossDriver, string> = {
  permanent_agriculture: "tree_cover_loss_ha__category_permanent_agriculture",
  hard_commodities: "tree_cover_loss_ha__category_hard_commodities",
  shifting_cultivation: "tree_cover_loss_ha__category_shifting_cultivation",
  logging: "tree_cover_loss_ha__category_logging",
  wildfire: "tree_cover_loss_ha__category_wildfire",
  settlements_infrastructure: "tree_cover_loss_ha__category_settlements__and__infrastructure",
  other_natural_disturbances: "tree_cover_loss_ha__category_other_natural_disturbances",
};

export const treeCoverLossSource = defineSource<TreeCoverLossData>({
  meta: {
    id: "treeCoverLoss",
    name: "Tree cover loss by dominant driver",
    publisher: "University of Maryland & WRI Global Forest Watch, via Our World in Data",
    url: "https://ourworldindata.org/grapher/tree-cover-loss-by-dominant-driver",
    evidence: "observed",
    cadence: "annual",
    refreshMs: WEEK,
    lag: "~5 months after year end",
    licence: "CC BY 4.0",
    note: "Loss includes plantations and secondary forest and does not net off regrowth.",
  },
  async load() {
    const csv = await fetchText(
      "https://ourworldindata.org/grapher/tree-cover-loss-by-dominant-driver.csv?v=1&csvType=full&useColumnShortNames=true",
    );
    const [header, ...rows] = parseCsv(csv);
    if (!header) throw new Error("Tree cover loss CSV empty");
    const col = (name: string) => header.indexOf(name);
    const iEntity = col("entity");
    const iCode = col("code");
    const iYear = col("year");
    const driverIdx = LOSS_DRIVERS.map((d) => col(DRIVER_COLUMNS[d]));

    const yearSet = new Set<number>();
    for (const r of rows) {
      const y = num(r[iYear]);
      if (y !== null) yearSet.add(y);
    }
    const years = [...yearSet].sort((a, b) => a - b);
    const yi = new Map(years.map((y, i) => [y, i]));

    const world = Object.fromEntries(LOSS_DRIVERS.map((d) => [d, years.map(() => null as number | null)])) as
      TreeCoverLossData["world"];
    const countries = new Map<string, { iso3: string; name: string; values: (number | null)[] }>();

    for (const r of rows) {
      const y = yi.get(num(r[iYear]) ?? -1);
      if (y === undefined) continue;
      const entity = r[iEntity] ?? "";
      const code = r[iCode] ?? "";
      const vals = driverIdx.map((i) => num(r[i]));
      if (entity === "World") {
        LOSS_DRIVERS.forEach((d, k) => (world[d][y] = vals[k] ?? null));
        continue;
      }
      if (code.length !== 3) continue;
      let c = countries.get(code);
      if (!c) {
        c = { iso3: code, name: entity, values: years.map(() => null) };
        countries.set(code, c);
      }
      const present = vals.filter((v): v is number => v !== null);
      c.values[y] = present.length ? present.reduce((a, b) => a + b, 0) : null;
    }

    // Fail loudly rather than silently showing zero global loss.
    if (LOSS_DRIVERS.every((d) => world[d].every((v) => v === null))) {
      throw new Error("Tree cover loss: World aggregate missing");
    }

    return {
      data: { years, world, byCountry: [...countries.values()] },
      dataAsOf: String(years.at(-1)),
    };
  },
});
