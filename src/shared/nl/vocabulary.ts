/**
 * Words the Ask parser recognises. This is a lookup table for reading
 * questions, not data: nothing here is ever shown as a figure.
 */
import type { Hazard } from "../types.ts";
import type { EnsoPhase, ListDataset } from "../query.ts";

/**
 * Short forms and region words people use for countries, beyond the names in
 * the catalog. "US" only matches when typed in capitals, so "show us" doesn't
 * turn into a country.
 */
export const COUNTRY_ALIASES: Record<string, string> = {
  US: "USA",
  USA: "USA",
  "U.S.": "USA",
  "U.S.A.": "USA",
  america: "USA",
  "united states": "USA",
  "the states": "USA",
  UK: "GBR",
  britain: "GBR",
  "great britain": "GBR",
  england: "GBR",
  EU: "EU27",
  "european union": "EU27",
  europe: "EU27",
  korea: "KOR",
  "south korea": "KOR",
  "north korea": "PRK",
  russia: "RUS",
  iran: "IRN",
  syria: "SYR",
  vietnam: "VNM",
  "viet nam": "VNM",
  laos: "LAO",
  bolivia: "BOL",
  venezuela: "VEN",
  tanzania: "TZA",
  czechia: "CZE",
  "czech republic": "CZE",
  DRC: "COD",
  "dr congo": "COD",
  "ivory coast": "CIV",
  turkey: "TUR",
  "türkiye": "TUR",
  turkiye: "TUR",
  UAE: "ARE",
  emirates: "ARE",
  saudi: "SAU",
  holland: "NLD",
  "the netherlands": "NLD",
  world: "WLD",
  global: "WLD",
  globally: "WLD",
  worldwide: "WLD",
  "the world": "WLD",
  "the planet": "WLD",
};

/** Phrases that name a list, longest first when matched. */
export const LIST_WORDS: Record<ListDataset, string[]> = {
  attribution: ["world weather attribution", "attribution studies", "attribution study", "attribution", "studies", "study", "wwa", "made more likely", "climate change made"],
  disasters: ["disaster alerts", "disasters", "disaster", "alerts", "gdacs", "catastrophes"],
  laws: ["climate laws", "climate law", "legislation", "laws", "law", "acts"],
  cops: ["conference of the parties", "climate conferences", "climate summits", "summits", "conferences", "cops", "cop"],
  records: ["record years", "records", "milestones", "on record", "record broken", "records broken"],
  eruptions: ["volcanic eruptions", "eruptions", "eruption", "volcanoes", "volcano", "volcanic"],
  enso: ["el nino episodes", "la nina episodes", "el nino years", "la nina years", "enso episodes", "el nino", "la nina", "enso"],
  pledges: ["net zero targets", "net-zero targets", "net zero", "net-zero", "ndcs", "ndc", "pledges", "pledge", "targets", "commitments", "promises"],
};

/** Hazard words, and which list they imply when no list was named. */
export const HAZARD_WORDS: { words: string[]; hazard: Hazard; list: ListDataset }[] = [
  { words: ["heatwaves", "heatwave", "heat waves", "heat wave", "extreme heat", "heat"], hazard: "heatwave", list: "attribution" },
  { words: ["floods", "flood", "flooding", "heavy rain", "rainfall", "rain"], hazard: "rainfall", list: "disasters" },
  { words: ["droughts", "drought"], hazard: "drought", list: "disasters" },
  { words: ["hurricanes", "hurricane", "cyclones", "cyclone", "typhoons", "typhoon", "storms", "storm"], hazard: "storm", list: "disasters" },
  { words: ["wildfires", "wildfire", "bushfires", "bushfire", "forest fires", "fires"], hazard: "wildfire", list: "disasters" },
  { words: ["cold snaps", "cold snap", "cold spells", "cold spell", "extreme cold"], hazard: "cold", list: "attribution" },
];

export const PHASE_WORDS: { words: string[]; phase: EnsoPhase }[] = [
  { words: ["el nino"], phase: "elNino" },
  { words: ["la nina"], phase: "laNina" },
];

export const RANK_WORDS = [
  "which countries",
  "what countries",
  "who emits",
  "ranking",
  "ranked",
  "rank",
  "top",
  "largest",
  "biggest",
  "highest",
  "most",
  "leading",
  "worst",
  "lowest",
  "least",
  "smallest",
  "fewest",
];
export const ASCENDING_WORDS = ["lowest", "least", "smallest", "fewest"];
/** Words that turn a ranking into one by change. Falling words also flip the order. */
export const RISE_WORDS = ["fastest growing", "fastest-growing", "grew the most", "growing", "growth", "grew", "increases", "increase", "increased", "rising", "rises", "rise", "rose", "risen"];
export const FALL_WORDS = ["biggest cuts", "largest cuts", "cuts", "cut", "reduced", "reductions", "reduction", "decreases", "decrease", "decreased", "declines", "decline", "declined", "drops", "drop", "dropped", "fell", "falling", "fallen", "falls", "fall"];
export const PERCENT_WORDS = ["percentage", "percent", "per cent", "relative", "%"];

export const CHANGE_DISPLAY_WORDS = [
  "change per year",
  "yearly change",
  "annual change",
  "year-on-year",
  "year on year",
  "year over year",
  "rate of change",
  "rate of increase",
  "growth rate",
  "how fast",
  "speed",
];

export const OPEN_WORDS = ["open", "go to", "switch to", "jump to", "take me to", "explore", "explorer"];
export const MAP_WORDS = ["the map", "map"];

export const EXPLAIN_WORDS = ["why", "what causes", "what caused", "explain", "reason for", "reasons for", "because"];
export const FORECAST_WORDS = ["forecast", "predict", "prediction", "projection", "projected", "will be", "going to be", "in the future"];

export const SMOOTH_WORDS = ["smoothed", "smooth", "running mean", "moving average", "rolling average", "running average"];
export const DECADAL_WORDS = ["decadal average", "decadal mean", "decade average", "per decade"];

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, few: 3, couple: 2,
};
export const numberWord = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : (NUMBER_WORDS[w] ?? null));
export const NUMBER_WORD_PATTERN = `\\d+|${Object.keys(NUMBER_WORDS).join("|")}`;

/**
 * Parts of a whole, asked for together: "electricity mix in Germany" is every
 * electricity source, stacked. Ids are catalog measure ids.
 */
export const GROUP_WORDS: { words: string[]; measures: string[] }[] = [
  {
    words: ["electricity mix", "energy mix", "power mix", "generation mix", "electricity by source", "electricity sources", "sources of electricity", "power sources", "where electricity comes from", "electricity generation"],
    measures: ["energy.coal", "energy.gas", "energy.oil", "energy.nuclear", "energy.hydro", "energy.wind", "energy.solar", "energy.other_renewables"],
  },
  {
    words: ["emissions by fuel", "co2 by fuel", "by fuel", "fuel breakdown", "emissions by source", "sources of emissions", "emissions breakdown", "breakdown of emissions", "from each fuel", "fossil fuels"],
    measures: ["emissions.coal", "emissions.oil", "emissions.gas", "emissions.cement", "emissions.flaring", "emissions.land_use_change"],
  },
];

/** Stacked areas rather than lines. */
export const STACKED_WORDS = ["stacked area", "stacked chart", "stacked", "area chart", "breakdown", "composition", "made up of", "make up", "split by", "split up"];

/** A choropleth rather than a chart. */
export const MAP_VIEW_WORDS = ["choropleth", "world map", "on a map", "on the map", "as a map", "a map", "map", "maps", "mapped", "heat map", "heatmap", "geographically", "geographic", "spatially"];
/** Weaker: "emissions by country" is a map unless it asks for a ranking. */
export const BY_COUNTRY_WORDS = ["by country", "per country", "each country", "every country", "all countries", "across countries", "around the world", "across the world", "worldwide distribution"];

/** "Chart the top 5 emitters" draws lines over time instead of a ranking table. */
export const CHART_WORDS = ["line chart", "line graph", "time series", "over time", "through time", "over the years", "chart", "plot", "graph", "lines", "trend", "trends", "history", "evolution", "trajectory", "developed", "development"];

/** Filler that carries no meaning for the query; consumed so it doesn't count as unread. */
export const FILLER = new Set(
  (
    // Function words
    "a an the and or but nor so yet of in on at to for from by with without within into onto upon over under about above below " +
    "across along around through throughout during until till since before after between among against per via vs versus than then " +
    "as like such this that these those there here it its it's they them their theirs we us our you your i me my mine he she his her " +
    "is are was were be been being am do does did done doing has have had having can could would should will shall may might must " +
    "not no yes all any some every each both either neither few many much more most less least lot lots bit just only also too very " +
    "really quite rather pretty somewhat even still already ever never always often sometimes again else other others another same " +
    "own one ones what which who whom whose when where why how whether if while because though although " +
    // Asking and showing
    "show showing shown display displaying displayed give giving get getting got let let's lets tell telling find look looking see seeing " +
    "want wanted need needed would like please can could make made making create build generate render draw drawing visualise visualize " +
    "visualisation visualization view compare comparing comparison compared contrast list listing table tables overview summary summarise " +
    "summarize chart charts graph graphs plot plots diagram figure figures picture image interactive animated animation animate slider " +
    "timeline colours colors colour color coloured colored colorful colourful different various nice beautiful good great simple clear " +
    "quick quickly detailed detail details full whole entire complete " +
    // Data words
    "data dataset datasets number numbers value values level levels amount amounts total totals figure stats statistics statistic info " +
    "information measure measures measured measurement series record recorded trend trends change changes changed changing over time " +
    "year years yearly annual annually decade decades decadal century centuries period periods era recent recently latest current currently " +
    "now today present nowadays date ago far long so-far history historical historically " +
    "country countries nation nations national state states region regions place places world's " +
    "emitted emit emitting emits produce produced produces producing release released releases releasing " +
    "increase increasing increased decrease decreasing decreased growing grown grew changed evolve evolved evolving develop developing " +
    "happen happened happening going went gone come came comes compare " +
    // Months
    "january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec"
  ).split(/\s+/),
);
