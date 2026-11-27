/** Time helpers. Every series uses decimal years so they share the scrubber's axis. */

const MS_PER_DAY = 86_400_000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** UTC date → decimal year (2024-07-02 ≈ 2024.5). */
export function toDecimalYear(date: Date): number {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  return year + (date.getTime() - start) / (daysInYear(year) * MS_PER_DAY);
}

export function ymdToDecimalYear(year: number, month: number, day = 15): number {
  return toDecimalYear(new Date(Date.UTC(year, month - 1, day)));
}

export function decimalYearToDate(t: number): Date {
  const year = Math.floor(t);
  const start = Date.UTC(year, 0, 1);
  return new Date(start + (t - year) * daysInYear(year) * MS_PER_DAY);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / MS_PER_DAY) + 1;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
