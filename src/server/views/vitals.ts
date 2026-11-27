import type {
  Co2Data,
  Era5DailyData,
  GistempData,
  IgccData,
  OceanHeatData,
  Point,
  SeaIceData,
  SeaLevelData,
  SourceId,
  Envelope,
  VitalSign,
} from "@shared/types.ts";
import { isoDate, toDecimalYear } from "@shared/time.ts";
import type { SourceStore } from "../lib/source-store.ts";
import { downsample, round } from "../lib/stats.ts";

const signed = (v: number, d: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

/**
 * Builds the headline strip. Each tile degrades on its own: if one upstream is
 * down, that tile shows "unavailable" and the others still render.
 */
export async function buildVitals(store: SourceStore): Promise<VitalSign[]> {
  const safe = async <T>(id: SourceId) => {
    try {
      return await store.get<T>(id);
    } catch {
      return null;
    }
  };
  const [co2, gistemp, era5, seaIce, seaLevel, oceanHeat] = await Promise.all([
    safe<Co2Data>("co2"),
    safe<GistempData>("gistemp"),
    safe<Era5DailyData>("era5Daily"),
    safe<SeaIceData>("seaIce"),
    safe<SeaLevelData>("seaLevel"),
    safe<OceanHeatData>("oceanHeat"),
  ]);

  const vitals: VitalSign[] = [];

  vitals.push({
    id: "co2",
    label: "Atmospheric CO₂",
    value: co2?.data.latest.ppm ?? null,
    unit: "ppm",
    decimals: 1,
    context:
      co2 && co2.data.yearAgo !== null ? `${signed(co2.data.latest.ppm - co2.data.yearAgo, 1)} ppm vs a year ago` : null,
    higherIsWorse: true,
    spark: co2 ? downsample(co2.data.monthly.filter(([t]) => t >= co2.data.latest.t - 10), 120) : [],
    source: co2?.source ?? store.status("co2"),
    evidence: "observed",
    asOf: co2?.data.latest.date ?? null,
  });

  vitals.push({
    id: "temperature",
    label: "Global temperature",
    value: gistemp?.data.latest.anomaly ?? null,
    unit: "°C",
    decimals: 2,
    context: gistemp ? `latest month vs ${gistemp.data.baseline}` : null,
    higherIsWorse: true,
    spark: gistemp ? downsample(gistemp.data.monthly.filter(([t]) => t >= gistemp.data.latest.t - 10), 120) : [],
    source: gistemp?.source ?? store.status("gistemp"),
    evidence: "observed",
    asOf: gistemp?.data.latest.date ?? null,
  });

  if (era5) {
    const { current, climatology, year, latest } = era5.data;
    const spark: Point[] = [];
    current.forEach((v, i) => {
      const c = climatology[i];
      if (v !== null && c !== undefined && !Number.isNaN(c)) spark.push([year + i / 365, round(v - c, 3)]);
    });
    vitals.push({
      id: "era5",
      label: "Today’s global air temp",
      value: latest.tempC,
      unit: "°C",
      decimals: 2,
      context: `${signed(latest.anomaly, 2)} °C vs 1991–2020 for the date`,
      higherIsWorse: true,
      spark,
      source: era5.source,
      evidence: "modelled",
      asOf: latest.date,
    });
  } else {
    vitals.push(unavailable("era5", "Today’s global air temp", "°C", store, "era5Daily"));
  }

  vitals.push({
    id: "seaIce",
    label: "Arctic sea ice",
    value: seaIce?.data.north.latest.extent ?? null,
    unit: "M km²",
    decimals: 2,
    context: seaIce ? `${signed(seaIce.data.north.latest.anomaly, 2)} M km² vs 1981–2010 for the date` : null,
    higherIsWorse: false,
    spark: seaIce ? seaIce.data.north.annualMinimum : [],
    source: seaIce?.source ?? store.status("seaIce"),
    evidence: "observed",
    asOf: seaIce?.data.north.latest.date ?? null,
  });

  vitals.push({
    id: "seaLevel",
    label: "Sea level rise",
    value: seaLevel?.data.latest.mm ?? null,
    unit: "mm since 1993",
    decimals: 0,
    context: seaLevel?.data.trendMmPerYear ? `trend ${seaLevel.data.trendMmPerYear} mm/yr` : null,
    higherIsWorse: true,
    spark: seaLevel ? downsample(seaLevel.data.series, 120) : [],
    source: seaLevel?.source ?? store.status("seaLevel"),
    evidence: "observed",
    asOf: seaLevel ? isoDate(new Date(Date.UTC(Math.floor(seaLevel.data.latest.t), 0, 1 + Math.round((seaLevel.data.latest.t % 1) * 365)))) : null,
  });

  vitals.push({
    id: "oceanHeat",
    label: "Ocean heat (0–2000 m)",
    value: oceanHeat?.data.latest.value ?? null,
    unit: "×10²² J",
    decimals: 1,
    context: oceanHeat ? `annual, ${oceanHeat.data.latest.year}` : null,
    higherIsWorse: true,
    spark: oceanHeat?.data.annual ?? [],
    source: oceanHeat?.source ?? store.status("oceanHeat"),
    evidence: "observed",
    asOf: oceanHeat ? String(oceanHeat.data.latest.year) : null,
  });

  vitals.push(carbonBudgetVital(await safe<IgccData>("igcc"), store));

  return vitals;
}

function unavailable(id: string, label: string, unit: string, store: SourceStore, source: SourceId): VitalSign {
  return {
    id,
    label,
    value: null,
    unit,
    decimals: 0,
    context: null,
    higherIsWorse: true,
    spark: [],
    source: store.status(source),
    evidence: "observed",
    asOf: null,
  };
}

/**
 * Remaining 1.5 °C budget: the IGCC assessed value, drawn down from the date it
 * is counted from at the latest annual CO₂ emissions in the same dataset.
 */
function carbonBudgetVital(igcc: Envelope<IgccData> | null, store: SourceStore): VitalSign {
  if (!igcc) return unavailable("carbonBudget", "1.5 °C carbon budget left", "Gt CO₂", store, "igcc");
  const { budget, co2Emissions, edition } = igcc.data;
  const rate = co2Emissions.gt;
  const at = (t: number) => budget.gtCO2 - rate * (t - budget.fromYear);
  const now = toDecimalYear(new Date());
  const remaining = at(now);
  const spark: Point[] = [];
  for (let t = budget.fromYear; t <= Math.max(now, budget.fromYear) + 3; t += 0.25) spark.push([t, round(at(t), 1)]);
  return {
    id: "carbonBudget",
    label: "1.5 °C carbon budget left",
    value: round(remaining, 1),
    unit: "Gt CO₂",
    decimals: 1,
    context:
      remaining > 0
        ? `≈ ${(remaining / rate).toFixed(1)} years at ${rate.toFixed(1)} Gt/yr`
        : "exhausted at current emission rates",
    higherIsWorse: false,
    spark,
    source: igcc.source,
    evidence: "modelled",
    asOf: isoDate(new Date()),
    live: { start: budget.gtCO2, startT: budget.fromYear, ratePerYear: rate },
    method:
      `${edition}: ${budget.gtCO2} Gt CO₂ remaining from 1 January ${budget.fromYear} for a 50% chance of limiting warming to 1.5 °C ` +
      `(${budget.rangeGtCO2[0]}–${budget.rangeGtCO2[1]} Gt across the assessment's parameter sets). ` +
      `Drawn down at ${rate} Gt CO₂ a year, the ${co2Emissions.year} fossil and land-use emissions in the same dataset. ` +
      `The countdown is a projection: actual emissions since then are not yet measured.`,
  };
}
