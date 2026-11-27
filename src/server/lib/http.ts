import { config } from "../config.ts";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 60_000, retries = 2, headers = {} } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": config.userAgent, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, url, res.status);
      return res;
    } catch (err) {
      lastError = err;
      // Client errors won't fix themselves on retry.
      if (err instanceof UpstreamError && err.status && err.status < 500 && err.status !== 429) break;
      if (attempt < retries) await Bun.sleep(1_000 * 2 ** attempt);
    }
  }
  if (lastError instanceof UpstreamError) throw lastError;
  throw new UpstreamError(lastError instanceof Error ? lastError.message : String(lastError), url);
}

export async function fetchText(url: string, opts?: FetchOptions): Promise<string> {
  return (await fetchWithRetry(url, opts)).text();
}

export async function fetchJson<T>(url: string, opts?: FetchOptions): Promise<T> {
  const res = await fetchWithRetry(url, {
    ...opts,
    headers: { Accept: "application/json", ...opts?.headers },
  });
  return (await res.json()) as T;
}
