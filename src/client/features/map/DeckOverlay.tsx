import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";

/**
 * deck.gl rendered inside MapLibre (interleaved), so data sits beneath basemap labels.
 *
 * We attach one overlay per map instance ourselves instead of using `useControl`:
 * under React StrictMode, `useControl` removes and re-adds the same overlay, and
 * deck then tries to attach a second device to the same WebGL context and throws.
 * A new map instance (e.g. after a remount) gets its own overlay; the old one dies
 * with its map and WebGL context.
 */
export function DeckOverlay({ layers }: { layers: Layer[] }) {
  const { current: mapRef } = useMap();
  const attached = useRef<{ map: unknown; overlay: MapboxOverlay } | null>(null);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    if (attached.current?.map !== map) {
      const overlay = new MapboxOverlay({ interleaved: true, layers });
      map.addControl(overlay);
      attached.current = { map, overlay };
    } else {
      attached.current.overlay.setProps({ layers });
    }
  }, [mapRef, layers]);

  return null;
}
