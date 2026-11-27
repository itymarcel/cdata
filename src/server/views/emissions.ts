import {
  ENERGY_SOURCES,
  FUELS,
  type CountrySeries,
  type EmissionsMatrix,
  type EmissionsMetric,
  type EnergyMix,
  type Envelope,
  type WorldByFuel,
} from "@shared/types.ts";
import type { SourceStore } from "../lib/source-store.ts";
import { round } from "../lib/stats.ts";
import type { Co2Column, EnergyColumn, OwidTable } from "../sources/owid.ts";

export const EMISSIONS_METRICS: Record<EmissionsMetric, { unit: string }> = {
  co2: { unit: "Mt CO₂" },
  co2_per_capita: { unit: "t CO₂ per person" },
  cumulative_co2: { unit: "Mt CO₂ since 1850" },
  consumption_co2: { unit: "Mt CO₂ (consumption-based)" },
  total_ghg: { unit: "Mt CO₂e (all GHGs, incl. land use)" },
};

export function isEmissionsMetric(v: string): v is EmissionsMetric {
  return v in EMISSIONS_METRICS;
}

/**
 * OWID's cumulative_co2 starts counting in 1750. We want "since 1850" to match
 * the timeline, so we re-accumulate annual CO₂ from 1850.
 */
function cumulativeSince1850(table: OwidTable<Co2Column>): (number | null)[][] {
  return table.columns.co2.map((series) => {
    let sum = 0;
    let seen = false;
    return series.map((v) => {
      if (v !== null) {
        sum += v;
        seen = true;
      }
      return seen ? round(sum, 1) : null;
    });
  });
}

function buildMatrix(t: OwidTable<Co2Column>, metric: EmissionsMetric): EmissionsMatrix {
  const values = metric === "cumulative_co2" ? cumulativeSince1850(t) : t.columns[metric];
  return {
    metric,
    unit: EMISSIONS_METRICS[metric].unit,
    years: t.years,
    countries: t.countries,
    values: values.map((s) => s.map((v) => (v === null ? null : round(v, 3)))),
    population: metric === "co2_per_capita" ? t.columns.population : undefined,
  };
}

export function createEmissionsViews(store: SourceStore) {
  /** Matrices are rebuilt only when the underlying source version changes. */
  const matrixCache = new Map<EmissionsMetric, { version: number; value: EmissionsMatrix }>();

  async function co2(): Promise<{ env: Envelope<OwidTable<Co2Column>>; version: number }> {
    const { envelope, version } = await store.getVersioned<OwidTable<Co2Column>>("owidCo2");
    return { env: envelope, version };
  }

  return {
    async matrix(metric: EmissionsMetric): Promise<Envelope<EmissionsMatrix>> {
      const { env, version } = await co2();
      let hit = matrixCache.get(metric);
      if (!hit || hit.version !== version) {
        hit = { version, value: buildMatrix(env.data, metric) };
        matrixCache.set(metric, hit);
      }
      return { source: env.source, data: hit.value };
    },

    async worldByFuel(): Promise<Envelope<WorldByFuel>> {
      const { env } = await co2();
      const t = env.data;
      const w = t.countries.findIndex((c) => c.iso3 === "WLD");
      if (w < 0) throw new Error("World aggregate missing from OWID data");
      const series = Object.fromEntries(
        FUELS.map((f) => [f, t.columns[`${f}_co2` as Co2Column][w]!.map((v) => (v === null ? null : round(v, 1)))]),
      ) as WorldByFuel["series"];
      return { source: env.source, data: { years: t.years, series, unit: "Mt CO₂" } };
    },

    async country(iso3: string): Promise<Envelope<CountrySeries> | null> {
      const { env } = await co2();
      const t = env.data;
      const c = t.countries.findIndex((x) => x.iso3 === iso3);
      if (c < 0) return null;
      return {
        source: env.source,
        data: {
          iso3,
          name: t.countries[c]!.name,
          years: t.years,
          co2: t.columns.co2[c]!,
          totalGhg: t.columns.total_ghg[c]!,
          consumptionCo2: t.columns.consumption_co2[c]!,
          population: t.columns.population[c]!,
        },
      };
    },

    async energyMix(iso3: string): Promise<Envelope<EnergyMix> | null> {
      const env = await store.get<OwidTable<EnergyColumn>>("owidEnergy");
      const t = env.data;
      const c = t.countries.findIndex((x) => x.iso3 === iso3);
      if (c < 0) return null;
      const shares = Object.fromEntries(
        ENERGY_SOURCES.map((s) => [s, t.columns[`${s}_share_elec`][c]!]),
      ) as EnergyMix["shares"];
      return { source: env.source, data: { iso3, name: t.countries[c]!.name, years: t.years, shares } };
    },

  };
}

export type EmissionsViews = ReturnType<typeof createEmissionsViews>;
