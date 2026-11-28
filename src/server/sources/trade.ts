import { TRADE_INFO } from "@shared/trade.ts";
import { DAY, WEEK } from "@shared/time.ts";
import { TRADE_COMMODITIES, type TradeCommodity, type TradeFlow, type TradeFlowsData } from "@shared/types.ts";
import { config } from "../config.ts";
import { Cache } from "../lib/cache.ts";
import { UpstreamError } from "../lib/http.ts";
import { logger } from "../lib/logger.ts";
import { defineSource, type SourceDefinition } from "./types.ts";

/**
 * Bilateral trade from UN Comtrade's public preview API (no key). One source
 * per commodity, so each caches, refreshes and fails on its own.
 *
 * The preview API returns at most 500 rows per call and allows roughly one
 * call a second, so we don't download the whole matrix. For the latest year
 * with good coverage we read:
 *   1. every country's exports to the world (who the big exporters are),
 *   2. the largest exporters' exports by partner (their own records), and
 *   3. the largest importers' imports by origin, which fill in exporters that
 *      don't report to Comtrade (Russia, since 2022) or fall outside step 2.
 */

const BASE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS";
const REFERENCE = "https://comtradeapi.un.org/files/v1/app/reference";
/** Spacing between calls across all commodities; the preview API answers 429 below about a second. */
const MIN_GAP_MS = 2_000;

export interface ComtradeRow {
  reporterCode: number;
  partnerCode: number;
  flowCode: string;
  primaryValue: number | null;
  motCode: number;
  customsCode: string;
  partner2Code: number;
}

// ---------------------------------------------------------------------------
// One queue for every Comtrade call in the process
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    try {
      return await fn();
    } finally {
      lastCall = Date.now();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/**
 * Every Comtrade answer is kept for a few days in the dashboard's SQLite
 * cache, keyed by URL. A load that runs into the rate limit fails, and the
 * retry picks up where it stopped instead of starting over.
 */
const RESPONSE_TTL_MS = 6 * DAY;
let responses: Cache | null = null;
function responseCache(): Cache | null {
  if (process.env.NODE_ENV === "test") return null;
  return (responses ??= new Cache(config.cacheDb));
}

/** Fetches `url` (or reuses a recent answer), keeping only what `keep` returns. */
async function getJson<T, K = T>(url: string, keep: (body: T) => K = (b) => b as unknown as K): Promise<K> {
  const cache = responseCache();
  const key = `comtrade.v2:${url}`;
  const hit = cache?.get(key);
  if (hit && Date.now() - hit.fetchedAt < RESPONSE_TTL_MS) return JSON.parse(hit.payload) as K;
  const kept = keep(await fetchComtrade<T>(url));
  cache?.set({ id: key, payload: JSON.stringify(kept), fetchedAt: Date.now(), dataAsOf: null });
  return kept;
}

/**
 * The keyless API also has a call-volume quota that refills over about half
 * an hour; past it, every call answers 403 with a Retry-After. We note when it
 * refills and fail fast until then, so retries don't spend the next quota.
 */
let quotaUntil = 0;
const quotaError = (url: string) =>
  new UpstreamError(`UN Comtrade's free call quota is used up; it refills in about ${Math.ceil((quotaUntil - Date.now()) / 60_000)} min`, url, 403);

async function fetchComtrade<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() < quotaUntil) throw quotaError(url);
    const res = await throttled(() =>
      fetch(url, { headers: { "User-Agent": config.userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) }),
    );
    if (res.status === 429 && attempt < 4) {
      logger.info(`comtrade rate-limited, waiting ${5 * 2 ** attempt}s`);
      await Bun.sleep(5_000 * 2 ** attempt);
      continue;
    }
    if (res.status === 403) {
      const after = Number(res.headers.get("Retry-After"));
      quotaUntil = Date.now() + (Number.isFinite(after) && after > 0 ? after : 1800) * 1000;
      throw quotaError(url);
    }
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, url, res.status);
    return (await res.json()) as T;
  }
}

async function query(params: Record<string, string | number>): Promise<ComtradeRow[]> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return getJson<{ data?: ComtradeRow[]; error?: string }, ComtradeRow[]>(`${BASE}?${qs}`, (body) => {
    if (body.error) throw new UpstreamError(`Comtrade: ${body.error}`, BASE);
    // Totals only: no breakdown by transport mode, customs procedure or second partner.
    return (body.data ?? [])
      .filter((r) => r.motCode === 0 && r.customsCode === "C00" && r.partner2Code === 0)
      .map(({ reporterCode, partnerCode, flowCode, primaryValue, motCode, customsCode, partner2Code }) => ({
        reporterCode, partnerCode, flowCode, primaryValue, motCode, customsCode, partner2Code,
      }));
  });
}

// ---------------------------------------------------------------------------
// Country codes: Comtrade's numeric codes → ISO3
// ---------------------------------------------------------------------------

interface RefEntry {
  code: number;
  iso3: string;
  name: string;
}
export interface References {
  reporters: Map<number, RefEntry>;
  partners: Map<number, RefEntry>;
}

/**
 * Comtrade files Taiwan as "Other Asia, nes" (code 490, flagged as a group)
 * and Kosovo as "_KS"; we use the codes the country boundaries use. Every
 * other ISO3 comes from Comtrade's own reference files.
 */
const UNCODED: Record<number, string> = { 490: "TWN", 412: "XKX" };

function readReference(results: Record<string, unknown>[], codeKey: string, isoKey: string, descKey: string): Map<number, RefEntry> {
  const out = new Map<number, RefEntry>();
  for (const r of results) {
    const code = Number(r[codeKey]);
    if (!Number.isFinite(code) || r.entryExpiredDate) continue;
    const fixed = UNCODED[code];
    if (!fixed && r.isGroup === true) continue;
    const iso3 = fixed ?? String(r[isoKey] ?? "");
    // Regions, bunkers and "nes" areas carry codes like "_X ", "X1 " or "R91"; real countries are three letters.
    if (!/^[A-Z]{3}$/.test(iso3)) continue;
    out.set(code, { code, iso3, name: fixed === "TWN" ? "Taiwan" : String(r[descKey] ?? r.text ?? iso3) });
  }
  return out;
}

let refs: { at: number; value: Promise<References> } | null = null;
function references(): Promise<References> {
  if (!refs || Date.now() - refs.at > DAY) {
    const value = (async () => {
      const [rep, par] = await Promise.all([
        getJson<{ results: Record<string, unknown>[] }>(`${REFERENCE}/Reporters.json`),
        getJson<{ results: Record<string, unknown>[] }>(`${REFERENCE}/partnerAreas.json`),
      ]);
      return {
        reporters: readReference(rep.results, "reporterCode", "reporterCodeIsoAlpha3", "reporterDesc"),
        partners: readReference(par.results, "PartnerCode", "PartnerCodeIsoAlpha3", "PartnerDesc"),
      };
    })();
    refs = { at: Date.now(), value };
    value.catch(() => (refs = null));
  }
  return refs.value;
}

// ---------------------------------------------------------------------------
// Pure steps (tested)
// ---------------------------------------------------------------------------

export interface Total {
  code: number;
  iso3: string;
  value: number;
}

/** Reporters' totals to or from the world, countries only, largest first. */
export function worldTotals(rows: ComtradeRow[], reporters: Map<number, RefEntry>): Total[] {
  const out: Total[] = [];
  for (const r of rows) {
    const ref = reporters.get(r.reporterCode);
    if (r.partnerCode !== 0 || !ref || !r.primaryValue || r.primaryValue <= 0) continue;
    out.push({ code: r.reporterCode, iso3: ref.iso3, value: r.primaryValue });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** The largest entries until they add up to `share` of the total, within [min, max] entries. */
export function largest(totals: Total[], share: number, min: number, max: number): Total[] {
  const sum = totals.reduce((s, t) => s + t.value, 0);
  const out: Total[] = [];
  let acc = 0;
  for (const t of totals) {
    if (out.length >= max || (out.length >= min && acc >= share * sum)) break;
    out.push(t);
    acc += t.value;
  }
  return out;
}

/**
 * The newest year whose reporter count is at least 80% of the year before's:
 * countries report months apart, and a half-reported year would understate
 * every total. Returns the index into `counts` (newest first).
 */
export function pickYear(counts: number[]): number {
  for (let i = 0; i < counts.length - 1; i++) if (counts[i]! >= 20 && counts[i]! >= 0.8 * counts[i + 1]!) return i;
  return counts.length - 1;
}

/**
 * Joins both sides into exporter → importer flows. An exporter we read
 * keeps its own figure for every partner; the importers' records only add
 * flows from exporters we didn't read. Small flows are dropped.
 */
export function mergeFlows(opts: {
  exporterRows: { exporter: string; rows: ComtradeRow[] }[];
  importerRows: { importer: string; rows: ComtradeRow[] }[];
  partners: Map<number, RefEntry>;
  minValue: number;
  maxPerExporter: number;
}): TradeFlow[] {
  const flows = new Map<string, TradeFlow>();
  const readExporters = new Set(opts.exporterRows.map((e) => e.exporter));
  for (const { exporter, rows } of opts.exporterRows) {
    const own: TradeFlow[] = [];
    for (const r of rows) {
      const to = opts.partners.get(r.partnerCode)?.iso3;
      if (!to || to === exporter || r.flowCode !== "X" || !r.primaryValue || r.primaryValue < opts.minValue) continue;
      own.push({ from: exporter, to, value: r.primaryValue, reportedBy: "exporter" });
    }
    for (const f of own.sort((a, b) => b.value - a.value).slice(0, opts.maxPerExporter)) flows.set(`${f.from}>${f.to}`, f);
  }
  for (const { importer, rows } of opts.importerRows) {
    for (const r of rows) {
      const from = opts.partners.get(r.partnerCode)?.iso3;
      if (!from || from === importer || readExporters.has(from) || r.flowCode !== "M") continue;
      if (!r.primaryValue || r.primaryValue < opts.minValue) continue;
      const key = `${from}>${importer}`;
      if (!flows.has(key)) flows.set(key, { from, to: importer, value: r.primaryValue, reportedBy: "importer" });
    }
  }
  return [...flows.values()].sort((a, b) => b.value - a.value);
}

/** Exports in `prev` and `cur` over the countries that reported both years. */
export function likeForLike(cur: Total[], prev: Total[]): { value: number; current: number; reporters: number } | null {
  const before = new Map(prev.map((t) => [t.iso3, t.value]));
  let value = 0;
  let current = 0;
  let reporters = 0;
  for (const t of cur) {
    const p = before.get(t.iso3);
    if (p === undefined) continue;
    value += p;
    current += t.value;
    reporters++;
  }
  return reporters >= 10 ? { value, current, reporters } : null;
}

// ---------------------------------------------------------------------------
// Loading one commodity
// ---------------------------------------------------------------------------

async function loadCommodity(commodity: TradeCommodity): Promise<TradeFlowsData> {
  const info = TRADE_INFO[commodity];
  const ref = await references();
  const totals = (period: number, flowCode: "X" | "M") =>
    query({ period, cmdCode: info.hs, flowCode, partnerCode: 0 }).then((rows) => worldTotals(rows, ref.reporters));

  // Newest first: last year, the year before, and one more in case last year is thin.
  const latest = new Date().getUTCFullYear() - 1;
  const candidates = [latest, latest - 1, latest - 2].filter((y) => y >= (info.since ?? 0));
  const byYear: Total[][] = [];
  for (const y of candidates) {
    byYear.push(await totals(y, "X"));
    if (byYear.length >= 2 && pickYear(byYear.map((t) => t.length)) < byYear.length - 1) break;
  }
  const yi = pickYear(byYear.map((t) => t.length));
  const year = candidates[yi]!;
  const exportsTotals = byYear[yi]!;
  if (exportsTotals.length < 10) throw new Error(`Comtrade ${info.hs}: only ${exportsTotals.length} reporters for ${year}`);
  const prevTotals = byYear[yi + 1];
  const worldExports = exportsTotals.reduce((s, t) => s + t.value, 0);

  const exporters = largest(exportsTotals, 0.85, 3, 6);
  const importers = largest(await totals(year, "M"), 0.7, 3, 4);

  const exporterRows = [];
  for (const e of exporters)
    exporterRows.push({ exporter: e.iso3, rows: await query({ reporterCode: e.code, period: year, cmdCode: info.hs, flowCode: "X" }) });
  const importerRows = [];
  for (const i of importers)
    importerRows.push({ importer: i.iso3, rows: await query({ reporterCode: i.code, period: year, cmdCode: info.hs, flowCode: "M" }) });

  const flows = mergeFlows({ exporterRows, importerRows, partners: ref.partners, minValue: worldExports * 0.001, maxPerExporter: 40 });

  const names: Record<string, string> = {};
  for (const e of [...ref.reporters.values(), ...ref.partners.values()]) names[e.iso3] ??= e.name;
  const used = new Set([...flows.flatMap((f) => [f.from, f.to]), ...exporters.map((e) => e.iso3), ...importers.map((i) => i.iso3)]);
  const lfl = prevTotals ? likeForLike(exportsTotals, prevTotals) : null;
  const reported = new Set(exportsTotals.map((t) => t.iso3));
  const silent = new Map<string, number>();
  for (const f of flows) if (!reported.has(f.from)) silent.set(f.from, (silent.get(f.from) ?? 0) + f.value);

  return {
    commodity,
    hs: info.hs,
    year,
    worldExports,
    reporters: exportsTotals.length,
    exporters: exporters.map((e) => ({ iso3: e.iso3, value: e.value })),
    importers: importers.map((i) => ({ iso3: i.iso3, value: i.value })),
    silentExporters: [...silent].map(([iso3, value]) => ({ iso3, value })).sort((a, b) => b.value - a.value),
    previous: lfl ? { year: candidates[yi + 1]!, ...lfl } : null,
    flows,
    names: Object.fromEntries(Object.entries(names).filter(([k]) => used.has(k))),
  };
}

/**
 * Goods load one at a time, in TRADE_COMMODITIES order, so under the call
 * quota the first ones finish rather than all seven crawling along together.
 */
let loads: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const p = loads.then(fn, fn);
  loads = p.catch(() => undefined);
  return p;
}

function tradeSource(commodity: TradeCommodity): SourceDefinition<TradeFlowsData> {
  const info = TRADE_INFO[commodity];
  return defineSource<TradeFlowsData>({
    // The keyless API's quota can stop a load part-way; the next try resumes from cached answers.
    retryMs: 15 * 60_000,
    meta: {
      id: `trade.${commodity}`,
      name: `Trade: ${info.label}`,
      publisher: "UN Comtrade (UN Statistics Division), public preview API",
      url: "https://comtradeplus.un.org/",
      evidence: "reported",
      cadence: "annual",
      refreshMs: WEEK,
      lag: "6–18 months; countries report at different times",
      licence: "UN Comtrade terms of use",
      note: `${info.definition}. Customs values in US dollars, re-exports included, so trading hubs appear as exporters.`,
    },
    load: async () => {
      const data = await oneAtATime(() => loadCommodity(commodity));
      return { data, dataAsOf: String(data.year) };
    },
  });
}

export const tradeSources = TRADE_COMMODITIES.map(tradeSource);
