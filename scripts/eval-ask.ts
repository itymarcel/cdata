/**
 * Scores a reader of the Ask bar on questions the built-in parser finds hard.
 * A case passes when every field in `expect` matches the intent (arrays
 * compared as sets).
 *
 *   bun scripts/eval-ask.ts [base]                  the server's Claude reader: one paid API call per question
 *   bun scripts/eval-ask.ts [base] --parser         the built-in parser alone (free)
 *   bun scripts/eval-ask.ts [base] --local <ids>    in-browser models (comma-separated LOCAL_MODELS ids)
 *     [--decoding grammar|free|both]                 how the reply is decoded (default grammar)
 *     [--full] [--fresh]                             every field required / a new context per question
 *
 * `base` defaults to http://localhost:3100. For the Claude reader, start the
 * server with ANTHROPIC_API_KEY. For --local, start a development server and a
 * headless Chromium-family browser with WebGPU on :9333 (see CLAUDE.md); the
 * script opens /dev/local-model there, which runs the Ask bar's own
 * in-browser reader. The first run downloads each model (about 1–3 GB).
 */
import type { Catalog, Intent } from "../src/shared/query.ts";
import { parse } from "../src/shared/nl/parse.ts";
import { LOCAL_MODELS, isLocalModel } from "../src/shared/nl/model.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.indexOf(name);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3100";
const mode = flag("--local") >= 0 ? "local" : flag("--parser") >= 0 ? "parser" : "claude";
const localIds = mode === "local" ? (args[flag("--local") + 1] ?? LOCAL_MODELS[0].id).split(",") : [];
const decodingArg = flag("--decoding") >= 0 ? args[flag("--decoding") + 1] : "grammar";
const decodings = decodingArg === "both" ? ["grammar", "free"] : [decodingArg ?? "grammar"];
const localOpts = { brief: flag("--full") < 0, reuse: flag("--fresh") < 0 };

const CASES: { q: string; expect: Partial<Intent> }[] = [
  { q: "How have Germany's per-head carbon emissions compared with France's since reunification?", expect: { kind: "series", measures: ["emissions.perCapita"], countries: ["DEU", "FRA"], from: 1990 } },
  { q: "who pollutes the most?", expect: { kind: "rank", measures: ["emissions.co2"], order: "desc" } },
  { q: "which big economies decarbonised fastest over the last 15 years, relatively speaking", expect: { kind: "rank", rankBy: "percent", order: "asc" } },
  { q: "is the arctic summer ice still shrinking?", expect: { kind: "series", measures: ["seaIce.min"] } },
  { q: "how much of Britain's power is renewable these days", expect: { kind: "series", measures: ["energy.renewables"], countries: ["GBR"] } },
  { q: "carbon dioxide in the air during the last ice age", expect: { kind: "series", measures: ["co2.iceCore"] } },
  { q: "studies that blamed climate change for heat in India", expect: { kind: "list", dataset: "attribution", hazard: "heatwave", countries: ["IND"] } },
  { q: "cyclones hitting Bangladesh", expect: { kind: "list", dataset: "disasters", hazard: "storm", countries: ["BGD"] } },
  { q: "when did Pinatubo blow", expect: { kind: "list", dataset: "eruptions" } },
  { q: "what has Brazil promised to cut", expect: { kind: "list", dataset: "pledges", countries: ["BRA"] } },
  { q: "is warming speeding up? show the rate", expect: { kind: "series", measures: ["temperature"], display: "change" } },
  { q: "what will sea level be in 2100", expect: { kind: "unsupported", reason: "forecast" } },
  { q: "why do El Niño years run hot", expect: { kind: "unsupported", reason: "explanation" } },
  { q: "Germany's GDP", expect: { kind: "unsupported", reason: "not_in_data" } },
  { q: "take me to the ocean heat chart from 1980", expect: { kind: "open", view: "oceanHeat", from: 1980 } },
  { q: "where in the world do people emit the most carbon per head? colour the countries", expect: { kind: "map", measures: ["emissions.perCapita"] } },
  { q: "how did each country's emissions change after the Kyoto protocol, geographically", expect: { kind: "map", rankBy: "change", from: 1997 } },
  { q: "what is Germany's power made of", expect: { kind: "series", chart: "stacked", countries: ["DEU"] } },
  { q: "lines for the five biggest polluters since the millennium", expect: { kind: "series", topCountries: true, top: 5, from: 2000 } },
];

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x) => b.includes(x)) : a === b;

const catalog = (await (await fetch(`${base}/api/catalog`)).json()) as Catalog;
const year = new Date().getUTCFullYear();

/** The Ask bar's rule (useAsk.ts): the parser answers unless it is unsure, then a model does. */
const MODEL_THRESHOLD = 0.75;
function parserAnswers(q: string) {
  const p = parse(q, catalog, year);
  const unsure = !p.understood || p.confidence < MODEL_THRESHOLD || p.unread.length > 0;
  const settled = p.intent.kind === "unsupported" && (p.intent.reason === "explanation" || p.intent.reason === "forecast");
  return !unsure || settled;
}
const passes = (intent: Intent, expect: Partial<Intent>) => Object.entries(expect).every(([k, v]) => same(intent[k as keyof Intent], v));

/**
 * Scores one reader; `read` returns the intent (or an error) and how long it
 * took. "As used" scores what the Ask bar would show: the parser's reading
 * where it is sure, this reader's elsewhere.
 */
async function score(label: string, read: (q: string) => Promise<{ intent?: Intent; error?: string; ms?: number }>) {
  let passed = 0;
  let asUsed = 0;
  const times: number[] = [];
  console.log(`\n== ${label}`);
  for (const c of CASES) {
    const parser = parse(c.q, catalog, year);
    const r = await read(c.q);
    if (r.ms !== undefined) times.push(r.ms);
    const byParser = parserAnswers(c.q);
    if (byParser ? passes(parser.intent, c.expect) : !!r.intent && passes(r.intent, c.expect)) asUsed++;
    if (!r.intent) {
      console.log(`✗ ${c.q}\n    error: ${r.error}`);
      continue;
    }
    const misses = Object.entries(c.expect).filter(([k, v]) => !same(r.intent![k as keyof Intent], v));
    if (misses.length === 0) passed++;
    console.log(`${misses.length ? "✗" : "✓"} ${c.q}${r.ms !== undefined ? `  (${(r.ms / 1000).toFixed(1)} s)` : ""}`);
    for (const [k, v] of misses) console.log(`    ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(r.intent[k as keyof Intent])}`);
    if (mode !== "parser") console.log(`    parser: ${parser.intent.kind} ${parser.intent.measures.join(",")} ${parser.intent.countries.join(",")} (confidence ${parser.confidence.toFixed(2)})`);
  }
  const sorted = times.toSorted((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
  console.log(`${label}: ${passed}/${CASES.length} passed${median !== null ? `, median ${(median / 1000).toFixed(1)} s per question` : ""}; as used with the parser: ${asUsed}/${CASES.length}`);
  return { label, passed, asUsed, median };
}

/** A minimal DevTools-protocol client for the headless browser on :9333. */
async function devtools() {
  const targets = (await (await fetch("http://localhost:9333/json")).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((t) => t.type === "page") ?? ((await (await fetch("http://localhost:9333/json/new?about:blank", { method: "PUT" })).json()) as { webSocketDebuggerUrl: string });
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg), pending.delete(msg.id);
    if (msg.method === "Runtime.exceptionThrown") console.error("page exception:", msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  };
  const send = (method: string, params: object = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  /** Evaluates an async expression in the page; rejects with the page's error. */
  const evaluate = async <T>(expression: string): Promise<T> => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0] ?? r.result.exceptionDetails.text);
    return r.result?.result?.value as T;
  };
  return { send, evaluate, close: () => ws.close() };
}

const results: { label: string; passed: number; asUsed: number; median: number | null }[] = [];

if (mode === "parser") {
  results.push(await score("built-in parser", async (q) => ({ intent: parse(q, catalog, year).intent })));
} else if (mode === "claude") {
  if (!catalog.askAvailable) {
    console.error("The server has no language model configured (set ANTHROPIC_API_KEY, or ASK_ENABLED=1 with an `ant auth login` profile).");
    process.exit(1);
  }
  results.push(
    await score("server model (Claude)", async (q) => {
      const started = performance.now();
      const res = await fetch(`${base}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q }) });
      const body = (await res.json()) as { intent?: Intent; error?: string };
      return res.ok && body.intent ? { intent: body.intent, ms: performance.now() - started } : { error: `${res.status}: ${body.error}` };
    }),
  );
} else {
  const cdp = await devtools();
  for (const id of localIds) {
    if (!isLocalModel(id)) {
      console.error(`${id} is not in LOCAL_MODELS`);
      continue;
    }
    await cdp.send("Page.navigate", { url: `${base}/dev/local-model` });
    await Bun.sleep(1500);
    process.stdout.write(`\nLoading ${id}… `);
    const progress = setInterval(async () => {
      const s = await cdp.evaluate<{ state: string; progress?: number }>("window.evalLocal.status()").catch(() => null);
      if (s?.state === "loading") process.stdout.write(`${Math.round((s.progress ?? 0) * 100)}% `);
    }, 15_000);
    try {
      const { ms } = await cdp.evaluate<{ ms: number }>(`window.evalLocal.load(${JSON.stringify(id)})`);
      clearInterval(progress);
      console.log(`ready in ${(ms / 1000).toFixed(1)} s`);
      for (const decoding of decodings) {
        await cdp.evaluate(`window.evalLocal.options(${JSON.stringify({ decoding, ...localOpts })})`);
        // One unscored question first, so shader compilation isn't timed against the first case.
        const first = await cdp.evaluate<{ ms: number }>(`window.evalLocal.ask("CO2 since 1990")`);
        console.log(`first question (prompt not yet cached): ${(first.ms / 1000).toFixed(1)} s`);
        results.push(
          await score(`in-browser ${id}, ${decoding}${localOpts.brief ? "" : ", full schema"}${localOpts.reuse ? "" : ", fresh"}`, async (q) => {
            try {
              const r = await cdp.evaluate<{ intent: Intent; ms: number }>(`window.evalLocal.ask(${JSON.stringify(q)})`);
              return { intent: r.intent, ms: r.ms };
            } catch (err) {
              return { error: err instanceof Error ? err.message : String(err) };
            }
          }),
        );
      }
    } catch (err) {
      clearInterval(progress);
      console.log(`failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  cdp.close();
}

if (results.length > 1) {
  console.log("\nSummary");
  for (const r of results) console.log(`  ${r.label}: ${r.passed}/${CASES.length} alone, ${r.asUsed}/${CASES.length} with the parser${r.median !== null ? `, median ${(r.median / 1000).toFixed(1)} s` : ""}`);
}
process.exit(0);
