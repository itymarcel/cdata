import { color as parseColor } from "d3-color";
import { interpolateRgb } from "d3-interpolate";
import type { EnergySource, Evidence, Fuel, LossDriver, NodeKind } from "@shared/types.ts";

/** Mirrors the CSS tokens. deck.gl and sigma need raw values, not CSS variables. */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"] as const;

export const INK = {
  primary: "#eef0f2",
  secondary: "#a9b0ba",
  muted: "#6f7885",
  grid: "#1f262f",
  axis: "#343c47",
  surface: "#0e1116",
  accent: "#ff8a3d",
} as const;

/** Any CSS colour ("#3987e5", "rgb(…)") → [r, g, b] for WebGL layers. */
export function toRgb(css: string): [number, number, number] {
  const c = parseColor(css)?.rgb();
  if (!c) throw new Error(`Unparseable colour: ${css}`);
  return [Math.round(c.r), Math.round(c.g), Math.round(c.b)];
}

/** Fixed hue per entity so filtering never repaints the survivors. */
export const NODE_KIND_COLOR: Record<NodeKind, string> = {
  indicator: SERIES[0],
  driver: SERIES[1],
  actor: SERIES[6],
  event: SERIES[7],
  policy: SERIES[2],
  place: SERIES[3],
};

export const FUEL_COLOR: Record<Fuel, string> = {
  coal: SERIES[0],
  oil: SERIES[1],
  gas: SERIES[2],
  cement: SERIES[3],
  flaring: SERIES[4],
  land_use_change: SERIES[5],
};

export const ENERGY_COLOR: Record<EnergySource, string> = {
  coal: SERIES[0],
  gas: SERIES[1],
  oil: SERIES[2],
  nuclear: SERIES[3],
  hydro: SERIES[4],
  wind: SERIES[5],
  solar: SERIES[6],
  other_renewables: SERIES[7],
};

export const LOSS_DRIVER_COLOR: Record<LossDriver, string> = {
  permanent_agriculture: SERIES[0],
  hard_commodities: SERIES[1],
  shifting_cultivation: SERIES[2],
  logging: SERIES[3],
  wildfire: SERIES[4],
  settlements_infrastructure: SERIES[5],
  other_natural_disturbances: SERIES[6],
};

export const FACILITY_SECTOR_COLOR: Record<string, string> = {
  power: SERIES[0],
  manufacturing: SERIES[1],
  "fossil-fuel-operations": SERIES[2],
  "mineral-extraction": SERIES[3],
  waste: SERIES[4],
};

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  observed: "Observed: measured by instruments",
  modelled: "Modelled: derived from models, reanalysis or our own calculation",
  reported: "Reported: compiled from national inventories or company disclosures",
  curated: "Curated: assembled by hand from published sources; check the citation",
};

/** Sequential emissions ramp on a dark ground: dim → bright thermal. */
const EMISSION_STOPS = ["#2a1a12", "#5a2a12", "#9a4115", "#d95926", "#ff8a3d", "#ffc08a", "#fff0dd"];
export function emissionsColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (EMISSION_STOPS.length - 1);
  const i = Math.min(EMISSION_STOPS.length - 2, Math.floor(x));
  return interpolateRgb(EMISSION_STOPS[i]!, EMISSION_STOPS[i + 1]!)(x - i);
}

/** Diverging blue ↔ red for temperature anomalies, neutral grey midpoint (warming stripes). */
const STRIPE_COOL = ["#08306b", "#2166ac", "#4393c3", "#92c5de"];
const STRIPE_WARM = ["#f4a582", "#d6604d", "#b2182b", "#67000d"];
export function anomalyColor(anomaly: number, maxAbs: number): string {
  const t = Math.max(-1, Math.min(1, anomaly / maxAbs));
  const mid = "#3a3a38";
  const ramp = t < 0 ? [mid, ...STRIPE_COOL.slice().reverse()] : [mid, ...STRIPE_WARM];
  const x = Math.abs(t) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  return interpolateRgb(ramp[i]!, ramp[i + 1]!)(x - i);
}

/** Climate action, sequential on a dark ground: deep teal → bright leaf green. Distinct from the emissions ramp. */
const ACTION_STOPS = ["#0d2226", "#0f3b3d", "#12594f", "#16795e", "#2a9d68", "#5cc173", "#a6df86", "#e9f9c9"];
export function actionColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (ACTION_STOPS.length - 1);
  const i = Math.min(ACTION_STOPS.length - 2, Math.floor(x));
  return interpolateRgb(ACTION_STOPS[i]!, ACTION_STOPS[i + 1]!)(x - i);
}

/** Net change, t in [−1, 1]: loss in the tree-cover-loss pink, gain in the action green, grey at zero. */
const LOSS_STOPS = ["#2b2a2e", "#5b2d47", "#9a3d6c", "#dc6699"];
const GAIN_STOPS = ["#2b2a2e", "#1d5a4d", "#2a9d68", "#a6df86"];
export function divergingActionColor(t: number): string {
  const ramp = t < 0 ? LOSS_STOPS : GAIN_STOPS;
  const x = Math.min(1, Math.abs(t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  return interpolateRgb(ramp[i]!, ramp[i + 1]!)(x - i);
}

/** Trade-flow arcs: clean technology in cyan, fossil fuels in violet, chips in pink. None collides with the fire yellow or emissions orange. */
export const FLOW_COLOR = { clean: "#4fd8d0", fossil: "#b9a4ff", chips: "#ff8fd8" } as const;
