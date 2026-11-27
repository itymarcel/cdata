# Climate Observatory

An interactive dashboard that puts three things side by side: what the planet is doing, who is causing it, and what was decided. One timeline (1850 → today) drives every panel. All content comes from public data feeds. The only hand-written content is four physical links in the connections graph, each citing the IPCC AR6 assessment.

- **Vital signs** (tabs across the top): CO₂, global temperature, today's air temperature, Arctic sea ice, sea level, ocean heat, and the remaining 1.5 °C carbon budget (IGCC). Each tile has a sparkline, an evidence badge and an "as of" stamp. The first tab is the map; picking a vital swaps the map for that measure's **history explorer**, and the URL hash (`#temperature`) remembers the choice.
- **History explorer**: the longest record available for each measure, with the instrumental series and the reconstructions before it kept as separate lines: CO₂ from Antarctic ice cores back 800,000 years, temperature from Temp12k (12,000 years) and PAGES 2k (2,000 years), sea level from tide gauges since 1880, daily air temperature since 1940, and the full daily sea-ice record.
  - Navigation: range presets, drag to pan, scroll to zoom, shift-drag to zoom to a period, an overview strip with a draggable window, and arrow and +/− keys. Clicking the chart moves the timeline.
  - Tools: smoothing (1–30-year running mean), change per year, a log time axis for deep time, a "by year" view that lays every year over one calendar, a second measure on a right-hand axis, and a CSV download of what's in view.
  - Context layers fade in and out, and each measure only offers the ones that apply: reference lines (each with its source), uncertainty ranges, a trend fitted to what's in view (with acceleration for sea level), El Niño/La Niña periods, large volcanic eruptions, and the timeline's events.
- **Map** (MapLibre + deck.gl): emissions by country through time, tree-cover loss tiles, the largest emitting facilities, attribution studies, disaster alerts, live fires and live natural events.
- **Connections graph** (Sigma v4, WebGL): built from the datasets. Fuels → CO₂ (with tonnes), gases → warming (with °C), top emitters → their main fuels, attribution studies → the countries they concern, COPs → hosts, laws → countries. Links show evidence: solid = documented, dashed = attributed by a study or assessment.
- **Industry & land**: ranked emitters, Carbon Majors producers (optional, see below), global CO₂ by fuel, electricity mix, tree-cover loss by driver.
- **Promises vs reality**: every country's NDC targets, quoted verbatim, drawn against actual emissions and the current 10-year trend where they can be plotted. A second tab shows fossil-fuel subsidies.
- **Timeline**: warming stripes with four lanes of events: attribution studies, records detected in the data, climate laws and COPs. Nearby events merge into counted clusters; hover for a preview, click for the list. Click a legend entry to hide its lane. Keyboard: ←/→ (Shift for 10 years), Home/End, Space to play.

## Running it

```bash
bun install
bun run dev             # http://localhost:3000 with hot reload
bun run start           # production mode
bun test                # unit tests
bun run typecheck
bun run check:sources   # fetch every upstream once and print a summary
```

On first start the server downloads each source (≈ 35 MB in total, mostly OWID CSVs and the GDACS history) and caches the normalised result in `data/cache.sqlite`. After that, restarts serve from the cache immediately. No API keys are needed.

## Data sources

| Area | Source | Refresh |
|---|---|---|
| CO₂ (daily, monthly), methane | NOAA Global Monitoring Laboratory | 6 h / 1 day |
| Temperature | HadCRUT5 (stripes, records), NASA GISTEMP (latest month), ERA5 via Climate Reanalyzer (daily) | 6–24 h |
| Sea ice | NSIDC Sea Ice Index v4 | 6 h |
| Sea level, ocean heat | NOAA LSA altimetry; NOAA NCEI and Japan MRI via OWID | 1 day / 1 week |
| Long records (explorer) | Antarctic ice-core CO₂ (Bereiter et al. 2015), PAGES 2k (Neukom et al. 2019) and Temp12k (Kaufman et al. 2020), all via NOAA NCEI Paleoclimatology; Berkeley Earth; tide-gauge sea level (Church & White 2011, UHSLC) via OWID | 1–4 weeks |
| Explorer context | El Niño/La Niña: NOAA CPC Oceanic Niño Index; eruptions of VEI ≥ 5 since 1800: NOAA NCEI Significant Volcanic Eruptions | 1 day / 4 weeks |
| Carbon budget, warming by gas | IGCC (Indicators of Global Climate Change), GitHub data release | 1 week |
| Emissions, energy mix, tree-cover loss, subsidies | Our World in Data (Global Carbon Project, Ember, UMD/GFW, UNEP SDG 12.c.1) | 1 week |
| Facilities | Climate TRACE API | 1 day |
| Fires, natural events | NASA FIRMS (VIIRS 24 h), NASA EONET | 10–15 min |
| Disaster alerts | GDACS (UN OCHA & EC JRC), orange and red alerts since 2000 | 3 h |
| Attribution studies | World Weather Attribution (WordPress API) | 6 h |
| COPs, climate laws | Wikidata SPARQL | 1 day |
| NDC and net-zero targets | Climate Watch (WRI) API | 1 day |
| Country boundaries | Natural Earth | 4 weeks |
| Producer logos | Wikidata (matched by LEI, then by name): website favicon via Google's favicon service, else the Commons logo; nation states get their flag | with Carbon Majors |
| Country flags | `flag-icons` npm package (served locally) | n/a |

### Derived, not hand-entered

- **Records lane**: computed from the observations: every new warmest year since 1990 (HadCRUT5), the first calendar year above 1.5 °C, CO₂ crossing 350, 400 and 420 ppm, and new record-low Arctic sea-ice minima since 2000.
- **Pledge targets**: Climate Watch provides each NDC's target as text. `src/server/views/ndc-parse.ts` extracts a plottable number only from economy-wide % cuts against a base year, or "to X% of base-year levels". Intensity, peaking and business-as-usual targets are shown as text. Parser tests cover real target texts.
- **Study locations**: matched from country and region names in each WWA study's title and summary (`views/geocode.ts`). Studies without a place appear on the timeline but not the map.
- **Explorer reference lines**: computed from the data where possible. CO₂ "pre-industrial" is the mean of the ice-core samples dated 1700–1800, and "highest in 800,000 years" is the ice-core maximum before 1900. The sea-ice line is the 1981–2010 mean of yearly minima, and the 1.5 °C budget line is the cumulative emissions to the IGCC start year plus its remaining budget. The 1.5 °C and 2 °C temperature lines cite the Paris Agreement, Article 2. El Niño and La Niña episodes use NOAA's rule: five or more overlapping 3-month seasons at ±0.5 °C.
- **Carbon budget**: IGCC's remaining budget for a 50% chance of 1.5 °C (central parameter set; the range across sets is shown in the detail view). It is drawn down from 1 January of the year after the edition, at the latest annual CO₂ emissions in the same IGCC release.

### Optional and not-yet-connected sources

- **Carbon Majors** (InfluenceMap) needs a free login and is licensed for non-commercial use. Download the low-granularity emissions file from carbonmajors.org and drop it in `data/carbon-majors/`. Any file name works (browsers save it as `get_cm_file.html`); the loader picks the newest file with the Carbon Majors header. The folder is git-ignored so the data isn't redistributed. The Producers tab and the graph's producer nodes then fill in. The data is updated each November.
- **Not connected** because they require tokens or licences: Climate Change Laws of the World / Climate Policy Radar (an app token; Wikidata is used instead, with partial coverage), Sabin Center litigation, InfluenceMap lobbying, EM-DAT, and ReliefWeb (approved app name). The Data sources panel lists each source's state.

## Architecture

```
src/
  shared/            Types and time maths used by both sides
  server/
    index.ts         Bun.serve: API routes + the bundled SPA (HTML import)
    sources/         One module per upstream: fetch → parse → normalise
    lib/
      source-store   Caching, per-source schedules, dedupe, stale-on-error, optional sources
      cache          SQLite persistence (bun:sqlite), keyed by source id + payload version
      csv, http, text, wikidata, respond, stats, logger
    views/           Derived data: vitals, emissions, events, records, pledges, graph, geocoding
    routes/api.ts    HTTP surface
  client/
    app/             Layout, header, error boundaries
    state/store.ts   Zustand: time cursor, selection, layers, metric
    api/queries.ts   TanStack Query hooks; refetch intervals match each source's cadence
    components/      Panel, charts, badges, modal
    features/        vitals · timeline · map · graph · industry · politics · sources
tests/               bun test: CSV, time, source store, NDC parser, timeline clustering
```

**Data flow.** The browser only talks to `/api`. The server owns every upstream request. When an upstream fails, the store keeps serving the last good payload, flags it stale and retries at a quarter of the normal interval. Each source declares a payload `version`; bump it when the shape changes so old cached payloads are ignored.

### Adding a data source

1. Create a module in `src/server/sources/` that exports `defineSource({ meta, load })`. `load()` returns `{ data, dataAsOf }`. Add `isConfigured` if the source needs a key or a manual download.
2. Add its id to `SourceId` and a payload type in `src/shared/types.ts`.
3. Register it in `src/server/sources/index.ts`. Caching and scheduling are then automatic.
4. Expose it in `PUBLIC_SOURCES` (`routes/api.ts`), or add a derived view under `views/`.
5. Add a query hook in `client/api/queries.ts`.

## Evidence badges

- ● **observed**: measured by instruments
- ◐ **modelled**: reanalysis, models, assessments (IGCC, WWA, GDACS, Climate TRACE)
- ○ **reported**: registries, inventories and disclosures (OWID, Climate Watch, Wikidata)
- ◆ **curated**: hand-assembled. Only the four IPCC links in the graph.

## Known data caveats

- Climate Watch's summary of Russia's 2035 target reads "reducing … by 65–67% compared to 1990". Russia's NDC states emissions at 65–67% *of* 1990 levels. The dashboard plots the source text as given.
- Tree-cover loss is gross loss, including plantations, with regrowth not netted off.
- Pledge actuals are OWID total GHG including land use, which can differ from national inventories.
- NOAA's satellite sea-level file can lag by a year or more.
- WWA study dates are publication dates; the events are usually days to weeks earlier.
- GDACS alert levels estimate humanitarian impact. They say nothing about climate attribution.

## Tech notes

- MapLibre is pinned to 5.x. deck.gl 9.4's interleaved mode reads a MapLibre internal that changed in v6.
- `DeckOverlay` attaches one overlay per map instance itself. `useControl` under React StrictMode re-adds the overlay and deck throws "WebGL context already attached".
- Sigma's dashed-edge shader drops gap-0 patterns, so solid edges are dashes with their gaps painted in (`gapColor`).
- Panels subscribe to the whole cursor year (`useCursorYear`), not the continuous value, so dragging and playback re-render only the timeline each frame. Playback runs at about 60 fps on a GPU. Headless browsers that render WebGL in software are much slower.
