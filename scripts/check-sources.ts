/** Loads every upstream source once and prints a summary. Usage: bun scripts/check-sources.ts [id...] */
import { sources } from "../src/server/sources/index.ts";

const only = process.argv.slice(2);
const results = await Promise.allSettled(
  sources
    .filter((s) => only.length === 0 || only.includes(s.meta.id))
    .map(async (s) => {
      const t0 = performance.now();
      const { data, dataAsOf } = await s.load();
      const size = JSON.stringify(data).length;
      return `${s.meta.id.padEnd(14)} ok   as of ${String(dataAsOf).padEnd(26)} ${(size / 1024).toFixed(0).padStart(6)} KB  ${Math.round(performance.now() - t0)} ms`;
    }),
);
results.forEach((r, i) =>
  console.log(r.status === "fulfilled" ? r.value : `${sources[i]!.meta.id.padEnd(14)} FAIL ${r.reason}`),
);
