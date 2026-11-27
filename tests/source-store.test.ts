import { afterEach, describe, expect, test } from "bun:test";
import { Cache } from "../src/server/lib/cache.ts";
import { SourceStore } from "../src/server/lib/source-store.ts";
import type { SourceDefinition } from "../src/server/sources/types.ts";

function fakeSource(load: () => Promise<{ data: unknown; dataAsOf: string | null }>, refreshMs = 60_000): SourceDefinition<unknown> {
  return {
    meta: {
      id: "co2",
      name: "Fake",
      publisher: "Test",
      url: "https://example.org",
      evidence: "observed",
      cadence: "test",
      refreshMs,
    },
    load,
  };
}

let stores: SourceStore[] = [];
afterEach(() => {
  stores.forEach((s) => s.stop());
  stores = [];
});

describe("SourceStore", () => {
  test("loads once for concurrent callers and caches the result", async () => {
    let calls = 0;
    const cache = new Cache(":memory:");
    const store = new SourceStore(cache, [
      fakeSource(async () => {
        calls++;
        await Bun.sleep(10);
        return { data: { v: 1 }, dataAsOf: "2026-01-01" };
      }),
    ]);
    stores.push(store);
    const [a, b] = await Promise.all([store.get("co2"), store.get("co2")]);
    expect(calls).toBe(1);
    expect(a.data).toEqual({ v: 1 });
    expect(b.source.dataAsOf).toBe("2026-01-01");
    expect(cache.get("co2")?.payload).toBe('{"v":1}');
  });

  test("keeps serving the last good payload when a refresh fails", async () => {
    let fail = false;
    const store = new SourceStore(new Cache(":memory:"), [
      fakeSource(async () => {
        if (fail) throw new Error("upstream down");
        return { data: [1, 2, 3], dataAsOf: "2026-02-01" };
      }),
    ]);
    stores.push(store);
    await store.get("co2");
    fail = true;
    await store.refresh("co2");
    const env = await store.get<number[]>("co2");
    expect(env.data).toEqual([1, 2, 3]);
    expect(env.source.ok).toBe(false);
    expect(env.source.error).toBe("upstream down");
  });

  test("restores from the SQLite cache without hitting upstream", async () => {
    const cache = new Cache(":memory:");
    cache.set({ id: "co2", payload: '{"cached":true}', fetchedAt: Date.now(), dataAsOf: "2026-03-01" });
    let calls = 0;
    const store = new SourceStore(cache, [
      fakeSource(async () => {
        calls++;
        return { data: {}, dataAsOf: null };
      }),
    ]);
    stores.push(store);
    const env = await store.get("co2");
    expect(env.data).toEqual({ cached: true });
    expect(calls).toBe(0);
  });

  test("errors clearly when there is no data at all", async () => {
    const store = new SourceStore(new Cache(":memory:"), [
      fakeSource(async () => {
        throw new Error("nope");
      }),
    ]);
    stores.push(store);
    await expect(store.get("co2")).rejects.toThrow("unavailable");
  });

  test("schedules refresh intervals longer than setTimeout's 32-bit limit without firing early", async () => {
    let calls = 0;
    const cache = new Cache(":memory:");
    cache.set({ id: "co2", payload: "{}", fetchedAt: Date.now(), dataAsOf: null });
    const store = new SourceStore(cache, [
      fakeSource(async () => {
        calls++;
        return { data: {}, dataAsOf: null };
      }, 28 * 86_400_000),
    ]);
    stores.push(store);
    store.startScheduler();
    await Bun.sleep(50);
    expect(calls).toBe(0);
    expect(Date.parse(store.status("co2").nextRefreshAt!)).toBeGreaterThan(Date.now() + 27 * 86_400_000);
  });
});
