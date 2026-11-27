import { useEffect } from "react";
import type { VitalId } from "@shared/types.ts";
import { type MainView, useDashboard } from "../state/store.ts";

const VIEWS: MainView[] = ["map", "co2", "temperature", "era5", "seaIce", "seaLevel", "oceanHeat", "carbonBudget"] satisfies (VitalId | "map")[];

const fromHash = (): MainView | null => {
  const h = decodeURIComponent(location.hash.slice(1));
  return (VIEWS as string[]).includes(h) ? (h as MainView) : null;
};

/** Keeps the selected tab in the URL (#temperature), so a view can be linked, bookmarked and restored on reload. */
export function useViewInUrl() {
  const view = useDashboard((s) => s.view);
  const setView = useDashboard((s) => s.setView);

  useEffect(() => {
    const initial = fromHash();
    if (initial) setView(initial);
    const onHash = () => {
      const v = fromHash();
      if (v) setView(v);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [setView]);

  useEffect(() => {
    const target = view === "map" ? "" : `#${view}`;
    if (location.hash !== target) history.replaceState(null, "", `${location.pathname}${location.search}${target}`);
  }, [view]);
}
