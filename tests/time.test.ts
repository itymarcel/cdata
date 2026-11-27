import { describe, expect, test } from "bun:test";
import { decimalYearToDate, toDecimalYear, ymdToDecimalYear } from "../src/shared/time.ts";

describe("decimal years", () => {
  test("round-trip within a second", () => {
    const d = new Date(Date.UTC(2024, 6, 2, 12));
    expect(Math.abs(decimalYearToDate(toDecimalYear(d)).getTime() - d.getTime())).toBeLessThan(1000);
  });
  test("mid-year is about .5, leap years respected", () => {
    expect(ymdToDecimalYear(2024, 7, 2)).toBeCloseTo(2024.5, 2);
    expect(ymdToDecimalYear(2023, 1, 1)).toBe(2023);
  });
});
