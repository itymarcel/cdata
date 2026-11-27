import type { Co2Data, Point, SeaIceData, TemperatureData, TimelineEvent } from "@shared/types.ts";
import { decimalYearToDate, isoDate, ymdToDecimalYear } from "@shared/time.ts";

/**
 * Milestones detected in the observations themselves: thresholds crossed and
 * records broken. Nothing here is hand-entered; each event cites the dataset it
 * was computed from.
 */

function event(e: Omit<TimelineEvent, "kind" | "evidence">): TimelineEvent {
  return { ...e, kind: "record", evidence: "observed" };
}

/** Years that set a new record, scanning forward. Only records after `from` are returned. */
function newRecords(series: Point[], from: number, direction: "high" | "low"): Point[] {
  const out: Point[] = [];
  let best = direction === "high" ? -Infinity : Infinity;
  for (const p of series) {
    const beats = direction === "high" ? p[1] > best : p[1] < best;
    if (beats) {
      best = p[1];
      if (p[0] >= from) out.push(p);
    }
  }
  return out;
}

export function temperatureRecords(t: TemperatureData, url: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const [year, v] of newRecords(t.annual, 1990, "high")) {
    events.push(
      event({
        id: `rec-temp-${year}`,
        date: `${year}-12-31`,
        t: year + 0.99,
        title: `${year}: warmest year on record`,
        summary: `Global surface temperature ${v.toFixed(2)} °C above ${t.baseline} (HadCRUT5 annual mean).`,
        sourceUrl: url,
        sourceName: "HadCRUT5",
      }),
    );
  }
  const first15 = t.annual.find(([, v]) => v >= 1.5);
  if (first15) {
    events.push(
      event({
        id: `rec-temp-15-${first15[0]}`,
        date: `${first15[0]}-12-31`,
        t: first15[0] + 0.995,
        title: `${first15[0]}: first calendar year above 1.5 °C`,
        summary: `${first15[1].toFixed(2)} °C above ${t.baseline}. A single year above 1.5 °C is not yet a breach of the Paris goal, which refers to 20-year averages.`,
        sourceUrl: url,
        sourceName: "HadCRUT5",
      }),
    );
  }
  return events;
}

export function co2Thresholds(c: Co2Data, url: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const threshold of [350, 400, 420]) {
    const first = c.monthly.find(([, v]) => v >= threshold);
    if (!first) continue;
    const date = isoDate(decimalYearToDate(first[0])).slice(0, 7);
    events.push(
      event({
        id: `rec-co2-${threshold}`,
        date,
        t: first[0],
        title: `CO₂ passes ${threshold} ppm`,
        summary: `First monthly mean at Mauna Loa above ${threshold} ppm (${first[1].toFixed(2)} ppm). Pre-industrial levels were about 280 ppm.`,
        sourceUrl: url,
        sourceName: "NOAA GML",
      }),
    );
  }
  const start = c.monthly[0];
  if (start) {
    events.push(
      event({
        id: "rec-co2-start",
        date: isoDate(decimalYearToDate(start[0])).slice(0, 7),
        t: start[0],
        title: "Mauna Loa CO₂ record begins",
        summary: `First monthly mean: ${start[1].toFixed(2)} ppm. The longest continuous direct record of atmospheric CO₂.`,
        sourceUrl: url,
        sourceName: "NOAA GML",
      }),
    );
  }
  return events;
}

export function seaIceRecords(s: SeaIceData, url: string): TimelineEvent[] {
  return newRecords(s.north.annualMinimum, 2000, "low").map(([year, v]) =>
    event({
      id: `rec-ice-${year}`,
      date: `${year}-09-15`,
      t: ymdToDecimalYear(year, 9, 15),
      title: `${year}: record-low Arctic sea ice`,
      summary: `Annual minimum extent ${v.toFixed(2)} million km², the lowest in the satellite record at the time.`,
      place: { name: "Arctic", lon: 0, lat: 80 },
      sourceUrl: url,
      sourceName: "NSIDC Sea Ice Index",
    }),
  );
}
