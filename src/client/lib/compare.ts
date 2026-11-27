/**
 * Turns abstract magnitudes into something a reader can picture.
 * Reference values are rounded and stable; they are not live data.
 */
const UK_AREA_HA = 24_250_000; // ~242,500 km²
const FOOTBALL_PITCH_HA = 0.714; // FIFA-standard 105 × 68 m
const UK_CO2_2024_MT = 300; // UK territorial CO₂, rounded (OWID/GCP)
const MINUTES_PER_YEAR = 525_600;

export function compareArea(hectares: number): string {
  const uk = hectares / UK_AREA_HA;
  if (uk >= 0.5) return `≈ ${uk.toFixed(1)}× the area of the UK`;
  const pitchesPerMinute = hectares / FOOTBALL_PITCH_HA / MINUTES_PER_YEAR;
  if (pitchesPerMinute >= 1) return `≈ ${Math.round(pitchesPerMinute)} football pitches a minute, all year`;
  return `≈ ${Math.round(hectares / FOOTBALL_PITCH_HA).toLocaleString("en")} football pitches`;
}

export function compareEmissions(mt: number): string {
  const ratio = mt / UK_CO2_2024_MT;
  if (ratio >= 1.5) return `≈ ${ratio.toFixed(1)}× the UK’s annual CO₂`;
  if (ratio >= 0.1) return `≈ ${Math.round(ratio * 100)}% of the UK’s annual CO₂`;
  return "";
}
