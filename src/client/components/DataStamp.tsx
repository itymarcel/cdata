import type { SourceStatus } from "@shared/types.ts";
import { formatAsOf, formatRelative } from "../lib/format.ts";
import { EvidenceBadge } from "./EvidenceBadge.tsx";
import "./components.css";

/** "Data as of" stamp with provenance. Every panel carries one. */
export function DataStamp({ source, asOf, extra }: { source: SourceStatus | null | undefined; asOf?: string | null; extra?: string }) {
  if (!source) return null;
  const title = [
    source.name,
    source.publisher,
    `Updates: ${source.cadence}`,
    source.lag ? `Typical lag: ${source.lag}` : null,
    `Fetched ${formatRelative(source.fetchedAt)}`,
    source.note,
    source.error ? `Last refresh failed: ${source.error}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="stamp" title={title}>
      <EvidenceBadge evidence={source.evidence} compact />
      {asOf ?? source.dataAsOf ? (
        <span>
          as of <strong>{formatAsOf(asOf ?? source.dataAsOf)}</strong>
        </span>
      ) : (
        // Registries without a data date (e.g. NDC targets): say when we last checked.
        <span>
          checked <strong>{formatRelative(source.fetchedAt)}</strong>
        </span>
      )}
      <span className="stamp__sep">·</span>
      <a href={source.url} target="_blank" rel="noreferrer">
        {source.publisher.split(",")[0]}
      </a>
      {extra && (
        <>
          <span className="stamp__sep">·</span>
          <span>{extra}</span>
        </>
      )}
      {source.error && (
        <span className="stamp__warn" role="status">
          ⚠ stale
        </span>
      )}
    </div>
  );
}
