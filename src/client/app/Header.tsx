import { useEmissionsMatrix, useSources } from "../api/queries.ts";
import { ASK_SHORTCUT } from "../features/ask/AskBar.tsx";
import { useDashboard } from "../state/store.ts";
import { DataActivity } from "./DataActivity.tsx";

export function Header() {
  const setSourcesOpen = useDashboard((s) => s.setSourcesOpen);
  const setAskOpen = useDashboard((s) => s.setAskOpen);
  const country = useDashboard((s) => s.country);
  const selectCountry = useDashboard((s) => s.selectCountry);
  const metric = useDashboard((s) => s.metric);
  const { data: matrix } = useEmissionsMatrix(metric);
  const { data } = useSources();
  const connected = data?.filter((s) => s.connected) ?? [];
  const failing = connected.filter((s) => !s.ok && s.fetchedAt).length;
  const countryName = country ? (matrix?.data.countries.find((c) => c.iso3 === country)?.name ?? country) : null;

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          <circle cx="16" cy="16" r="4" fill="var(--accent)" />
        </svg>
        <h1>Climate Observatory</h1>
        <span className="app-header__tag">What the planet is doing · who is causing it · what was decided</span>
      </div>
      <div className="app-header__actions">
        {countryName && (
          <button type="button" className="country-pill" onClick={() => selectCountry(null)} aria-label={`Clear selection: ${countryName}`}>
            <span className="muted">Selected</span> {countryName} <span aria-hidden="true">✕</span>
          </button>
        )}
        <DataActivity />
        <button type="button" className="btn ask-trigger" onClick={() => setAskOpen(true)} aria-keyshortcuts="Meta+K Control+K /">
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Ask the data
          <kbd>{ASK_SHORTCUT}</kbd>
        </button>
        <button type="button" className="btn" onClick={() => setSourcesOpen(true)}>
          Data sources
          {data && (
            <span className={`app-header__health${failing ? " is-warn" : ""}`}>
              {failing ? `⚠ ${failing} stale` : `● ${connected.filter((s) => s.ok).length}/${connected.length}`}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
