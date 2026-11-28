import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BunRequest } from "bun";
import { TRADE_COMMODITIES, type MapMeasureData, type SourceId, type TradeCommodity } from "@shared/types.ts";
import { type AskResponse, buildQuery, validateQuery } from "@shared/query.ts";
import { toDecimalYear } from "@shared/time.ts";
import { AskUnavailableError, createTranslator } from "../lib/ask.ts";
import { createRegistry } from "../views/catalog.ts";
import { createLlmRoutes } from "./llm.ts";
import { QueryError, createQueryEngine } from "../views/query.ts";
import { buildEvents } from "../views/events.ts";
import { buildFlows } from "../views/flows.ts";
import { buildGraphFromData } from "../views/graph.ts";
import { buildPledgeGaps } from "../views/pledges.ts";
import { HttpError, handle, json } from "../lib/respond.ts";
import type { SourceStore } from "../lib/source-store.ts";
import { createEmissionsViews, isEmissionsMetric } from "../views/emissions.ts";
import { buildContext, buildHistory, isVitalId } from "../views/history.ts";
import { createProducerLogos } from "../views/producer-logos.ts";
import { buildVitals } from "../views/vitals.ts";

/** 4:3 SVG flags from the flag-icons package, keyed by ISO 3166-1 alpha-2. */
const FLAGS_DIR = join(dirname(Bun.resolveSync("flag-icons/package.json", import.meta.dir)), "flags", "4x3");

/** Raw source payloads that the client may request directly by id. */
const PUBLIC_SOURCES: SourceId[] = [
  "co2",
  "ch4",
  "temperature",
  "gistemp",
  "era5Daily",
  "seaIce",
  "seaLevel",
  "oceanHeat",
  "treeCoverLoss",
  "fires",
  "naturalEvents",
  "facilities",
  "countries",
  "disasterAlerts",
  "subsidies",
  "carbonMajors",
  "igcc",
];

/** Browser cache lifetimes per source, roughly half their refresh cadence. */
const MAX_AGE: Partial<Record<SourceId, number>> = {
  fires: 300,
  naturalEvents: 300,
  countries: 86_400,
};

export function createApiRoutes(store: SourceStore) {
  const emissions = createEmissionsViews(store);
  // Derived views are rebuilt at most every few minutes; their inputs change slowly.
  const cachedEvents = ttlCache(() => buildEvents(store), 5 * 60_000);
  const cachedGraph = ttlCache(() => buildGraphFromData(store), 10 * 60_000);
  const producerLogo = createProducerLogos(store);
  const translator = createTranslator();
  const registry = createRegistry(store, { askAvailable: translator.available });
  const engine = createQueryEngine(registry);

  /** Reads a JSON body of at most 16 kB. */
  async function body(req: Request): Promise<unknown> {
    const text = await req.text();
    if (text.length > 16_384) throw new HttpError(413, "Request too large");
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
  }
  /** Runs a query; "nothing to show" is a 422 with a message for the reader. */
  async function run(query: Parameters<typeof engine.run>[0]) {
    try {
      return await engine.run(query);
    } catch (err) {
      if (err instanceof QueryError) throw new HttpError(422, err.message);
      throw err;
    }
  }

  return {
    ...createLlmRoutes(),
    "/api/health": () => Response.json({ ok: true, time: new Date().toISOString() }),

    "/api/sources": handle((req) => json(req, store.allStatuses())),

    "/api/vitals": handle(async (req) => json(req, await buildVitals(store), { maxAge: 60 })),

    "/api/source/:id": handle(async (req: BunRequest<"/api/source/:id">) => {
      const id = req.params.id as SourceId;
      if (!PUBLIC_SOURCES.includes(id)) throw new HttpError(404, `Unknown source ${id}`);
      return json(req, await store.get(id), { maxAge: MAX_AGE[id] ?? 600 });
    }),

    "/api/emissions/matrix/:metric": handle(async (req: BunRequest<"/api/emissions/matrix/:metric">) => {
      const { metric } = req.params;
      if (!isEmissionsMetric(metric)) throw new HttpError(400, `Unknown metric ${metric}`);
      return json(req, await emissions.matrix(metric), { maxAge: 3600 });
    }),

    "/api/emissions/world-by-fuel": handle(async (req) => json(req, await emissions.worldByFuel(), { maxAge: 3600 })),

    "/api/emissions/country/:iso3": handle(async (req: BunRequest<"/api/emissions/country/:iso3">) => {
      const data = await emissions.country(req.params.iso3.toUpperCase());
      if (!data) throw new HttpError(404, "Country not found");
      return json(req, data, { maxAge: 3600 });
    }),

    "/api/energy/:iso3": handle(async (req: BunRequest<"/api/energy/:iso3">) => {
      const data = await emissions.energyMix(req.params.iso3.toUpperCase());
      if (!data) throw new HttpError(404, "Country not found");
      return json(req, data, { maxAge: 3600 });
    }),

    /** Exporter → importer flows of one commodity, with label points to draw them between. */
    "/api/flows/:commodity": handle(async (req: BunRequest<"/api/flows/:commodity">) => {
      const c = req.params.commodity as TradeCommodity;
      if (!TRADE_COMMODITIES.includes(c)) throw new HttpError(404, `Unknown commodity ${c}`);
      const flows = await buildFlows(store, c);
      // A "still loading" answer must not be cached, or the browser's polling never sees the data arrive.
      return json(req, flows, { maxAge: flows.data ? 3600 : 0 });
    }),

    /** Any per-country catalog measure as a year × country table, for the map's choropleth. */
    "/api/map/:measure": handle(async (req: BunRequest<"/api/map/:measure">) => {
      const { catalog, loaded } = await registry.get();
      const id = req.params.measure;
      const m = catalog.measures.find((x) => x.id === id);
      const table = loaded.get(id)?.table;
      if (!m || !table) throw new HttpError(404, `No per-country measure ${id}`);
      const data: MapMeasureData = {
        id: m.id, label: m.label, short: m.short, unit: m.unit, decimals: m.decimals, evidence: m.evidence, source: m.source,
        years: table.years, countries: table.countries, values: table.values,
      };
      return json(req, data, { maxAge: 3600 });
    }),

    "/api/flag/:iso2": (req: BunRequest<"/api/flag/:iso2">) => {
      const code = req.params.iso2.toLowerCase();
      const path = join(FLAGS_DIR, `${code}.svg`);
      if (!/^[a-z]{2}$/.test(code) || !existsSync(path)) return new Response("No flag", { status: 404 });
      return new Response(Bun.file(path), {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=2592000, immutable" },
      });
    },

    "/api/producer-logo/:qid": (req: BunRequest<"/api/producer-logo/:qid">) => producerLogo(req.params.qid),

    "/api/history/:id": handle(async (req: BunRequest<"/api/history/:id">) => {
      const { id } = req.params;
      if (!isVitalId(id)) throw new HttpError(404, `Unknown vital ${id}`);
      return json(req, await buildHistory(store, id), { maxAge: 600 });
    }),

    "/api/context": handle(async (req) => json(req, await buildContext(store), { maxAge: 3600 })),

    "/api/pledges": handle(async (req) => json(req, await buildPledgeGaps(store), { maxAge: 3600 })),

    "/api/timeline": handle(async (req) => {
      const { events, sources } = await cachedEvents();
      return json(req, { events, sources: sources.map((id) => store.status(id)) }, { maxAge: 300 });
    }),

    "/api/graph": handle(async (req) => json(req, await cachedGraph(), { maxAge: 600 })),

    "/api/catalog": handle(async (req) => json(req, (await registry.get()).catalog, { maxAge: 300 })),

    /** Runs a structured query (from the parser in the browser, or an edited one). */
    "/api/query": {
      POST: handle(async (req) => {
        const { catalog } = await registry.get();
        const v = validateQuery(await body(req), catalog);
        if ("error" in v) throw new HttpError(400, v.error);
        return json(req, await run(v.query));
      }),
    },

    /** Free text → model → intent → the same query path. Only when a model is configured. */
    "/api/ask": {
      POST: handle(async (req) => {
        const { text } = (await body(req)) as { text?: unknown };
        if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Ask needs some text");
        const { catalog } = await registry.get();
        let intent;
        try {
          intent = await translator.translate(text.trim(), catalog, Math.floor(toDecimalYear(new Date())));
        } catch (err) {
          if (err instanceof AskUnavailableError) throw new HttpError(503, err.message);
          throw err;
        }
        const built = buildQuery(intent, catalog);
        const out: AskResponse = { intent, query: built.query, result: null, notes: built.notes };
        if (built.query) {
          try {
            const r = await engine.run(built.query);
            out.result = r.result;
            out.notes.push(...r.notes);
          } catch (err) {
            if (!(err instanceof QueryError)) throw err;
            out.notes.push(err.message);
          }
        }
        return json(req, out);
      }),
    },

    "/api/*": (req: Request) => json(req, { error: "Not found" }, { status: 404 }),
  };
}

/** Memoises an async builder for `ttlMs`; concurrent callers share one build. */
function ttlCache<T>(build: () => Promise<T>, ttlMs: number) {
  let value: { at: number; data: Promise<T> } | null = null;
  return () => {
    if (!value || Date.now() - value.at > ttlMs) {
      const data = build();
      value = { at: Date.now(), data };
      data.catch(() => (value = null)); // don't cache failures
    }
    return value.data;
  };
}
