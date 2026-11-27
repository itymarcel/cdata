import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Map, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import { DataStamp } from "../../components/DataStamp.tsx";
import { Panel } from "../../components/Panel.tsx";
import { useCursorYear, useDashboard } from "../../state/store.ts";
import { DeckOverlay } from "./DeckOverlay.tsx";
import { LayerSwitcher } from "./LayerSwitcher.tsx";
import { MapLegend } from "./MapLegend.tsx";
import { MapTooltip } from "./MapTooltip.tsx";
import { useMapLayers, type HoverInfo } from "./useMapLayers.ts";
import "./map.css";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const FOREST_FIRST_YEAR = 2001;
const FOREST_LAST_YEAR = 2024;

export function MapView() {
  const mapRef = useRef<MapRef>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const onHover = useCallback((h: HoverInfo | null) => setHover(h), []);
  const { layers, shownYear, isLive, matrixSource } = useMapLayers(onHover);

  const year = useCursorYear();
  const forestOn = useDashboard((s) => s.layers.forestLoss);
  const flyTarget = useDashboard((s) => s.flyTarget);
  const metric = useDashboard((s) => s.metric);

  useEffect(() => {
    if (!flyTarget) return;
    mapRef.current?.flyTo({ center: [flyTarget.lon, flyTarget.lat], zoom: flyTarget.zoom, duration: 1600, essential: true });
  }, [flyTarget]);

  // GFW tree-cover-loss tiles accumulate loss from 2001 up to the cursor year.
  const forestEnd = Math.min(FOREST_LAST_YEAR, year);
  const forestVisible = forestOn && forestEnd >= FOREST_FIRST_YEAR;
  const forestTiles = `https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png?start_year=${FOREST_FIRST_YEAR}&end_year=${forestEnd}&tree_cover_density_threshold=30`;

  return (
    <Panel
      title="Map"
      subtitle={
        <>
          Emissions by country in <strong className="mono">{shownYear}</strong>
          {!isLive && " · live layers paused: move the timeline to Now to see them"}
        </>
      }
      className="map-panel"
      footer={<DataStamp source={matrixSource} extra={metric.replace(/_/g, " ")} />}
    >
      <div className="map-wrap">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: 15, latitude: 22, zoom: 1.4 }}
          mapStyle={BASEMAP}
          minZoom={0.8}
          maxZoom={12}
          attributionControl={{ compact: true }}
          dragRotate={false}
          onMouseOut={() => setHover(null)}
        >
          {forestVisible && (
            <Source key={forestEnd} id="forest-loss" type="raster" tiles={[forestTiles]} tileSize={256} maxzoom={12}
              attribution='Tree cover loss: <a href="https://glad.umd.edu/">UMD GLAD</a> / <a href="https://www.globalforestwatch.org/">GFW</a>'>
              {/* Above the deck choropleth (which sits below the country outlines) */}
              <Layer id="forest-loss-layer" type="raster" beforeId="waterway_label" paint={{ "raster-opacity": 0.95 }} />
            </Source>
          )}
          <DeckOverlay layers={layers} />
          <NavigationControl position="bottom-right" showCompass={false} />
        </Map>
        <LayerSwitcher isLive={isLive} forestNote={forestOn && !forestVisible ? `Forest data starts in ${FOREST_FIRST_YEAR}` : forestOn ? `Loss 2001–${forestEnd}` : null} />
        <MapLegend />
        {hover && <MapTooltip info={hover} />}
      </div>
    </Panel>
  );
}
