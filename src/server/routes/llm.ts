/**
 * Serves the optional in-browser model without the browser leaving `/api`:
 * the WebLLM module itself from node_modules, and the model files (weights,
 * tokenizer, compiled WebGPU kernels) fetched from their upstreams and kept on
 * disk, so each file is downloaded from Hugging Face or GitHub once per server
 * rather than once per visitor. Only the models in `LOCAL_MODELS` are proxied.
 */
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LOCAL_MODELS } from "@shared/nl/model.ts";
import { config } from "../config.ts";
import { logger } from "../lib/logger.ts";

const HF = "https://huggingface.co/";
const LIBS = "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/";
/** One path segment: no leading dot, so never "." or "..". */
const SEG = String.raw`[A-Za-z0-9_-][A-Za-z0-9_.-]*`;
const HF_PATH = new RegExp(`^mlc-ai/(${SEG})/resolve/main/(${SEG})$`);
const LIB_PATH = new RegExp(`^v\\d+_\\d+_\\d+(?:/${SEG})?/${SEG}-webgpu\\.wasm$`);

export type LlmUpstream = "hf" | "lib";

/** The upstream URL for a proxied path, or null when it isn't one of the allowed model files. */
export function upstreamFor(kind: LlmUpstream, path: string): string | null {
  if (kind === "hf") {
    const m = HF_PATH.exec(path);
    return m && LOCAL_MODELS.some((x) => x.id === m[1]) ? HF + path : null;
  }
  return LIB_PATH.test(path) ? LIBS + path : null;
}

const TYPES: Record<string, string> = { json: "application/json", wasm: "application/wasm", js: "text/javascript; charset=utf-8", map: "application/json" };
const typeOf = (path: string) => TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream";

export function createLlmRoutes(dir = config.llmDir) {
  const webllm = join(dirname(Bun.resolveSync("@mlc-ai/web-llm/package.json", import.meta.dir)), "lib");

  async function proxy(kind: LlmUpstream, req: Request): Promise<Response> {
    const path = decodeURIComponent(new URL(req.url).pathname.slice(`/api/llm/${kind}/`.length));
    const url = upstreamFor(kind, path);
    if (!url) return new Response("Not an allowed model file", { status: 404 });
    const headers: Record<string, string> = { "Content-Type": typeOf(path), "Cache-Control": "public, max-age=604800" };
    const local = join(dir, kind, path);
    const file = Bun.file(local);
    if (await file.exists()) return new Response(file, { headers });

    const res = await fetch(url, { headers: { "User-Agent": config.userAgent } });
    if (!res.ok || !res.body) return new Response(`Upstream answered ${res.status}`, { status: res.status === 404 ? 404 : 502 });
    const length = res.headers.get("content-length");
    if (length) headers["Content-Length"] = length;
    // Each chunk goes to the browser and to a part file; the part file replaces
    // nothing until it is complete, so an interrupted download is never served.
    // (Not body.tee(): Bun 1.2 never finishes writing a tee'd branch to disk.)
    await mkdir(dirname(local), { recursive: true });
    const part = `${local}.${crypto.randomUUID()}.part`;
    const sink = Bun.file(part).writer();
    const reader = res.body.getReader();
    const discard = () => Promise.resolve(sink.end()).then(() => unlink(part)).catch(() => undefined);
    const toBrowser = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch (err) {
          await discard();
          controller.error(err);
          return;
        }
        const { done, value } = chunk;
        if (done) {
          controller.close();
          await sink.end();
          const size = (await stat(part)).size;
          if (length && size !== Number(length)) {
            logger.warn(`llm cache: incomplete download of ${path} (${size} of ${length} bytes)`);
            await unlink(part).catch(() => undefined);
          } else await rename(part, local);
          return;
        }
        sink.write(value);
        controller.enqueue(value);
      },
      async cancel(reason) {
        await reader.cancel(reason);
        await discard();
      },
    });
    return new Response(toBrowser, { headers });
  }

  return {
    /** The WebLLM module (≈7 MB), loaded by the browser only when someone turns the model on. */
    "/api/llm/web-llm/:file": (req: Request & { params: { file: string } }) => {
      const name = req.params.file;
      if (name !== "index.js" && name !== "index.js.map") return new Response("Not found", { status: 404 });
      return new Response(Bun.file(join(webllm, name)), { headers: { "Content-Type": typeOf(name), "Cache-Control": "public, max-age=86400" } });
    },
    "/api/llm/hf/*": (req: Request) => proxy("hf", req),
    "/api/llm/lib/*": (req: Request) => proxy("lib", req),
  };
}
