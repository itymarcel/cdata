import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { Catalog, Intent, Query, QueryResult, ViewId } from "@shared/query.ts";
import { buildQuery, splitRef } from "@shared/query.ts";
import { type Parsed, parse } from "@shared/nl/parse.ts";
import type { VitalId } from "@shared/types.ts";
import { ApiError, askModel, historyQuery, runQuery } from "../../api/queries.ts";
import { nowYear, useDashboard } from "../../state/store.ts";
import { defaultSettings } from "../explorer/VitalExplorer.tsx";
import { localModelChosen, readLocally } from "./localModel.ts";

/** Below this share of understood words, a model (in-browser if turned on, else the server's) gets the question instead. */
const MODEL_THRESHOLD = 0.75;
const RECENT_KEY = "ask:recent";

export type Reader = "parser" | "model" | "local";

export interface AskState {
  status: "idle" | "running" | "done" | "error";
  /** The intent the current answer was built from; chips edit this. */
  intent: Intent | null;
  /** Who read the question: the parser, the server's model, or the in-browser one. */
  via: Reader | null;
  /** Words the parser couldn't place (parser runs only). */
  unread: string[];
  /** Typos the parser fixed: [as typed, read as]. */
  corrections: [string, string][];
  query: Query | null;
  result: QueryResult | null;
  notes: string[];
  error: string | null;
}

const idle: AskState = { status: "idle", intent: null, via: null, unread: [], corrections: [], query: null, result: null, notes: [], error: null };

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function remember(text: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([text, ...readRecent().filter((r) => r !== text)].slice(0, 6)));
  } catch {
    // Storage can be unavailable (private windows); recents are a convenience.
  }
}

/**
 * Hands a query to the history explorer: picks the view, sets its window,
 * smoothing and display, switches on the requested series, and adds a second
 * vital on the right axis when the question named two.
 */
export function useOpenInExplorer() {
  const qc = useQueryClient();
  const setView = useDashboard((s) => s.setView);
  const setExplorer = useDashboard((s) => s.setExplorer);
  return useCallback(
    async (o: { view: ViewId; series: string[]; span: [number | null, number | null]; smoothing: number; display: "values" | "change"; compare?: VitalId | null }, catalog: Catalog) => {
      if (o.view === "map") {
        setView("map");
        return;
      }
      const history = await qc.fetchQuery(historyQuery(o.view));
      const defaults = defaultSettings(history);
      const now = nowYear();
      const dataMin = Math.min(...history.series.map((s) => s.points[0]?.[0] ?? now));
      const end = Math.max(now, ...history.series.map((s) => s.points.at(-1)?.[0] ?? now));
      const [from, to] = o.span;
      const window: [number, number] | null =
        from === null && to === null ? null : [Math.max(dataMin, from ?? dataMin), Math.min(end, to === null ? end : to + 1)];
      const visible: Record<string, boolean> = {};
      for (const ref of o.series) {
        const m = catalog.measures.find((x) => x.id === splitRef(ref).measure);
        if (m?.vital?.id === o.view) visible[m.vital.series] = true;
      }
      setExplorer(
        o.view,
        {
          window: window && window[1] > window[0] ? window : null,
          smoothing: o.smoothing,
          display: o.display,
          compare: o.compare ?? null,
          visible: { ...(useDashboard.getState().explorer[o.view]?.visible ?? {}), ...visible },
        },
        defaults,
      );
      setView(o.view);
    },
    [qc, setView, setExplorer],
  );
}

export function useAsk(catalog: Catalog | undefined, onNavigated: () => void) {
  const [state, setState] = useState<AskState>(idle);
  const openInExplorer = useOpenInExplorer();
  // Only the latest request may update the state.
  const seq = useRef(0);
  // The question being answered; remembered as a recent one only if it got an answer.
  const asked = useRef<string | null>(null);

  const finish = useCallback(
    async (n: number, base: Partial<AskState>, query: Query | null, notes: string[]) => {
      if (!catalog) return;
      if (!query) {
        setState({ ...idle, ...base, status: "done", query: null, result: null, notes });
        return;
      }
      if (query.kind === "open") {
        await openInExplorer({ view: query.view, series: query.series, span: query.span, smoothing: query.smoothing, display: query.display }, catalog);
        if (n === seq.current) {
          if (asked.current) remember(asked.current);
          setState({ ...idle, ...base, status: "done", query, notes });
          onNavigated();
        }
        return;
      }
      try {
        const res = await runQuery(query);
        if (n !== seq.current) return;
        if (asked.current) remember(asked.current);
        setState({ ...idle, ...base, status: "done", query: res.query, result: res.result, notes: [...notes, ...res.notes] });
      } catch (err) {
        if (n !== seq.current) return;
        setState({ ...idle, ...base, status: "error", query, notes, error: err instanceof Error ? err.message : String(err) });
      }
    },
    [catalog, openInExplorer, onNavigated],
  );

  /** Runs an intent through buildQuery and the server, keeping who read it. */
  const runIntent = useCallback(
    async (intent: Intent, via: Reader, unread: string[] = [], corrections: [string, string][] = []) => {
      if (!catalog) return;
      const n = ++seq.current;
      setState((s) => ({ ...s, status: "running", intent, via, unread, corrections, error: null }));
      const built = buildQuery(intent, catalog);
      await finish(n, { intent, via, unread, corrections }, built.query, built.notes);
    },
    [catalog, finish],
  );

  const askTheModel = useCallback(
    async (text: string) => {
      if (!catalog) return;
      const n = ++seq.current;
      setState((s) => ({ ...s, status: "running", via: "model", error: null }));
      try {
        const res = await askModel(text);
        if (n !== seq.current) return;
        const base = { intent: res.intent, via: "model" as const, unread: [] };
        if (res.query?.kind === "open") return void (await finish(n, base, res.query, res.notes));
        if (res.result) remember(text);
        setState({ ...idle, ...base, status: "done", query: res.query, result: res.result, notes: res.notes });
      } catch (err) {
        if (n !== seq.current) return;
        const message = err instanceof ApiError && err.status === 503 ? err.message : `The model couldn’t read that: ${err instanceof Error ? err.message : String(err)}`;
        setState((s) => ({ ...s, status: "error", error: message }));
      }
    },
    [catalog, finish],
  );

  /** Reads the question with the in-browser model, then runs it like a parser reading. */
  const askLocally = useCallback(
    async (text: string) => {
      if (!catalog) return;
      const n = ++seq.current;
      setState((s) => ({ ...s, status: "running", via: "local", error: null }));
      try {
        const { intent } = await readLocally(text, catalog, Math.floor(nowYear()));
        if (n !== seq.current) return;
        const built = buildQuery(intent, catalog);
        await finish(n, { intent, via: "local", unread: [], corrections: [] }, built.query, built.notes);
      } catch (err) {
        if (n !== seq.current) return;
        setState((s) => ({ ...s, status: "error", error: `The in-browser model couldn’t read that: ${err instanceof Error ? err.message : String(err)}` }));
      }
    },
    [catalog, finish],
  );

  const submit = useCallback(
    (text: string, preview: Parsed | null) => {
      if (!catalog || !text.trim()) return;
      asked.current = text.trim();
      const p = preview ?? parse(text, catalog, Math.floor(nowYear()));
      const unsure = !p.understood || p.confidence < MODEL_THRESHOLD || p.unread.length > 0;
      // Explanation and forecast questions are answered by template either way.
      const settled = p.intent.kind === "unsupported" && (p.intent.reason === "explanation" || p.intent.reason === "forecast");
      if (unsure && !settled && localModelChosen()) return void askLocally(text);
      if (unsure && !settled && catalog.askAvailable) return void askTheModel(text);
      return void runIntent(p.intent, "parser", p.unread, p.corrections);
    },
    [catalog, askTheModel, askLocally, runIntent],
  );

  const reset = useCallback(() => {
    seq.current++;
    setState(idle);
  }, []);

  return { state, submit, runIntent, askTheModel, askLocally, reset, openInExplorer };
}
