import { describe, expect, test } from "bun:test";
import { parseNdcTarget } from "../src/server/views/ndc-parse.ts";

describe("parseNdcTarget", () => {
  test.each([
    ['"Economy-wide target of reducing net greenhouse gas emissions by 50-52 percent below 2005 levels in 2030"', 0.51, 2005, 2030],
    ["The UK commits to reducing its emissions by at least 68% by 2030 compared to 1990 levels.", 0.68, 1990, 2030],
    ["The European Union commits to reducing emissions by between 66.25-72.5% by 2035 compared to 1990 levels.", 0.69375, 1990, 2035],
    ["26% to 28% reduction in GHG emission by 2025 compared to 2005 and to make best efforts to reduce its emissions by 28%", 0.27, 2005, 2025],
    ["Japan commits to reduce GHG emissions by 46% by 2030 compared to 2013 levels.", 0.46, 2013, 2030],
    ["The United States commits to reducing its emissions by 61-66 percent below 2005 levels by 2035.", 0.635, 2005, 2035],
  ])("%s", (text, reduction, base, target) => {
    const p = parseNdcTarget(text);
    expect(p).not.toBeNull();
    expect(p!.reduction).toBeCloseTo(reduction, 4);
    expect(p!.baseYear).toBe(base);
    expect(p!.targetYear).toBe(target);
  });

  test.each([
    ["Limit GHG emissions to 70-75% of 1990 levels by 2030", 0.275, 1990, 2030],
    ['"A target for limiting greenhouse gas emissions, which provides for a reduction in greenhouse gas emissions by 2030 to 70 percent relative to the 1990 level."', 0.3, 1990, 2030],
  ])("reads emission levels as a share of the base year: %s", (text, reduction, base, target) => {
    const p = parseNdcTarget(text);
    expect(p!.reduction).toBeCloseTo(reduction, 4);
    expect(p).toMatchObject({ baseYear: base, targetYear: target });
  });

  test("uses the separately recorded target year when the text omits it", () => {
    const p = parseNdcTarget('"At least a 40-45% reduction in GHG emissions compared to 2005 levels."', 2030);
    expect(p).toMatchObject({ baseYear: 2005, targetYear: 2030 });
    expect(p!.reduction).toBeCloseTo(0.425, 4);
  });

  test.each([
    'China will lower its CO2 emissions per unit of gross domestic product (GDP) by over 65% from the 2005 level by 2030.',
    "60% to 65% reduction of CO2 emissions per unit of GDP by 2030 compared to 2005 level",
    "China commits to reducing emissions by at least 7%–10% from peak levels by 2035.",
    "Reduce emissions by 30% below business-as-usual by 2030",
    "Achieve the peaking of CO2 emissions around 2030",
  ])("rejects non-absolute target: %s", (text) => {
    expect(parseNdcTarget(text)).toBeNull();
  });
});
