import { useMemo } from "react";
import type { HistorySeries, OverlayId, TimelineKind, VitalHistory, VitalId, VitalSign } from "@shared/types.ts";
import { useClimateContext, useHistory, useTimeline, useVitals } from "../../api/queries.ts";
import { EvidenceBadge } from "../../components/EvidenceBadge.tsx";
import { PanelState } from "../../components/Panel.tsx";
import { Segmented } from "../../components/Segmented.tsx";
import { SERIES } from "../../lib/colors.ts";
import { formatAsOf, formatNumber } from "../../lib/format.ts";
import { type ExplorerSettings, nowYear, useDashboard } from "../../state/store.ts";
import { useLiveValue } from "../vitals/useLiveBudget.ts";
import { type ChartSeries, type CompareSeries, HistoryChart } from "./HistoryChart.tsx";
import { Overview } from "./Overview.tsx";
import { STEP, annualMeans, clip, maxGapFor, ratePerYear, runningMean, toCsv } from "./transform.ts";
import "./explorer.css";

const OVERLAY_INFO: Record<OverlayId, { label: string; hint: string; from?: number }> = {
  references: { label: "Reference lines", hint: "Baselines and thresholds. Hover a line for where it comes from." },
  uncertainty: { label: "Uncertainty ranges", hint: "Shaded ranges around the reconstructions and Berkeley Earth." },
  trend: { label: "Trend", hint: "Least-squares fit to the main series in view. Zoom to change the period." },
  enso: { label: "El Niño / La Niña", hint: "Red when the Pacific was in El Niño, blue in La Niña. El Niño years run hot.", from: 1950 },
  volcanoes: { label: "Large eruptions", hint: "VEI 5 and above. Big eruptions cool the planet for a year or two.", from: 1800 },
  events: { label: "Timeline events", hint: "The same records, COPs, laws and studies as the timeline below.", from: 1850 },
};
const EVENT_KINDS: { kind: TimelineKind; label: string }[] = [
  { kind: "record", label: "Records" },
  { kind: "cop", label: "COPs" },
  { kind: "law", label: "Laws" },
  { kind: "attribution", label: "Studies" },
];
const SMOOTHING = [
  { value: "0", label: "Off" },
  { value: "1", label: "1 yr" },
  { value: "5", label: "5 yr" },
  { value: "10", label: "10 yr" },
  { value: "30", label: "30 yr" },
];
const COMPARE_LABEL: Record<VitalId, string> = {
  co2: "CO₂",
  temperature: "Global temperature",
  era5: "Daily air temperature",
  seaIce: "Arctic sea ice",
  seaLevel: "Sea level",
  oceanHeat: "Ocean heat",
  carbonBudget: "Cumulative CO₂",
};
const COMPARE_COLOR = "#c3c9d1";

export function defaultSettings(h: VitalHistory): ExplorerSettings {
  return {
    rangeId: h.defaultRange,
    window: null,
    overlays: h.defaultOverlays,
    eventKinds: ["record", "cop"],
    visible: {},
    smoothing: 0,
    display: "values",
    scale: "linear",
    mode: h.defaultMode ?? "timeline",
    compare: null,
  };
}

/** Colours by role, so the instrumental record is always blue and proxies always warm. */
function assignColors(series: HistorySeries[]): Map<string, string> {
  const pools: Record<HistorySeries["role"], string[]> = {
    primary: [SERIES[0]],
    alternative: [SERIES[2], SERIES[4], SERIES[1], SERIES[5]],
    reconstruction: [SERIES[3], SERIES[6], SERIES[7]],
    projection: [SERIES[0]],
  };
  const used: Record<string, number> = {};
  const out = new Map<string, string>();
  for (const s of series) {
    const pool = pools[s.role];
    const i = used[s.role] ?? 0;
    used[s.role] = i + 1;
    out.set(s.id, pool[i % pool.length]!);
  }
  return out;
}

/** Values → change per year → running mean, in that order. Bands survive only untransformed. */
function transform(s: HistorySeries, settings: ExplorerSettings) {
  let points = s.points;
  let resolution = s.resolution;
  let band = s.band;
  if (settings.display === "change") {
    points = ratePerYear(points, resolution);
    if (STEP[resolution] < 1) resolution = "annual";
    band = undefined;
  }
  if (settings.smoothing > STEP[resolution] * 1.5) {
    points = runningMean(points, settings.smoothing);
    band = undefined;
  }
  return { points, resolution, band };
}

export function VitalExplorer({ id }: { id: VitalId }) {
  const { data: history, isLoading, isError } = useHistory(id);
  const { data: vitals } = useVitals();
  if (isLoading) return <div className="panel xp"><PanelState status="loading" /></div>;
  if (isError || !history) return <div className="panel xp"><PanelState status="error" /></div>;
  if (history.series.length === 0)
    return (
      <div className="panel xp">
        <PanelState status="empty" message="None of this measure’s sources could be reached. Try again shortly." />
      </div>
    );
  return <Explorer key={id} history={history} vital={vitals?.find((v) => v.id === id)} />;
}

function Explorer({ history, vital }: { history: VitalHistory; vital: VitalSign | undefined }) {
  const now = useMemo(() => nowYear(), []);
  const defaults = useMemo(() => defaultSettings(history), [history]);
  const settings = useDashboard((s) => s.explorer[history.id]) ?? defaults;
  const setExplorer = useDashboard((s) => s.setExplorer);
  const update = (patch: Partial<ExplorerSettings>) => setExplorer(history.id, patch, defaults);
  const cursor = useDashboard((s) => s.year);
  const setYear = useDashboard((s) => s.setYear);
  const overlays = new Set(settings.overlays);
  const wantsContext = settings.overlays.some((o) => o === "enso" || o === "volcanoes");
  const { data: context } = useClimateContext(wantsContext || history.overlays.includes("enso"));
  const { data: timeline } = useTimeline();
  const compareHistory = useHistory(settings.compare).data;

  const colors = useMemo(() => assignColors(history.series), [history]);
  const primary = history.series.find((s) => s.role === "primary") ?? history.series[0]!;
  const dataMin = Math.min(...history.series.map((s) => s.points[0]?.[0] ?? now));
  const end = Math.max(now, ...history.series.map((s) => s.points.at(-1)?.[0] ?? now));
  const range = history.ranges.find((r) => r.id === settings.rangeId) ?? history.ranges[0]!;
  const win: [number, number] = settings.window ?? [Math.max(range.from, dataMin), end];
  const canLog = dataMin < now - 500;
  const scale = canLog ? settings.scale : "linear";
  const canSeasonal = primary.resolution === "daily" || primary.resolution === "monthly";
  const mode = canSeasonal && settings.display === "values" ? settings.mode : "timeline";

  const clampWindow = ([a, b]: [number, number]): [number, number] => {
    const minSpan = mode === "seasonal" ? 1 : Math.max(STEP[primary.resolution] * 6, 0.05);
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    if (hi - lo < minSpan) {
      const mid = (lo + hi) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    const span = Math.min(hi - lo, end - dataMin);
    if (lo < dataMin) (lo = dataMin), (hi = dataMin + span);
    if (hi > end) (hi = end), (lo = end - span);
    if (scale === "log") hi = Math.min(hi, now);
    return [lo, hi];
  };
  const setWindow = (w: [number, number]) => update({ window: clampWindow(w) });

  const chartSeries: ChartSeries[] = useMemo(
    () =>
      history.series
        .filter((s) => (settings.visible[s.id] ?? s.visible) && !(settings.display === "change" && s.resolution === "multiYear"))
        .map((s) => {
          const t = transform(s, settings);
          return {
            id: s.id,
            label: s.label,
            color: colors.get(s.id)!,
            role: s.role,
            resolution: t.resolution,
            points: t.points,
            band: t.band,
            maxGap: maxGapFor({ resolution: t.resolution }),
          };
        }),
    [history, settings, colors],
  );

  const compare: CompareSeries | null = useMemo(() => {
    if (!compareHistory || compareHistory.id === history.id) return null;
    const p = compareHistory.series.find((s) => s.role === "primary") ?? compareHistory.series[0];
    if (!p) return null;
    const base = STEP[p.resolution] < 1 ? { ...p, points: annualMeans(p.points, p.resolution), resolution: "annual" as const } : p;
    const t = transform(base, settings);
    return {
      label: `${compareHistory.label} (right axis)`,
      unit: settings.display === "change" ? `${compareHistory.unit.split(" ")[0]}/yr` : compareHistory.unit,
      decimals: compareHistory.decimals,
      color: COMPARE_COLOR,
      points: t.points,
    };
  }, [compareHistory, history.id, settings]);

  const unit = settings.display === "change" ? `${history.unit.split(" ")[0]} per year` : history.unit;
  const overviewExtent: [number, number] = [Math.min(Math.max(range.from, dataMin), win[0]), end];

  const toggleOverlay = (o: OverlayId) =>
    update({ overlays: overlays.has(o) ? settings.overlays.filter((x) => x !== o) : [...settings.overlays, o] });
  const toggleSeries = (s: HistorySeries) => update({ visible: { ...settings.visible, [s.id]: !(settings.visible[s.id] ?? s.visible) } });
  const zoomBy = (f: number) => {
    const mid = (win[0] + win[1]) / 2;
    const half = ((win[1] - win[0]) / 2) * f;
    setWindow([mid - half, mid + half]);
  };

  const download = () => {
    const rows = chartSeries.map((s) => ({ label: s.label, points: clip(s.points, win[0], win[1]).filter(([t]) => t >= win[0] && t <= win[1]) }));
    const blob = new Blob([toCsv(rows, unit)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${history.id}-${Math.round(win[0])}-${Math.round(win[1])}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const span = win[1] - win[0];
    const step = span * (e.shiftKey ? 0.5 : 0.1);
    if (e.key === "ArrowLeft") setWindow([win[0] - step, win[1] - step]);
    else if (e.key === "ArrowRight") setWindow([win[0] + step, win[1] + step]);
    else if (e.key === "+" || e.key === "=") zoomBy(0.7);
    else if (e.key === "-") zoomBy(1 / 0.7);
    else if (e.key === "0" || e.key === "Home") update({ window: null });
    else return;
    e.preventDefault();
  };

  const inView = (from?: number) => from === undefined || win[1] >= from;

  return (
    <section className="panel xp" aria-label={`${history.label}: history explorer`}>
      <header className="xp-head">
        <Hero vital={vital} history={history} />
        <div className="xp-head__tools">
          <div className="segmented" role="radiogroup" aria-label="Time range">
            {history.ranges.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={settings.window === null && r.id === settings.rangeId}
                className={settings.window === null && r.id === settings.rangeId ? "is-active" : undefined}
                onClick={() => update({ rangeId: r.id, window: null })}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="xp-zoom" role="group" aria-label="Zoom">
            <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 0.6)} aria-label="Zoom out" title="Zoom out (−)">
              −
            </button>
            <button type="button" className="icon-btn" onClick={() => zoomBy(0.6)} aria-label="Zoom in" title="Zoom in (+)">
              +
            </button>
            <button type="button" className="icon-btn" onClick={() => update({ window: null })} disabled={settings.window === null} title="Back to the selected range (0)">
              Reset
            </button>
          </div>
        </div>
      </header>

      <div className="xp-toolbar" role="toolbar" aria-label="Chart tools">
        {canSeasonal && (
          <Field label="View">
            <Segmented
              label="View"
              value={mode}
              onChange={(v) => update({ mode: v, display: "values" })}
              options={[
                { value: "timeline", label: "Timeline" },
                { value: "seasonal", label: "By year", title: "Lay every year over the same calendar" },
              ]}
            />
          </Field>
        )}
        <Field label="Smoothing">
          <Segmented label="Smoothing" value={String(settings.smoothing)} options={SMOOTHING} onChange={(v) => update({ smoothing: Number(v) })} />
        </Field>
        <Field label="Show">
          <Segmented
            label="Show"
            value={settings.display}
            onChange={(v) => update({ display: v, mode: v === "change" ? "timeline" : settings.mode })}
            options={[
              { value: "values", label: "Values" },
              { value: "change", label: "Change / yr", title: "Year-on-year change, from calendar-year means" },
            ]}
          />
        </Field>
        {canLog && mode === "timeline" && (
          <Field label="Time axis">
            <Segmented
              label="Time axis"
              value={scale}
              onChange={(v) => update({ scale: v, window: settings.window && v === "log" ? [settings.window[0], Math.min(settings.window[1], now)] : settings.window })}
              options={[
                { value: "linear", label: "Linear" },
                { value: "log", label: "Log", title: "Logarithmic in years ago: deep time and the last century both get room" },
              ]}
            />
          </Field>
        )}
        {mode === "timeline" && (
          <Field label="Compare">
            <select
              className="select"
              value={settings.compare ?? ""}
              onChange={(e) => update({ compare: (e.target.value || null) as VitalId | null })}
              aria-label="Compare with another measure"
            >
              <option value="">Nothing</option>
              {(Object.keys(COMPARE_LABEL) as VitalId[])
                .filter((v) => v !== history.id)
                .map((v) => (
                  <option key={v} value={v}>
                    {COMPARE_LABEL[v]}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <button type="button" className="btn xp-download" onClick={download} title="The visible series and period, as shown">
          Download CSV
        </button>
      </div>

      <div className="xp-body">
        <div className="xp-main" tabIndex={0} onKeyDown={onKeyDown} aria-label="Chart. Arrow keys pan, plus and minus zoom, 0 resets.">
          <HistoryChart
            series={chartSeries}
            compare={mode === "timeline" ? compare : null}
            window={win}
            scale={scale}
            mode={mode}
            now={now}
            unit={unit}
            decimals={history.decimals}
            overlays={settings.display === "change" ? new Set([...overlays].filter((o) => o !== "references")) : overlays}
            available={history.overlays}
            references={history.references}
            enso={context?.enso?.episodes ?? []}
            volcanoes={context?.volcanoes ?? []}
            events={timeline?.events ?? []}
            eventKinds={settings.eventKinds}
            acceleration={!!history.acceleration && settings.display === "values"}
            cursor={cursor}
            onPan={setWindow}
            onZoom={setWindow}
            onReset={() => update({ window: null })}
            onPickYear={(t) => t >= 1850 && t <= now && setYear(t)}
          />
          <Overview series={chartSeries} extent={overviewExtent} window={win} scale={scale} now={now} onChange={setWindow} />
          <p className="xp-hint muted">
            {mode === "seasonal"
              ? `Each line is one year, ${Math.floor(win[0])}–${Math.floor(win[1])}; the latest is orange. Drag the strip below to pick the years.`
              : "Drag to pan · scroll to zoom · shift-drag to zoom to a period · double-click to reset · click to move the timeline"}
          </p>
        </div>

        <aside className="xp-side">
          <section>
            <h3 className="xp-side__title">Data</h3>
            <ul className="xp-list">
              {history.series.map((s) => {
                const on = settings.visible[s.id] ?? s.visible;
                const blocked = settings.display === "change" && s.resolution === "multiYear";
                const why = blocked ? "Hidden in Change / yr: each value averages decades or centuries, so a yearly change is not meaningful." : null;
                return (
                  <li key={s.id}>
                    <label
                      className={`xp-toggle${on && !blocked ? "" : " is-off"}`}
                      title={[why, s.note, `${s.source.name} · ${s.source.publisher}`].filter(Boolean).join("\n")}
                    >
                      <input type="checkbox" checked={on && !blocked} disabled={blocked} onChange={() => toggleSeries(s)} />
                      <span className={`xp-key xp-key--${s.role}`} style={{ color: colors.get(s.id) }} />
                      <span className="xp-toggle__label">{s.label}</span>
                      <EvidenceBadge evidence={s.evidence} compact />
                      <span className="xp-toggle__span muted mono">{spanLabel(s)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="xp-side__title">Context</h3>
            {mode === "seasonal" && <p className="muted xp-side__note">Context layers apply to the timeline view.</p>}
            <ul className="xp-list">
              {history.overlays.map((o) => {
                const info = OVERLAY_INFO[o];
                const disabled = mode === "seasonal" || (o === "references" && settings.display === "change");
                return (
                  <li key={o}>
                    <label className={`xp-toggle${overlays.has(o) && !disabled ? "" : " is-off"}`} title={info.hint}>
                      <input type="checkbox" checked={overlays.has(o)} disabled={disabled} onChange={() => toggleOverlay(o)} />
                      <span className={`xp-swatch xp-swatch--${o}`} />
                      <span className="xp-toggle__label">
                        {o === "trend" && history.acceleration ? "Trend and acceleration" : info.label}
                      </span>
                      {!inView(info.from) && <span className="muted xp-toggle__span">from {info.from}</span>}
                    </label>
                    {o === "events" && overlays.has("events") && !disabled && (
                      <div className="xp-chips">
                        {EVENT_KINDS.map((k) => {
                          const active = settings.eventKinds.includes(k.kind);
                          return (
                            <button
                              key={k.kind}
                              type="button"
                              className={`xp-chip${active ? " is-active" : ""}`}
                              aria-pressed={active}
                              onClick={() =>
                                update({ eventKinds: active ? settings.eventKinds.filter((x) => x !== k.kind) : [...settings.eventKinds, k.kind] })
                              }
                            >
                              <svg width="8" height="8" aria-hidden="true">
                                <circle cx="4" cy="4" r="3" className={`tl-glyph tl-glyph--${k.kind}`} />
                              </svg>
                              {k.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="xp-side__title">About</h3>
            <p className="xp-side__text">{history.explainer}</p>
            {vital?.method && <p className="xp-side__text muted">{vital.method}</p>}
            <ul className="xp-sources">
              {[...new Map(history.series.map((s) => [s.source.url, s.source])).values()].map((src) => (
                <li key={src.url}>
                  <a href={src.url} target="_blank" rel="noreferrer">
                    {src.name}
                  </a>
                  <span className="muted"> · {src.publisher}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}

function Hero({ vital, history }: { vital: VitalSign | undefined; history: VitalHistory }) {
  const live = useLiveValue(vital?.live);
  const value = live ?? vital?.value ?? null;
  return (
    <div className="xp-hero">
      <h2 className="xp-hero__title">{history.label}</h2>
      {vital && (
        <div className="xp-hero__value">
          <span className="xp-hero__number mono">{formatNumber(value, live !== null ? 3 : vital.decimals)}</span>
          <span className="vital__unit">{vital.unit}</span>
          <EvidenceBadge evidence={vital.evidence} compact />
          <span className="muted xp-hero__context">
            {vital.context ? `${vital.context} · ` : ""}as of {formatAsOf(vital.asOf)}
          </span>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="xp-field">
      <span className="xp-field__label">{label}</span>
      {children}
    </div>
  );
}

function spanLabel(s: HistorySeries): string {
  const a = s.points[0]?.[0];
  const b = s.points.at(-1)?.[0];
  if (a === undefined || b === undefined) return "";
  const f = (t: number) => (t < -20_000 ? `${Math.round((1950 - t) / 1000)}k BP` : t < 0.5 ? `${Math.round(1 - t)} BCE` : String(Math.floor(t)));
  return `${f(a)}–${f(b)}`;
}
