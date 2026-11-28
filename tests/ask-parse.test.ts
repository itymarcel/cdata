import { describe, expect, test } from "bun:test";
import { type Catalog, type Intent, type Measure, buildQuery, emptyIntent, validateQuery } from "../src/shared/query.ts";
import { normalize, parse } from "../src/shared/nl/parse.ts";
import { MEASURE_DEFS } from "../src/server/views/catalog.ts";

/**
 * A catalog with the real vocabulary (terms, context, twins) and made-up
 * coverage, so these tests check how questions are read, not the data.
 */
const COUNTRIES = [
  { iso3: "DEU", name: "Germany", names: ["Federal Republic of Germany"] },
  { iso3: "FRA", name: "France", names: ["French Republic"] },
  { iso3: "CHN", name: "China", names: ["People's Republic of China"] },
  { iso3: "USA", name: "United States", names: ["United States of America"] },
  { iso3: "GBR", name: "United Kingdom", names: [] },
  { iso3: "IND", name: "India", names: [] },
  { iso3: "PAK", name: "Pakistan", names: [] },
  { iso3: "GEO", name: "Georgia", names: [] },
  { iso3: "EU27", name: "European Union (27)", names: [] },
  { iso3: "WLD", name: "World", names: [] },
];
const PER_COUNTRY = COUNTRIES.map((c) => c.iso3);
/** Real-looking coverage where the record-extension logic depends on it. */
const COVERAGE: Record<string, [number, number]> = {
  co2: [1958, 2026],
  "co2.daily": [2023, 2026],
  "co2.iceCore": [-803_000, 2001],
  "temperature.berkeley": [1850, 2024],
  era5: [1940, 2026],
  seaIce: [1978, 2026],
  "seaIce.min": [1979, 2025],
  "seaIce.max": [1979, 2025],
  "seaIce.antarctic": [1978, 2026],
  oceanHeat: [1957, 2025],
  "oceanHeat.mri": [1955, 2020],
  carbonBudget: [1851, 2026],
  temperature: [1880, 2026],
  "temperature.hadcrut": [1850, 2025],
  "temperature.pages2k": [16, 1985],
  "temperature.temp12k": [-10_050, 1950],
  seaLevel: [1993, 2025],
  "seaLevel.tideGauges": [1880, 2009],
  "seaLevel.uhslc": [1970, 2020],
};
export const catalog: Catalog = {
  measures: MEASURE_DEFS.map(({ load: _l, vital, ...v }): Measure => ({
    ...v,
    ...(vital ? { vital } : {}),
    unit: v.id.startsWith("energy.") ? "% of electricity" : v.scale === "interval" ? "°C vs 1850–1900" : "Mt CO₂",
    decimals: 1,
    evidence: "observed",
    source: { name: "Test", publisher: "Test", url: "https://example.org" },
    coverage: COVERAGE[v.id] ?? [1850, 2025],
    resolution: v.id === "co2.iceCore" ? "multiYear" : "annual",
    ...(["emissions", "energy", "action", "land", "finance"].includes(v.group) ? { countries: PER_COUNTRY } : {}),
  })),
  countries: COUNTRIES,
  lists: (["attribution", "disasters", "laws", "cops", "records", "eruptions", "enso", "pledges"] as const).map((id) => ({
    id,
    label: id,
    filters: id === "enso" ? ["span", "phase"] : id === "records" ? ["span"] : id === "pledges" ? ["country"] : ["country", "hazard", "span"],
    sources: [],
  })),
  askAvailable: false,
};

const NOW = 2026;
const read = (q: string) => parse(q, catalog, NOW);
const intent = (q: string) => read(q).intent;

describe("normalize", () => {
  test("keeps positions aligned with the input", () => {
    for (const s of ["CO₂ in Türkiye, 1990–2000!", "El Niño years", "U.S. emissions"]) expect(normalize(s).length).toBe(s.length);
  });
  test("reads subscripts and folds accents", () => {
    expect(normalize("CO₂")).toBe("co2");
    expect(normalize("El Niño")).toBe("el nino");
  });
});

describe("measures", () => {
  test("a modifier and its context words make one measure, not two", () => {
    expect(intent("co2 emissions per capita").measures).toEqual(["emissions.perCapita"]);
    expect(intent("co2 ice cores").measures).toEqual(["co2.iceCore"]);
    expect(intent("greenhouse gas emissions").measures).toEqual(["emissions.ghg"]);
  });
  test("bare CO₂ is the atmosphere; with a country it is that country's emissions", () => {
    expect(intent("co2 since 1990").measures).toEqual(["co2"]);
    expect(intent("co2 in germany").measures).toEqual(["emissions.co2"]);
    expect(intent("methane in india").measures).toEqual(["emissions.methane"]);
    expect(intent("methane").measures).toEqual(["ch4"]);
  });
  test("two measures keep the order they were named in", () => {
    expect(intent("solar vs wind in china").measures).toEqual(["energy.solar", "energy.wind"]);
    expect(intent("compare temperature and co2").measures).toEqual(["temperature", "co2"]);
  });
  test("a measure word inside a longer measure name doesn't become a hazard", () => {
    const i = intent("ocean heat since 1960");
    expect(i.kind).toBe("series");
    expect(i.measures).toEqual(["oceanHeat"]);
    expect(i.hazard).toBeNull();
  });
  test("short labels from the catalog are understood", () => {
    expect(intent("Arctic ice minimum").measures).toEqual(["seaIce.min"]);
    expect(intent("CO₂ per person").measures).toEqual(["emissions.perCapita"]);
  });
});

describe("climate action", () => {
  test.each([
    ["solar capacity in china", "action.solar"],
    ["installed wind in germany since 2010", "action.wind"],
    ["electric car sales germany vs france", "action.evShare"],
    ["ev share in china", "action.evShare"],
    ["afforestation in india", "forest.afforestation"],
    ["tree planting in china", "forest.afforestation"],
    ["net forest change in brazil", "forest.change"],
    ["protected areas in france", "land.protected"],
    ["low carbon electricity in france", "energy.lowCarbon"],
  ])("%s → %s", (q, id) => {
    expect(intent(q).measures).toEqual([id]);
  });
  test("capacity and electricity share stay apart", () => {
    expect(intent("solar share in germany").measures).toEqual(["energy.solar"]);
    expect(intent("solar capacity vs wind capacity in china").measures).toEqual(["action.solar", "action.wind"]);
  });
  test("forest loss is still tree cover loss, not net change", () => {
    expect(intent("forest loss in brazil").measures).toEqual(["forest.loss"]);
  });
  test("an action measure can be mapped", () => {
    expect(intent("map of solar capacity")).toMatchObject({ kind: "map", measures: ["action.solar"] });
  });
});

describe("countries", () => {
  test("names, aliases and the world", () => {
    expect(intent("germany vs france co2").countries).toEqual(["DEU", "FRA"]);
    expect(intent("renewables share uk").countries).toEqual(["GBR"]);
    expect(intent("emissions of the european union").countries).toEqual(["EU27"]);
  });
  test("'US' only in capitals, so 'show us' is not a country", () => {
    expect(intent("show us coal emissions").countries).toEqual([]);
    expect(intent("US coal emissions").countries).toEqual(["USA"]);
  });
  test("a country with an unknown measure is not answered with emissions", () => {
    const p = read("gdp of germany");
    expect(p.intent.kind).toBe("unsupported");
    expect(p.intent.reason).toBe("not_in_data");
    expect(p.unread).toEqual(["gdp"]);
  });
  test("a country alone means its emissions", () => {
    const i = intent("germany");
    expect(i.kind).toBe("series");
    expect(buildQuery(i, catalog).query).toMatchObject({ series: ["emissions.co2@DEU"] });
  });
});

describe("periods", () => {
  const span = (q: string) => [intent(q).from, intent(q).to];
  test.each([
    ["temperature since 1990", [1990, null]],
    ["temperature between 1950 and 2000", [1950, 2000]],
    ["temperature 1990-2000", [1990, 2000]],
    ["temperature from 2000 to 1990", [1990, 2000]],
    ["temperature in 1998", [1998, 1998]],
    ["temperature in the 1980s", [1980, 1989]],
    ["temperature in the 80s", [1980, 1989]],
    ["sea level since the 1990s", [1990, null]],
    ["temperature before 1900", [null, 1899]],
    ["sea ice last 20 years", [2006, null]],
    ["sea ice over the past decade", [2016, null]],
    ["co2 ice cores last 800,000 years", [NOW - 800_000, null]],
    ["co2 ice cores last 800k years", [NOW - 800_000, null]],
    ["temperature since 10,000 BC", [-9999, null]],
    ["temperature in the 20th century", [1900, 1999]],
    ["temperature last year", [2025, 2025]],
  ] as const)("%s", (q, expected) => {
    expect(span(q)).toEqual([...expected]);
  });
  test("a CO₂ reading is not a year", () => {
    expect(span("co2 ppm")).toEqual([null, null]);
  });
});

describe("kinds of answer", () => {
  test("rankings", () => {
    expect(intent("top 10 emitters")).toMatchObject({ kind: "rank", measures: ["emissions.co2"], top: 10, order: "desc", rankBy: "value" });
    expect(intent("5 lowest emitters per capita in 2000")).toMatchObject({ kind: "rank", measures: ["emissions.perCapita"], top: 5, order: "asc", from: 2000, to: 2000 });
    expect(intent("which countries cut emissions the most since 1990")).toMatchObject({ kind: "rank", rankBy: "change", order: "asc", from: 1990 });
    expect(intent("fastest growing emitters since 2000 in percent")).toMatchObject({ kind: "rank", rankBy: "percent", order: "desc" });
  });
  test("lists, with hazards and phases", () => {
    expect(intent("floods in pakistan")).toMatchObject({ kind: "list", dataset: "disasters", hazard: "rainfall", countries: ["PAK"] });
    expect(intent("heatwave studies in europe")).toMatchObject({ kind: "list", dataset: "attribution", hazard: "heatwave", countries: ["EU27"] });
    expect(intent("heatwaves")).toMatchObject({ kind: "list", dataset: "attribution", hazard: "heatwave" });
    expect(intent("El Niño episodes since 2000")).toMatchObject({ kind: "list", dataset: "enso", phase: "elNino", from: 2000 });
    expect(intent("cop conferences in the 2010s")).toMatchObject({ kind: "list", dataset: "cops", from: 2010, to: 2019 });
  });
  test("a target year in a pledge question is not a period", () => {
    expect(intent("net zero by 2050")).toMatchObject({ kind: "list", dataset: "pledges", from: null, to: null });
  });
  test("the El Niño index is a series, not the list of episodes", () => {
    expect(intent("el nino index since 1990")).toMatchObject({ kind: "series", measures: ["oni"] });
  });
  test("open a view", () => {
    expect(intent("open sea level since 1900")).toMatchObject({ kind: "open", view: "seaLevel", from: 1900 });
    expect(intent("go to the map")).toMatchObject({ kind: "open", view: "map" });
  });
  test("explanations and forecasts are not charted", () => {
    expect(intent("why is sea level rising")).toMatchObject({ kind: "unsupported", reason: "explanation", relatedVital: "seaLevel" });
    expect(intent("what will temperature be in 2060")).toMatchObject({ kind: "unsupported", reason: "forecast" });
  });
  test("display options", () => {
    expect(intent("temperature 10-year average since 1850").smoothing).toBe(10);
    expect(intent("smoothed sea level").smoothing).toBe(10);
    expect(intent("how fast is co2 rising").display).toBe("change");
  });
  test("nothing recognisable", () => {
    const p = read("purple elephants dancing");
    expect(p.understood).toBe(false);
    expect(p.confidence).toBe(0);
    expect(p.intent).toMatchObject({ kind: "unsupported", reason: "unclear" });
  });
  test("a fully read question has full confidence", () => {
    const p = read("germany vs france co2 per capita since 1990");
    expect(p.unread).toEqual([]);
    expect(p.confidence).toBe(1);
  });
});

describe("buildQuery", () => {
  const base = (patch: Partial<Intent>): Intent => ({ ...emptyIntent(), ...patch });

  test("a global measure with a country uses its twin, and says so", () => {
    const b = buildQuery(base({ measures: ["co2"], countries: ["DEU"] }), catalog);
    expect(b.query).toMatchObject({ kind: "series", series: ["emissions.co2@DEU"] });
    expect(b.notes.join(" ")).toContain("one global figure");
  });
  test("a global measure without a twin stays global, with a note", () => {
    const b = buildQuery(base({ measures: ["temperature"], countries: ["DEU"] }), catalog);
    expect(b.query).toMatchObject({ series: ["temperature"] });
    expect(b.notes.join(" ")).toContain("no per-country series");
  });
  test("a per-country measure without a country is the world total", () => {
    expect(buildQuery(base({ measures: ["emissions.co2"] }), catalog).query).toMatchObject({ series: ["emissions.co2@WLD"] });
  });
  test("unknown ids are dropped with a note, never guessed", () => {
    const b = buildQuery(base({ measures: ["gdp", "co2"], countries: ["XXX"] }), catalog);
    expect(b.query).toMatchObject({ series: ["co2"] });
    expect(b.notes).toEqual(expect.arrayContaining(["Unknown country code XXX.", "Unknown measure “gdp”."]));
  });
  test("rankings fall back to the closest per-country measure", () => {
    const b = buildQuery(base({ kind: "rank", measures: ["ch4"] }), catalog);
    expect(b.query).toMatchObject({ kind: "rank", measure: "emissions.methane" });
  });
  test("a percentage ranking of an anomaly becomes a ranking by change", () => {
    const interval = { ...catalog, measures: catalog.measures.map((m) => (m.id === "emissions.co2" ? { ...m, scale: "interval" as const } : m)) };
    expect(buildQuery(base({ kind: "rank", measures: ["emissions.co2"], rankBy: "percent" }), interval).query).toMatchObject({ by: "change" });
  });
  test("unanswerable questions get a template reply and no query", () => {
    const b = buildQuery(base({ kind: "unsupported", reason: "forecast" }), catalog);
    expect(b.query).toBeNull();
    expect(b.notes[0]).toContain("not forecasts");
  });
  test("spans are put in order", () => {
    expect(buildQuery(base({ measures: ["co2"], from: 2000, to: 1990 }), catalog).query).toMatchObject({ span: [1990, 2000] });
  });
});

describe("validateQuery", () => {
  test("accepts a well-formed query and clamps sizes", () => {
    const v = validateQuery({ kind: "rank", measure: "emissions.co2", span: [null, 2020], by: "value", order: "asc", top: 500 }, catalog);
    expect(v).toEqual({ query: { kind: "rank", measure: "emissions.co2", span: [null, 2020], by: "value", order: "asc", top: 50 } });
  });
  test("rejects unknown series and countries without data", () => {
    expect(validateQuery({ kind: "series", series: ["nope"] }, catalog)).toHaveProperty("error");
    expect(validateQuery({ kind: "series", series: ["emissions.co2@ZZZ"] }, catalog)).toHaveProperty("error");
    expect(validateQuery({ kind: "series", series: ["co2@DEU"] }, catalog)).toHaveProperty("error");
  });
  test("rejects rankings of global measures", () => {
    expect(validateQuery({ kind: "rank", measure: "co2" }, catalog)).toHaveProperty("error");
  });
  test("rejects junk", () => {
    expect(validateQuery(null, catalog)).toHaveProperty("error");
    expect(validateQuery({ kind: "drop table" }, catalog)).toHaveProperty("error");
  });
});

describe("harder phrasing", () => {
  test("'years ago' periods", () => {
    expect([intent("co2 100 years ago").from, intent("co2 100 years ago").to]).toEqual([1926, 1926]);
    expect([intent("temperature since 50 years ago").from, intent("temperature since 50 years ago").to]).toEqual([1976, null]);
    expect([intent("sea level a century ago").from, intent("sea level a century ago").to]).toEqual([1926, 1926]);
    expect([intent("emissions 30 years ago until today").from, intent("emissions 30 years ago until today").to]).toEqual([1996, null]);
    expect(intent("sea level from 1900 until today").to).toBeNull();
  });
  test("chatty questions leave nothing unread", () => {
    for (const q of [
      "Show co2 emissions on a map with different colours",
      "can you please show me a nice chart of methane levels in the atmosphere",
      "how has global warming developed over the past century",
      "what were india's emissions in march 2020",
      "arctic see ice",
    ])
      expect(read(q).unread).toEqual([]);
  });
  test("a rise or fall in one year is measured from the year before", () => {
    const p = read("The rise of emissions in Germany last year?");
    expect(p.unread).toEqual([]);
    expect(p.intent).toMatchObject({ kind: "series", measures: ["emissions.co2"], countries: ["DEU"], from: 2024, to: 2025 });
    expect(intent("the fall in coal electricity in the UK in 2020")).toMatchObject({ kind: "series", from: 2019, to: 2020 });
    expect(intent("which countries' emissions rose the most last year")).toMatchObject({ kind: "rank", rankBy: "change", from: 2024, to: 2025 });
  });
  test("must not widen a single year without a change, or a ranking by level", () => {
    expect(intent("emissions in Germany last year")).toMatchObject({ from: 2025, to: 2025 });
    expect(intent("top 10 emitters in 2020")).toMatchObject({ kind: "rank", rankBy: "value", from: 2020, to: 2020 });
    expect(intent("emissions rise in Germany since 1990")).toMatchObject({ from: 1990, to: null });
  });
  test("possessives", () => {
    expect(intent("india's emissions").countries).toEqual(["IND"]);
  });
  test("typos are corrected to known words and reported", () => {
    const p = read("germny vs frnace co2 emisions");
    expect(p.intent).toMatchObject({ measures: ["emissions.co2"], countries: ["DEU", "FRA"] });
    expect(p.corrections).toEqual([["germny", "germany"], ["frnace", "france"], ["emisions", "emissions"]]);
    expect(read("temprature anomaly").intent.measures).toEqual(["temperature"]);
  });
  test("typo correction leaves real unknown words alone", () => {
    for (const q of ["purple elephants dancing", "the weather in paris", "gdp of germany"]) expect(read(q).corrections).toEqual([]);
    expect(intent("purple elephants dancing").kind).toBe("unsupported");
  });
});

describe("maps", () => {
  test("a map of a per-country measure", () => {
    expect(intent("Show co2 emissions on a map with different colours")).toMatchObject({ kind: "map", measures: ["emissions.co2"], rankBy: "value" });
    expect(intent("emissions per capita by country")).toMatchObject({ kind: "map", measures: ["emissions.perCapita"] });
    expect(intent("solar share around the world in 2020")).toMatchObject({ kind: "map", measures: ["energy.solar"], from: 2020, to: 2020 });
  });
  test("a map of CO₂ means emissions; a bare map means CO₂ emissions", () => {
    expect(intent("co2 on a map").measures).toEqual(["emissions.co2"]);
    expect(intent("show me a map").measures).toEqual(["emissions.co2"]);
  });
  test("change maps", () => {
    expect(intent("map of emissions change since 1990")).toMatchObject({ kind: "map", rankBy: "change", from: 1990 });
    expect(intent("map of percent change in emissions since 2000")).toMatchObject({ kind: "map", rankBy: "percent" });
  });
  test("a ranking 'by country' stays a ranking; 'open the map' opens the view", () => {
    expect(intent("top emitters by country").kind).toBe("rank");
    expect(intent("open the map")).toMatchObject({ kind: "open", view: "map" });
  });
  test("buildQuery makes a map query, falling back to a per-country twin", () => {
    expect(buildQuery({ ...emptyIntent(), kind: "map", measures: ["ch4"] }, catalog).query).toEqual({ kind: "map", measure: "emissions.methane", span: [null, null], by: "value" });
    expect(validateQuery({ kind: "map", measure: "co2" }, catalog)).toHaveProperty("error");
    expect(validateQuery({ kind: "map", measure: "energy.solar", by: "change", span: [2000, null] }, catalog)).toEqual({
      query: { kind: "map", measure: "energy.solar", span: [2000, null], by: "change" },
    });
  });
});

describe("groups, stacks and top countries over time", () => {
  test("an electricity mix is every source, stacked", () => {
    const i = intent("electricity mix in germany");
    expect(i.measures).toHaveLength(8);
    expect(i.measures.every((m) => m.startsWith("energy."))).toBe(true);
    expect(i).toMatchObject({ kind: "series", chart: "stacked", countries: ["DEU"] });
  });
  test("emissions by fuel", () => {
    expect(intent("emissions by fuel in china since 1950")).toMatchObject({ chart: "stacked", countries: ["CHN"], from: 1950 });
    expect(intent("emissions by fuel in china").measures).toContain("emissions.coal");
  });
  test("'stacked' asks for stacked areas", () => {
    expect(intent("solar and wind in spain stacked").chart).toBe("stacked");
  });
  test("chart the top N countries over time", () => {
    const i = intent("chart the top 5 emitters since 1990");
    expect(i).toMatchObject({ kind: "series", topCountries: true, top: 5, order: "desc", measures: ["emissions.co2"], from: 1990 });
    expect(buildQuery(i, catalog).query).toEqual({
      kind: "series",
      series: ["emissions.co2"],
      span: [1990, null],
      display: "values",
      smoothing: 0,
      chart: "lines",
      top: { n: 5, order: "desc" },
    });
    expect(intent("top 5 emitters since 1990").kind).toBe("rank");
  });
});

describe("records that start late are extended with older ones", () => {
  const q = (i: Partial<Intent>) => buildQuery({ ...emptyIntent(), ...i }, catalog);
  test("before the main record: the older record instead", () => {
    const b = q({ measures: ["co2"], from: 1926, to: 1926 });
    expect(b.query).toMatchObject({ series: ["co2.iceCore"] });
    expect(b.notes.join(" ")).toContain("starts in 1958");
  });
  test("reaching back: both records", () => {
    expect(q({ measures: ["co2"], from: 1900 }).query).toMatchObject({ series: ["co2", "co2.iceCore"] });
    expect(q({ measures: ["seaLevel"], from: 1900 }).query).toMatchObject({ series: ["seaLevel", "seaLevel.tideGauges"] });
    expect(q({ measures: ["temperature"], from: 1850 }).query).toMatchObject({ series: ["temperature", "temperature.hadcrut"] });
    expect(q({ measures: ["temperature"], from: 1000 }).query).toMatchObject({ series: ["temperature", "temperature.pages2k"] });
  });
  test("must not extend when the main record covers the period, or for a named alternative", () => {
    expect(q({ measures: ["co2"], from: 1990 }).query).toMatchObject({ series: ["co2"] });
    expect(q({ measures: ["temperature.berkeley"], from: 1000 }).query).toMatchObject({ series: ["temperature.berkeley"] });
  });
});
