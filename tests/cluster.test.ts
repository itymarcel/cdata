import { describe, expect, test } from "bun:test";
import type { TimelineEvent } from "../src/shared/types.ts";
import { clusterLane, markWidth } from "../src/client/features/timeline/cluster.ts";

const ev = (id: string, t: number): TimelineEvent => ({
  id,
  t,
  date: `${Math.floor(t)}-01-01`,
  kind: "attribution",
  title: id,
  summary: "",
  sourceUrl: "https://example.org",
  sourceName: "test",
  evidence: "modelled",
});
const x = (t: number) => (t - 1850) * 6; // 6 px per year

describe("clusterLane", () => {
  test("spaced events stay separate", () => {
    const cs = clusterLane([ev("a", 1900), ev("b", 1950), ev("c", 2000)], x, 5, "attribution");
    expect(cs.map((c) => c.events.length)).toEqual([1, 1, 1]);
  });

  test("dense events merge until no two marks overlap, and none are lost", () => {
    const events = Array.from({ length: 140 }, (_, i) => ev(`e${i}`, 2004 + (i * 22) / 140));
    const cs = clusterLane(events, x, 5, "attribution");
    expect(cs.reduce((a, c) => a + c.events.length, 0)).toBe(140);
    for (let i = 0; i < cs.length - 1; i++) {
      const a = cs[i]!;
      const b = cs[i + 1]!;
      expect(b.x - a.x).toBeGreaterThanOrEqual((markWidth(a.events.length) + markWidth(b.events.length)) / 2);
    }
  });
});
