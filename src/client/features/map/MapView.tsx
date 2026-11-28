import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Map, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import { inSentence } from "@shared/trade.ts";
import { DataStamp } from "../../components/DataStamp.tsx";
import { Panel } from "../../components/Panel.tsx";
import { useCursorYear, useDashboard } from "../../state/store.ts";
import { AnimatedDeck } from "./AnimatedDeck.tsx";
import { restyleBasemap } from "./basemap.ts";
import { FlowsCard } from "./FlowsCard.tsx";
import { LayerSwitcher } from "./LayerSwitcher.tsx";
import { MapLegend } from "./MapLegend.tsx";
import { MapTooltip } from "./MapTooltip.tsx";
import { useMapLayers, type HoverInfo } from "./useMapLayers.ts";
import "./map.css";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const FOREST_FIRST_YEAR = 2001;
const FOREST_LAST_YEAR = 2024;
/** Degrees of longitude per second while the globe idles. */
const SPIN_SPEED = 3;

/** A rim of blue light around the globe (our series blue, dimmed) that fades out as you zoom in. */
const SKY = {
  "sky-color": "#07090c",
  "horizon-color": "#2a5d9c",
  "fog-color": "#07090c",
  "sky-horizon-blend": 0.75,
  "horizon-fog-blend": 0.5,
  "fog-ground-blend": 0.9,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 3, 0.85, 7, 0],
} as const;

const PROJECTION = { globe: { type: "globe" }, mercator: { type: "mercator" } } as const;

/** Zoom at which the globe fills about 85% of the map's height (MapLibre's globe is 512·2^z / π px across). */
const fitGlobeZoom = (height: number) => Math.max(0.3, Math.log2((0.92 * height * Math.PI) / 512));

const prefersReducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Spins the globe slowly until someone touches it. Stops for good on the first
 * drag, scroll, click or fly-to, and pauses while the map is hidden behind a chart.
 */
function useIdleSpin(mapRef: React.RefObject<MapRef | null>, active: boolean, loaded: boolean) {
  const stopped = useRef(prefersReducedMotion());
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded || !active || stopped.current) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!map.isMoving() && document.visibilityState === "visible") {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + dt * SPIN_SPEED, c.lat] });
      }
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      stopped.current = true;
      cancelAnimationFrame(raf);
    };
    const events = ["mousedown", "touchstart", "wheel", "dragstart"] as const;
    for (const e of events) map.on(e, stop);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const e of events) map.off(e, stop);
    };
  }, [mapRef, active, loaded]);
  return stopped;
}

export function MapView() {
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const onHover = useCallback((h: HoverInfo | null) => setHover(h), []);
  const mapLayers = useMapLayers(onHover);
  const { layers, pulse, shownYear, isLive, matrixSource } = mapLayers;

  const year = useCursorYear();
  const forestOn = useDashboard((s) => s.layers.forestLoss);
  const flyTarget = useDashboard((s) => s.flyTarget);
  const metric = useDashboard((s) => s.metric);
  const projection = useDashboard((s) => s.projection);
  const visible = useDashboard((s) => s.view === "map");
  const expanded = useDashboard((s) => s.mapExpanded);
  const setExpanded = useDashboard((s) => s.setMapExpanded);

  const spinStopped = useIdleSpin(mapRef, projection === "globe" && visible, loaded);

  useEffect(() => {
    if (!flyTarget) return;
    spinStopped.current = true;
    mapRef.current?.flyTo({ center: [flyTarget.lon, flyTarget.lat], zoom: flyTarget.zoom, duration: 1600, essential: true });
  }, [flyTarget, spinStopped]);

  // Switching projection: a whole globe, or the flat world filling the width.
  const firstProjection = useRef(true);
  useEffect(() => {
    if (firstProjection.current) {
      firstProjection.current = false;
      return;
    }
    const map = mapRef.current?.getMap();
    if (!map) return;
    // deck picks MapView or GlobeView on "styledata", which setProjection doesn't fire.
    map.fire("styledata");
    const el = map.getContainer();
    const zoom = projection === "globe" ? fitGlobeZoom(el.clientHeight) : Math.max(0.8, Math.log2(el.clientWidth / 512));
    map.easeTo({ zoom, pitch: 0, duration: 800 });
  }, [projection]);

  // Expanded, the map fills the window; Escape brings it back. A whole globe is refitted to the new height.
  useEffect(() => {
    if (!visible && expanded) setExpanded(false);
  }, [visible, expanded, setExpanded]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, setExpanded]);
  const firstExpand = useRef(true);
  useEffect(() => {
    if (firstExpand.current) {
      firstExpand.current = false;
      return;
    }
    const map = mapRef.current?.getMap();
    if (!map) return;
    // Let the panel take its new size first.
    const id = requestAnimationFrame(() => {
      map.resize();
      if (projection === "globe") map.easeTo({ zoom: fitGlobeZoom(map.getContainer().clientHeight), duration: 600 });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit on expand/collapse only
  }, [expanded]);

  // GFW tree-cover-loss tiles accumulate loss from 2001 up to the cursor year.
  const forestEnd = Math.min(FOREST_LAST_YEAR, year);
  const forestVisible = forestOn && forestEnd >= FOREST_FIRST_YEAR;
  const forestTiles = `https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png?start_year=${FOREST_FIRST_YEAR}&end_year=${forestEnd}&tree_cover_density_threshold=30`;

  const action = mapLayers.action;
  const coloured = action ? `${action.data.short} by country` : "Emissions by country";

  return (
    <Panel
      title="Map"
      subtitle={
        <>
          {coloured} in <strong className="mono">{shownYear}</strong>
          {mapLayers.flows && (
            <>
              {" · "}trade in {inSentence(mapLayers.flows.label)}, <strong className="mono">{mapLayers.flows.year}</strong>
            </>
          )}
          {!isLive && " · live layers paused: move the timeline to Now to see them"}
        </>
      }
      className={`map-panel${expanded ? " is-expanded" : ""}`}
      actions={
        <button type="button" className="icon-btn" onClick={() => setExpanded(!expanded)} aria-pressed={expanded} title={expanded ? "Back to the dashboard (Esc)" : "Fill the window"}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      }
      footer={
        <>
          {action ? (
            <span className="stamp" title={`${action.data.source.name}\n${action.data.source.publisher}`}>
              <a href={action.data.source.url} target="_blank" rel="noopener noreferrer">
                {action.data.source.publisher}
              </a>
            </span>
          ) : (
            <DataStamp source={matrixSource} extra={metric.replace(/_/g, " ")} />
          )}
          {mapLayers.flowsSource && <DataStamp source={mapLayers.flowsSource} extra="trade flows" />}
        </>
      }
    >
      <div className={`map-wrap map-wrap--${projection}`}>
        <Map
          ref={mapRef}
          initialViewState={{ longitude: 20, latitude: 18, zoom: 1.5 }}
          mapStyle={BASEMAP}
          projection={PROJECTION[projection]}
          sky={SKY as unknown as React.ComponentProps<typeof Map>["sky"]}
          minZoom={0}
          maxZoom={12}
          attributionControl={{ compact: true }}
          dragRotate={false}
          renderWorldCopies={projection === "mercator"}
          onLoad={(e) => {
            restyleBasemap(e.target);
            const el = e.target.getContainer();
            if (projection === "globe") e.target.jumpTo({ zoom: fitGlobeZoom(el.clientHeight) });
            setLoaded(true);
          }}
          onMouseOut={() => setHover(null)}
        >
          {forestVisible && (
            <Source key={forestEnd} id="forest-loss" type="raster" tiles={[forestTiles]} tileSize={256} maxzoom={12}
              attribution='Tree cover loss: <a href="https://glad.umd.edu/">UMD GLAD</a> / <a href="https://www.globalforestwatch.org/">GFW</a>'>
              {/* Above the deck choropleth (which sits below the country outlines) */}
              <Layer id="forest-loss-layer" type="raster" beforeId="waterway_label" paint={{ "raster-opacity": 0.95 }} />
            </Source>
          )}
          <AnimatedDeck layers={layers} pulse={pulse} animate={visible && !prefersReducedMotion()} />
          <NavigationControl position="bottom-right" showCompass={false} />
        </Map>
        <LayerSwitcher isLive={isLive} forestNote={forestOn && !forestVisible ? `Forest data starts in ${FOREST_FIRST_YEAR}` : forestOn ? `Loss 2001–${forestEnd}` : null} />
        <FlowsCard
          view={mapLayers.flows}
          loading={mapLayers.flowsLoading}
          error={mapLayers.flowsError}
          drawn={mapLayers.arcCount}
        />
        <MapLegend action={action} flows={mapLayers.flows} />
        {hover && <MapTooltip info={hover} />}
      </div>
    </Panel>
  );
}
