/**
 * Deterministic reader for the Ask bar. It turns "germany vs france per capita
 * since 1990" into an `Intent` without any model: periods, countries, measures
 * and the kind of answer wanted are matched against the catalog's own
 * vocabulary. What it can't read is reported back as `unread`, so the UI can
 * say so (or hand the question to a model when one is configured).
 */
import type { Catalog, Intent, ListDataset, Measure } from "../query.ts";
import { emptyIntent } from "../query.ts";
import type { VitalId } from "../types.ts";
import {
  ASCENDING_WORDS,
  BY_COUNTRY_WORDS,
  CHANGE_DISPLAY_WORDS,
  CHART_WORDS,
  GROUP_WORDS,
  MAP_VIEW_WORDS,
  STACKED_WORDS,
  COUNTRY_ALIASES,
  DECADAL_WORDS,
  EXPLAIN_WORDS,
  FALL_WORDS,
  FILLER,
  FORECAST_WORDS,
  HAZARD_WORDS,
  LIST_WORDS,
  MAP_WORDS,
  NUMBER_WORD_PATTERN,
  OPEN_WORDS,
  PERCENT_WORDS,
  PHASE_WORDS,
  RANK_WORDS,
  RISE_WORDS,
  SMOOTH_WORDS,
  numberWord,
} from "./vocabulary.ts";

export interface Parsed {
  intent: Intent;
  /** Words the parser couldn't place, in the order typed. */
  unread: string[];
  /** Typos it fixed: [as typed, read as]. */
  corrections: [string, string][];
  /** Share of meaningful words that were understood, 0–1. */
  confidence: number;
  /** True when anything at all was recognised. */
  understood: boolean;
}

/**
 * Lower-cases and blanks out punctuation without changing the string's length,
 * so positions in the normalised text are positions in what was typed.
 */
export function normalize(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // Subscript digits: CO₂ → co2.
    if (code >= 0x2080 && code <= 0x2089) out += String(code - 0x2080);
    else if (ch === "–" || ch === "—") out += "-";
    else if (ch === "’") out += "'";
    else {
      // Lower case without accents (niño → nino), but only where that keeps the string aligned with the input.
      const lower = ch.toLowerCase();
      const folded = lower.normalize("NFD").replace(/\p{M}/gu, "");
      const c = folded.length === ch.length ? folded : lower.length === ch.length ? lower : ch;
      out += /[\p{L}\p{N}\-.,'%]/u.test(c) ? c : " ".repeat(c.length);
    }
  }
  // Commas and full stops only matter inside numbers ("800,000") and abbreviations ("u.s.");
  // a possessive "'s" never does ("india's emissions").
  return out.replace(/'s(?![\p{L}\p{N}])/gu, "  ").replace(/,(?!\d)/g, " ").replace(/(?<!\d),/g, " ").replace(/\.(?=\s|$)/g, " ");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A phrase as a whole-word pattern, with an optional plural. */
const phrase = (p: string) => `(?<![\\p{L}\\p{N}])${escape(p).replace(/ /g, "\\s+")}(?:s|es)?(?![\\p{L}\\p{N}])`;

/** Compiled patterns, reused across calls: the parser runs on every keystroke. */
const compiled = new Map<string, RegExp>();
function regex(source: string): RegExp {
  let re = compiled.get(source);
  if (!re) compiled.set(source, (re = new RegExp(source, "gu")));
  return re;
}

class Text {
  readonly used: boolean[];
  constructor(
    readonly s: string,
    readonly original: string,
  ) {
    this.used = Array.from({ length: s.length }, () => false);
  }
  private free(a: number, b: number) {
    for (let i = a; i < b; i++) if (this.used[i]) return false;
    return true;
  }
  mark(a: number, b: number) {
    for (let i = a; i < b; i++) this.used[i] = true;
  }
  /** Every free match of a pattern; marks them used when `take` is true. */
  find(pattern: RegExp | string, take = true): RegExpExecArray[] {
    const re = typeof pattern === "string" ? regex(pattern) : new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    const out: RegExpExecArray[] = [];
    for (const m of this.s.matchAll(re)) {
      const a = m.index;
      const b = a + m[0].length;
      if (m[0].length === 0 || !this.free(a, b)) continue;
      if (take) this.mark(a, b);
      out.push(m as RegExpExecArray);
    }
    return out;
  }
  /** First phrase from the list that occurs, longest first. */
  any(phrases: string[], take = true): string | null {
    for (const p of [...phrases].sort((a, b) => b.length - a.length)) if (this.find(phrase(p), take).length) return p;
    return null;
  }
  /** Words not yet consumed. */
  rest(): string[] {
    let out = "";
    for (let i = 0; i < this.s.length; i++) out += this.used[i] ? " " : this.s[i];
    return out.split(/\s+/).map((w) => w.replace(/^[-.,']+|[-.,']+$/g, "")).filter(Boolean);
  }
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const YEAR = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,7})(k)?(?:\s?(bce|bc|ce|ad|b\.c\.|a\.d\.))?`;
const UNIT = String.raw`(years?|yrs?|decades?|centur(?:y|ies)|millenni(?:um|a))`;

/** "800,000" → 800000, "12k" → 12000, "10,000 BC" → -9999 (astronomical years, as the explorer uses). */
function yearOf(num: string, k: string | undefined, era: string | undefined): number {
  const n = Number(num.replace(/,/g, "")) * (k ? 1000 : 1);
  return era && era.startsWith("b") ? 1 - n : n;
}
const unitYears = (u: string) => (u.startsWith("dec") ? 10 : u.startsWith("cent") ? 100 : u.startsWith("mill") ? 1000 : 1);
/** A bare number counts as a year if it's in a plausible range or carries an era. */
const plausible = (n: number, era: string | undefined) => !!era || (n >= 1000 && n <= 2200);

function readPeriod(t: Text, nowYear: number): { from: number | null; to: number | null } | null {
  let m: RegExpExecArray | undefined;
  const W = String.raw`(?<![\p{L}\p{N}])`;
  const E = String.raw`(?![\p{L}\p{N}])`;

  // between 1990 and 2000 / from 1990 to 2000
  [m] = t.find(`${W}(?:between|from)\\s+${YEAR}\\s*(?:and|to|-|until|till|through)\\s*${YEAR}${E}`);
  if (m) return order(yearOf(m[1]!, m[2], m[3] ?? m[6]), yearOf(m[4]!, m[5], m[6]));

  // 1990-2000 / 1990 to 2000
  [m] = t.find(`${W}${YEAR}\\s*(?:-|to|until|till|through)\\s*${YEAR}${E}`, false);
  if (m) {
    const a = yearOf(m[1]!, m[2], m[3] ?? m[6]);
    const b = yearOf(m[4]!, m[5], m[6]);
    if (plausible(Math.abs(a), m[3] ?? m[6]) && plausible(Math.abs(b), m[6])) {
      t.mark(m.index, m.index + m[0].length);
      return order(a, b);
    }
  }

  // the 1980s / the 80s / since the 1980s
  [m] = t.find(`${W}(since\\s+|in\\s+|during\\s+)?(?:the\\s+)?(\\d{1,3})0'?s${E}`);
  if (m) {
    const d = m[2]!;
    const start = d.length === 3 ? Number(d) * 10 : d.length === 1 ? (Number(d) >= 3 ? 1900 : 2000) + Number(d) * 10 : null;
    if (start !== null) return { from: start, to: m[1]?.startsWith("since") ? null : start + 9 };
  }

  // the 20th century
  [m] = t.find(`${W}(?:in\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\s+century${E}`);
  if (m) {
    const start = (Number(m[1]) - 1) * 100;
    return { from: start, to: Math.min(start + 99, nowYear) === nowYear ? null : start + 99 };
  }

  // this year / last year
  if (t.find(`${W}this\\s+year${E}`).length) return { from: nowYear, to: nowYear };
  if (t.find(`${W}last\\s+year${E}`).length) return { from: nowYear - 1, to: nowYear - 1 };

  // since 30 years ago / from a century ago
  const N = `(\\d{1,3}(?:,\\d{3})+|${NUMBER_WORD_PATTERN})(k)?`;
  [m] = t.find(`${W}(?:since|from|starting|beginning|after)\\s+(?:about\\s+|around\\s+|some\\s+)?${N}\\s+${UNIT}\\s+ago${E}`);
  if (m) {
    const n = numberWord(m[1]!) ?? Number(m[1]!.replace(/,/g, ""));
    return { from: nowYear - n * (m[2] ? 1000 : 1) * unitYears(m[3]!), to: null };
  }
  // 100 years ago / a century ago: that one year
  [m] = t.find(`${W}(?:about\\s+|around\\s+|some\\s+)?${N}\\s+${UNIT}\\s+ago${E}`);
  if (m) {
    const y = nowYear - (numberWord(m[1]!) ?? Number(m[1]!.replace(/,/g, ""))) * (m[2] ? 1000 : 1) * unitYears(m[3]!);
    return { from: y, to: y };
  }

  // last 30 years / past decade / last 800k years / the past few centuries
  [m] = t.find(`${W}(?:in\\s+|over\\s+|during\\s+)?(?:the\\s+)?(?:last|past|previous|recent)\\s+(?:(\\d{1,3}(?:,\\d{3})+|${NUMBER_WORD_PATTERN})(k)?\\s+)?${UNIT}${E}`);
  if (m) {
    const n = m[1] ? (numberWord(m[1]) ?? Number(m[1].replace(/,/g, ""))) : 1;
    return { from: nowYear - n * (m[2] ? 1000 : 1) * unitYears(m[3]!), to: null };
  }

  // since 1990 / after 1990 / from 1990
  [m] = t.find(`${W}(?:since|after|from|starting(?:\\s+in)?|beginning(?:\\s+in)?)\\s+(?:the\\s+year\\s+)?${YEAR}${E}`);
  if (m) return { from: yearOf(m[1]!, m[2], m[3]), to: null };

  // before 1990 / until 2000
  [m] = t.find(`${W}(?:before|until|till|up\\s+to|through|prior\\s+to|by)\\s+${YEAR}${E}`);
  if (m) {
    const y = yearOf(m[1]!, m[2], m[3]);
    if (plausible(Math.abs(y), m[3])) return { from: null, to: m[0].startsWith("before") || m[0].startsWith("prior") ? y - 1 : y };
  }

  // Bare years: "in 1990", "1990 2020"
  const bare = t
    .find(`${W}(?:in\\s+|for\\s+|of\\s+)?${YEAR}${E}`, false)
    .map((x) => ({ x, y: yearOf(x[1]!, x[2], x[3]) }))
    .filter(({ x, y }) => plausible(Math.abs(y), x[3]));
  if (bare.length) {
    for (const { x } of bare) t.mark(x.index, x.index + x[0].length);
    const ys = bare.map((b) => b.y);
    return { from: Math.min(...ys), to: Math.max(...ys) };
  }
  return null;
}

function order(a: number, b: number) {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

interface Hit {
  measure: Measure;
  a: number;
  b: number;
  words: number;
  specific: boolean;
}

/**
 * Picks measures greedily: the one whose phrases cover the most words wins and
 * claims those words, then the next, until no measure has a phrase left. So
 * "co2 emissions per capita" is one measure, not "CO₂ emissions" plus
 * "per capita".
 */
function readMeasures(t: Text, measures: Measure[]): Measure[] {
  const hits: Hit[] = [];
  measures.forEach((m) => {
    // The measure's own short label counts as one of its names ("CO₂ per person", "Arctic ice minimum").
    for (const [list, specific] of [[[...m.terms, m.short], true], [m.context ?? [], false]] as const)
      for (const term of list) {
        const p = normalize(term).replace(/\s+/g, " ").trim();
        if (!p) continue;
        for (const x of t.find(phrase(p), false))
          hits.push({ measure: m, a: x.index, b: x.index + x[0].length, words: p.split(/\s+/).length, specific });
      }
  });
  const claimed: boolean[] = Array.from({ length: t.s.length }, () => false);
  const isFree = (h: Hit) => {
    for (let i = h.a; i < h.b; i++) if (claimed[i]) return false;
    return true;
  };
  const chosen: Measure[] = [];
  for (;;) {
    let best: { m: Measure; score: number; hits: Hit[] } | null = null;
    for (const m of measures) {
      if (chosen.includes(m)) continue;
      const own = hits.filter((h) => h.measure === m && isFree(h));
      if (!own.some((h) => h.specific)) continue;
      // Overlapping phrases of the same measure count once, by their longest.
      const spans: Hit[] = [];
      for (const h of own.sort((x, y) => y.words - x.words)) if (!spans.some((s) => h.a < s.b && s.a < h.b)) spans.push(h);
      const score = spans.reduce((s, h) => s + h.words + (h.specific ? 0.5 : 0), 0);
      if (!best || score > best.score) best = { m, score, hits: spans };
    }
    if (!best) break;
    chosen.push(best.m);
    for (const h of best.hits) for (let i = h.a; i < h.b; i++) claimed[i] = true;
  }
  for (let i = 0; i < claimed.length; i++) if (claimed[i]) t.used[i] = true;
  // Loose words from a chosen measure's own names belong to it too: "arctic see ice".
  for (const m of chosen) {
    const words = new Set([...m.terms, m.short, ...(m.context ?? [])].flatMap((x) => normalize(x).split(/\s+/)).filter((w) => w.length >= 3));
    for (const w of words) t.find(`(?<![\\p{L}\\p{N}])${escape(w)}(?:s|es)?(?![\\p{L}\\p{N}])`);
  }
  // Keep the order the reader named them in.
  const first = (m: Measure) => Math.min(...hits.filter((h) => h.measure === m && h.specific).map((h) => h.a));
  return chosen.sort((x, y) => first(x) - first(y));
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

function readCountries(t: Text, catalog: Catalog): string[] {
  const entries: { term: string; iso3: string; caps: boolean }[] = [];
  for (const c of catalog.countries) for (const n of [c.name, ...c.names]) entries.push({ term: n, iso3: c.iso3, caps: false });
  for (const [term, iso3] of Object.entries(COUNTRY_ALIASES))
    if (iso3 === "WLD" || catalog.countries.some((c) => c.iso3 === iso3)) entries.push({ term, iso3, caps: term.replace(/\./g, "") === "US" });
  entries.sort((a, b) => b.term.length - a.term.length);
  const found: { iso3: string; at: number }[] = [];
  for (const e of entries) {
    const p = normalize(e.term).replace(/\s+/g, " ").trim();
    if (p.length < 2) continue;
    const re = `(?<![\\p{L}\\p{N}])${escape(p).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`;
    for (const m of t.find(re, false)) {
      if (e.caps && t.original.slice(m.index, m.index + m[0].length) !== t.original.slice(m.index, m.index + m[0].length).toUpperCase()) continue;
      t.mark(m.index, m.index + m[0].length);
      found.push({ iso3: e.iso3, at: m.index });
    }
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.iso3))];
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Typo correction: unknown words are matched to the nearest word the parser knows
// ---------------------------------------------------------------------------

const vocabularies = new WeakMap<Catalog, { known: Set<string>; targets: string[] }>();

/**
 * Every word the parser knows for this catalog, with plurals (`known`), and
 * the words worth correcting a typo to (`targets`: meaningful words, not filler).
 */
function vocabulary(catalog: Catalog): { known: Set<string>; targets: string[] } {
  const hit = vocabularies.get(catalog);
  if (hit) return hit;
  const v = new Set<string>();
  const base = new Set<string>();
  const add = (phrase: string) => {
    for (const w of normalize(phrase).split(/\s+/)) {
      const word = w.replace(/^[-.,']+|[-.,']+$/g, "");
      if (word.length < 2 || /\d/.test(word)) continue;
      v.add(word);
      v.add(`${word}s`);
      base.add(word);
    }
  };
  for (const m of catalog.measures) [...m.terms, ...(m.context ?? []), m.short, m.label].forEach(add);
  for (const c of catalog.countries) [c.name, ...c.names].forEach(add);
  for (const l of catalog.lists) add(l.label);
  for (const list of [
    Object.keys(COUNTRY_ALIASES), ...Object.values(LIST_WORDS), ...HAZARD_WORDS.map((h) => h.words), ...PHASE_WORDS.map((p) => p.words),
    RANK_WORDS, RISE_WORDS, FALL_WORDS, PERCENT_WORDS, CHANGE_DISPLAY_WORDS, OPEN_WORDS, MAP_WORDS, MAP_VIEW_WORDS, BY_COUNTRY_WORDS,
    CHART_WORDS, STACKED_WORDS, EXPLAIN_WORDS, FORECAST_WORDS, SMOOTH_WORDS, DECADAL_WORDS, ...GROUP_WORDS.map((g) => g.words), [...FILLER],
    ["since", "before", "after", "between", "last", "past", "previous", "ago", "decade", "century", "millennium", "bc", "bce", "ad", "ce", "mean", "average"],
  ])
    list.forEach(add);
  // Only words as written in the vocabulary, not the plurals generated for matching.
  const out = { known: v, targets: [...base].filter((w) => !FILLER.has(w) && w.length >= 4) };
  vocabularies.set(catalog, out);
  return out;
}

/** Edit distance with transpositions, giving up beyond `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/**
 * Replaces words the parser doesn't know with the closest meaningful one it
 * does, keeping the first letter: one edit for words of 4–7 letters, two for
 * longer ones. Short words are left alone; "gdp" stays "gdp" and is reported
 * as not understood.
 */
export function correct(text: string, catalog: Catalog): { text: string; corrections: [string, string][] } {
  const { known, targets } = vocabulary(catalog);
  const corrections: [string, string][] = [];
  const out = text.replace(/[\p{L}][\p{L}'’-]*/gu, (word) => {
    const w = normalize(word).trim();
    if (w.length < 4 || known.has(w) || /\d/.test(w)) return word;
    const max = w.length >= 8 ? 2 : 1;
    let best: string | null = null;
    let bestD = max + 1;
    for (const cand of targets) {
      // Typos rarely change a word's first letter; requiring it keeps "dancing" from becoming "ranking".
      if (cand[0] !== w[0] || Math.abs(cand.length - w.length) > max) continue;
      const dd = distance(w, cand, max);
      if (dd < bestD) {
        best = cand;
        bestD = dd;
      }
    }
    if (!best || bestD > max) return word;
    corrections.push([word, best]);
    return best;
  });
  return { text: out, corrections };
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

export function parse(text: string, catalog: Catalog, nowYear: number): Parsed {
  const fixed = correct(text, catalog);
  const t = new Text(normalize(fixed.text), fixed.text);
  const intent = emptyIntent();
  const has = (words: string[], take = true) => t.any(words, take) !== null;
  const takeAll = (words: string[]) => {
    while (t.any(words) !== null);
  };

  const explain = has(EXPLAIN_WORDS);
  const forecast = has(FORECAST_WORDS);
  const open = has(OPEN_WORDS);
  const changeDisplay = has(CHANGE_DISPLAY_WORDS);
  const stacked = has(STACKED_WORDS);

  // Smoothing: "10-year average", "smoothed", "decadal average"
  const [sm] = t.find(`(?<![\\p{L}\\p{N}])(\\d{1,3})[\\s-]?(?:year|yr)s?[\\s-]+(?:running\\s+|moving\\s+|rolling\\s+)?(?:mean|average|avg)(?![\\p{L}\\p{N}])`);
  if (sm) intent.smoothing = Number(sm[1]);
  else if (has(DECADAL_WORDS)) intent.smoothing = 10;
  else if (has(SMOOTH_WORDS)) intent.smoothing = 10;

  // Top N: "top 10", "5 largest", "ten biggest"
  let topN: number | null = null;
  const [tn] = t.find(`(?<![\\p{L}\\p{N}])(?:top|first|largest|biggest|highest|lowest|smallest|leading)\\s+(${NUMBER_WORD_PATTERN})(?![\\p{L}\\p{N}])`, false);
  const [nt] = t.find(`(?<![\\p{L}\\p{N}])(${NUMBER_WORD_PATTERN})\\s+(?:largest|biggest|highest|lowest|smallest|top|leading|countries|emitters)(?![\\p{L}\\p{N}])`, false);
  for (const m of [tn, nt]) {
    const n = m ? numberWord(m[1]!) : null;
    if (!m || n === null || n <= 0 || n > 100 || topN !== null || m[1] === "a" || m[1] === "an") continue;
    topN = n;
    // Only the number is consumed; the rank word is read below.
    const at = m === tn ? m.index + m[0].length - m[1]!.length : m.index;
    t.mark(at, at + m[1]!.length);
  }

  const period = readPeriod(t, nowYear);
  if (period) {
    intent.from = period.from;
    // "30 years ago until today" runs to the present, not just that one year.
    const toNow = t.find(`(?<![\\p{L}\\p{N}])(?:until|till|to|through|up\\s+to)\\s+(?:today|now|the\\s+present|present|date|this\\s+year)(?![\\p{L}\\p{N}])`).length > 0;
    intent.to = toNow ? null : period.to;
  }

  // Lists, before measures: "temperature records" is a list of records.
  let dataset: ListDataset | null = null;
  let datasetAt = Infinity;
  for (const [id, words] of Object.entries(LIST_WORDS) as [ListDataset, string[]][]) {
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
      const [m] = t.find(phrase(normalize(w).trim()), false);
      if (m && m.index < datasetAt && (id !== "enso" || !/\b(index|oni)\b/.test(t.s))) {
        dataset = id;
        datasetAt = m.index;
      }
    }
  }
  if (dataset) {
    for (const { words, phase } of PHASE_WORDS) if (dataset === "enso" && t.any(words, false)) intent.phase = phase;
    if (intent.phase && /el nino/.test(t.s) && /la nina/.test(t.s)) intent.phase = null;
    takeAll(LIST_WORDS[dataset]);
  }

  // Groups: "electricity mix" is every electricity source.
  const byId = new Map(catalog.measures.map((m) => [m.id, m]));
  const group = GROUP_WORDS.find((g) => t.any(g.words) !== null);
  const groupMeasures = group ? group.measures.filter((id) => byId.has(id)) : [];

  // Hazards name a list on their own: "floods in pakistan".
  const hazardHit = HAZARD_WORDS.find(({ words }) => t.any(words, false) !== null && (dataset === null || dataset === "attribution" || dataset === "disasters"));
  // "ocean heat" is a measure, not a heatwave: read measures first when the hazard word is part of one.
  const measures = readMeasures(t, catalog.measures);
  if (hazardHit && t.any(hazardHit.words)) {
    intent.hazard = hazardHit.hazard;
    if (!dataset) dataset = hazardHit.list;
    if (dataset === "disasters" && (hazardHit.hazard === "heatwave" || hazardHit.hazard === "cold")) dataset = "attribution";
  }

  // Before countries, so "around the world" asks for a map rather than naming the world.
  const mapView = has(MAP_VIEW_WORDS);
  const byCountry = has(BY_COUNTRY_WORDS);
  const countries = readCountries(t, catalog);
  const named = countries.filter((c) => c !== "WLD");
  // A country with a global measure means its per-country twin: "co2 in germany" is Germany's emissions.
  intent.measures = [
    ...new Set([
      ...groupMeasures,
      ...measures.map((m) => (named.length && !m.countries && m.countryTwin && byId.has(m.countryTwin) ? m.countryTwin : m.id)),
    ]),
  ];
  intent.countries = countries;

  const rankWord = t.any(RANK_WORDS, false);
  const rising = has(RISE_WORDS);
  const falling = has(FALL_WORDS);
  const percent = has(PERCENT_WORDS);
  const ascending = rankWord !== null && ASCENDING_WORDS.includes(rankWord);
  if (rankWord) takeAll(RANK_WORDS);
  const changeWord = /\b(change|changes|changed|difference|growth|grown|grew|increase|increased|decrease|decreased|rise|rose|fall|fell|cut|cuts|drop|dropped)\b/.test(t.s);
  const chartWord = has(CHART_WORDS);
  const anyMeasure = intent.measures.length > 0;
  const firstPerCountry = intent.measures.some((id) => byId.get(id)?.countries || byId.get(id)?.countryTwin);
  const ranking = rankWord !== null || topN !== null || ((rising || falling) && named.length === 0 && /\b(countries|emitters|nations|polluters)\b/.test(t.s));
  const order = falling !== ascending ? "asc" : "desc";

  // Decide what kind of answer this is.
  const firstVital = intent.measures.map((id) => byId.get(id)?.vital?.id).find(Boolean) as VitalId | undefined;
  if (explain) {
    intent.kind = "unsupported";
    intent.reason = "explanation";
    intent.relatedVital = firstVital ?? null;
  } else if (forecast || (intent.from !== null && intent.from > nowYear && dataset !== "pledges")) {
    intent.kind = "unsupported";
    intent.reason = "forecast";
  } else if (open && mapView && !anyMeasure) {
    intent.kind = "open";
    intent.view = "map";
  } else if (open && firstVital && !mapView) {
    intent.kind = "open";
    intent.view = firstVital;
  } else if (dataset) {
    intent.kind = "list";
    intent.dataset = dataset;
    if (topN) intent.top = topN;
    // Pledge targets aren't dated by when they were made; "net zero by 2050" names the target year.
    if (dataset === "pledges") intent.from = intent.to = null;
  } else if ((mapView || (byCountry && !ranking)) && (firstPerCountry || !anyMeasure) && named.length === 0) {
    // "co2 emissions on a map", "solar share by country", "map of emissions change since 1990"
    intent.kind = "map";
    intent.rankBy = (rising || falling || changeWord || percent) && intent.from !== null ? (percent ? "percent" : "change") : "value";
    if (!anyMeasure) intent.measures = ["emissions.co2"].filter((id) => byId.has(id));
    // A map of CO₂ means emissions, the per-country twin of the atmospheric measure.
    intent.measures = intent.measures.map((id) => (!byId.get(id)?.countries && byId.get(id)?.countryTwin) || id);
  } else if (ranking && chartWord && named.length === 0) {
    // "chart the top 5 emitters since 1990": lines for the leading countries.
    intent.kind = "series";
    intent.topCountries = true;
    intent.top = topN ?? 5;
    intent.order = order;
    if (!anyMeasure) intent.measures = ["emissions.co2"].filter((id) => byId.has(id));
  } else if (ranking) {
    intent.kind = "rank";
    intent.top = topN ?? 10;
    intent.rankBy = percent ? "percent" : rising || falling ? "change" : "value";
    // "largest cuts" lists the most negative change first; "smallest increase" the least positive.
    intent.order = order;
  } else if (anyMeasure || countries.length) {
    intent.kind = "series";
  } else {
    intent.kind = "unsupported";
    intent.reason = "unclear";
  }
  // "the rise in emissions last year", "whose emissions fell most in 2020": a change within one
  // year is measured from the year before, so the answer has a start and an end to compare.
  const changeAsked = rising || falling || changeWord;
  const byChange = intent.kind === "series" || ((intent.kind === "rank" || intent.kind === "map") && intent.rankBy !== "value");
  if (changeAsked && byChange && intent.from !== null && intent.from === intent.to) intent.from -= 1;
  if (changeDisplay) intent.display = "change";
  if (stacked || group) intent.chart = "stacked";

  const unread = t.rest().filter((w) => !FILLER.has(w) && !/^\d+$/.test(w) && w.length > 1);
  // "gdp of germany": a country and an unknown word means a measure we don't have, not Germany's emissions.
  if (intent.kind === "series" && intent.measures.length === 0 && unread.length > 0) {
    intent.kind = "unsupported";
    intent.reason = "not_in_data";
  }
  const content = t.s.split(/\s+/).filter((w) => w && !FILLER.has(w)).length;
  const understood = intent.kind !== "unsupported" || intent.reason !== "unclear";
  const confidence = content === 0 ? 0 : Math.max(0, 1 - unread.length / content);
  return { intent, unread, corrections: fixed.corrections, confidence: understood ? confidence : 0, understood };
}
