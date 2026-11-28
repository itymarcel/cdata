import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, Intent, MeasureGroup } from "@shared/query.ts";
import { emptyIntent } from "@shared/query.ts";
import { parse } from "@shared/nl/parse.ts";
import { LOCAL_MODELS } from "@shared/nl/model.ts";
import { useCatalog } from "../../api/queries.ts";
import { nowYear, useDashboard } from "../../state/store.ts";
import { AskResult, type ResultActions } from "./AskResult.tsx";
import { Chips } from "./Chips.tsx";
import { checkLocalModel, localModelChosen, turnOffLocalModel, useLocalModel, warmLocalModel } from "./localModel.ts";
import { readRecent, useAsk } from "./useAsk.ts";
import "./ask.css";

const EXAMPLES = [
  "CO₂ emissions on a map",
  "Germany vs France CO₂ per person since 1990",
  "Electricity mix in Germany",
  "Map of emissions change since 1990",
  "Chart the top 5 emitters since 1990",
  "Top 10 emitters",
  "Which countries cut emissions the most since 1990",
  "Arctic sea ice minimum, last 20 years",
  "Solar vs wind electricity in China since 2010",
  "Floods in Pakistan",
  "CO₂ from ice cores, last 800,000 years",
  "Global temperature 10-year average since 1850",
  "Solar share by country",
  "El Niño episodes since 2000",
];

const GROUP_LABEL: Record<MeasureGroup, string> = {
  vital: "Vital signs",
  atmosphere: "Atmosphere",
  ocean: "Ocean",
  emissions: "Emissions (per country)",
  energy: "Electricity mix (per country)",
  action: "Climate action (per country)",
  land: "Land (per country)",
  finance: "Finance (per country)",
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const ASK_SHORTCUT = isMac ? "⌘K" : "Ctrl K";

/** Opens the Ask bar on ⌘K / Ctrl+K anywhere, or "/" when not typing. */
export function useAskShortcut() {
  const setAskOpen = useDashboard((s) => s.setAskOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAskOpen(!useDashboard.getState().askOpen);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setAskOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setAskOpen]);
}

/** Catalog names that complete the word being typed. */
function completions(text: string, catalog: Catalog | undefined): string[] {
  if (!catalog) return [];
  const m = /(?:^|\s)([^\s]{2,})$/.exec(text);
  if (!m) return [];
  const frag = m[1]!.toLowerCase();
  const out = new Set<string>();
  const consider = (name: string) => {
    const n = name.toLowerCase();
    if (n !== frag && (n.startsWith(frag) || n.includes(` ${frag}`)) && out.size < 6) out.add(name);
  };
  for (const c of catalog.countries) if (c.iso3 !== "WLD") consider(c.name);
  for (const mm of catalog.measures) consider(mm.short);
  for (const l of catalog.lists) consider(l.label);
  return [...out];
}

export function AskBar() {
  useAskShortcut();
  const open = useDashboard((s) => s.askOpen);
  const setAskOpen = useDashboard((s) => s.setAskOpen);
  const setExplorerPanel = useDashboard((s) => s.setExplorerPanel);
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { data: catalog, isError: catalogError } = useCatalog(open);
  const [text, setText] = useState("");
  const [ran, setRan] = useState("");
  const close = useCallback(() => setAskOpen(false), [setAskOpen]);
  const { state, submit, runIntent, askTheModel, askLocally, openInExplorer } = useAsk(catalog, close);
  const year = useMemo(() => Math.floor(nowYear()), []);
  const local = useLocalModel();
  const localLabel = LOCAL_MODELS.find((m) => m.id === local.model)?.label ?? local.model;
  const localOn = local.status.state === "ready" || local.status.state === "loading" || localModelChosen();

  useEffect(() => {
    if (open) void checkLocalModel();
  }, [open]);
  // A visitor who turned the model on gets its prompt processed while they type.
  useEffect(() => {
    if (open && catalog && local.status.state !== "unsupported" && local.status.state !== "unknown") warmLocalModel(catalog, year);
  }, [open, catalog, local.status.state, year]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      requestAnimationFrame(() => input.current?.select());
    }
    if (!open && d.open) d.close();
  }, [open]);

  const preview = useMemo(() => (catalog && text.trim() ? parse(text, catalog, year) : null), [catalog, text, year]);
  // The live reading ignores a half-typed last word ("germany vs fra") until it's finished.
  const livePreview = useMemo(() => {
    if (!catalog || !preview || /\s$/.test(text)) return preview;
    const last = text.match(/(\S+)$/)?.[1]?.toLowerCase() ?? "";
    if (!preview.unread.length || !last.endsWith(preview.unread.at(-1)!)) return preview;
    const rest = text.replace(/\S+$/, "");
    return rest.trim() ? parse(rest, catalog, year) : null;
  }, [catalog, preview, text, year]);
  const complete = useMemo(() => completions(text, catalog), [text, catalog]);
  const stale = text.trim() !== ran.trim();

  const go = (t = text) => {
    if (!t.trim()) return;
    setText(t);
    setRan(t);
    submit(t, t === text ? preview : null);
  };
  const accept = (name: string) => {
    setText((t) => t.replace(/[^\s]+$/, `${name} `));
    input.current?.focus();
  };
  const edit = (next: Intent) => {
    setRan(text);
    void runIntent(next, state.via ?? "parser");
  };

  const actions: ResultActions = {
    openInExplorer: (view, compare) => {
      const q = state.query;
      if (!catalog || q?.kind !== "series") return;
      void openInExplorer({ view, series: q.series, span: q.span, smoothing: q.smoothing, display: q.display, compare }, catalog).then(close);
    },
    chartCountries: (measure, iso3s, span) => {
      void runIntent({ ...emptyIntent(), kind: "series", measures: [measure], countries: iso3s, from: span[0], to: span[1] }, state.via ?? "parser");
    },
    rankCountries: (measure, by, base, year) => {
      void runIntent({ ...emptyIntent(), kind: "rank", measures: [measure], rankBy: by, from: by === "value" ? year : base, to: year }, state.via ?? "parser");
    },
    close,
  };

  const showLive = !!preview && (stale || state.status === "idle");
  const reading = showLive ? (livePreview?.understood ? livePreview.intent : null) : state.intent;
  const unread = showLive ? (livePreview?.unread ?? []) : state.unread;
  const corrections = showLive ? (livePreview?.corrections ?? []) : state.corrections;
  const answered = !showLive && !!state.result;
  const noAnswer = !showLive && state.status === "done" && state.intent?.kind === "unsupported" && (state.intent.reason === "not_in_data" || state.intent.reason === "unclear");

  return (
    <dialog ref={ref} className="ask" onClose={close} onClick={(e) => e.target === ref.current && close()} aria-label="Ask the data">
      <form
        className="ask-input"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="ask-input__icon">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && complete.length) {
              e.preventDefault();
              accept(complete[0]!);
            }
          }}
          placeholder="Ask the data: “Germany vs France CO₂ per person since 1990”"
          aria-label="Ask the data"
          aria-describedby="ask-help"
          autoComplete="off"
          spellCheck={false}
        />
        {state.status === "running" && <span className="spinner" role="status" aria-label="Working" />}
        <kbd className="ask-kbd">esc</kbd>
      </form>

      {complete.length > 0 && (
        <div className="ask-complete" aria-label="Completions">
          <span className="muted">Tab</span>
          {complete.map((c) => (
            <button key={c} type="button" onClick={() => accept(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {catalog && reading && (
        <div className="ask-reading">
          <Chips intent={reading} catalog={catalog} onChange={edit} live={!!showLive} />
          {showLive && <span className="muted ask-reading__hint">↵ to run</span>}
        </div>
      )}

      <div className="ask-body" aria-live="polite">
        {catalogError && <p className="ask-error">The catalog couldn’t be loaded. Is the server running?</p>}
        {!catalog && !catalogError && open && <p className="muted">Loading what you can ask about…</p>}

        {corrections.length > 0 && (showLive || state.status !== "idle") && (
          <p className="ask-corrected">Read {corrections.map(([a, b]) => `“${a}” as “${b}”`).join(", ")}.</p>
        )}
        {unread.length > 0 && (showLive || state.status !== "idle") && (
          <p className={answered ? "ask-ignored" : "ask-unread"}>
            {answered ? "Ignored" : "Not understood"}: {unread.map((w) => `“${w}”`).join(", ")}.{" "}
            {!showLive && state.via === "parser" && (localOn || local.status.state === "off") && (
              <button type="button" className="btn" onClick={() => askLocally(text)}>
                {localOn ? "Ask the in-browser model" : `Read it with an in-browser model${local.size ? ` (${formatBytes(local.size)} download, once)` : ""}`}
              </button>
            )}{" "}
            {catalog?.askAvailable && !showLive && state.via === "parser" && (
              <button type="button" className="btn" onClick={() => askTheModel(text)}>
                Ask the model instead
              </button>
            )}
          </p>
        )}

        {state.status === "running" && state.via === "local" && local.status.state === "loading" && (
          <p className="muted ask-local" role="status">
            Loading {localLabel} into this browser: {Math.round(local.status.progress * 100)}%. The first time this downloads the model; later visits load it from the browser’s cache.
          </p>
        )}

        {!showLive && state.notes.length > 0 && (
          <ul className="ask-notes">
            {state.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        {!showLive && state.status === "done" && state.intent?.kind === "unsupported" && state.intent.reason === "explanation" && state.intent.relatedVital && catalog && (
          <p>
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                setExplorerPanel("facts");
                void openInExplorer({ view: state.intent!.relatedVital!, series: [], span: [null, null], smoothing: 0, display: "values" }, catalog).then(close);
              }}
            >
              Open the explorer’s key facts and context notes
            </button>
          </p>
        )}

        {!showLive && state.status === "error" && <p className="ask-error">{state.error}</p>}

        {!showLive && state.result && catalog && <AskResult key={JSON.stringify(state.query)} result={state.result} query={state.query} catalog={catalog} actions={actions} />}

        {catalog && ((!text.trim() && state.status === "idle") || noAnswer) && <Start catalog={catalog} onPick={go} onInsert={(s) => setText(s)} />}
      </div>

      <footer className="ask-foot" id="ask-help">
        <span>
          <kbd className="ask-kbd">↵</kbd> ask <kbd className="ask-kbd">tab</kbd> complete <kbd className="ask-kbd">esc</kbd> close
        </span>
        <span className="muted">
          {state.via === "model" && !showLive
            ? "Read by a language model. Every figure is computed by the dashboard from the cited data."
            : state.via === "local" && !showLive && state.status !== "running"
              ? `Read by ${localLabel}, running in this browser. Every figure is computed by the dashboard from the cited data.`
              : "Read by the built-in parser. Every figure is computed from the cited data."}
          {localOn && (
            <>
              {" "}
              <button type="button" className="ask-link" onClick={() => void turnOffLocalModel(true)} title={`Stops ${localLabel} and deletes its files from this browser`}>
                Turn off the in-browser model
              </button>
            </>
          )}
        </span>
      </footer>
    </dialog>
  );
}

const formatBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

function Start({ catalog, onPick, onInsert }: { catalog: Catalog; onPick: (t: string) => void; onInsert: (t: string) => void }) {
  const recent = useMemo(() => readRecent(), []);
  const groups = useMemo(() => {
    const m = new Map<MeasureGroup, Catalog["measures"]>();
    for (const x of catalog.measures) m.set(x.group, [...(m.get(x.group) ?? []), x]);
    return [...m.entries()];
  }, [catalog]);
  const yr = (t: number) => (t >= 1 ? String(Math.floor(t)) : t < -48_000 ? `${Math.round((nowYear() - t) / 1000).toLocaleString("en")}k yrs ago` : `${Math.round(1 - t).toLocaleString("en")} BCE`);
  return (
    <div className="ask-start">
      <section>
        <h4>Try</h4>
        <ul className="ask-examples">
          {[...recent.map((r) => ({ r, recent: true })), ...EXAMPLES.filter((e) => !recent.includes(e)).map((r) => ({ r, recent: false }))].slice(0, 10).map(({ r, recent }) => (
            <li key={r}>
              <button type="button" onClick={() => onPick(r)}>
                {recent && <span className="muted" aria-label="Recent">↺ </span>}
                {r}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>What you can ask about</h4>
        <div className="ask-catalog">
          {groups.map(([g, ms]) => (
            <div key={g}>
              <h5>{GROUP_LABEL[g]}</h5>
              <ul>
                {ms.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => onInsert(`${m.short} `)} title={`${m.label} · ${m.source.publisher}`}>
                      {m.short}
                    </button>
                    <span className="muted mono"> {yr(m.coverage[0])}–{yr(m.coverage[1])}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h5>Lists</h5>
            <ul>
              {catalog.lists.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => onInsert(`${l.label} `)}>
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
