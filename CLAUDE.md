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

- **No hand-entered data.** Everything shown comes from a public feed or is derived from one, with its source cited. The only curated content is the four IPCC links in the graph and the IPCC passages in `server/views/citations.ts` (verbatim quotes with paragraph and page, behind the explorer's context notes). Reference lines and thresholds are computed from the data, or else cite a document (e.g. Paris Art. 2). Don't invent numbers. If something can't be sourced, say so to the user.
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
  - `Story.tsx`: headline, key facts and context notes (headline figures open a floating card; facts open in place). The side panel has two tabs, Key facts (default, `store.explorerPanel`) and Data & layers.
  - Server side: `server/views/history.ts` (`buildHistory` per vital, `buildContext`), `server/views/insights.ts` (one story builder per vital, tested in `tests/insights.test.ts`) and `server/sources/history.ts` (ice-core CO₂, PAGES 2k/Temp12k, Berkeley Earth, tide gauges, ONI/ENSO, NOAA volcanoes).
  - API: `/api/history/:id`, `/api/context`.
- **Story rules:** a story sentence is a template, and every number in it comes from the data. Each fact carries a `basis` naming its series and calculation. Gate any qualitative claim ("record", "speeding up") on the computed values, and add a test for the case where the claim must not appear. Daily series stamp midnight (NSIDC) or noon (ERA5), so read dates with `dateOf`/`dayKey`, never `floor`.
- **Context notes:** each note has What it means / Why it matters / How we know. A line is either computed (`basis`) or restates a report passage (`cite`), never both. A cited line may only use numbers its quote contains (tested). To add a passage, copy it verbatim from the report into `citations.ts`, dropping footnote markers, and link the PDF page.
- **Explorer design decisions:**
  - Context layers fade (`.xp-layer.is-off`) rather than unmount.
  - Each vital declares which overlays it offers.
  - "Change / yr" hides multi-year reconstructions, because a yearly rate is meaningless at their resolution.
  - The trend is fitted to the series that best covers the visible window.
- **Ask bar (⌘K):** `client/features/ask/` (`AskBar.tsx` dialog and shortcut, `Chips.tsx` editable reading, `AskResult.tsx`, `useAsk.ts`). Pipeline: `shared/nl/parse.ts` (question → `Intent`, pure, also runs in the browser) → `buildQuery` in `shared/query.ts` (Intent → `Query`, checked against the catalog) → `server/views/query.ts` (executor) over `server/views/catalog.ts` (`MEASURE_DEFS`: vocabulary + loaders). Optional models fill the same `Intent`: `server/lib/ask.ts` (Claude, structured output) and `client/features/ask/localModel.ts` (WebLLM on WebGPU, opt-in per browser, preferred over Claude once turned on). Their schema, prompts and reply coercion live in `shared/nl/model.ts` (`systemPrompt` for Claude, `compactPrompt` + `localQuestion` for the 4k-context browser models, `LOCAL_MODELS`). `server/routes/llm.ts` serves the WebLLM module and proxies only `LOCAL_MODELS`' files from Hugging Face and GitHub into `data/llm/`, so the browser stays on `/api`. API: `GET /api/catalog`, `POST /api/query`, `POST /api/ask`, `/api/llm/*`. Tests: `tests/ask-parse.test.ts` (golden questions, real vocabulary), `tests/query.test.ts`, `tests/ask-model.test.ts` (prompt size, proxy allowlist against WebLLM's model list).
  - The model only ever produces an `Intent`. Never let model text reach the UI; unanswerable questions map to the `UNSUPPORTED_TEXT` templates.
  - Scoring readers: `bun scripts/eval-ask.ts --parser` (free), `--local <ids> [--decoding grammar|free|both] [--full] [--fresh]` (headless Brave on :9333 with `--enable-unsafe-webgpu`; it drives the dev-only `/dev/local-model` harness, which uses the Ask bar's own reader), or no flag for Claude (paid, needs a key). "As used" is the parser where it's sure plus the model elsewhere, which is what visitors get.
  - Browser-model constraints: the system prompt must stay question-independent so WebLLM can keep it in the KV cache (it only reuses the cache for a continuation; `localModel.ts` keeps one session and restarts it before 4,096 tokens). Grammar-constrained decoding is about 5× slower per token than free decoding. Don't `tee()` a fetch body to `Bun.write` (it never finishes on Bun 1.2).
  - Result sentences follow the story rules: templates, figures from the data, a `basis` each, claims gated (with a test where they must not appear). Percentages only where `percentMeaningful`.
  - Answer kinds: `series` (lines, stacked, value bars, or `top` countries chosen by the server), `map` (`MapResult.tsx`, d3-geo choropleth, one colour scale across years), `rank`, `list`, `open`. Typo correction (`correct` in `parse.ts`) only targets non-filler words with the same first letter.
  - A new measure needs terms that don't collide: run the parser tests, and add a golden case. Keep the parser fast (it runs per keystroke; ~3 ms with the full catalog), so reuse compiled patterns.
- **Map:** `client/features/map/`. `MapView.tsx` (globe by default, `store.projection`; idle spin until the first interaction; Expand/Esc via `store.mapExpanded` refits the globe), `useMapLayers.ts` (all deck layers; the choropleth shows `store.actionMeasure` when set, else the emissions `metric`), `choropleth.ts` (the climate-action measures it offers, colour scale, carry-forward for sparse years), `arcs.ts` (great-circle arcs and comets) and `dots.ts` (land as a dot grid, one country per dot), all tested in `tests/arcs.test.ts`. Look: `basemap.ts` repaints Carto dark-matter on load (land/sea in our background shades, names only when zoomed in); countries are dots coloured by the measure over a faint polygon tint that takes hover and click; arcs, ends and comets are a glow pass plus a bright core with additive blending (`ADDITIVE`). Don't give translucent PathLayers rounded joints: they bead. `AnimatedDeck.tsx` adds the moving pulses; `FlowsCard.tsx` is the trade card.
  - Trade flows: `server/sources/trade.ts` (one source per good, `trade.<good>`; UN Comtrade keyless API with a shared throttle, a call quota, per-URL answers cached in SQLite, goods loaded one at a time), `server/views/flows.ts` (places and facts), `/api/flows/:good`. Goods, HS codes and the picker's groups live in `shared/trade.ts` (`TRADE_INFO`, `TRADE_GROUPS`; chip goods carry a `step` for the card's chain strip). Label a bundled heading for everything it counts (HS 280429 is helium as well as neon). It answers `data: null` while a first load runs, and the client polls. Tests: `tests/trade.test.ts`.
  - Climate action: `server/sources/action.ts` (OWID grapher tables, each credited to its agency), catalog measures `action.*`, `forest.change`, `forest.afforestation`, `land.protected`, `energy.lowCarbon`. The map and the Action tab read any per-country catalog measure from `/api/map/:id`.
  - Don't import `@deck.gl/geo-layers`: it pulls Node polyfills into the bundle (`process is not defined`).
  - Comtrade's quota is per IP and shared with the user's dev server. Start your own instance with `DISABLE_SCHEDULER=1` so it doesn't spend it; it reads the answers the dev server cached.
- **Flags and logos:** `components/Flag.tsx` uses `/api/flag/:iso2` (from the `flag-icons` package; `shared/iso.ts` maps iso3→iso2). `features/industry/ProducerLogo.tsx` uses `/api/producer-logo/:qid` (`server/views/producer-logos.ts`: Google favicon → www. variant → Commons logo, cached in memory).

## Known limitations / open threads

- The ice-core CO₂ composite ends in 2001. Mauna Loa and the global series take over.
- Explorer explainers are written server-side in `views/history.ts`.
- Explorer settings survive tab switches but not a reload (zustand, not persisted).
