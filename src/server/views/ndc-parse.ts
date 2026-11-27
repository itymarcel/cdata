/**
 * Extracts a plottable target from NDC target text, e.g.
 *   "reducing net greenhouse gas emissions by 50-52 percent below 2005 levels in 2030"
 * → { reduction: 0.51, baseYear: 2005, targetYear: 2030 }.
 *
 * Deliberately conservative: anything that isn't an absolute % cut against a
 * historical base year (intensity, peaking, business-as-usual baselines) returns
 * null and is shown as text instead.
 */
export interface ParsedTarget {
  reduction: number;
  reductionLabel: string;
  baseYear: number;
  targetYear: number;
}

const NOT_ABSOLUTE =
  /per unit of (?:GDP|gross domestic product|economic output)|\bGDP\b|intensity|per capita|business[- ]as[- ]usual|\bBAU\b|baseline scenario|compared to (?:a |the )?baseline|from (?:its |their )?peak|peak(?:ing)?\b.*\bby\b.*%? from peak|reference scenario|unconditional.*conditional/i;

const NUM = String.raw`(?<![\d.])(\d{1,3}(?:\.\d+)?)`;
const UNIT = String.raw`\s*(?:%|percent|per cent)`;
/** "50-52 percent", "26% to 28%", "66.25-72.5%": the unit is optional on the first number only. */
const RANGE = new RegExp(String.raw`${NUM}(?:${UNIT})?\s*(?:-|–|—|to|and)\s*${NUM}${UNIT}`, "i");
const SINGLE = new RegExp(String.raw`${NUM}${UNIT}`, "i");
const BASE = /(?:below|compared (?:to|with)|relative to|from|than|against|of)\s+(?:the\s+)?(?:its\s+)?(?:FY\s*)?((?:19|20)\d{2})(?:\s*(?:levels?|emissions|FY))?/i;
const TARGET = /(?:by|in|for|until|before)\s+(?:the\s+)?(?:year\s+)?(?:FY\s*)?(20\d{2})/i;

/**
 * @param fallbackTargetYear the target year recorded separately for the same
 *   NDC document, used when the text omits it ("40-45% below 2005 levels").
 */
/** "limit emissions to 70-75% of 1990 levels" or "to 70 percent relative to the 1990 level": a level, not a cut. */
const LEVEL = new RegExp(
  String.raw`(?:to|at)\s+${NUM}(?:\s*(?:%|percent|per cent))?(?:\s*(?:-|–|—|to)\s*${NUM})?\s*(?:%|percent|per cent)\s+(?:of|relative to|compared to)\s+(?:the\s+)?(?:FY\s*)?((?:19|20)\d{2})`,
  "i",
);

export function parseNdcTarget(text: string, fallbackTargetYear?: number | null): ParsedTarget | null {
  if (NOT_ABSOLUTE.test(text)) return null;
  const level = text.match(LEVEL);
  if (level) {
    const a = Number(level[1]);
    const b = level[2] ? Number(level[2]) : a;
    const baseYear = Number(level[3]);
    const targetYear = findTargetYear(text, baseYear) ?? fallbackTargetYear ?? NaN;
    if (Number.isFinite(targetYear) && baseYear < targetYear && Math.max(a, b) <= 100) {
      const [lo, hi] = [100 - Math.max(a, b), 100 - Math.min(a, b)];
      return {
        reduction: (lo + hi) / 200,
        reductionLabel: lo === hi ? `−${lo}% vs ${baseYear}` : `−${lo} to −${hi}% vs ${baseYear}`,
        baseYear,
        targetYear,
      };
    }
  }
  if (!/reduc|cut|lower|decreas|below|limit/i.test(text)) return null;

  let low: number;
  let high: number;
  const range = text.match(RANGE);
  if (range && Number(range[1]) < Number(range[2]) && Number(range[2]) <= 100) {
    low = Number(range[1]);
    high = Number(range[2]);
  } else {
    const single = text.match(SINGLE);
    if (!single) return null;
    low = high = Number(single[1]);
  }
  if (!(high > 0 && high <= 100)) return null;

  const base = text.match(BASE);
  const baseYear = base ? Number(base[1]) : NaN;
  const targetYear = findTargetYear(text, baseYear) ?? fallbackTargetYear ?? NaN;
  if (!Number.isFinite(baseYear) || !Number.isFinite(targetYear) || baseYear >= targetYear) return null;
  if (baseYear < 1990 || targetYear > 2060) return null;

  return {
    reduction: (low + high) / 200,
    reductionLabel: low === high ? `−${low}% vs ${baseYear}` : `−${low} to −${high}% vs ${baseYear}`,
    baseYear,
    targetYear,
  };
}

/** First 20xx after "by/in/for…" that isn't the base year. */
function findTargetYear(text: string, baseYear: number): number | null {
  for (const m of text.matchAll(new RegExp(TARGET.source, "gi"))) {
    const y = Number(m[1]);
    if (y !== baseYear) return y;
  }
  return null;
}
