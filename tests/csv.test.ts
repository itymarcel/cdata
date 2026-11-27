import { describe, expect, test } from "bun:test";
import { num, parseCsv, parseCsvRecords } from "../src/server/lib/csv.ts";

describe("parseCsv", () => {
  test("handles quoted fields with commas, quotes and newlines", () => {
    const rows = parseCsv('a,b,c\n1,"x, y","say ""hi"""\n2,"multi\nline",3\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "multi\nline", "3"],
    ]);
  });

  test("handles CRLF and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("records are keyed by trimmed header", () => {
    expect(parseCsvRecords(" year , value\n2024, 1.5\n")).toEqual([{ year: "2024", value: "1.5" }]);
  });
});

describe("num", () => {
  test("treats blanks and sentinels as missing", () => {
    expect(num("")).toBeNull();
    expect(num("***", ["***"])).toBeNull();
    expect(num("-99.99", ["-99.99"])).toBeNull();
    expect(num(" 3.25 ")).toBe(3.25);
    expect(num("abc")).toBeNull();
  });
});
