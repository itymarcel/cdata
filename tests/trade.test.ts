import { describe, expect, test } from "bun:test";
import { TRADE_COMMODITIES, type TradeFlowsData } from "../src/shared/types.ts";
import { CHIP_STEPS, TRADE_GROUPS, TRADE_INFO } from "../src/shared/trade.ts";
import { type ComtradeRow, largest, likeForLike, mergeFlows, pickYear, worldTotals } from "../src/server/sources/trade.ts";
import { flowFacts } from "../src/server/views/flows.ts";

const ref = (pairs: [number, string][]) => new Map(pairs.map(([code, iso3]) => [code, { code, iso3, name: iso3 }]));
const CODES = ref([
  [156, "CHN"],
  [528, "NLD"],
  [276, "DEU"],
  [643, "RUS"],
  [699, "IND"],
  [842, "USA"],
]);
const row = (reporterCode: number, partnerCode: number, value: number, flowCode = "X"): ComtradeRow => ({
  reporterCode,
  partnerCode,
  flowCode,
  primaryValue: value,
  motCode: 0,
  customsCode: "C00",
  partner2Code: 0,
});

describe("world totals and the largest reporters", () => {
  test("keeps countries' world totals, largest first, and drops groups and zero rows", () => {
    const t = worldTotals([row(528, 0, 5), row(156, 0, 50), row(999, 0, 80), row(276, 0, 0), row(276, 528, 9)], CODES);
    expect(t.map((x) => x.iso3)).toEqual(["CHN", "NLD"]);
  });
  test("largest stops at the share, within its bounds", () => {
    const t = [60, 20, 10, 5, 5].map((value, i) => ({ code: i, iso3: `C${i}X`, value }));
    expect(largest(t, 0.8, 1, 10).length).toBe(2);
    expect(largest(t, 0.8, 3, 10).length).toBe(3);
    expect(largest(t, 0.99, 1, 2).length).toBe(2);
  });
});

describe("picking a year", () => {
  test("the newest year once its reporter count is close to the year before", () => {
    expect(pickYear([95, 100])).toBe(0);
  });
  test("a half-reported latest year falls back", () => {
    expect(pickYear([40, 100, 98])).toBe(1);
  });
  test("too few reporters is never good enough", () => {
    expect(pickYear([12, 12])).toBe(1);
  });
});

describe("merging both sides", () => {
  const merged = mergeFlows({
    exporterRows: [{ exporter: "CHN", rows: [row(156, 528, 100), row(156, 276, 40), row(156, 0, 500), row(156, 999, 30)] }],
    importerRows: [
      // India's records: imports from China (already read from China's side) and from Russia (not read).
      { importer: "IND", rows: [row(699, 156, 77, "M"), row(699, 643, 60, "M"), row(699, 0, 300, "M")] },
    ],
    partners: CODES,
    minValue: 10,
    maxPerExporter: 10,
  });
  test("an exporter we read keeps its own figures; importers fill in the rest", () => {
    expect(merged).toEqual([
      { from: "CHN", to: "NLD", value: 100, reportedBy: "exporter" },
      { from: "RUS", to: "IND", value: 60, reportedBy: "importer" },
      { from: "CHN", to: "DEU", value: 40, reportedBy: "exporter" },
    ]);
  });
  test("no flow to the world aggregate, unknown areas or below the minimum", () => {
    const tiny = mergeFlows({ exporterRows: [{ exporter: "CHN", rows: [row(156, 528, 5)] }], importerRows: [], partners: CODES, minValue: 10, maxPerExporter: 10 });
    expect(tiny).toEqual([]);
  });
});

describe("like-for-like change", () => {
  test("only countries that reported both years count", () => {
    const cur = Array.from({ length: 12 }, (_, i) => ({ code: i, iso3: `A${String.fromCharCode(65 + i)}A`, value: 2 }));
    const prev = cur.slice(0, 10).map((t) => ({ ...t, value: 1 }));
    expect(likeForLike(cur, prev)).toEqual({ value: 10, current: 20, reporters: 10 });
  });
  test("too few common reporters gives no comparison", () => {
    expect(likeForLike([{ code: 1, iso3: "CHN", value: 1 }], [{ code: 1, iso3: "CHN", value: 1 }])).toBeNull();
  });
});

describe("flow facts", () => {
  const base: TradeFlowsData = {
    commodity: "crude",
    hs: "2709",
    year: 2025,
    worldExports: 1000e9,
    reporters: 80,
    exporters: [
      { iso3: "SAU", value: 200e9 },
      { iso3: "USA", value: 120e9 },
      { iso3: "CAN", value: 100e9 },
    ],
    importers: [{ iso3: "CHN", value: 300e9 }],
    silentExporters: [{ iso3: "RUS", value: 90e9 }],
    previous: { year: 2024, value: 900e9, current: 990e9, reporters: 75 },
    flows: [{ from: "RUS", to: "CHN", value: 90e9, reportedBy: "importer" }],
    names: {},
  };
  const name = (iso3: string) => ({ SAU: "Saudi Arabia", USA: "United States", CAN: "Canada", RUS: "Russia", CHN: "China" })[iso3] ?? iso3;
  const plain = (d: TradeFlowsData) => flowFacts(d, name).map((f) => f.text.map((p) => (typeof p === "string" ? p : p.em)).join(""));

  test("shares are of reported exports, and say so", () => {
    expect(plain(base)[0]).toBe("Saudi Arabia’s exports were 20% of all crude oil exports reported for 2025 ($1.0 tn).");
    expect(plain(base)[1]).toContain("shipped 42% of it");
  });
  test("a mirror figure names whose records it is", () => {
    expect(plain(base)[2]).toBe("The largest single route: Russia → China, $90 bn (as recorded by China).");
  });
  test("rose, fell or flat follows the sign of the like-for-like change", () => {
    expect(plain(base).find((t) => t.startsWith("Reported exports"))).toBe("Reported exports rose 10% from 2024 to 2025, like for like.");
    const down = plain({ ...base, previous: { year: 2024, value: 1000e9, current: 800e9, reporters: 75 } });
    expect(down.find((t) => t.startsWith("Reported exports"))).toContain("fell 20%");
    const flat = plain({ ...base, previous: { year: 2024, value: 1000e9, current: 1005e9, reporters: 75 } });
    expect(flat.find((t) => t.startsWith("Reported exports"))).toBe("Reported exports were about flat between 2024 and 2025.");
    expect(flat.join(" ")).not.toMatch(/rose|fell/);
  });
  test("no change claim without a like-for-like comparison", () => {
    expect(plain({ ...base, previous: null }).join(" ")).not.toMatch(/rose|fell|flat/);
  });
  test("a non-reporting exporter is only called out when it matters", () => {
    expect(plain(base).at(-1)).toBe("Russia filed no 2025 export figure; its $90 bn shown here comes from its customers’ import records.");
    const small = plain({ ...base, silentExporters: [{ iso3: "RUS", value: 5e9 }] });
    expect(small.join(" ")).not.toContain("filed no");
  });
  test("a name ending in s takes a bare apostrophe", () => {
    const facts = flowFacts({ ...base, exporters: [{ iso3: "NLD", value: 200e9 }] }, (iso3) => (iso3 === "NLD" ? "Netherlands" : iso3));
    expect(facts[0]!.text.map((p) => (typeof p === "string" ? p : p.em)).join("")).toStartWith("Netherlands’ exports were 20%");
  });
  test("every fact names its basis", () => {
    for (const f of flowFacts(base, name)) expect(f.basis).toMatch(/UN Comtrade HS 2709/);
  });
});

describe("the goods on offer", () => {
  test("each good has its own HS code and a group the picker shows", () => {
    const codes = TRADE_COMMODITIES.map((c) => TRADE_INFO[c].hs);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of TRADE_COMMODITIES) {
      expect(TRADE_GROUPS.map((g) => g.id)).toContain(TRADE_INFO[c].group);
      expect(TRADE_INFO[c].definition.startsWith(`HS ${TRADE_INFO[c].hs}:`)).toBe(true);
    }
  });
  test("every chip good sits on a step of the chain, and every step has a good", () => {
    const chips = TRADE_COMMODITIES.filter((c) => TRADE_INFO[c].group === "chips");
    for (const c of chips) expect(CHIP_STEPS.map((s) => s.step)).toContain(TRADE_INFO[c].step!);
    for (const s of CHIP_STEPS) expect(chips.some((c) => TRADE_INFO[c].step === s.step)).toBe(true);
    expect(TRADE_COMMODITIES.filter((c) => TRADE_INFO[c].step && TRADE_INFO[c].group !== "chips")).toEqual([]);
  });
  test("a heading that bundles goods says so in its label", () => {
    // HS 280429 is every rare gas but argon, helium included: never present it as neon alone.
    expect(TRADE_INFO.gases.label).toMatch(/helium/i);
  });
  test("chip goods read naturally inside a fact", () => {
    const facts = flowFacts(
      { ...{ commodity: "chips", hs: "8542", year: 2025, worldExports: 900e9, reporters: 90, importers: [], silentExporters: [], previous: null, flows: [], names: {} }, exporters: [{ iso3: "HKG", value: 300e9 }] },
      (iso3) => iso3,
    );
    expect(facts[0]!.text.map((p) => (typeof p === "string" ? p : p.em)).join("")).toBe("HKG’s exports were 33% of all integrated circuits exports reported for 2025 ($900 bn).");
  });
});
