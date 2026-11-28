import type { Citation, IgccData, NoteLine, Point, RichText, StoryFact, StoryNote, VitalId, VitalStory } from "@shared/types.ts";
import { daysInYear } from "@shared/time.ts";
import { linearFit, mean } from "../lib/stats.ts";
import { IPCC } from "./citations.ts";

/**
 * Plain-language readings of each vital sign: one headline sentence and a few
 * key facts, every figure computed here from the same series the explorer
 * draws. The sentences are templates; the numbers, ranks, dates and records
 * all come from the data, so they move when the data does. A builder returns
 * null rather than a story with gaps when its inputs are too thin.
 */

/** A key figure; with `note`, it opens that note. */
const em = (text: string, note?: string) => (note ? { em: text, note } : { em: text });

/** A note line computed from data. */
const fromData = (text: RichText, basis: string, link?: VitalId): NoteLine => ({ text, basis, ...(link ? { link } : {}) });

/** A note line that restates a report passage; its numbers must all appear in the quote. */
const cited = (text: RichText, cite: Citation, link?: VitalId): NoteLine => ({ text, cite, ...(link ? { link } : {}) });

/** The ratio as a small fraction ("3 for every 2"), when one is within 3%. */
export function simpleRatio(r: number): [number, number] | null {
  for (let d = 2; d <= 5; d++) {
    const n = Math.round(r * d);
    if (n !== d && Math.abs(n / d - r) / r < 0.03) return [n, d];
  }
  return null;
}

/** Population standard deviation. */
const spread = (vs: number[]) => {
  const m = mean(vs)!;
  return Math.sqrt(mean(vs.map((v) => (v - m) ** 2))!);
};

export function num(v: number, decimals = 0): string {
  return v.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const signed = (v: number, decimals: number) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v), decimals)}`;

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "warmest", "2nd warmest". */
const ranked = (rank: number, word: string) => (rank === 1 ? word : `${ordinal(rank)} ${word}`);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The calendar day a decimal year falls on. Daily series stamp either midnight
 * (NSIDC) or noon (ERA5) and are rounded to four decimals (≈ 53 minutes), so
 * read to the nearest day with a quarter-day offset: right for both.
 */
export function dateOf(t: number): Date {
  const year = Math.floor(t);
  return new Date(Date.UTC(year, 0, 1 + Math.round((t - year) * daysInYear(year) - 0.25)));
}

/** Decimal year → "25 November". */
export function dayMonth(t: number): string {
  const d = dateOf(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Decimal year → "October 2026", reading the month the point sits in. */
export function monthYear(t: number): string {
  const year = Math.floor(t);
  const month = Math.min(11, Math.floor((t - year) * 12));
  return `${MONTHS[month]} ${year}`;
}

/** "11-25": the calendar date of a decimal year, for comparing the same date across years. */
export function dayKey(t: number): string {
  const d = dateOf(t);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Calendar-year means of a sub-annual series, keeping only years with (nearly) every value. */
export function completeYearMeans(points: Point[], perYear: number): Point[] {
  const groups = new Map<number, number[]>();
  for (const [t, v] of points) {
    const y = Math.floor(t);
    let g = groups.get(y);
    if (!g) groups.set(y, (g = []));
    g.push(v);
  }
  const out: Point[] = [];
  for (const [y, vs] of groups) if (vs.length >= perYear * 0.95) out.push([y, mean(vs)!]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** 1 = the highest (or, with "asc", the lowest) of `values`. Ties share the better rank. */
export function rankOf(values: number[], v: number, order: "desc" | "asc" = "desc"): number {
  return 1 + values.filter((x) => (order === "desc" ? x > v : x < v)).length;
}

/** Least-squares slope per year over [from, to]; null with fewer than `min` points. */
export function slope(points: Point[], from: number, to: number, min = 5): number | null {
  const pts = points.filter(([t]) => t >= from && t <= to);
  return pts.length >= min ? (linearFit(pts)?.slope ?? null) : null;
}

/** The earliest year of the unbroken run of year-on-year rises that ends at the last year. */
export function risingSince(annual: Point[]): number | null {
  let i = annual.length - 1;
  if (i < 1) return null;
  while (i > 0 && annual[i]![1] > annual[i - 1]![1] && annual[i]![0] - annual[i - 1]![0] === 1) i--;
  return i === annual.length - 1 ? null : annual[i]![0];
}

/**
 * The largest N for which the N most extreme years are exactly the last N
 * years ("the 18 lowest minima were all in the last 18 years"). Capped at half
 * the record, since "the N lowest of N" says nothing.
 */
export function extremesAreRecent(annual: Point[], order: "desc" | "asc"): number {
  const sorted = [...annual].sort((a, b) => (order === "desc" ? b[1] - a[1] : a[1] - b[1]));
  let best = 0;
  let top = -Infinity;
  for (let n = 1; n <= Math.floor(annual.length / 2); n++) {
    top = Math.max(top, annual.length - 1 - annual.indexOf(sorted[n - 1]!)); // how far back the n-th extreme sits
    if (top === n - 1) best = n;
  }
  return best;
}

/** Year → calendar date → value, for same-date comparisons across years. */
function byDate(points: Point[]): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  for (const [t, v] of points) {
    const y = Math.floor(t);
    let m = out.get(y);
    if (!m) out.set(y, (m = new Map()));
    m.set(dayKey(t), v);
  }
  return out;
}

/** Every year's value on one calendar date. */
function onDate(years: Map<number, Map<string, number>>, key: string): number[] {
  const out: number[] = [];
  for (const m of years.values()) {
    const v = m.get(key);
    if (v !== undefined) out.push(v);
  }
  return out;
}

// ─── CO₂ ────────────────────────────────────────────────────────────────────

export function co2Story(monthly: Point[], iceCore: Point[] | null, igcc: IgccData | null = null): VitalStory | null {
  if (monthly.length < 36) return null;
  const MLO = "Mauna Loa monthly means, NOAA Global Monitoring Laboratory";
  const ICE = "Antarctic ice-core composite (Bereiter et al. 2015)";
  const last12 = mean(monthly.slice(-12).map(([, v]) => v))!;
  const lastT = monthly.at(-1)![0];
  const pre = iceCore ? mean(iceCore.filter(([t]) => t >= 1700 && t < 1800).map(([, v]) => v)) : null;
  const preIndustrial = iceCore?.filter(([t]) => t < 1750) ?? [];
  const maxBefore1900 = iceCore ? Math.max(...iceCore.filter(([t]) => t < 1900).map(([, v]) => v)) : null;
  const spanYears = iceCore?.length ? Math.floor((1950 - iceCore[0]![0]) / 100_000) * 100_000 : 0;

  const deepTime = maxBefore1900 !== null && spanYears > 0 && last12 > maxBefore1900;
  const headline: RichText =
    pre !== null
      ? ["CO₂ is ", em(`${num((last12 / pre - 1) * 100)}% higher`, "preindustrial"), " than before the industrial era"]
      : ["CO₂ averaged ", em(`${num(last12, 1)} ppm`, "preindustrial"), " over the last 12 months"];
  if (deepTime) headline.push(", and higher than at any time in the last ", em(`${num(spanYears)} years`, "deepTime"));
  headline.push(".");

  const startYear = Math.floor(monthly[0]![0]);
  const howWeKnow: NoteLine[] = [fromData([`CO₂ has been measured continuously in the air at Mauna Loa Observatory, Hawaii, since ${startYear}.`], MLO)];
  if (iceCore && spanYears > 0)
    howWeKnow.push(
      fromData(
        ["Older air comes from bubbles sealed in Antarctic ice as snow piled up and turned to ice. Dating the layers takes the record back ", em(`${num(spanYears)} years`), "."],
        ICE,
      ),
    );
  const notes: StoryNote[] = [];
  const meaning: NoteLine[] = [];
  if (pre !== null) {
    meaning.push(
      fromData(
        ["Before industrialisation the air held about ", em(`${num(pre)} ppm`), ` of CO₂: ${num(pre)} molecules in every million. Over the last 12 months it held `, em(`${num(last12)} ppm`), "."],
        `${ICE}, mean of the samples dated 1700–1800; ${MLO}, mean of the latest 12 months`,
      ),
    );
    const frac = simpleRatio(last12 / pre);
    if (frac)
      meaning.push(
        fromData(["For every ", em(`${frac[1]} molecules`), " of CO₂ in the air of the 1700s there are now about ", em(String(frac[0])), "."], "Ratio of the two values above, as the nearest simple fraction"),
      );
  } else meaning.push(fromData(["ppm means parts per million: ", em(`${num(last12)} molecules`), " of CO₂ in every million molecules of air."], MLO));
  const matters: NoteLine[] = [];
  const co2Warming = igcc?.warmingBySpecies.find((s) => s.compound === "CO2");
  if (co2Warming) {
    const largest = igcc!.warmingBySpecies.every((s) => s === co2Warming || s.p50 < co2Warming.p50);
    matters.push(
      fromData(
        [
          "The CO₂ people have added has warmed the planet by about ",
          em(`${num(co2Warming.p50, 1)} °C`),
          ` since 1750${largest ? ", more than any other emission" : ""}. The 90% range is ${num(co2Warming.p5, 2)} to ${num(co2Warming.p95, 2)} °C.`,
        ],
        `Indicators of Global Climate Change (${igcc!.edition}), warming attributed to each emitted compound, median and 5–95% range`,
        "temperature",
      ),
    );
  }
  matters.push(
    cited(["The rise is caused by people. Land and ocean soak up about ", em("56%"), " of the CO₂ we emit each year; the rest builds up in the air."], IPCC.humanCausedCo2, "carbonBudget"),
    cited(["The CO₂ the ocean absorbs is making seawater more acidic."], IPCC.oceanWarmingHuman),
  );
  notes.push({ id: "preindustrial", title: pre !== null ? "Compared with before the industrial era" : "CO₂ in the air", meaning, matters, howWeKnow });
  if (deepTime && preIndustrial.length > 10)
    notes.push({
      id: "deepTime",
      title: `The last ${num(spanYears)} years`,
      meaning: [
        fromData(
          [
            "Through that time CO₂ moved between ",
            em(`${num(Math.min(...preIndustrial.map(([, v]) => v)))} and ${num(maxBefore1900!)} ppm`),
            ". The last 12 months were ",
            em(`${num(last12 - maxBefore1900!)} ppm`),
            " above the highest point.",
          ],
          `${ICE}, lowest sample before 1750 and highest before 1900; ${MLO}, mean of the latest 12 months`,
        ),
      ],
      matters: [
        cited(
          [
            "The IPCC finds CO₂ higher than at any time in at least ",
            em("2 million years"),
            ". The rise since 1750 far exceeds the natural swings between ice ages and warm periods over the past 800,000 years.",
          ],
          IPCC.co2TwoMillionYears,
        ),
      ],
      howWeKnow: howWeKnow.slice(1),
    });

  const facts: StoryFact[] = [];
  facts.push({
    text: [
      "The 12 months to ",
      monthYear(lastT),
      " averaged ",
      em(`${num(last12, 1)} ppm`),
      ...(pre !== null ? [", against ", em(`${num(pre)} ppm`), " in 1700–1800."] : ["."]),
    ],
    basis: pre !== null ? `${MLO}; pre-industrial: mean of the ice-core samples dated 1700–1800, ${ICE}` : MLO,
  });

  const annual = completeYearMeans(monthly, 12);
  const growth: Point[] = [];
  for (let i = 1; i < annual.length; i++)
    if (annual[i]![0] - annual[i - 1]![0] === 1) growth.push([annual[i]![0], annual[i]![1] - annual[i - 1]![1]]);
  const latest = growth.at(-1);
  if (latest) {
    const rank = rankOf(growth.map(([, g]) => g), latest[1]);
    facts.push({
      text: [`In ${latest[0]} CO₂ rose `, em(`${num(latest[1], 2)} ppm`), `, the ${ranked(rank, "largest")} yearly rise since ${growth[0]![0]}.`],
      basis: `${MLO}; change between calendar-year averages, ranked against every year since ${growth[0]![0]}`,
    });
    const decade = Math.ceil(growth[0]![0] / 10) * 10;
    const early = mean(growth.filter(([y]) => y >= decade && y < decade + 10).map(([, g]) => g));
    const recent = growth.slice(-10);
    if (early !== null && recent.length === 10 && recent[0]![0] > decade + 10)
      facts.push({
        text: [
          "The yearly rise has grown from ",
          em(`${num(early, 1)} ppm`),
          ` in the ${decade}s to `,
          em(`${num(mean(recent.map(([, g]) => g))!, 1)} ppm`),
          ` in ${recent[0]![0]}–${latest[0]}.`,
        ],
        basis: `${MLO}; mean of the yearly changes in each period`,
      });
  }
  const since = risingSince(annual);
  if (since !== null && annual.length - annual.findIndex(([y]) => y === since) > 10)
    facts.push({
      text:
        since === annual[0]![0]
          ? ["CO₂ has risen ", em("every single year"), ` since measurements began in ${Math.floor(monthly[0]![0])}.`]
          : ["CO₂ has risen ", em("every year"), ` since ${since}.`],
      basis: `${MLO}; calendar-year averages`,
    });
  if (preIndustrial.length > 10 && maxBefore1900 !== null && spanYears > 0)
    facts.push({
      text: [
        `Over the ${num(spanYears)} years before industrialisation, CO₂ stayed between `,
        em(`${num(Math.min(...preIndustrial.map(([, v]) => v)))} and ${num(maxBefore1900)} ppm`),
        ".",
      ],
      basis: `${ICE}; lowest sample before 1750, highest before 1900`,
      ...(notes.some((n) => n.id === "deepTime") ? { note: "deepTime" } : {}),
    });
  return { headline, facts, notes };
}

// ─── Global temperature ─────────────────────────────────────────────────────

export function temperatureStory(annual: Point[], monthly: Point[]): VitalStory | null {
  if (annual.length < 50) return null;
  const SRC = "HadCRUT5 (Met Office Hadley Centre / UEA), relative to 1850–1900";
  const values = annual.map(([, v]) => v);
  const [lastYear, lastV] = annual.at(-1)!;
  const lastRank = rankOf(values, lastV);
  const last10 = mean(annual.slice(-10).map(([, v]) => v))!;

  const headline: RichText =
    lastRank === 1
      ? [em(String(lastYear)), " was the warmest year on record, ", em(`${num(lastV, 2)} °C`, "warming"), " above the late 1800s."]
      : ["Over the last ten years Earth averaged ", em(`${num(last10, 2)} °C`, "warming"), " warmer than in the late 1800s."];

  const notes: StoryNote[] = [];
  const meaning: NoteLine[] = [];
  const early = annual.filter(([y]) => y >= 1850 && y <= 1900).map(([, v]) => v);
  if (early.length >= 30) {
    const wobble = spread(early);
    meaning.push(
      fromData(
        ["In 1850–1900 a typical year was within ", em(`±${num(wobble, 2)} °C`), " of the average. The last ten years sit ", em(`${num(last10 / wobble)} times`), " that far above it."],
        `${SRC}; standard deviation of the 1850–1900 calendar-year means, against the mean of the last ten years`,
      ),
    );
  }
  meaning.push(
    cited(["Land warms faster than the ocean: in 2011–2020 land was ", em("1.59 °C"), " warmer than in 1850–1900, the ocean ", em("0.88 °C"), "."], IPCC.landVsOcean),
  );
  notes.push({
    id: "warming",
    title: "What a degree of global warming means",
    meaning,
    matters: [
      cited(
        ["The IPCC’s best estimate is that people caused ", em("1.07 °C"), " of warming by 2010–2019. Natural drivers moved it by only −0.1 to +0.1 °C."],
        IPCC.humanCausedWarming,
      ),
      cited(
        ["Every extra ", em("0.5 °C"), " brings clearly more frequent and intense heatwaves and heavy rain, and more drought in some regions."],
        IPCC.extremesPerHalfDegree,
        "era5",
      ),
      cited(["Earth has warmed faster since 1970 than in any 50-year period in at least ", em("2,000 years"), "."], IPCC.fastestIn2000Years),
    ],
    howWeKnow: [
      fromData(
        [`HadCRUT5 combines thermometer readings from weather stations on land and from ships and buoys at sea, back to ${annual[0]![0]}.`],
        SRC,
      ),
      fromData(["NASA and Berkeley Earth build their own versions from the same kinds of measurements. Compare them under Data & layers."], "Alternative datasets in this chart"),
    ],
  });

  const facts: StoryFact[] = [];
  const [maxYear, maxV] = annual.reduce((a, b) => (b[1] > a[1] ? b : a));
  facts.push({
    text:
      lastRank === 1
        ? ["The last ten years averaged ", em(`${num(last10, 2)} °C`), " above 1850–1900."]
        : [`${lastYear} was the `, em(ranked(lastRank, "warmest")), ` year on record (${signed(lastV, 2)} °C). The record is ${maxYear}, at `, em(`${signed(maxV, 2)} °C`), "."],
    basis: `${SRC}; calendar-year means`,
  });
  const top10 = [...annual].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const top10From = Math.min(...top10.map(([y]) => y));
  if (lastYear - top10From < 20)
    facts.push({
      text: ["The ten warmest years on record have all been since ", em(String(top10From)), "."],
      basis: `${SRC}; calendar-year means`,
    });
  if (annual.length >= 20) {
    const last20 = mean(annual.slice(-20).map(([, v]) => v))!;
    const above = annual.slice(-20).filter(([, v]) => v > 1.5).length;
    notes.push({
      id: "paris",
      title: "Why 20-year averages",
      meaning: [
        cited(["The IPCC reports global warming as ", em("20-year averages"), ", so a single hot year does not by itself cross a warming level."], IPCC.twentyYearAverages),
        fromData(
          [em(`${above} of the last 20 years`), ` ${above === 1 ? "was" : "were"} above 1.5 °C.`],
          `${SRC}; calendar-year means ${lastYear - 19}–${lastYear}`,
        ),
      ],
      matters: [],
      howWeKnow: [],
    });
    facts.push({
      note: "paris",
      text: [
        "The Paris Agreement’s 1.5 °C limit refers to long-term averages. The latest 20-year average ",
        `(${lastYear - 19}–${lastYear}) is `,
        em(`${num(last20, 2)} °C`),
        ".",
      ],
      basis: `${SRC}; mean of the last 20 calendar years. Paris Agreement, Article 2`,
    });
  }
  if (monthly.length >= 12) {
    const m12 = mean(monthly.slice(-12).map(([, v]) => v))!;
    facts.push({
      text: ["The 12 months to ", monthYear(monthly.at(-1)![0]), " averaged ", em(`${signed(m12, 2)} °C`), "."],
      basis: `${SRC}; mean of the latest 12 monthly values`,
    });
  }
  const since1970 = slope(annual, 1970, lastYear, 20);
  const since2010 = slope(annual, 2010, lastYear, 10);
  if (since1970 !== null)
    facts.push({
      text: [
        "Since 1970 warming has averaged ",
        em(`${num(since1970 * 10, 2)} °C per decade`),
        ...(since2010 !== null ? [`; since 2010, `, em(`${num(since2010 * 10, 2)} °C`), "."] : ["."]),
      ],
      basis: `${SRC}; least-squares trend of calendar-year means. Short periods are strongly affected by El Niño and La Niña`,
    });
  const lastCool = [...annual].reverse().find(([, v]) => v <= 0);
  if (lastCool && lastYear - lastCool[0] > 20)
    facts.push({
      text: ["Every year since ", em(String(lastCool[0] + 1)), " has been warmer than the 1850–1900 average."],
      basis: `${SRC}; the last calendar year at or below zero was ${lastCool[0]}`,
    });
  return { headline, facts, notes };
}

// ─── Daily air temperature (ERA5) ───────────────────────────────────────────

export function era5Story(daily: Point[], climatology: Point[]): VitalStory | null {
  if (daily.length < 3650) return null;
  const SRC = "ERA5 daily global 2 m air temperature (Copernicus / ECMWF, via Climate Reanalyzer)";
  const years = byDate(daily);
  const [lastT, lastV] = daily.at(-1)!;
  const year = Math.floor(lastT);
  const key = dayKey(lastT);
  const firstYear = Math.floor(daily[0]![0]);
  const clim = new Map(climatology.map(([t, v]) => [dayKey(t), v]));
  const c = clim.get(key);
  const sameDay = onDate(years, key);
  const isRecord = rankOf(sameDay, lastV) === 1 && sameDay.length > 10;

  const headline: RichText =
    c !== undefined
      ? [
          `On ${dayMonth(lastT)} the world was `,
          em(`${num(Math.abs(lastV - c), 2)} °C ${lastV >= c ? "warmer" : "cooler"}`, "daily"),
          " than the 1991–2020 average for the date",
          ...(isRecord ? [", ", em("the warmest on record"), " for that day."] : ["."]),
        ]
      : [`On ${dayMonth(lastT)} the global average air temperature was `, em(`${num(lastV, 2)} °C`, "daily"), "."];

  const facts: StoryFact[] = [];
  const thisYear = years.get(year);
  const meaning: NoteLine[] = [];
  if (climatology.length > 300) {
    const [hiT, hiV] = climatology.reduce((a, b) => (b[1] > a[1] ? b : a));
    const [loT, loV] = climatology.reduce((a, b) => (b[1] < a[1] ? b : a));
    meaning.push(
      fromData(
        [
          "Global temperature has its own seasons. In the 1991–2020 average the world is warmest around ",
          em(`${dayMonth(hiT)} (${num(hiV, 1)} °C)`),
          " and coolest around ",
          em(`${dayMonth(loT)} (${num(loV, 1)} °C)`),
          ", so each day is compared with the average for its own date.",
        ],
        `${SRC}; 1991–2020 mean for each calendar day`,
      ),
    );
  }
  if (thisYear && clim.size > 300) {
    let above = 0;
    let counted = 0;
    for (const [k, v] of thisYear) {
      const ck = clim.get(k);
      if (ck === undefined) continue;
      counted++;
      if (v > ck) above++;
    }
    if (counted > 14)
      meaning.push(
        fromData([em(`${above} of ${counted} days`), ` so far in ${year} were warmer than the 1991–2020 average for their date.`], `${SRC}; each day against its 1991–2020 mean`),
      );
  }
  meaning.push(fromData(["1991–2020 is a recent baseline that was already well above the late 1800s. For warming since then, see global temperature."], `${SRC}; baseline as published`, "temperature"));
  const notes: StoryNote[] = [
    {
      id: "daily",
      title: "Reading a daily global temperature",
      meaning,
      matters: [
        cited(
          ["Heatwaves have become more frequent and more intense over most land since the ", em("1950s"), ", and human-caused climate change is the main driver."],
          IPCC.hotExtremes,
        ),
        cited(["Every extra ", em("0.5 °C"), " of warming brings clearly more frequent and intense heatwaves and heavy rain."], IPCC.extremesPerHalfDegree, "temperature"),
      ],
      howWeKnow: [
        fromData(
          [
            `ERA5 is a reanalysis: a weather model kept on track by observations from satellites, weather stations, balloons and ships, run for every day since ${firstYear}. That is why it is marked modelled.`,
          ],
          SRC,
        ),
      ],
    },
  ];
  if (thisYear && thisYear.size > 14) {
    const keys = [...thisYear.keys()].filter((k) => k !== "02-29");
    const ytd = (m: Map<string, number>) => {
      let sum = 0;
      for (const k of keys) {
        const v = m.get(k);
        if (v === undefined) return null;
        sum += v;
      }
      return sum / keys.length;
    };
    const means: number[] = [];
    for (const m of years.values()) {
      const v = ytd(m);
      if (v !== null) means.push(v);
    }
    const mine = ytd(thisYear);
    if (mine !== null && means.length > 10) {
      facts.push({
        text: [`From 1 January to ${dayMonth(lastT)}, ${year} has been the `, em(ranked(rankOf(means, mine), "warmest")), ` such period since ${firstYear}.`],
        basis: `${SRC}; mean over the same calendar dates in every year`,
      });
    }
    let records = 0;
    for (const [k, v] of thisYear) if (rankOf(onDate(years, k), v) === 1) records++;
    facts.push({
      text: [em(`${records} ${records === 1 ? "day" : "days"}`), ` this year ${records === 1 ? "has" : "have"} been the warmest on record for ${records === 1 ? "its" : "their"} date.`],
      basis: `${SRC}; each date compared with the same date in every year since ${firstYear}`,
    });
  }
  const [maxT, maxV] = daily.reduce((a, b) => (b[1] > a[1] ? b : a));
  facts.push({
    text: ["The warmest day on record was ", `${dayMonth(maxT)} ${dateOf(maxT).getUTCFullYear()}, at `, em(`${num(maxV, 2)} °C`), "."],
    basis: `${SRC}; highest daily value since ${firstYear}`,
  });
  return { headline, facts, notes };
}

// ─── Arctic sea ice ─────────────────────────────────────────────────────────

export function seaIceStory(arctic: Point[], minima: Point[], baseMin: number | null, antarctic: Point[]): VitalStory | null {
  if (arctic.length < 3650 || minima.length < 20) return null;
  const SRC = "NSIDC Sea Ice Index v4";
  const years = byDate(arctic);
  const [lastT, lastV] = arctic.at(-1)!;
  const sameDay = onDate(years, dayKey(lastT));
  const rank = rankOf(sameDay, lastV, "asc");

  const headline: RichText = [
    "Arctic sea ice is the ",
    em(ranked(rank, "lowest"), "arctic"),
    ` on record for ${dayMonth(lastT)}, in ${sameDay.length} years of satellite data.`,
  ];

  const firstYear = Math.floor(arctic[0]![0]);
  const key = dayKey(lastT);
  // The first ten years with a value on this date (before 1987 the satellites passed every other day).
  const early: [number, number][] = [];
  for (let y = firstYear; y < firstYear + 25 && early.length < 10; y++) {
    const v = years.get(y)?.get(key);
    if (v !== undefined) early.push([y, v]);
  }
  const meaning: NoteLine[] = [];
  if (early.length === 10) {
    const was = mean(early.map(([, v]) => v))!;
    meaning.push(
      fromData(
        [
          `In ${early[0]![0]}–${early[9]![0]}, ice on ${dayMonth(lastT)} covered on average `,
          em(`${num(was, 2)} million km²`),
          `. This year it covers ${num(lastV, 2)}: `,
          em(`${num((1 - lastV / was) * 100)}% less`),
          ".",
        ],
        `${SRC}; mean extent on this date in the first ten years with a value for it`,
      ),
    );
  }
  meaning.push(fromData(["Extent counts every patch of ocean that is at least 15% covered by ice."], `${SRC}; definition of extent`));
  const notes: StoryNote[] = [
    {
      id: "arctic",
      title: "Arctic sea ice",
      meaning,
      matters: [
        cited(
          [
            "People are very likely the main cause of the Arctic’s ice loss: about ",
            em("40% less"),
            " ice in September and ",
            em("10% less"),
            " in March, comparing 1979–1988 with 2010–2019.",
          ],
          IPCC.arcticIceHuman,
          "temperature",
        ),
        cited(["Late-summer Arctic ice is smaller than at any time in at least ", em("1,000 years"), "."], IPCC.arcticIce1000Years),
        cited(
          ["The Arctic is likely to be practically ice-free in September (under 1 million km²) at least once ", em("before 2050"), "."],
          IPCC.iceFreeArctic,
        ),
      ],
      howWeKnow: [
        fromData(
          [`Satellites have mapped the ice since ${firstYear} from the microwaves that ice and open water give off, which pass through clouds and the polar night.`],
          SRC,
        ),
      ],
    },
  ];

  const facts: StoryFact[] = [];
  facts.push({
    text: ["It covers ", em(`${num(lastV, 2)} million km²`), ` of ocean (${dayMonth(lastT)} ${Math.floor(lastT)}).`],
    basis: `${SRC}; daily extent, the area with at least 15% ice cover`,
  });
  const fit = linearFit(minima);
  if (fit && baseMin)
    facts.push({
      text: ["The yearly minimum is shrinking by about ", em(`${num((-fit.slope * 10 * 100) / baseMin)}% per decade`), " against its 1981–2010 average."],
      basis: `${SRC}; least-squares trend of the yearly minima since ${minima[0]![0]}, as a share of the 1981–2010 mean minimum (${num(baseMin, 2)} million km²)`,
    });
  const [lowYear, lowV] = minima.reduce((a, b) => (b[1] < a[1] ? b : a));
  const [minYear, minV] = minima.at(-1)!;
  const minRank = rankOf(minima.map(([, v]) => v), minV, "asc");
  facts.push({
    text:
      minYear === lowYear
        ? [`${minYear}’s minimum, `, em(`${num(minV, 2)} million km²`), ", was the lowest on record."]
        : [`${minYear}’s minimum was the `, em(ranked(minRank, "lowest")), ` on record. The record low is ${num(lowV, 2)} million km², in `, em(String(lowYear)), "."],
    basis: `${SRC}; lowest daily extent of each year`,
  });
  const recent = extremesAreRecent(minima, "asc");
  if (recent >= 3)
    facts.push({
      text: ["The ", em(`${recent} lowest minima`), ` have all been in the last ${recent} years.`],
      basis: `${SRC}; yearly minima ${minima[0]![0]}–${minYear}`,
    });
  const lastS = antarctic.at(-1);
  if (lastS) {
    const southRank = rankOf(onDate(byDate(antarctic), dayKey(lastS[0])), lastS[1], "asc");
    facts.push({
      text: ["Around Antarctica, ice covers ", em(`${num(lastS[1], 2)} million km²`), ", the ", em(ranked(southRank, "lowest")), " for the date."],
      basis: `${SRC}; Southern Hemisphere daily extent`,
      note: "antarctic",
    });
    notes.push({
      id: "antarctic",
      title: "Why Antarctica is different",
      meaning: [
        cited(
          ["Antarctic sea ice showed no significant trend from 1979 to 2020: some regions gained ice while others lost it, and it swings widely from year to year."],
          IPCC.arcticIceHuman,
        ),
      ],
      matters: [],
      howWeKnow: [],
    });
  }
  return { headline, facts, notes };
}

// ─── Sea level ──────────────────────────────────────────────────────────────

export function seaLevelStory(satellite: Point[], tideGauges: Point[] | null, now: number): VitalStory | null {
  if (satellite.length < 120) return null;
  const SAT = "NOAA Laboratory for Satellite Altimetry";
  const TG = "Tide-gauge reconstruction (Church & White 2011)";
  const sat12 = mean(satellite.slice(-12).map(([, v]) => v))!;
  const lastT = satellite.at(-1)![0];
  const first = Math.floor(satellite[0]![0]) + 1; // first full year of satellites
  const tgStart = tideGauges?.length ? Math.floor(tideGauges[0]![0]) : null;
  const tgBase = tgStart !== null ? mean(tideGauges!.filter(([t]) => Math.floor(t) === tgStart).map(([, v]) => v)) : null;
  const early = slope(satellite, first - 0.5, first + 9.5, 60);
  const late = slope(satellite, lastT - 10, lastT, 60);
  const faster = early !== null && late !== null && late > early;

  const headline: RichText =
    tgBase !== null
      ? ["Global sea level has risen about ", em(`${num((sat12 - tgBase) / 10)} cm`, "rise"), ` since ${tgStart}`]
      : ["Global sea level has risen ", em(`${num(sat12)} mm`, "rise"), " since 1993"];
  if (faster) headline.push(", and the rise is ", em("speeding up", "faster"), ".");
  else headline.push(".");

  const notes: StoryNote[] = [
    {
      id: "rise",
      title: "Why the sea is rising",
      meaning:
        late !== null
          ? [
              fromData(
                ["At the rate of the last ten years, ", em(`${num(late, 1)} mm a year`), ", the sea rises about ", em(`${num(late, 0)} cm every decade`), "."],
                `${SAT}; least-squares trend over the last ten years`,
              ),
            ]
          : [],
      matters: [
        cited(
          [
            "Warming water expands, and melting land ice adds water. In 1971–2018 expansion explained ",
            em("50%"),
            " of the rise, glaciers 22%, ice sheets 20% and changes in water stored on land 8%.",
          ],
          IPCC.seaLevelCauses,
          "oceanHeat",
        ),
        cited(["The sea has risen faster since 1900 than in any century in at least ", em("3,000 years"), "."], IPCC.seaLevel3000Years),
        cited(
          ["It will keep rising for centuries. Over the next 2,000 years, about ", em("2 to 3 m"), " if warming is limited to 1.5 °C, and 2 to 6 m at 2 °C."],
          IPCC.seaLevelCommitted,
        ),
      ],
      howWeKnow: [
        ...(tgStart !== null ? [fromData([`Tide gauges on coasts have recorded sea level since ${tgStart}.`], TG)] : []),
        fromData(["Since 1993 satellites have measured the height of the whole ocean surface by bouncing radar pulses off it."], SAT),
      ],
    },
  ];
  if (faster)
    notes.push({
      id: "faster",
      title: "Is the rise speeding up?",
      meaning: [
        fromData(
          [`${first}–${first + 9}: `, em(`${num(early!, 1)} mm a year`), ". The last ten years: ", em(`${num(late!, 1)} mm a year`), "."],
          `${SAT}; least-squares trends over each ten-year period`,
        ),
      ],
      matters: [
        cited(
          ["The IPCC finds the same over a longer span: ", em("1.3 mm"), " a year in 1901–1971, 1.9 in 1971–2006 and ", em("3.7 mm"), " in 2006–2018."],
          IPCC.seaLevelRates,
        ),
      ],
      howWeKnow: [fromData(["Under Data & layers, “Trend and acceleration” fits a curve as well as a straight line, so you can see the speed-up in the chart."], "Explorer trend overlay")],
    });

  const facts: StoryFact[] = [];
  if (tgBase !== null)
    facts.push({
      text: ["Satellites alone have measured ", em(`${num(sat12)} mm`), ` of that since 1993 (the 12 months to ${monthYear(lastT)}).`],
      basis: `${SAT}; mean of the latest 12 monthly values. The ${tgStart} figure joins this to the ${TG}, both set to zero in 1993`,
    });
  if (early !== null && late !== null)
    facts.push({
      text: ["It is rising ", em(`${num(late, 1)} mm a year`), ` over the last ten years, ${faster ? "up" : "down"} from `, em(`${num(early, 1)} mm`), ` a year in ${first}–${first + 9}.`],
      basis: `${SAT}; least-squares trends over each ten-year period`,
    });
  if (tideGauges) {
    const century = slope(tideGauges, 1900, 2000, 40);
    if (century !== null)
      facts.push({
        text: ["Through the 20th century the average was ", em(`${num(century, 1)} mm a year`), "."],
        basis: `${TG}; least-squares trend 1900–1999`,
      });
  }
  if (now - lastT > 0.5)
    facts.push({
      text: ["The satellite record currently ends in ", em(monthYear(lastT)), `; NOAA’s file can lag by a year or more.`],
      basis: `${SAT}; date of the latest value`,
    });
  return { headline, facts, notes };
}

// ─── Ocean heat ─────────────────────────────────────────────────────────────

export function oceanHeatStory(annual: Point[]): VitalStory | null {
  if (annual.length < 40) return null;
  const SRC = "NOAA NCEI ocean heat content, 0–2000 m, via Our World in Data";
  const values = annual.map(([, v]) => v);
  const [lastYear, lastV] = annual.at(-1)!;
  const rank = rankOf(values, lastV);
  const records = annual.filter(([, v], i) => i > 0 && v > Math.max(...values.slice(0, i)));
  const recentRecords = records.filter(([y]) => y > lastYear - 10).length;

  const headline: RichText =
    rank === 1
      ? ["The upper ocean held ", em("more heat than ever measured", "heat"), ` in ${lastYear}: `, em(`${recentRecords} of the last 10 years`), " set a record."]
      : [`Ocean heat in ${lastYear} was the `, em(ranked(rank, "highest"), "heat"), " on record."];

  const facts: StoryFact[] = [];
  const firstYear = annual[0]![0];
  const base = mean(annual.slice(0, 5).map(([, v]) => v))!;
  const notes: StoryNote[] = [
    {
      id: "heat",
      title: "Where the extra heat goes",
      meaning: [
        cited(
          ["The ocean has taken up ", em("91%"), " of the extra heat building up in the climate. Land took about 5%, melting ice 3% and the air just ", em("1%"), "."],
          IPCC.oceanTakesTheHeat,
        ),
        fromData(
          [
            "The unit, 10²² joules, is ten thousand billion billion joules. Since ",
            `${firstYear}–${firstYear + 4} the upper 2,000 m have gained `,
            em(`${num(lastV - base)} of them`),
            ".",
          ],
          `${SRC}; ${lastYear} value minus the mean of the first five years`,
        ),
      ],
      matters: [
        cited(["Warmer water expands: that explained ", em("50%"), " of sea-level rise in 1971–2018."], IPCC.seaLevelCauses, "seaLevel"),
        cited(["Marine heatwaves have roughly ", em("doubled"), " in frequency since the 1980s."], IPCC.hotExtremes),
        cited(
          ["Past emissions have committed the ocean to keep warming, and the change is ", em("irreversible"), " for centuries to millennia."],
          IPCC.oceanCommitted,
        ),
      ],
      howWeKnow: [
        fromData(
          ["Since the early 2000s robotic Argo floats have sampled temperature down to 2,000 m across the oceans. Earlier values come from ship measurements."],
          SRC,
        ),
      ],
    },
  ];
  facts.push({
    text: ["The upper 2,000 m of ocean has gained ", em(`${num(lastV - base)} × 10²² joules`), ` since ${firstYear}–${firstYear + 4}.`],
    basis: `${SRC}; ${lastYear} value minus the mean of the first five years`,
  });
  const early = slope(annual, 1960, 1999, 20);
  const late = slope(annual, 2000, lastYear, 10);
  if (early !== null && late !== null && early > 0)
    facts.push({
      text: ["Since 2000 it has gained heat ", em(`${num(late / early, 1)} times as fast`), " as in 1960–1999."],
      basis: `${SRC}; least-squares trends: ${num(early, 2)} vs ${num(late, 2)} × 10²² J a year`,
    });
  if (rank !== 1)
    facts.push({
      text: [em(`${recentRecords} of the last 10 years`), " set a new record."],
      basis: `${SRC}; a record is a year above every earlier year`,
    });
  return { headline, facts, notes };
}

// ─── Carbon budget ──────────────────────────────────────────────────────────

const partOfYear = (t: number) => {
  const f = t - Math.floor(t);
  return `${f < 1 / 3 ? "early" : f < 2 / 3 ? "mid" : "late"} ${Math.floor(t)}`;
};

export function carbonBudgetStory(cumulative: Point[], igcc: IgccData, now: number): VitalStory | null {
  const { budget, co2Emissions, edition } = igcc;
  const rate = co2Emissions.gt;
  if (!(rate > 0)) return null;
  const IG = `Indicators of Global Climate Change (${edition})`;
  const OWID = "Global Carbon Project via Our World in Data";
  const remaining = budget.gtCO2 - rate * (now - budget.fromYear);
  const runsOut = budget.fromYear + budget.gtCO2 / rate;
  const yearsLeft = remaining / rate;

  const headline: RichText =
    remaining > 0
      ? [
          "At today’s emissions the carbon budget for 1.5 °C runs out in ",
          em(yearsLeft < 1.5 ? "about a year" : `about ${num(yearsLeft)} years`, "budget"),
          `, in ${partOfYear(runsOut)}.`,
        ]
      : ["At today’s emissions the carbon budget for 1.5 °C ", em(`ran out in ${partOfYear(runsOut)}`, "budget"), "."];

  const facts: StoryFact[] = [];
  const last = cumulative.at(-1);
  const meaning: NoteLine[] = [
    fromData(
      [
        "The carbon budget is how much more CO₂ can be emitted for a 50% chance of holding warming to 1.5 °C: ",
        em(`${budget.gtCO2} billion tonnes`),
        ` from 1 January ${budget.fromYear}.`,
      ],
      `${IG}; central estimate`,
    ),
  ];
  if (last)
    meaning.push(
      fromData(
        ["That is ", em(`${num((budget.gtCO2 / last[1]) * 100)}%`), " of what has already been emitted since 1850."],
        `${IG} budget against the ${OWID} total to the end of ${last[0] - 1}`,
      ),
    );
  const notes: StoryNote[] = [
    {
      id: "budget",
      title: "What the carbon budget is",
      meaning,
      matters: [
        cited(
          ["Warming rises almost in step with all the CO₂ ever emitted: each ", em("1,000 Gt"), " adds about ", em("0.45 °C"), " (likely 0.27 to 0.63 °C)."],
          IPCC.warmingPerTonne,
          "temperature",
        ),
        cited(["So holding warming at any level means reaching ", em("net zero"), " CO₂ emissions."], IPCC.netZero),
      ],
      howWeKnow: [
        fromData(
          ["The budget comes from Indicators of Global Climate Change, a yearly update of the IPCC’s assessment of these numbers. The countdown assumes emissions stay at today’s level."],
          IG,
        ),
      ],
    },
  ];
  if (last) {
    facts.push({
      text: ["Since 1850 humanity has emitted ", em(`${num(last[1])} billion tonnes of CO₂`), ` from fossil fuels, cement and land use (to the end of ${last[0] - 1}).`],
      basis: `${OWID}; yearly fossil and land-use CO₂, summed`,
    });
    const at1990 = cumulative.find(([t]) => t === 1990)?.[1];
    if (at1990 !== undefined)
      facts.push({
        text: [em(`${num(((last[1] - at1990) / last[1]) * 100)}%`), " of it was emitted from 1990 on."],
        basis: `${OWID}; emitted from 1 January 1990 as a share of the total since 1850`,
      });
  }
  facts.push({
    text: [
      `For a 50% chance of 1.5 °C, ${budget.gtCO2} Gt was left on 1 January ${budget.fromYear}. Depending on assumptions the figure ranges from `,
      em(`${budget.rangeGtCO2[0]} to ${budget.rangeGtCO2[1]} Gt`),
      ".",
    ],
    basis: `${IG}; central estimate and range across its parameter sets`,
  });
  facts.push({
    text: [`Emissions in ${co2Emissions.year} were `, em(`${num(rate, 1)} Gt CO₂`), ". The countdown assumes they stay there: it is a projection, not a measurement."],
    basis: `${IG}; fossil and land-use CO₂`,
  });
  return { headline, facts, notes };
}
