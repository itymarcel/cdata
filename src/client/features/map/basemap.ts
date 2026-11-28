import type { Map as MaplibreMap } from "maplibre-gl";

/**
 * Carto's dark-matter basemap, repainted as a quiet "data globe": land and sea
 * are two close shades of our background, so the land dots (deck) carry the
 * continents; borders are hairlines; country and city names wait until you
 * zoom in. Streets and towns stay for close-ups. Run once the style has loaded.
 */
const LAND = "#121a24";
const SEA = "#0c121a";
const LINE = "rgba(169, 176, 186, 0.16)";
const LABEL = "#8a94a2";
const HALO = "#07090c";

/** Layers that only clutter a whole-globe view. */
const HIDDEN = ["place_continent", "watername_ocean", "watername_sea", "boundary_country_outline", "water_shadow"];
/** Labels that appear from this zoom. */
const LABEL_FROM: Record<string, number> = { place_country_1: 3, place_country_2: 4, place_state: 5 };

export function restyleBasemap(map: MaplibreMap): void {
  const has = (id: string) => Boolean(map.getLayer(id));
  const paint = (id: string, prop: string, value: unknown) => {
    if (has(id)) map.setPaintProperty(id, prop, value);
  };
  paint("background", "background-color", LAND);
  paint("water", "fill-color", SEA);
  paint("waterway", "line-color", SEA);
  paint("boundary_country_inner", "line-color", LINE);
  paint("boundary_country_inner", "line-width", ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 1]);
  paint("boundary_state", "line-opacity", 0.35);
  for (const id of HIDDEN) if (has(id)) map.setLayoutProperty(id, "visibility", "none");
  for (const [id, from] of Object.entries(LABEL_FROM)) if (has(id)) map.setLayerZoomRange(id, from, 24);
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== "symbol" || !layer.id.startsWith("place_")) continue;
    map.setPaintProperty(layer.id, "text-color", LABEL);
    map.setPaintProperty(layer.id, "text-halo-color", HALO);
  }
}
