import type { TradeCommodity, TradeGroup } from "./types.ts";

export interface TradeCommodityInfo {
  label: string;
  /** Shorter label for selects and chips. */
  short: string;
  group: TradeGroup;
  /** For chip goods: which step of making a chip it feeds. */
  step?: "material" | "wafer" | "fab" | "chip";
  /** Harmonized System code queried at UN Comtrade. */
  hs: string;
  /** Exact HS heading text, shortened, so a reader knows what's counted. */
  definition: string;
  /** First year the code exists (HS 2022 split solar modules out). */
  since?: number;
}

export const TRADE_INFO: Record<TradeCommodity, TradeCommodityInfo> = {
  solar: {
    label: "Solar PV modules",
    short: "Solar panels",
    group: "clean",
    hs: "854143",
    definition: "HS 854143: photovoltaic cells assembled in modules or made up into panels",
    since: 2022,
  },
  batteries: {
    label: "Lithium-ion batteries",
    short: "Batteries",
    group: "clean",
    hs: "850760",
    definition: "HS 850760: lithium-ion accumulators (cells and packs, for any use)",
  },
  evs: {
    label: "Electric cars",
    short: "Electric cars",
    group: "clean",
    hs: "870380",
    definition: "HS 870380: passenger vehicles with only an electric motor for propulsion",
  },
  wind: {
    label: "Wind turbines",
    short: "Wind turbines",
    group: "clean",
    hs: "850231",
    definition: "HS 850231: wind-powered electric generating sets",
  },
  crude: {
    label: "Crude oil",
    short: "Crude oil",
    group: "fossil",
    hs: "2709",
    definition: "HS 2709: petroleum oils and oils from bituminous minerals, crude",
  },
  coal: {
    label: "Coal",
    short: "Coal",
    group: "fossil",
    hs: "2701",
    definition: "HS 2701: coal, briquettes and similar solid fuels made from coal",
  },
  lng: {
    label: "Liquefied natural gas",
    short: "LNG",
    group: "fossil",
    hs: "271111",
    definition: "HS 271111: natural gas, liquefied",
  },
  polysilicon: {
    label: "Hyper-pure silicon",
    short: "Polysilicon",
    group: "chips",
    hs: "280461",
    definition: "HS 280461: silicon at least 99.99% pure (polysilicon), the raw material of both chip and solar wafers",
    step: "material",
  },
  wafers: {
    label: "Doped wafers",
    short: "Wafers",
    group: "chips",
    hs: "381800",
    definition: "HS 381800: chemical elements and compounds doped for use in electronics, as discs or wafers",
    step: "wafer",
  },
  gases: {
    label: "Helium and rare gases",
    short: "Helium, neon…",
    group: "chips",
    hs: "280429",
    definition: "HS 280429: rare gases other than argon (helium, neon, krypton, xenon), counted together",
    step: "fab",
  },
  hf: {
    label: "Hydrogen fluoride",
    short: "Hydrogen fluoride",
    group: "chips",
    hs: "281111",
    definition: "HS 281111: hydrogen fluoride (hydrofluoric acid), for any use, wafer etching among them",
    step: "fab",
  },
  chipTools: {
    label: "Chipmaking machines",
    short: "Chip machines",
    group: "chips",
    hs: "848620",
    definition: "HS 848620: machines used solely or mainly to make semiconductor devices or integrated circuits",
    step: "fab",
  },
  chips: {
    label: "Integrated circuits",
    short: "Chips",
    group: "chips",
    hs: "8542",
    definition: "HS 8542: electronic integrated circuits (processors, memories and others)",
    step: "chip",
  },
};

export const TRADE_GROUPS: { id: TradeGroup; label: string }[] = [
  { id: "clean", label: "Clean technology" },
  { id: "fossil", label: "Fossil fuels" },
  { id: "chips", label: "Chips and what goes into them" },
];

/** Where each step of the chip chain sits, for the card's chain strip. */
export const CHIP_STEPS: { step: NonNullable<TradeCommodityInfo["step"]>; label: string }[] = [
  { step: "material", label: "Material" },
  { step: "wafer", label: "Wafers" },
  { step: "fab", label: "Into fabs" },
  { step: "chip", label: "Out" },
];

/** "$9.8 bn", "$640 m": customs values to two or three significant figures. */
export function usd(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)} tn`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)} bn`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)} m`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)} k`;
  return `$${Math.round(v)}`;
}

/** A label inside a sentence: "Solar PV modules" → "solar PV modules", "LNG" stays "LNG". */
export const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label);
