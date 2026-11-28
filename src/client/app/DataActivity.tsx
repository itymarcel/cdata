import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSources } from "../api/queries.ts";
import { useLocalModel } from "../features/ask/localModel.ts";

/** Requests shorter than this don't show the indicator, so minute-by-minute refreshes don't flash it. */
const SHOW_AFTER_MS = 400;

/**
 * A slowly pulsing, turning loader next to the Ask button while data is on its
 * way: requests from this page, sources the server is loading for the first
 * time (after a deploy, before the cache is warm), or the in-browser model's
 * download. Its tooltip says which.
 */
export function DataActivity() {
  const fetching = useIsFetching();
  const { data: sources } = useSources();
  const model = useLocalModel((s) => s.status);

  const reasons: string[] = [];
  if (model.state === "loading") reasons.push(`Loading the in-browser model: ${Math.round(model.progress * 100)}%`);
  const firstLoads = (sources ?? []).filter((s) => s.connected && !s.fetchedAt && !s.error);
  if (firstLoads.length === 1) reasons.push(`The server is loading ${firstLoads[0]!.name} for the first time`);
  else if (firstLoads.length > 1) reasons.push(`The server is loading ${firstLoads.length} sources for the first time`);
  if (fetching > 0) reasons.push(fetching === 1 ? "Fetching data" : `Fetching data (${fetching} requests)`);

  const busy = reasons.length > 0;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!busy) return setShown(false);
    const t = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [busy]);

  if (!shown) return null;
  const label = reasons.join(" · ");
  return (
    <span className="data-activity" role="status" aria-label={label} title={label}>
      {/* Lucide "loader-circle" (ISC licence), inlined. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </span>
  );
}
