import type { Envelope, NdcData, Point, PledgeGap, PledgeTarget, SourceStatus } from "@shared/types.ts";
import type { SourceStore } from "../lib/source-store.ts";
import { linearFit, round } from "../lib/stats.ts";
import type { Co2Column, OwidTable } from "../sources/owid.ts";

/** Climate Watch uses EUU for the EU; OWID's aggregate is EU27 here. */
const CW_TO_OWID: Record<string, string> = { EUU: "EU27" };

export interface PledgesResponse {
  gaps: PledgeGap[];
  sources: { targets: SourceStatus; emissions: SourceStatus };
}

/**
 * Pledged pathway vs actual emissions vs current trend, for every country with
 * NDC targets on Climate Watch. Targets come verbatim from the NDC registry
 * (via Climate Watch); actuals are OWID total GHG including land use.
 */
export async function buildPledgeGaps(store: SourceStore): Promise<Envelope<PledgesResponse>> {
  const [ndc, owid] = await Promise.all([
    store.get<NdcData>("ndcTargets"),
    store.get<OwidTable<Co2Column>>("owidCo2"),
  ]);
  const t = owid.data;
  const startIdx = Math.max(0, t.years.indexOf(1990));
  const years = t.years.slice(startIdx);
  const netZero = new Map(ndc.data.netZero.map((n) => [n.iso3, n]));

  const byCountry = new Map<string, { name: string; targets: typeof ndc.data.targets }>();
  for (const target of ndc.data.targets) {
    const c = byCountry.get(target.iso3) ?? { name: target.country, targets: [] };
    c.targets.push(target);
    byCountry.set(target.iso3, c);
  }

  const gaps: PledgeGap[] = [];
  for (const [cwIso, { name, targets }] of byCountry) {
    const iso3 = CW_TO_OWID[cwIso] ?? cwIso;
    const ci = t.countries.findIndex((c) => c.iso3 === iso3);
    const full = ci >= 0 ? t.columns.total_ghg[ci]! : [];
    const actual = ci >= 0 ? full.slice(startIdx) : years.map(() => null);

    // Latest submission wins for each target year (targets are ordered by submission).
    const latestByYear = new Map<number, PledgeTarget>();
    for (const target of [...targets].sort((a, b) => a.order - b.order)) {
      if (!target.parsed) continue;
      latestByYear.set(target.parsed.targetYear, {
        year: target.parsed.targetYear,
        reduction: target.parsed.reduction,
        rangeLabel: target.parsed.reductionLabel,
        baseYear: target.parsed.baseYear,
        text: target.text,
      });
    }
    const plotted = [...latestByYear.values()].sort((a, b) => a.year - b.year);
    // Unparsed commitments from the most recent submissions, shown as text.
    const otherCommitments = [...targets]
      .sort((a, b) => b.order - a.order)
      .filter((x) => !x.parsed)
      .map((x) => x.text)
      .slice(0, 3);

    let latestIdx = -1;
    actual.forEach((v, i) => {
      if (v !== null) latestIdx = i;
    });
    const latestYear = latestIdx >= 0 ? years[latestIdx]! : null;
    const latestValue = latestIdx >= 0 ? actual[latestIdx]! : null;

    const targetPoints = plotted.flatMap((target) => {
      const baseValue = full[t.years.indexOf(target.baseYear)];
      if (baseValue === null || baseValue === undefined) return [];
      return [{ year: target.year, value: round(baseValue * (1 - target.reduction), 1), baseValue: round(baseValue, 1), label: target.rangeLabel }];
    });
    const future = targetPoints.filter((p) => latestYear === null || p.year > latestYear);
    const requiredPath: Point[] =
      latestYear !== null && latestValue !== null && future.length
        ? [[latestYear, latestValue], ...future.map((p) => [p.year, p.value] as Point)]
        : [];

    const recent: Point[] = [];
    for (let i = Math.max(0, latestIdx - 9); i <= latestIdx; i++) {
      const v = actual[i];
      if (v !== null && v !== undefined) recent.push([years[i]!, v]);
    }
    const fit = linearFit(recent);
    const lastYear = Math.max(2035, ...targetPoints.map((p) => p.year));
    const currentTrend: Point[] =
      fit && latestYear !== null ? [latestYear, lastYear].map((y) => [y, round(fit.intercept + fit.slope * y, 1)] as Point) : [];

    const nz = netZero.get(cwIso);
    gaps.push({
      iso3,
      name,
      targets: plotted,
      otherCommitments,
      netZero: nz && (nz.year || nz.status) ? { year: nz.year, status: nz.status } : undefined,
      years,
      actual,
      targetPoints,
      requiredPath,
      currentTrend,
      latestYear,
      sourceUrl: `https://www.climatewatchdata.org/countries/${cwIso}`,
    });
  }

  gaps.sort((a, b) => a.name.localeCompare(b.name));
  return { source: ndc.source, data: { gaps, sources: { targets: ndc.source, emissions: owid.source } } };
}
