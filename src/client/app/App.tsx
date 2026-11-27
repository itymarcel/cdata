import { VitalExplorer } from "../features/explorer/VitalExplorer.tsx";
import { ConnectionsPanel } from "../features/graph/ConnectionsPanel.tsx";
import { IndustryPanel } from "../features/industry/IndustryPanel.tsx";
import { MapView } from "../features/map/MapView.tsx";
import { PoliticsPanel } from "../features/politics/PoliticsPanel.tsx";
import { SourcesModal } from "../features/sources/SourcesModal.tsx";
import { TimeScrubber } from "../features/timeline/TimeScrubber.tsx";
import { MAIN_VIEW_ID, VitalsBar } from "../features/vitals/VitalsBar.tsx";
import { useViewInUrl } from "./useViewInUrl.ts";
import { useDashboard } from "../state/store.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { Header } from "./Header.tsx";
import "./app.css";

/**
 * Layout: tabs across the top (the map, then each vital sign), the selected
 * view centre with the connections graph on the right, industry and politics
 * below, the time scrubber pinned to the bottom.
 */
export function App() {
  const view = useDashboard((s) => s.view);
  useViewInUrl();
  return (
    <div className="app">
      <Header />
      <ErrorBoundary name="Vital signs">
        <VitalsBar />
      </ErrorBoundary>
      <main className="app-main">
        <div className="app-main__map" id={MAIN_VIEW_ID} role="tabpanel" aria-label={view === "map" ? "Map" : "History explorer"}>
          {/* The map stays mounted while hidden, so its view and layers survive a trip to a chart. */}
          <div className="main-view__map" hidden={view !== "map"}>
            <ErrorBoundary name="Map">
              <MapView />
            </ErrorBoundary>
          </div>
          {view !== "map" && (
            <ErrorBoundary name="History explorer">
              <VitalExplorer id={view} />
            </ErrorBoundary>
          )}
        </div>
        <div className="app-main__graph">
          <ErrorBoundary name="Connections">
            <ConnectionsPanel />
          </ErrorBoundary>
        </div>
        <div className="app-main__industry">
          <ErrorBoundary name="Industry">
            <IndustryPanel />
          </ErrorBoundary>
        </div>
        <div className="app-main__politics">
          <ErrorBoundary name="Politics">
            <PoliticsPanel />
          </ErrorBoundary>
        </div>
      </main>
      <div className="app-scrubber">
        <ErrorBoundary name="Timeline">
          <TimeScrubber />
        </ErrorBoundary>
      </div>
      <SourcesModal />
    </div>
  );
}
