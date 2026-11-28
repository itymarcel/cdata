/**
 * Development-only harness for `scripts/eval-ask.ts --local`: exposes the Ask
 * bar's own in-browser reader (same prompt, schema and coercion) to a driver
 * over the DevTools protocol. Served at /dev/local-model outside production.
 */
import type { Catalog } from "@shared/query.ts";
import type { LocalModelId } from "@shared/nl/model.ts";
import { checkLocalModel, loadLocalModel, localOptions, readLocally, useLocalModel } from "../features/ask/localModel.ts";

let catalog: Catalog | null = null;
const year = new Date().getUTCFullYear();

Object.assign(window, {
  evalLocal: {
    async load(id: LocalModelId) {
      await checkLocalModel();
      const status = useLocalModel.getState().status;
      if (status.state === "unsupported") throw new Error(status.reason);
      const started = performance.now();
      await loadLocalModel(id);
      catalog ??= (await (await fetch("/api/catalog")).json()) as Catalog;
      return { ms: Math.round(performance.now() - started) };
    },
    status: () => useLocalModel.getState().status,
    ask: (q: string) => readLocally(q, catalog!, year),
    /** A plain completion with no prompt or grammar, to measure raw speed. */
    async bench(n = 120) {
      const res = await (await loadLocalModel()).chat.completions.create({ messages: [{ role: "user", content: "Write a long story about a lighthouse." }], max_tokens: n, temperature: 0 });
      return res.usage;
    },
    options: (o: Partial<typeof localOptions>) => void Object.assign(localOptions, o),
  },
});
