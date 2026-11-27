# CLAUDE.md

Climate Observatory: a Bun + React 19 dashboard over public climate data. **Read README.md first**: it covers features, data sources, architecture, how to add a source, and the known caveats. This file only holds what an agent needs on top of that.

## Verify every change

```bash
bun run typecheck && bun test
```

Both must be clean. TypeScript is v7 (`tsc` = tsgo) with `strict` and `noUncheckedIndexedAccess`. Import with explicit `.ts`/`.tsx` extensions. Aliases: `@shared/*`, `@client/*`, `@server/*`.

## Running and looking at the app

- The user normally has `bun run dev` running on **:3000**. Leave it alone and start your own instance on another port:
  `PORT=3100 bun --hot src/server/index.ts > <scratchpad>/server.log 2>&1` (background). It shares `data/cache.sqlite`, so it starts warm. Stop it when you're done.
- After changing a source's payload shape, bump its `version`, or the cached payload is served as-is.
- **Screenshots:** Playwright's Chromium is broken on this machine, and `--screenshot` hangs. Use headless Brave plus the CDP driver in `scripts/screenshot.ts`. Both commands need `dangerouslyDisableSandbox: true`.
  ```bash
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --headless=new --no-first-run --hide-scrollbars \
    --user-data-dir=<scratchpad>/brave --window-size=1600,1000 --remote-debugging-port=9333 about:blank &
  bun scripts/screenshot.ts <scratchpad>/shot steps.json
  ```
  An example `steps.json`: `[{"go":"http://localhost:3100/#co2"},{"wait":10000},{"shot":"co2"}]`. The first load needs about 10 s, because the map is WebGL in software. Read the PNGs, then kill Brave afterwards.
- Deep links: the URL hash picks the main view (`#temperature`, `#co2`, …; no hash shows the map).

## Project rules

- **No hand-entered data.** Everything shown comes from a public feed or is derived from one, with its source cited. The only curated content is the four IPCC links in the graph. Reference lines and thresholds are computed from the data, or else cite a document (e.g. Paris Art. 2). Don't invent numbers. If something can't be sourced, say so to the user.
- Evidence badges (observed / modelled / reported / curated) must match the source. New series in the explorer carry `evidence` and `source`.
- Time is always a decimal year: `Point = [t, v]`. Convert paleo "years BP" with `1950 - age`. Temperature anomalies are rebased to 1850–1900 where the data allows; Temp12k stays relative to 1800–1900 and says so in its note.
- The server owns every upstream request. The browser only calls `/api/*`. Sources must never throw past `load()` for optional enrichment; for example, `identifyProducers` (Wikidata) degrades to no logo.
- The README is user-facing documentation. When you add a feature or source, update its sources table and the matching section.
- Commit only when asked. The repo has no commits yet.

## Where things are (beyond the README's tree)

- **Main view tabs:** `client/features/vitals/VitalsBar.tsx` is a WAI-ARIA tablist (map + 7 vitals). `store.view` (`"map" | VitalId`) is synced to the hash by `client/app/useViewInUrl.ts`. `App.tsx` keeps the map mounted but `hidden` while a chart shows; don't unmount it, because deck.gl and MapLibre are expensive to recreate.
- **History explorer:** `client/features/explorer/`.
  - `VitalExplorer.tsx`: toolbar, side panel, settings per vital in `store.explorer`.
  - `HistoryChart.tsx`: SVG chart with zoom, pan, layers and trend.
  - `Overview.tsx`: overview strip.
  - `transform.ts`: pure maths, tested in `tests/explorer.test.ts`.
  - Server side: `server/views/history.ts` (`buildHistory` per vital, `buildContext`) and `server/sources/history.ts` (ice-core CO₂, PAGES 2k/Temp12k, Berkeley Earth, tide gauges, ONI/ENSO, NOAA volcanoes).
  - API: `/api/history/:id`, `/api/context`.
- **Explorer design decisions:**
  - Context layers fade (`.xp-layer.is-off`) rather than unmount.
  - Each vital declares which overlays it offers.
  - "Change / yr" hides multi-year reconstructions, because a yearly rate is meaningless at their resolution.
  - The trend is fitted to the series that best covers the visible window.
- **Flags and logos:** `components/Flag.tsx` uses `/api/flag/:iso2` (from the `flag-icons` package; `shared/iso.ts` maps iso3→iso2). `features/industry/ProducerLogo.tsx` uses `/api/producer-logo/:qid` (`server/views/producer-logos.ts`: Google favicon → www. variant → Commons logo, cached in memory).

## Known limitations / open threads

- The ice-core CO₂ composite ends in 2001. Mauna Loa and the global series take over.
- Explorer explainers are written server-side in `views/history.ts`.
- Explorer settings survive tab switches but not a reload (zustand, not persisted).
