import { SourceNotConnectedError } from "./source-store.ts";

/** JSON responses with gzip and cache headers. Large payloads (OWID matrices, fires) shrink ~8×. */
export function json(req: Request, body: unknown, opts: { maxAge?: number; status?: number } = {}): Response {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": opts.maxAge ? `public, max-age=${opts.maxAge}` : "no-store",
    Vary: "Accept-Encoding",
  };
  const acceptsGzip = (req.headers.get("accept-encoding") ?? "").includes("gzip");
  if (acceptsGzip && text.length > 2048) {
    headers["Content-Encoding"] = "gzip";
    return new Response(Bun.gzipSync(Buffer.from(text)), { status: opts.status ?? 200, headers });
  }
  return new Response(text, { status: opts.status ?? 200, headers });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Wraps a handler so thrown errors become JSON error responses. */
export function handle<R extends Request>(fn: (req: R) => Promise<Response> | Response) {
  return async (req: R): Promise<Response> => {
    try {
      return await fn(req);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof SourceNotConnectedError ? 424 : 503;
      const message = err instanceof Error ? err.message : String(err);
      return json(req, { error: message }, { status });
    }
  };
}
