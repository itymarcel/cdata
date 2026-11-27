/**
 * Small, fast CSV parser. Handles quoted fields with embedded commas, quotes
 * and newlines, which is all our upstreams need.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parses a CSV with a header row into records keyed by column name. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const cols = header.map((h) => h.trim());
  return rows
    .filter((r) => r.length > 1 || (r[0] ?? "") !== "")
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
}

/** Parses a number, treating empty strings and sentinel values as missing. */
export function num(value: string | undefined, sentinels: string[] = []): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (v === "" || sentinels.includes(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
