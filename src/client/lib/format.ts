/** Number and date formatting used across panels. */

const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** 1,284 · 12.9K · 4.2M; full numbers under 10,000. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Math.abs(value) < 10_000 ? formatNumber(value, Math.abs(value) < 10 ? 1 : 0) : compactFmt.format(value);
}

export function formatSigned(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : "−"}${formatNumber(Math.abs(value), decimals)}`;
}

export function formatYear(t: number): string {
  return String(Math.floor(t));
}

/** Decimal year → "Mar 2024". */
export function formatMonthYear(t: number): string {
  const year = Math.floor(t);
  const month = Math.min(11, Math.floor((t - year) * 12));
  return new Date(Date.UTC(year, month, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "3 hours ago", "2 days ago". */
export function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return iso;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function formatAsOf(asOf: string | null): string {
  if (!asOf) return "—";
  if (/^\d{4}$/.test(asOf)) return asOf;
  if (/^\d{4}-\d{2}$/.test(asOf)) {
    const [y, m] = asOf.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return asOf;
  const hasTime = asOf.includes("T") && !asOf.endsWith("T00:00:00Z");
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(hasTime ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" } : { timeZone: "UTC" }),
  });
}
