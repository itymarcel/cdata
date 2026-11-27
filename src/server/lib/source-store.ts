import type { Envelope, SourceId, SourceStatus } from "@shared/types.ts";
import type { SourceDefinition } from "../sources/types.ts";
import type { Cache } from "./cache.ts";
import { logger } from "./logger.ts";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Cache rows are keyed by id and payload version, so a shape change never serves stale structure. */
const cacheKey = (def: SourceDefinition<unknown>) => (def.version ? `${def.meta.id}@v${def.version}` : def.meta.id);

export class SourceNotConnectedError extends Error {
  constructor(
    readonly sourceId: SourceId,
    readonly setup: string,
  ) {
    super(`Source ${sourceId} is not connected: ${setup}`);
  }
}

interface Entry {
  def: SourceDefinition<unknown>;
  data: unknown;
  fetchedAt: number | null;
  dataAsOf: string | null;
  error: string | null;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  nextRefreshAt: number | null;
  /** Bumped on every successful load so derived views can memoise. */
  version: number;
}

/**
 * Owns every upstream source: serves cached data, refreshes each source on its
 * own schedule, deduplicates concurrent loads and keeps serving the last good
 * payload when an upstream fails.
 */
export class SourceStore {
  private entries = new Map<SourceId, Entry>();

  constructor(
    private cache: Cache,
    defs: SourceDefinition<unknown>[],
  ) {
    for (const def of defs) {
      const cached = cache.get(cacheKey(def));
      this.entries.set(def.meta.id, {
        def,
        data: cached ? JSON.parse(cached.payload) : null,
        fetchedAt: cached?.fetchedAt ?? null,
        dataAsOf: cached?.dataAsOf ?? null,
        error: null,
        inFlight: null,
        timer: null,
        nextRefreshAt: null,
        version: cached ? 1 : 0,
      });
    }
  }

  private entry(id: SourceId): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown source: ${id}`);
    return e;
  }

  private isStale(e: Entry): boolean {
    return e.fetchedAt === null || Date.now() - e.fetchedAt > e.def.meta.refreshMs;
  }

  private isConnected(e: Entry): boolean {
    return e.def.isConfigured?.() ?? true;
  }

  /** Loads a source from upstream. Concurrent callers share one request. */
  refresh(id: SourceId): Promise<void> {
    const e = this.entry(id);
    if (!this.isConnected(e)) return Promise.resolve();
    if (e.inFlight) return e.inFlight;
    const started = performance.now();
    e.inFlight = (async () => {
      try {
        const { data, dataAsOf } = await e.def.load();
        e.data = data;
        e.dataAsOf = dataAsOf;
        e.fetchedAt = Date.now();
        e.error = null;
        e.version++;
        this.cache.set({ id: cacheKey(e.def), payload: JSON.stringify(data), fetchedAt: e.fetchedAt, dataAsOf });
        logger.info(`source ${id} refreshed in ${Math.round(performance.now() - started)}ms (as of ${dataAsOf})`);
      } catch (err) {
        e.error = err instanceof Error ? err.message : String(err);
        logger.warn(`source ${id} failed: ${e.error}`);
      } finally {
        e.inFlight = null;
      }
    })();
    return e.inFlight;
  }

  /** Returns data, loading it first if nothing is cached yet. Refreshes stale data in the background. */
  async get<T>(id: SourceId): Promise<Envelope<T>> {
    const e = this.entry(id);
    if (!this.isConnected(e)) throw new SourceNotConnectedError(id, e.def.meta.setup ?? "Not configured");
    if (e.data === null) await this.refresh(id);
    else if (this.isStale(e)) void this.refresh(id);
    if (e.data === null) {
      throw new Error(`Source ${id} is unavailable: ${e.error ?? "no data"}`);
    }
    return { source: this.status(id), data: e.data as T };
  }

  /** Data plus a version number, for memoising derived views. */
  async getVersioned<T>(id: SourceId): Promise<{ envelope: Envelope<T>; version: number }> {
    const envelope = await this.get<T>(id);
    return { envelope, version: this.entry(id).version };
  }

  /** Returns cached data without triggering a load; null if absent. */
  peek<T>(id: SourceId): Envelope<T> | null {
    const e = this.entry(id);
    return e.data === null ? null : { source: this.status(id), data: e.data as T };
  }

  status(id: SourceId): SourceStatus {
    const e = this.entry(id);
    return {
      ...e.def.meta,
      connected: this.isConnected(e),
      fetchedAt: e.fetchedAt ? new Date(e.fetchedAt).toISOString() : null,
      dataAsOf: e.dataAsOf,
      ok: e.error === null && e.data !== null,
      error: e.error,
      nextRefreshAt: e.nextRefreshAt ? new Date(e.nextRefreshAt).toISOString() : null,
    };
  }

  allStatuses(): SourceStatus[] {
    return [...this.entries.keys()].map((id) => this.status(id));
  }

  /**
   * Starts one timer per source. Stale sources load immediately, staggered so
   * the heavy downloads don't all start in the same second.
   */
  startScheduler(): void {
    let stagger = 0;
    for (const [id, e] of this.entries) {
      if (!this.isConnected(e)) continue;
      const dueIn = this.isStale(e) ? (stagger += 750) : e.fetchedAt! + e.def.meta.refreshMs - Date.now();
      this.schedule(id, Math.max(0, dueIn));
    }
  }

  private schedule(id: SourceId, delayMs: number): void {
    const e = this.entry(id);
    if (e.timer) clearTimeout(e.timer);
    e.nextRefreshAt = Date.now() + delayMs;
    // setTimeout overflows past ~24.8 days and fires immediately; hop in chunks instead.
    if (delayMs > MAX_TIMEOUT_MS) {
      e.timer = setTimeout(() => this.schedule(id, delayMs - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
      return;
    }
    e.timer = setTimeout(async () => {
      await this.refresh(id);
      // Back off to a quarter of the cadence (min 1 min) after a failure.
      const next = e.error ? Math.max(60_000, e.def.meta.refreshMs / 4) : e.def.meta.refreshMs;
      this.schedule(id, next);
    }, delayMs);
  }

  stop(): void {
    for (const e of this.entries.values()) if (e.timer) clearTimeout(e.timer);
  }
}
