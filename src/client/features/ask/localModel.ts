/**
 * The optional in-browser reader: a small language model run on the visitor's
 * GPU with WebLLM (WebGPU), in place of the server's paid model. Like that one
 * it only fills in an `Intent` under a JSON schema; nothing it writes is shown.
 *
 * Nothing is downloaded until the visitor turns it on. The WebLLM module and
 * the model files come from the server (`/api/llm/*`), which proxies and caches
 * them; the browser keeps them in its Cache Storage afterwards. The choice is
 * remembered per browser, and the model loads again from that cache when the
 * next hard question comes.
 */
import type * as WebLLM from "@mlc-ai/web-llm";
import { create } from "zustand";
import type { Catalog, Intent } from "@shared/query.ts";
import { LOCAL_MODELS, type LocalModelId, coerceIntent, compactPrompt, intentSchema, isLocalModel, localQuestion, resolveCountries } from "@shared/nl/model.ts";

const MODULE_URL = "/api/llm/web-llm/index.js";
const HF = "https://huggingface.co/";
const STORAGE_KEY = "ask:localModel";

export type LocalModelStatus =
  /** Not checked yet. */
  | { state: "unknown" }
  /** This browser can't run it (no WebGPU, or no 16-bit float shaders). */
  | { state: "unsupported"; reason: string }
  | { state: "off" }
  | { state: "loading"; progress: number; text: string }
  | { state: "ready" }
  | { state: "error"; message: string };

interface LocalModelStore {
  model: LocalModelId;
  status: LocalModelStatus;
  /** Bytes of weights to download, from the model's own tensor-cache.json. */
  size: number | null;
}

function remembered(): LocalModelId | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && isLocalModel(v) ? v : null;
  } catch {
    return null;
  }
}
function remember(id: LocalModelId | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the model just isn't remembered across visits.
  }
}

export const useLocalModel = create<LocalModelStore>(() => ({
  model: remembered() ?? LOCAL_MODELS[0].id,
  status: { state: "unknown" },
  size: null,
}));
const set = (s: Partial<LocalModelStore>) => useLocalModel.setState(s);

let lib: Promise<typeof WebLLM> | null = null;
let engine: Promise<WebLLM.MLCEngineInterface> | null = null;
let engineModel: LocalModelId | null = null;
/** One question at a time: the engine holds a single conversation. */
let queue: Promise<unknown> = Promise.resolve();

const loadLib = () => (lib ??= import(/* not bundled: served on demand */ MODULE_URL) as Promise<typeof WebLLM>);

/** WebLLM's record for a model, with every URL pointed at our server. */
function record(webllm: typeof WebLLM, id: LocalModelId): WebLLM.ModelRecord {
  const base = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
  if (!base) throw new Error(`WebLLM ${id} is not in this version's model list`);
  const origin = location.origin;
  return {
    ...base,
    model: base.model.replace(HF, `${origin}/api/llm/hf/`),
    model_lib: base.model_lib.replace(webllm.modelLibURLPrefix, `${origin}/api/llm/lib/`),
    overrides: { ...base.overrides, context_window_size: CONTEXT },
  };
}
const appConfig = (webllm: typeof WebLLM, id: LocalModelId): WebLLM.AppConfig => ({ model_list: [record(webllm, id)] });

/** Checks WebGPU once; the answer decides whether the option is offered at all. */
export async function checkLocalModel(): Promise<void> {
  if (useLocalModel.getState().status.state !== "unknown") return;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu || !isSecureContext) return set({ status: { state: "unsupported", reason: "This browser has no WebGPU." } });
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return set({ status: { state: "unsupported", reason: "No WebGPU adapter is available." } });
  if (!adapter.features.has("shader-f16")) return set({ status: { state: "unsupported", reason: "This GPU lacks 16-bit float shaders." } });
  set({ status: { state: "off" } });
  void downloadSize(useLocalModel.getState().model);
}

async function downloadSize(id: LocalModelId) {
  try {
    const res = await fetch(`/api/llm/hf/mlc-ai/${id}/resolve/main/tensor-cache.json`);
    const json = (await res.json()) as { records?: { nbytes?: number }[] };
    const bytes = (json.records ?? []).reduce((s, r) => s + (r.nbytes ?? 0), 0);
    if (useLocalModel.getState().model === id && bytes > 0) set({ size: bytes });
  } catch {
    // The size is a courtesy; the button works without it.
  }
}

/** Loads (downloading the first time) and keeps the engine. */
export function loadLocalModel(id: LocalModelId = useLocalModel.getState().model): Promise<WebLLM.MLCEngineInterface> {
  if (engine && engineModel === id) return engine;
  const previous = engine;
  engineModel = id;
  set({ model: id, status: { state: "loading", progress: 0, text: "Loading WebLLM…" } });
  engine = (async () => {
    if (previous) await (await previous.catch(() => null))?.unload();
    const webllm = await loadLib();
    const e = await webllm.CreateMLCEngine(id, {
      appConfig: appConfig(webllm, id),
      initProgressCallback: (r) => {
        if (engineModel === id) set({ status: { state: "loading", progress: r.progress, text: r.text } });
      },
    });
    remember(id);
    if (engineModel === id) set({ status: { state: "ready" } });
    return e;
  })();
  engine.catch((err: unknown) => {
    if (engineModel !== id) return;
    engine = null;
    engineModel = null;
    set({ status: { state: "error", message: err instanceof Error ? err.message : String(err) } });
  });
  return engine;
}

/** Turns the model off and, with `forget`, deletes its files from this browser. */
export async function turnOffLocalModel(forget: boolean) {
  const id = engineModel ?? useLocalModel.getState().model;
  const e = engine;
  engine = null;
  engineModel = null;
  remember(null);
  set({ status: { state: "off" } });
  await (await e?.catch(() => null))?.unload();
  if (forget) {
    const webllm = await loadLib();
    await webllm.deleteModelAllInfoInCache(id, appConfig(webllm, id));
  }
}

/** True when the visitor turned the model on in this browser (it may still need loading). */
export const localModelChosen = () => remembered() !== null || useLocalModel.getState().status.state === "ready";

export interface LocalReading {
  intent: Intent;
  /** The model's reply, for evaluation only; never shown. */
  raw: string;
  ms: number;
}

/**
 * How replies are decoded. "grammar" holds every token to the intent schema
 * (always valid JSON, but WebLLM's grammar masking makes each token about five
 * times slower). "free" decodes unconstrained and falls back to the grammar
 * only when the reply doesn't parse. `scripts/eval-ask.ts --local` compares them.
 */
export type Decoding = "grammar" | "free";
export const localOptions: {
  decoding: Decoding;
  /** Require only kind and measures, letting the model skip unused fields (fewer tokens to write). */
  brief: boolean;
  /** Keep one conversation in the KV cache across questions (see `session`). */
  reuse: boolean;
} = { decoding: "grammar", brief: true, reuse: true };

/**
 * The conversation kept in the model's KV cache. Every question is appended to
 * it, so the long system prompt is processed once rather than per question
 * (WebLLM reuses the cache only for a continuation). It starts over before the
 * 4,096-token context fills, or when the prompt or model changes.
 */
let session: { key: string; messages: WebLLM.ChatCompletionMessageParam[]; tokens: number } = { key: "", messages: [], tokens: 0 };
/**
 * WebLLM's builds default to 4,096 tokens, which holds the prompt and only
 * about three questions; every restart costs a full prompt (45 s for the 4B
 * model on an M1 Pro). Twice that keeps about thirty.
 */
const CONTEXT = 8_192;
const SESSION_TOKENS = CONTEXT - 500;

/** The chat request for a question, continuing the session. */
export function requestFor(text: string, catalog: Catalog, nowYear: number, grammar: boolean, model: LocalModelId = useLocalModel.getState().model): WebLLM.ChatCompletionRequestNonStreaming {
  const system = compactPrompt(catalog, nowYear);
  const key = `${model}\n${system}`;
  if (session.key !== key || !localOptions.reuse) session = { key, messages: [{ role: "system", content: system }], tokens: 0 };
  return {
    messages: [...session.messages, { role: "user", content: localQuestion(text, catalog, nowYear) }],
    ...(grammar ? { response_format: { type: "json_object", schema: JSON.stringify(intentSchema(catalog, { brief: localOptions.brief })) } } : {}),
    temperature: 0,
    max_tokens: 300,
    // Qwen3 models think first unless told not to; the others don't know the flag.
    ...(model.startsWith("Qwen3") ? { extra_body: { enable_thinking: false } } : {}),
  };
}

/** The JSON object in a reply, ignoring an empty <think></think> block or a code fence around it. */
function replyJson(raw: string): unknown {
  const body = raw.replace(/^\s*<think>[\s\S]*?<\/think>/, "");
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b < a) throw new SyntaxError("no JSON object");
  return JSON.parse(body.slice(a, b + 1));
}

/**
 * Processes the system prompt ahead of the first question, by reading a
 * fixed example from the prompt itself (about 40 s for the 4B model on an M1
 * Pro; afterwards a question takes a few seconds). Only when the visitor has
 * turned the model on, and only once per session.
 */
export function warmLocalModel(catalog: Catalog, nowYear: number) {
  const { state } = useLocalModel.getState().status;
  if (!localModelChosen() || state === "error" || state === "unsupported" || session.messages.length > 1 || warming || pending > 0) return;
  warming = true;
  void readLocally("solar vs wind share in Spain since 2005", catalog, nowYear)
    .catch(() => undefined)
    .finally(() => (warming = false));
}
let warming = false;
/** Questions queued or being read. */
let pending = 0;

/** Reads a question with the in-browser model. */
export function readLocally(text: string, catalog: Catalog, nowYear: number): Promise<LocalReading> {
  pending++;
  const run = queue.then(async () => {
    const e = await loadLocalModel();
    const started = performance.now();
    const attempt = async (grammar: boolean) => {
      const req = requestFor(text, catalog, nowYear, grammar);
      const res = await e.chat.completions.create(req);
      const choice = res.choices[0];
      const raw = choice?.message.content ?? "";
      // With a reused cache, usage counts only the new tokens, so the running total is kept here.
      const tokens = session.tokens + (res.usage?.total_tokens ?? SESSION_TOKENS);
      // Keep the turn only if the model finished it, so the cache matches the conversation.
      const fits = choice?.finish_reason === "stop" && tokens < SESSION_TOKENS;
      session = fits ? { key: session.key, messages: [...req.messages, { role: "assistant", content: raw }], tokens } : { key: "", messages: [], tokens: 0 };
      return { raw, parsed: replyJson(raw) };
    };
    let reply: { raw: string; parsed: unknown };
    try {
      reply = await attempt(localOptions.decoding === "grammar");
    } catch (err) {
      if (localOptions.decoding === "grammar" || !(err instanceof SyntaxError)) throw err;
      reply = await attempt(true);
    }
    return { intent: resolveCountries(coerceIntent(reply.parsed), catalog, nowYear), raw: reply.raw, ms: Math.round(performance.now() - started) };
  }).catch((err: unknown) => {
    throw err instanceof SyntaxError ? new Error("The in-browser model's reply wasn't valid JSON.") : err;
  });
  queue = run.catch(() => undefined).finally(() => pending--);
  return run;
}
