# Climate Observatory

An interactive dashboard that puts four things side by side: what the planet is doing, who is causing it, what is being done about it, and what was decided. One timeline (1850 → today) drives every panel. All content comes from public data feeds. The only hand-written content is four physical links in the connections graph and the "why it matters" lines in the explorer's context notes, each restating a quoted passage of the IPCC AR6 assessment.

- **Vital signs** (tabs across the top): CO₂, global temperature, today's air temperature, Arctic sea ice, sea level, ocean heat, and the remaining 1.5 °C carbon budget (IGCC). Each tile has a sparkline, an evidence badge and an "as of" stamp. The first tab is the map; picking a vital swaps the map for that measure's **history explorer**, and the URL hash (`#temperature`) remembers the choice.
- **History explorer**: the longest record available for each measure, with the instrumental series and the reconstructions before it kept as separate lines: CO₂ from Antarctic ice cores back 800,000 years, temperature from Temp12k (12,000 years) and PAGES 2k (2,000 years), sea level from tide gauges since 1880, daily air temperature since 1940, and the full daily sea-ice record.
  - Reading it: each measure opens with a one-sentence headline in plain language ("Arctic sea ice is the 3rd lowest on record for 25 November"), and the side panel's **Key facts** list what the data says: records, ranks, rates then and now, and streaks. Every fact names the series and calculation behind it, and the latest value is labelled where its line ends. **Data & layers** holds the dataset and context switches.
  - Context: the headline's key figures (dotted underline) and facts with an ⓘ open a note in three parts: **What it means** puts the figure in everyday terms ("for every 2 molecules of CO₂ in the air of the 1700s there are now about 3"), **Why it matters** gives the causes and consequences with links to the related measures, and **How we know** explains the measurement. Data-derived lines name their calculation; report-based lines show the IPCC passage word for word, with a link to its page.
  - Navigation: range presets, drag to pan, scroll to zoom, shift-drag to zoom to a period, an overview strip with a draggable window, and arrow and +/− keys. Clicking the chart moves the timeline.
  - Tools: smoothing (1–30-year running mean), change per year, a log time axis for deep time, a "by year" view that lays every year over one calendar, a second measure on a right-hand axis, and a CSV download of what's in view.
  - Context layers fade in and out, and each measure only offers the ones that apply: reference lines (each with its source), uncertainty ranges, a trend fitted to what's in view (with acceleration for sea level), El Niño/La Niña periods, large volcanic eruptions, and the timeline's events.
- **Ask the data** (⌘K, Ctrl+K or `/`): a command bar that turns a plain question into a chart, a map, a comparison, a ranking or a list, built from the same series the dashboard shows. "Germany vs France CO₂ per person since 1990", "show CO₂ emissions on a map", "map of emissions change since 1990", "electricity mix in Germany", "chart the top 5 emitters since 1990", "which countries cut emissions the most since 1990", "floods in Pakistan", "CO₂ 100 years ago".
  - How it reads you: a built-in parser (no model, runs in the browser as you type) turns the question into a structured query: measures, countries, period, and the kind of answer. Periods can be years, ranges, decades, centuries, "last 20 years", "30 years ago until today" or "10,000 BC". Typos are corrected against the catalog's own words ("germny" → Germany) and shown. Its reading shows as chips you can correct (remove a country, change the period, switch lines/stacked or value/change), and the answer updates. Words it couldn't place are listed, never guessed at.
  - Maps: any per-country measure as a choropleth with a year slider and play button, one colour scale across all years so playback shows growth; or the change since a base year on a diverging scale. Hover for the value and rank, click a country to chart it, "Open on the main map" for the emissions and climate-action measures the dashboard map shows.
  - Charts: lines per unit; stacked areas for parts of a whole ("electricity mix", "emissions by fuel"); bars for a single year; the top N countries over time. When a vital sign's main record starts too late for the period asked (Mauna Loa in 1958, satellites in 1993), the older record of the same measure is added (ice cores, tide gauges, HadCRUT5, PAGES 2k), with a note.
  - What it answers: 52 measures (every explorer series, plus per-country emissions by gas and fuel, the electricity mix, low-carbon electricity, solar and wind capacity, electric car sales, net forest change, afforestation, protected land, tree-cover loss and fossil-fuel subsidies), country rankings by level, change or % change, and eight lists (attribution studies, disaster alerts, climate laws, COPs, records, eruptions, El Niño and La Niña episodes, pledges). Every series carries its evidence badge and source.
  - What it says: a chart per unit, a table of start, end, change, trend and extremes, and template sentences whose figures are all computed from the data, each with a "how this was computed" note. Claims are gated on the values: "peaked" only when the peak is inside the period and the end is at least 5% below it, "N times" only for ratio-scale measures in the same unit, a percentage only where the measure has a true zero (never for anomalies, and shares change in percentage points). Questions about causes or the future get a plain reply instead of a chart, and a link to the explorer's context notes.
  - Hand-off: "Open in explorer" carries the period, smoothing and series into the history explorer (with a second vital on the right axis); "Chart the top 5" turns a ranking into a comparison; list dates move the timeline.
  - Optional language models, for questions the parser can't read (low confidence or unknown words). Either one only fills in the same structured query, constrained by a JSON schema built from the catalog. It never sees or writes data; the dashboard runs the query and computes every figure.
    - **In the browser, free:** a visitor can turn on a small model (Qwen3.5 4B, Apache 2.0) that runs on their own GPU with WebLLM and WebGPU. Nothing is downloaded until they do; the offer names the size (2.4 GB, once; about 4 GB of GPU memory). It then reads the hard questions instead of Claude, and "Turn off the in-browser model" deletes it from the browser again. Needs WebGPU with 16-bit float shaders (current Chrome, Edge and Safari on desktop); the offer isn't shown otherwise.
    - **On the server, paid:** with Anthropic credentials, Claude reads them for everyone. See [Running it](#running-it).
- **Map** (MapLibre + deck.gl): opens as a slowly turning globe, its land drawn as a grid of dots (it stops at the first touch; a Globe/Flat switch keeps the flat map). Country dots are coloured by an emissions measure or a **climate-action** measure, chosen from one menu, on the timeline's year:
  - Emissions: total, per person, since 1850, consumption-based, all greenhouse gases.
  - Climate action: installed solar and wind capacity (IRENA), renewable and low-carbon shares of electricity, the electric share of new car sales (IEA), net forest change and afforestation (FAO), and protected land (UNEP-WCMC). One colour scale spans every year so moving the timeline shows growth; its top is the 99.5th percentile so one giant doesn't wash out everyone else. Net forest change is diverging (loss pink, gain green). FAO's afforestation comes every 5–10 years, so the map shows each country's latest figure up to ten years old and the tooltip names its year.
  - **Trade flows**: arcs from exporter to importer for clean technology (solar modules, lithium-ion batteries, electric cars, wind turbines), fossil fuels (crude oil, coal, LNG), or chips and what goes into them (hyper-pure silicon, doped wafers, helium and rare gases, hydrogen fluoride, chipmaking machines, integrated circuits), from UN Comtrade. Picking a chip good shows the chain from raw material to wafers, into the fabs and chips out, so one click moves along it. Arcs follow great circles and rise in proportion to their length; width is the value, and pulses run in the direction of trade. With no country selected the 60 largest routes show; click a country or a route to see all of one country's routes, with its export and import totals. A card states what the routes add up to: the top exporter's share of reported exports, the top three's share, the largest route, the like-for-like change on the year before, and any big exporter that doesn't report (its figures then come from its customers' import records). Hover a route for its value, its share of the exporter's exports and whose customs records it comes from. **Expand** fills the window with the map (Esc returns).
  - Also: tree-cover-loss tiles, the largest emitting facilities, attribution studies, disaster alerts, live fires and live natural events.
- **Connections graph** (Sigma v4, WebGL): built from the datasets. Fuels → CO₂ (with tonnes), gases → warming (with °C), top emitters → their main fuels, attribution studies → the countries they concern, COPs → hosts, laws → countries. Links show evidence: solid = documented, dashed = attributed by a study or assessment.
- **Industry & land**: ranked emitters, Carbon Majors producers (optional, see below), global CO₂ by fuel, electricity mix, tree-cover loss by driver, and **Action**: solar and wind capacity, the electric share of new cars, low-carbon electricity, and forests gained and lost, for the selected country (or the world), each with its latest figure and source.
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

The Ask bar works without any key. To let it hand hard questions to a language model, start the server with Anthropic credentials:

```bash
ANTHROPIC_API_KEY=… bun run dev      # or ASK_ENABLED=1 with an `ant auth login` profile
```

| Variable | Default | |
|---|---|---|
| `ASK_ENABLED` | on when a key is set | `0` turns the model off, `1` turns it on for a stored profile |
| `ASK_MODEL` | `claude-opus-5-5` | any model with structured outputs |
| `ASK_PER_MINUTE` | `20` | questions per minute across all visitors (each is a paid call) |

Only the question text and the catalog (measure names, units, coverage, country names) are sent; no data values.

The in-browser model needs no configuration. The server fetches its files from Hugging Face and GitHub on first use and keeps them in `data/llm/` (`LLM_CACHE_DIR`), so the browser still only talks to `/api`. Development servers also serve `/dev/local-model`, a harness for the evaluation below.

`bun scripts/eval-ask.ts` scores a reader on 19 questions the parser finds hard: `--parser` the parser alone (free), `--local [model ids]` the in-browser models through headless Brave or Chrome with WebGPU on port 9333, and no flag the server's Claude (19 paid calls). On an M1 Pro:

| Reader | Right alone | Right as used (parser where sure, model elsewhere) | Per question |
|---|---|---|---|
| Built-in parser | 10/19 | 10/19 | ~3 ms |
| Qwen3.5 4B in the browser (the default) | 17/19 | 17/19 | 4.3 s median; ~40 s for the first, which is processed when the Ask bar opens |
| Llama 3.2 3B in the browser | 11/19 | 12/19 | 7.7 s (full schema) |
| Qwen2.5 1.5B in the browser | 9/19 | 12/19 | 10.7 s (full schema) |
| Qwen3.5 2B in the browser | 6/19 | 10/19 | 14.7 s (full schema) |

Claude hasn't been scored here yet (it needs a key).

On first start the server downloads each source (≈ 40 MB in total, mostly OWID CSVs and the GDACS history) and caches the normalised result in `data/cache.sqlite`. After that, restarts serve from the cache immediately. No API keys are needed.

Trade flows are the exception to "immediately": UN Comtrade's keyless API allows about one call a second and a limited number of calls per half hour, and each traded good needs a dozen or so calls. The goods load one at a time (solar modules first), every answer is kept in the cache for six days, and a load stopped by the quota resumes from those answers 15 minutes later. Expect the first good within a few minutes and all thirteen within a few hours; the map's trade card says when the quota refills.

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
| Climate action | Our World in Data compilations of IRENA (solar and wind capacity), IEA Global EV Outlook (electric car sales), FAO Forest Resources Assessment (net forest change, afforestation), UNEP-WCMC/IUCN Protected Planet via the World Bank (protected land) | 1 week |
| Trade flows | UN Comtrade public API (no key): exports by partner from the largest exporters, imports by origin from the largest importers, HS codes 854143, 850760, 870380, 850231, 2709, 2701, 271111; chips: 280461, 381800, 280429, 281111, 848620, 8542 | 1 week |
| Country boundaries | Natural Earth (1:110m outlines; 1:50m label points, which include small states such as Singapore) | 4 weeks |
| Producer logos | Wikidata (matched by LEI, then by name): website favicon via Google's favicon service, else the Commons logo; nation states get their flag | with Carbon Majors |
| Country flags | `flag-icons` npm package (served locally) | n/a |
| In-browser model (optional, Ask bar) | WebLLM's prebuilt models from Hugging Face (`mlc-ai`) and their WebGPU kernels from GitHub (`mlc-ai/binary-mlc-llm-libs`), fetched and kept by the server in `data/llm/` | on first use |

### Derived, not hand-entered

- **Trade routes** (`sources/trade.ts`, `views/flows.ts`): for each good, the newest year whose number of reporting countries is at least 80% of the year before's. Its largest exporters (until they cover 85% of reported exports, at most six) give their exports by partner; its largest importers (until 70% of imports, at most four) give their imports by origin, which fill in routes from exporters that weren't read or don't report. A route from an exporter that was read always uses that exporter's own figure. Routes under 0.1% of reported world exports are dropped. The card's sentences are templates with every figure computed: shares are "of exports reported", the year-on-year change only counts countries that reported both years and says "rose", "fell" or "about flat" by its sign, and a non-reporting exporter is only named when its routes reach 1% of reported exports.
- **Records lane**: computed from the observations: every new warmest year since 1990 (HadCRUT5), the first calendar year above 1.5 °C, CO₂ crossing 350, 400 and 420 ppm, and new record-low Arctic sea-ice minima since 2000.
- **Pledge targets**: Climate Watch provides each NDC's target as text. `src/server/views/ndc-parse.ts` extracts a plottable number only from economy-wide % cuts against a base year, or "to X% of base-year levels". Intensity, peaking and business-as-usual targets are shown as text. Parser tests cover real target texts.
- **Study locations**: matched from country and region names in each WWA study's title and summary (`views/geocode.ts`). Studies without a place appear on the timeline but not the map.
- **Headlines and key facts** (`src/server/views/insights.ts`): sentence templates filled from the explorer's own series. Every figure, rank, date and record is computed, and a claim is only made when the data supports it: "speeding up" needs a higher recent rate, "higher than at any time in 800,000 years" needs the latest 12-month mean above the ice-core maximum, and "the N lowest minima were all in the last N years" is capped at half the record. A builder returns nothing when its inputs are too thin. Temperature facts use HadCRUT5 because it is on the 1850–1900 baseline; the 1.5 °C fact cites the Paris Agreement, Article 2.
- **Context notes** (`insights.ts`, `citations.ts`): the meaning and how-we-know lines are computed like the facts. Each "why it matters" line restates a passage of the IPCC AR6 WG1 Summary for Policymakers, stored verbatim in `citations.ts` with its paragraph and page; tests check that every number in such a line appears in its quote. Warming attributed to CO₂ comes from the IGCC data the carbon budget already uses.
- **Explorer reference lines**: computed from the data where possible. CO₂ "pre-industrial" is the mean of the ice-core samples dated 1700–1800, and "highest in 800,000 years" is the ice-core maximum before 1900. The sea-ice line is the 1981–2010 mean of yearly minima, and the 1.5 °C budget line is the cumulative emissions to the IGCC start year plus its remaining budget. The 1.5 °C and 2 °C temperature lines cite the Paris Agreement, Article 2. El Niño and La Niña episodes use NOAA's rule: five or more overlapping 3-month seasons at ±0.5 °C.
- **Carbon budget**: IGCC's remaining budget for a 50% chance of 1.5 °C (central parameter set; the range across sets is shown in the detail view). It is drawn down from 1 January of the year after the edition, at the latest annual CO₂ emissions in the same IGCC release.

### Optional and not-yet-connected sources

- **Carbon Majors** (InfluenceMap) needs a free login and is licensed for non-commercial use. Download the low-granularity emissions file from carbonmajors.org and drop it in `data/carbon-majors/`. Any file name works (browsers save it as `get_cm_file.html`); the loader picks the newest file with the Carbon Majors header. The folder is git-ignored so the data isn't redistributed. The Producers tab and the graph's producer nodes then fill in. The data is updated each November.
- **Language models for the Ask bar**: optional, see above. The in-browser model needs nothing on the server but disk space (about 1–3 GB per model in `data/llm/`, git-ignored); Claude needs Anthropic credentials. Without either, the built-in parser answers everything it can read.
- **Not connected** because they require tokens or licences: Climate Change Laws of the World / Climate Policy Radar (an app token; Wikidata is used instead, with partial coverage), Sabin Center litigation, InfluenceMap lobbying, EM-DAT, and ReliefWeb (approved app name). The Data sources panel lists each source's state.

## Architecture

```
src/
  shared/            Types and time maths used by both sides
    query.ts         Ask bar: catalog types, Intent → Query (buildQuery), validation, result types
    nl/              Ask bar: the deterministic question parser and its vocabulary; model.ts: what a model is told and may answer (schema, prompts, coercion, LOCAL_MODELS)
  server/
    index.ts         Bun.serve: API routes + the bundled SPA (HTML import)
    sources/         One module per upstream: fetch → parse → normalise
    lib/
      source-store   Caching, per-source schedules, dedupe, stale-on-error, optional sources
      cache          SQLite persistence (bun:sqlite), keyed by source id + payload version
      ask            Optional model reader: question → Intent, schema-constrained
      csv, http, text, wikidata, respond, stats, logger
    views/           Derived data: vitals, history, insights (headlines, key facts, context notes), citations (IPCC passages), emissions, flows (trade routes for the map), events, records, pledges, graph, geocoding, catalog + query (the Ask bar's measures and executor; the map reads per-country measures from it too)
    routes/api.ts    HTTP surface
    routes/llm.ts    The in-browser model's files: the WebLLM module, and an allowlisted, disk-cached proxy for model weights and kernels
  client/
    app/             Layout, header, error boundaries
    state/store.ts   Zustand: time cursor, selection, layers, metric
    api/queries.ts   TanStack Query hooks; refetch intervals match each source's cadence
    components/      Panel, charts, badges, modal
    features/        vitals · timeline · map · graph · industry · politics · sources · ask
tests/               bun test: CSV, time, source store, NDC parser, timeline clustering, explorer transforms, insights, Ask parser and executor
```

**Data flow.** The browser only talks to `/api`. The server owns every upstream request. When an upstream fails, the store keeps serving the last good payload, flags it stale and retries at a quarter of the normal interval. Each source declares a payload `version`; bump it when the shape changes so old cached payloads are ignored.

### Adding a data source

1. Create a module in `src/server/sources/` that exports `defineSource({ meta, load })`. `load()` returns `{ data, dataAsOf }`. Add `isConfigured` if the source needs a key or a manual download.
2. Add its id to `SourceId` and a payload type in `src/shared/types.ts`.
3. Register it in `src/server/sources/index.ts`. Caching and scheduling are then automatic.
4. To make it askable, add a measure to `MEASURE_DEFS` in `src/server/views/catalog.ts`: an id, labels, the phrases people use for it, and a loader. Coverage, units, countries and sources are read from the data.
5. Expose it in `PUBLIC_SOURCES` (`routes/api.ts`), or add a derived view under `views/`.
6. Add a query hook in `client/api/queries.ts`.

## Evidence badges

- ● **observed**: measured by instruments
- ◐ **modelled**: reanalysis, models, assessments (IGCC, WWA, GDACS, Climate TRACE)
- ○ **reported**: registries, inventories and disclosures (OWID, Climate Watch, Wikidata)
- ◆ **curated**: hand-assembled. The four IPCC links in the graph and the IPCC passages behind the explorer's context notes.

## Known data caveats

- Trade values are what customs declare, in current US dollars: exporters' figures are FOB, importers' (used for non-reporting exporters) are CIF, so the two sides differ by freight and insurance. Re-exports count, so hubs such as the Netherlands, Belgium and Singapore appear as exporters of goods they don't make. Countries report months apart; the latest year is used only once most have reported. Solar modules have their own code only from HS 2022, so countries still reporting in older HS versions are missing for that good.
- Chip goods are customs headings, not chip-only products. Hyper-pure silicon (HS 280461) feeds solar wafers as well as chip wafers; hydrogen fluoride (281111) has many uses; HS 280429 counts helium together with neon, krypton and xenon, so it can't show neon alone. Taiwan doesn't report to UN Comtrade, so its exports (chips and wafers above all) appear only as recorded by the largest importers, and its share isn't in the "of exports reported" figures. Hong Kong and Singapore re-export a large share of chips.
- The map shows the largest routes, not all trade: the routes read cover the largest exporters and importers, and small routes are dropped.
- FAO forest figures are yearly averages over each assessment period (e.g. 2021–2025), so neighbouring years repeat. The IEA's electric share of new cars includes plug-in hybrids.

- Climate Watch's summary of Russia's 2035 target reads "reducing … by 65–67% compared to 1990". Russia's NDC states emissions at 65–67% *of* 1990 levels. The dashboard plots the source text as given.
- Tree-cover loss is gross loss, including plantations, with regrowth not netted off.
- Pledge actuals are OWID total GHG including land use, which can differ from national inventories.
- NOAA's satellite sea-level file can lag by a year or more.
- WWA study dates are publication dates; the events are usually days to weeks earlier.
- GDACS alert levels estimate humanitarian impact. They say nothing about climate attribution.

## Tech notes

- The in-browser model (`client/features/ask/localModel.ts`) is WebLLM 0.2.88, loaded from `/api/llm/web-llm/index.js` by a dynamic import, so its 7 MB stay out of the app bundle. Its prompt (`compactPrompt` in `shared/nl/model.ts`) leaves out the country list to fit a small context and names the parser's countries in the question's turn instead. WebLLM only reuses its KV cache when a request continues the previous conversation, so every question is appended to one session (context raised to 8,192 tokens, restarted before it fills): the prompt is processed once (~40 s for the 4B model) instead of per question. Replies are held to the schema by WebLLM's grammar, which costs about five times more per token than free decoding but was more accurate for every model tried; the "brief" schema keeps replies short by requiring only kind, measures, countries and years. Answers can vary slightly with what is already in the session.
- The model proxy (`server/routes/llm.ts`) only fetches the files of models in `LOCAL_MODELS` and their WebGPU kernels, writes each to a part file while streaming it, and keeps it only when complete. It doesn't use `body.tee()`: with Bun 1.2, writing a tee'd branch to disk never finishes.

- The map is a MapLibre globe (`projection: globe`) with deck.gl interleaved. deck picks its MapView or GlobeView on MapLibre's `styledata` event, which `setProjection` doesn't fire, so switching Globe/Flat fires it by hand. Country polygons are triangulated flat by deck, so on the globe a large country's triangles dip under the sphere and fail the depth test; the choropleth draws with `depthCompare: always` and back-face culling instead, which still hides the far side.
- Trade arcs are deck `PathLayer`s over our own great-circle vertices with altitude (`features/map/arcs.ts`, tested), and the pulses are short path segments rebuilt each frame in `AnimatedDeck.tsx`, so only that component re-renders at 30 fps. `@deck.gl/geo-layers`' TripsLayer would do the same, but the package can only be imported whole and brings Node polyfills into the browser bundle. Motion is off under `prefers-reduced-motion`, and pauses while the map is hidden.
- The globe's look: Carto's dark-matter basemap repainted on load (`features/map/basemap.ts`), land drawn as about 20,000 dots on a 0.7° grid (`dots.ts`, spacing widened by 1/cos(latitude) so dots sit equally far apart on the ground), each dot coloured by its country's value, over a faint polygon tint that takes hover and click. Arcs, their ends and the pulses are a wide translucent glow plus a bright core, blended additively so crossing routes brighten.

- MapLibre is pinned to 5.x. deck.gl 9.4's interleaved mode reads a MapLibre internal that changed in v6.
- `DeckOverlay` attaches one overlay per map instance itself. `useControl` under React StrictMode re-adds the overlay and deck throws "WebGL context already attached".
- Sigma's dashed-edge shader drops gap-0 patterns, so solid edges are dashes with their gaps painted in (`gapColor`).
- Panels subscribe to the whole cursor year (`useCursorYear`), not the continuous value, so dragging and playback re-render only the timeline each frame. Playback runs at about 60 fps on a GPU. Headless browsers that render WebGL in software are much slower.
