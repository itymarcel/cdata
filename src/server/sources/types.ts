import type { SourceMeta } from "@shared/types.ts";

export interface LoadResult<T> {
  data: T;
  /** ISO date of the newest observation in the payload. */
  dataAsOf: string | null;
}

/**
 * One upstream dataset. `load` fetches and normalises it; the store handles
 * caching, scheduling, retries and status reporting.
 */
export interface SourceDefinition<T> {
  meta: SourceMeta;
  /** Bump when the payload shape changes, so cached payloads in the old shape are ignored. */
  version?: number;
  /** How soon to try again after a failed load. Defaults to a quarter of `meta.refreshMs` (at least a minute). */
  retryMs?: number;
  load(): Promise<LoadResult<T>>;
  /**
   * Optional: sources that need a key, a licence or a manual download report
   * whether they can run. Unconfigured sources are listed but never fetched.
   */
  isConfigured?: () => boolean;
}

export function defineSource<T>(def: SourceDefinition<T>): SourceDefinition<T> {
  return def;
}
