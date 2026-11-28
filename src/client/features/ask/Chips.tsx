import { useState } from "react";
import { type Catalog, HAZARD_LABEL, type Intent } from "@shared/query.ts";
import { Flag } from "../../components/Flag.tsx";

const KIND_LABEL: Record<Intent["kind"], string> = { series: "Chart", map: "Map", rank: "Ranking", list: "List", open: "Open", unsupported: "Not answerable" };
const LIST_LABEL: Record<string, string> = {
  attribution: "Attribution studies",
  disasters: "Disaster alerts",
  laws: "Climate laws",
  cops: "COPs",
  records: "Records",
  eruptions: "Eruptions",
  enso: "El Niño / La Niña",
  pledges: "Pledges",
};

/** One chip for a group of measures asked for together. */
function groupLabel(ids: string[]): string {
  if (ids.every((id) => id.startsWith("energy."))) return `Electricity mix (${ids.length} sources)`;
  if (ids.every((id) => id.startsWith("emissions."))) return `CO₂ by fuel (${ids.length} fuels)`;
  return `${ids.length} measures`;
}

/** "1990 → now", "1980–1989", "all years"; BCE for years before 1, "years ago" for deep time. */
export function periodLabel(from: number | null, to: number | null): string {
  const now = new Date().getUTCFullYear();
  const y = (v: number) => (v >= 1 ? String(v) : now - v > 50_000 ? `${(now - v).toLocaleString("en")} yrs ago` : `${(1 - v).toLocaleString("en")} BCE`);
  if (from === null && to === null) return "All years";
  if (from !== null && to !== null) return from === to ? y(from) : `${y(from)}–${y(to)}`;
  return from !== null ? `${y(from)} → now` : `start → ${y(to!)}`;
}

/**
 * The parser's (or model's) reading of a question, as chips the reader can
 * correct: remove a country, change the period, switch ranking direction.
 * Every edit produces a new intent, which runs straight away.
 */
export function Chips({
  intent,
  catalog,
  onChange,
  live,
}: {
  intent: Intent;
  catalog: Catalog;
  onChange: (next: Intent) => void;
  /** Preview while typing: not editable yet. */
  live?: boolean;
}) {
  const [editingPeriod, setEditingPeriod] = useState(false);
  const measure = (id: string) => catalog.measures.find((m) => m.id === id);
  const country = (iso3: string) => catalog.countries.find((c) => c.iso3 === iso3);
  const set = (patch: Partial<Intent>) => onChange({ ...intent, ...patch });
  const editable = !live;
  const remove = (label: string, onRemove: () => void) =>
    editable ? (
      <button type="button" className="ask-chip__x" onClick={onRemove} aria-label={`Remove ${label}`}>
        ✕
      </button>
    ) : null;

  const showPeriod = intent.kind !== "unsupported" && !(intent.kind === "list" && intent.dataset === "pledges");

  return (
    <ul className={`ask-chips${live ? " is-live" : ""}`} aria-label={live ? "How your question is read so far" : "How your question was read; edit to change the answer"}>
      <li className="ask-chip ask-chip--kind">{KIND_LABEL[intent.kind]}</li>

      {intent.kind === "list" && intent.dataset && <li className="ask-chip">{LIST_LABEL[intent.dataset] ?? intent.dataset}</li>}

      {intent.kind !== "list" && intent.measures.length > 3 && (
        <li className="ask-chip" title={intent.measures.map((id) => measure(id)?.short ?? id).join(", ")}>
          {groupLabel(intent.measures)}
          {remove("these measures", () => set({ measures: [] }))}
        </li>
      )}
      {intent.kind !== "list" &&
        intent.measures.length <= 3 &&
        intent.measures.map((id) => {
          const m = measure(id);
          return (
            <li key={id} className="ask-chip" title={m?.label}>
              {m?.short ?? id}
              {remove(m?.short ?? id, () => set({ measures: intent.measures.filter((x) => x !== id) }))}
            </li>
          );
        })}

      {intent.countries.map((iso3) => {
        const c = country(iso3);
        return (
          <li key={iso3} className="ask-chip">
            <Flag iso3={iso3} />
            {c?.name ?? iso3}
            {remove(c?.name ?? iso3, () => set({ countries: intent.countries.filter((x) => x !== iso3) }))}
          </li>
        );
      })}

      {intent.kind === "list" && intent.hazard && (
        <li className="ask-chip">
          {HAZARD_LABEL[intent.hazard]}
          {remove(HAZARD_LABEL[intent.hazard], () => set({ hazard: null }))}
        </li>
      )}
      {intent.kind === "list" && intent.phase && (
        <li className="ask-chip">
          {intent.phase === "elNino" ? "El Niño" : "La Niña"}
          {remove("phase", () => set({ phase: null }))}
        </li>
      )}

      {showPeriod &&
        (editingPeriod && editable ? (
          <li className="ask-chip ask-chip--edit">
            <PeriodEditor
              from={intent.from}
              to={intent.to}
              onDone={(from, to) => {
                setEditingPeriod(false);
                if (from !== intent.from || to !== intent.to) set({ from, to });
              }}
            />
          </li>
        ) : (
          <li className="ask-chip">
            {editable ? (
              <button type="button" className="ask-chip__btn" onClick={() => setEditingPeriod(true)} title="Change the period">
                {periodLabel(intent.from, intent.to)}
              </button>
            ) : (
              periodLabel(intent.from, intent.to)
            )}
          </li>
        ))}

      {intent.kind === "series" && editable && (
        <>
          <li className="ask-chip">
            <select className="ask-chip__select" value={intent.display} onChange={(e) => set({ display: e.target.value as Intent["display"] })} aria-label="Values or change per year">
              <option value="values">Values</option>
              <option value="change">Change per year</option>
            </select>
          </li>
          <li className="ask-chip">
            <select className="ask-chip__select" value={String(intent.smoothing)} onChange={(e) => set({ smoothing: Number(e.target.value) })} aria-label="Smoothing">
              {[0, 5, 10, 30].concat([0, 5, 10, 30].includes(intent.smoothing) ? [] : [intent.smoothing]).map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "No smoothing" : `${v}-yr mean`}
                </option>
              ))}
            </select>
          </li>
        </>
      )}

      {intent.kind === "series" && intent.topCountries && (
        <li className="ask-chip">
          {editable ? (
            <select className="ask-chip__select" value={String(intent.top)} onChange={(e) => set({ top: Number(e.target.value) })} aria-label="How many countries">
              {[3, 5, 8].concat([3, 5, 8].includes(intent.top) ? [] : [intent.top]).map((v) => (
                <option key={v} value={v}>
                  Top {v} countries
                </option>
              ))}
            </select>
          ) : (
            `Top ${intent.top} countries`
          )}
        </li>
      )}

      {intent.kind === "series" && editable && (intent.measures.length > 1 || intent.countries.length > 1 || intent.topCountries) && (
        <li className="ask-chip">
          <select className="ask-chip__select" value={intent.chart} onChange={(e) => set({ chart: e.target.value as Intent["chart"] })} aria-label="Chart type">
            <option value="lines">Lines</option>
            <option value="stacked">Stacked</option>
          </select>
        </li>
      )}

      {intent.kind === "map" && editable && (
        <li className="ask-chip">
          <select className="ask-chip__select" value={intent.rankBy} onChange={(e) => set({ rankBy: e.target.value as Intent["rankBy"] })} aria-label="Map values or change">
            <option value="value">Values</option>
            <option value="change">Change since start</option>
            <option value="percent">% change since start</option>
          </select>
        </li>
      )}

      {intent.kind === "rank" && editable && (
        <>
          <li className="ask-chip">
            <select className="ask-chip__select" value={intent.rankBy} onChange={(e) => set({ rankBy: e.target.value as Intent["rankBy"] })} aria-label="Rank by">
              <option value="value">By value</option>
              <option value="change">By change</option>
              <option value="percent">By % change</option>
            </select>
          </li>
          <li className="ask-chip">
            <select className="ask-chip__select" value={intent.order} onChange={(e) => set({ order: e.target.value as Intent["order"] })} aria-label="Order">
              <option value="desc">{intent.rankBy === "value" ? "Highest first" : "Biggest rise first"}</option>
              <option value="asc">{intent.rankBy === "value" ? "Lowest first" : "Biggest fall first"}</option>
            </select>
          </li>
          <li className="ask-chip">
            <select className="ask-chip__select" value={String(intent.top)} onChange={(e) => set({ top: Number(e.target.value) })} aria-label="How many">
              {[5, 10, 20, 50].concat([5, 10, 20, 50].includes(intent.top) ? [] : [intent.top]).map((v) => (
                <option key={v} value={v}>
                  Top {v}
                </option>
              ))}
            </select>
          </li>
        </>
      )}
    </ul>
  );
}

function PeriodEditor({ from, to, onDone }: { from: number | null; to: number | null; onDone: (from: number | null, to: number | null) => void }) {
  const [a, setA] = useState(from === null ? "" : String(from));
  const [b, setB] = useState(to === null ? "" : String(to));
  const read = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  return (
    <form
      className="ask-period"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(read(a), read(b));
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onDone(from, to);
        }
      }}
    >
      <input aria-label="From year" placeholder="start" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
      <span aria-hidden="true">–</span>
      <input aria-label="To year" placeholder="now" inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} />
      <button type="submit" className="ask-chip__btn">
        Apply
      </button>
    </form>
  );
}
