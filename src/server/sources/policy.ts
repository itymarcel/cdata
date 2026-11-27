import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  CarbonMajor,
  CarbonMajorsData,
  IgccData,
  NdcData,
  NdcTarget,
  NetZeroTarget,
  SubsidiesData,
} from "@shared/types.ts";
import { DAY, WEEK } from "@shared/time.ts";
import { num, parseCsvRecords } from "../lib/csv.ts";
import { fetchJson, fetchText } from "../lib/http.ts";
import { round } from "../lib/stats.ts";
import { htmlToText } from "../lib/text.ts";
import { parseNdcTarget } from "../views/ndc-parse.ts";
import { identifyProducers } from "./producer-identity.ts";
import { defineSource } from "./types.ts";

// ---------------------------------------------------------------------------
// IGCC: remaining carbon budget, emissions and warming by compound
// ---------------------------------------------------------------------------

const IGCC_RAW = "https://raw.githubusercontent.com/ClimateIndicator/data/main/data";
const IGCC_EDITION = "IGCC-2025a";

export const igccSource = defineSource<IgccData>({
  meta: {
    id: "igcc",
    name: "Indicators of Global Climate Change",
    publisher: "IGCC (Forster et al., ESSD)",
    url: "https://github.com/ClimateIndicator/data",
    evidence: "modelled",
    cadence: "annual (June)",
    refreshMs: WEEK,
    lag: "~6 months",
    licence: "CC BY 4.0",
    note: "Remaining carbon budget for 1.5 °C at 50% likelihood, from the IGCC synthesis table. The range spans the assessment's parameter sets.",
  },
  async load() {
    const [budgetCsv, emissionsCsv, speciesCsv] = await Promise.all([
      fetchText(`${IGCC_RAW}/CDS/csv/co2-budget_global_igcc-assessment_synthesis_table_${IGCC_EDITION}.csv`),
      fetchText(`${IGCC_RAW}/CDS/csv/ghg-emissions_global_igcc-assessment_synthesis_annual-mean-timeseries_${IGCC_EDITION}.csv`),
      fetchText(`${IGCC_RAW}/base/anthropogenic_warming_by_species/temperature_relative_to_1750.csv`),
    ]);

    // Budget table: parameters, dT_targets, likelihood, remaining_carbon_budget
    const rows = parseCsvRecords(budgetCsv).filter(
      (r) => Math.abs((num(r.dT_targets) ?? 0) - 1.5) < 0.01 && Math.abs((num(r.likelihood) ?? 0) - 0.5) < 0.01,
    );
    if (rows.length === 0) throw new Error("IGCC budget table has no 1.5 °C / 50% rows");
    const values = rows.map((r) => num(r.remaining_carbon_budget)!).filter(Number.isFinite);
    // The first parameter set is the assessment's central configuration.
    const central = values[0]!;

    // Emissions timeseries: latest year with both CO2 components.
    const em = parseCsvRecords(emissionsCsv)
      .map((r) => ({ year: num(r.time), ffi: num(r.CO2_FFI), luc: num(r.CO2_LULUCF) }))
      .filter((r) => r.year !== null && r.ffi !== null && r.luc !== null);
    const last = em.at(-1);
    if (!last) throw new Error("IGCC emissions empty");

    const species = parseCsvRecords(speciesCsv).flatMap((r) => {
      const p50 = num(r.Total_p50);
      return p50 === null
        ? []
        : [{ compound: r["Compound emitted"] ?? "", p5: num(r.Total_p5) ?? p50, p50, p95: num(r.Total_p95) ?? p50 }];
    });

    const editionYear = Number(IGCC_EDITION.match(/\d{4}/)![0]);
    return {
      data: {
        edition: IGCC_EDITION,
        budget: {
          targetC: 1.5,
          likelihood: 0.5,
          gtCO2: round(central, 0),
          rangeGtCO2: [round(Math.min(...values), 0), round(Math.max(...values), 0)],
          // The 2025 edition assesses warming to the end of 2025, so the budget runs from 1 Jan 2026.
          fromYear: editionYear + 1,
        },
        co2Emissions: { year: last.year!, gt: round(last.ffi! + last.luc!, 2) },
        warmingBySpecies: species,
      },
      dataAsOf: `${editionYear}`,
    };
  },
});

// ---------------------------------------------------------------------------
// Climate Watch (WRI): NDC GHG targets and net-zero targets for every country
// ---------------------------------------------------------------------------

const CW = "https://www.climatewatchdata.org/api/v1/data";

interface CwRow {
  id: number;
  iso_code3: string;
  country: string;
  indicator_id: string;
  value: string;
}

async function cwAll(path: string, indicatorIds: number[]): Promise<CwRow[]> {
  const out: CwRow[] = [];
  const ids = indicatorIds.map((i) => `indicator_ids[]=${i}`).join("&");
  for (let page = 1; page <= 50; page++) {
    const res = await fetchJson<{ data: CwRow[] }>(`${CW}/${path}?${ids}&per_page=200&page=${page}`, {
      timeoutMs: 60_000,
    });
    out.push(...res.data);
    if (res.data.length < 200) break;
  }
  return out;
}

const IND_GHG_TARGET = 649030;
const IND_TARGET_YEAR = 649033;
const IND_NZ_STATUS = 649351;
const IND_NZ_YEAR = 649352;

export const ndcTargetsSource = defineSource<NdcData>({
  version: 3, // v3: level targets ("70% of 1990"); v2: target years paired from Climate Watch's target-year field
  meta: {
    id: "ndcTargets",
    name: "NDC and net-zero targets",
    publisher: "Climate Watch (World Resources Institute)",
    url: "https://www.climatewatchdata.org/ndcs-explore",
    evidence: "reported",
    cadence: "as countries submit NDCs",
    refreshMs: DAY,
    licence: "CC BY 4.0",
    note: "Target text is shown verbatim. Only economy-wide % cuts against a base year are plotted; intensity, peaking and baseline targets are listed as text.",
  },
  async load() {
    const [targets, targetYears, netZero] = await Promise.all([
      cwAll("ndc_content", [IND_GHG_TARGET]),
      cwAll("ndc_content", [IND_TARGET_YEAR]),
      cwAll("net_zero_content", [IND_NZ_STATUS, IND_NZ_YEAR]),
    ]);

    // Target text and target year are separate indicators, one row per NDC document,
    // listed in the same document order. Pair them by position when the counts match.
    const groupByCountry = (rows: CwRow[]) => {
      const m = new Map<string, CwRow[]>();
      for (const r of [...rows].sort((a, b) => a.id - b.id)) m.set(r.iso_code3, [...(m.get(r.iso_code3) ?? []), r]);
      return m;
    };
    const yearsByCountry = groupByCountry(targetYears);

    const seen = new Set<string>();
    const out: NdcTarget[] = [];
    for (const [iso, rows] of groupByCountry(targets)) {
      const years = yearsByCountry.get(iso);
      const paired = years && years.length === rows.length ? years : null;
      rows.forEach((r, i) => {
        const text = htmlToText(r.value ?? "");
        if (!text) return;
        const key = `${iso}|${text}`;
        if (seen.has(key)) return; // identical text repeated across documents
        seen.add(key);
        // Only trust a separately recorded year when it is a single plain year.
        const yearText = paired ? htmlToText(paired[i]!.value ?? "") : "";
        const fallback = /^\d{4}$/.test(yearText) ? Number(yearText) : null;
        out.push({ iso3: iso, country: r.country, text, parsed: parseNdcTarget(text, fallback), order: r.id });
      });
    }

    const nz = new Map<string, NetZeroTarget>();
    for (const r of netZero) {
      const t = nz.get(r.iso_code3) ?? { iso3: r.iso_code3, country: r.country, status: "", year: null };
      // e.g. "In Law (6/30/2021)<br>In Policy Document (12/18/2020)" → "In Law (6/30/2021) · In Policy Document (…)"
      if (r.indicator_id === "nz_status") t.status = (r.value ?? "").split(/<br\s*\/?>/i).map(htmlToText).filter(Boolean).join(" · ");
      if (r.indicator_id === "nz_year") t.year = num(r.value?.match(/\d{4}/)?.[0]);
      nz.set(r.iso_code3, t);
    }
    if (out.length < 50) throw new Error(`Climate Watch returned only ${out.length} targets`);
    return { data: { targets: out, netZero: [...nz.values()] }, dataAsOf: null };
  },
});

// ---------------------------------------------------------------------------
// Fossil-fuel subsidies (UN SDG indicator 12.c.1, via Our World in Data)
// ---------------------------------------------------------------------------

export const subsidiesSource = defineSource<SubsidiesData>({
  version: 2, // v2: world aggregate
  meta: {
    id: "subsidies",
    name: "Fossil-fuel subsidies (SDG 12.c.1)",
    publisher: "UN Environment Programme, via Our World in Data",
    url: "https://ourworldindata.org/grapher/fossil-fuel-subsidies",
    evidence: "reported",
    cadence: "annual",
    refreshMs: WEEK,
    lag: "~1–2 years",
    licence: "CC BY 4.0",
    note: "Explicit consumer and producer subsidies, current US dollars. Implicit subsidies (unpriced pollution) are not included.",
  },
  async load() {
    const rows = parseCsvRecords(
      await fetchText(
        "https://ourworldindata.org/grapher/fossil-fuel-subsidies.csv?v=1&csvType=full&useColumnShortNames=true",
      ),
    );
    const valueCol = Object.keys(rows[0] ?? {}).find((k) => !["entity", "code", "year"].includes(k));
    if (!valueCol) throw new Error("Subsidies CSV has no value column");
    const years = [...new Set(rows.map((r) => Number(r.year)))].filter(Number.isFinite).sort((a, b) => a - b);
    const yi = new Map(years.map((y, i) => [y, i]));
    const byIso = new Map<string, SubsidiesData["countries"][number]>();
    const world: (number | null)[] = years.map(() => null);
    for (const r of rows) {
      const iso = r.code ?? "";
      if (iso === "OWID_WRL") world[yi.get(Number(r.year))!] = num(r[valueCol]);
      if (iso.length !== 3) continue;
      const c = byIso.get(iso) ?? { iso3: iso, name: r.entity ?? iso, values: years.map(() => null) };
      c.values[yi.get(Number(r.year))!] = num(r[valueCol]);
      byIso.set(iso, c);
    }
    return {
      data: { unit: "US$", years, world: world.some((v) => v !== null) ? world : null, countries: [...byIso.values()] },
      dataAsOf: String(years.at(-1)),
    };
  },
});

// ---------------------------------------------------------------------------
// Carbon Majors: needs a free login to download, so it is read from a local file
// ---------------------------------------------------------------------------

export const CARBON_MAJORS_DIR = process.env.CARBON_MAJORS_DIR ?? "data/carbon-majors";
const CARBON_MAJORS_HEADER = /^\uFEFF?year,parent_entity,parent_type,/;

/**
 * Finds the Carbon Majors CSV in its folder whatever it is called: browsers save
 * the download as "get_cm_file.html" after the download link, not as a .csv.
 * The newest file whose first line is the Carbon Majors header wins.
 */
function findCarbonMajorsFile(): string | null {
  if (!existsSync(CARBON_MAJORS_DIR)) return null;
  const candidates = readdirSync(CARBON_MAJORS_DIR)
    .map((name) => join(CARBON_MAJORS_DIR, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const path of candidates) {
    const head = readFileSync(path, { encoding: "utf8", flag: "r" }).slice(0, 200);
    if (CARBON_MAJORS_HEADER.test(head)) return path;
  }
  return null;
}

export const carbonMajorsSource = defineSource<CarbonMajorsData>({
  meta: {
    id: "carbonMajors",
    name: "Carbon Majors (producer emissions)",
    publisher: "InfluenceMap",
    url: "https://carbonmajors.org/Downloads",
    evidence: "reported",
    cadence: "annual (November)",
    refreshMs: DAY,
    licence: "Non-commercial use, InfluenceMap terms",
    setup: `Download the low-granularity emissions file from carbonmajors.org (free login) and save it in ${CARBON_MAJORS_DIR}/ (any file name).`,
    note: "Emissions traced to the fossil fuels and cement each company or state produced.",
  },
  version: 2, // v2: Wikidata identity (logo, website) per entity
  isConfigured: () => findCarbonMajorsFile() !== null,
  async load() {
    const file = findCarbonMajorsFile();
    if (!file) throw new Error("Carbon Majors file not found");
    const rows = parseCsvRecords(await Bun.file(file).text());
    const byEntity = new Map<string, CarbonMajor>();
    const leis = new Map<string, string>();
    let totalMt = 0;
    for (const r of rows) {
      const entity = r.parent_entity ?? "";
      const year = num(r.year);
      const mt = num(r.total_emissions_MtCO2e);
      if (!entity || year === null || mt === null) continue;
      totalMt += mt;
      const e = byEntity.get(entity) ?? {
        entity,
        type: r.parent_type ?? "",
        commodities: [],
        cumulativeMt: 0,
        sinceYear: year,
        latestYear: year,
        latestMt: 0,
      };
      e.cumulativeMt += mt;
      e.sinceYear = Math.min(e.sinceYear, year);
      if (year > e.latestYear) {
        e.latestYear = year;
        e.latestMt = 0;
      }
      if (year === e.latestYear) e.latestMt += mt;
      if (r.commodity && !e.commodities.includes(r.commodity)) e.commodities.push(r.commodity);
      if (r.lei) leis.set(entity, r.lei);
      byEntity.set(entity, e);
    }
    const entities = [...byEntity.values()]
      .map((e) => ({ ...e, cumulativeMt: round(e.cumulativeMt, 1), latestMt: round(e.latestMt, 1) }))
      .sort((a, b) => b.cumulativeMt - a.cumulativeMt);
    if (entities.length === 0) throw new Error("Carbon Majors file has no recognised rows");
    const identities = await identifyProducers(entities.map((e) => ({ entity: e.entity, type: e.type, lei: leis.get(e.entity) })));
    for (const e of entities) Object.assign(e, identities.get(e.entity));
    return {
      data: { entities, totalMt: round(totalMt, 0) },
      dataAsOf: String(Math.max(...entities.map((e) => e.latestYear))),
    };
  },
});
