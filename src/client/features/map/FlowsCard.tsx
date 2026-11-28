import { useMemo, useState } from "react";
import { CHIP_STEPS, TRADE_GROUPS, TRADE_INFO, usd } from "@shared/trade.ts";
import { TRADE_COMMODITIES, type FlowsView, type TradeCommodity } from "@shared/types.ts";
import { FLOW_COLOR } from "../../lib/colors.ts";
import { useDashboard } from "../../state/store.ts";
import { Rich } from "../explorer/Story.tsx";
import { TOP_FLOWS } from "./useMapLayers.ts";

/**
 * The chip goods laid out in the order a chip is made, so one click steps from
 * the raw silicon to the chips and the routes show where each stage goes.
 */
function ChipChain({ commodity, onPick }: { commodity: TradeCommodity; onPick: (c: TradeCommodity) => void }) {
  return (
    <ol className="chip-chain" aria-label="Steps in making a chip">
      {CHIP_STEPS.map(({ step, label }) => (
        <li key={step} className="chip-chain__step">
          <span className="chip-chain__label">{label}</span>
          {TRADE_COMMODITIES.filter((c) => TRADE_INFO[c].step === step).map((c) => (
            <button
              key={c}
              type="button"
              className={`chip-chain__good${c === commodity ? " is-active" : ""}`}
              aria-pressed={c === commodity}
              title={TRADE_INFO[c].definition}
              onClick={() => onPick(c)}
            >
              {TRADE_INFO[c].short}
            </button>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** Picks what the arcs show, says what they add up to, and narrows to one country's routes. */
export function FlowsCard({ view, loading, error, drawn }: { view: FlowsView | null; loading: boolean; error: string | null; drawn: number }) {
  const on = useDashboard((s) => s.layers.flows);
  const commodity = useDashboard((s) => s.flowCommodity);
  const setCommodity = useDashboard((s) => s.setFlowCommodity);
  const country = useDashboard((s) => s.country);
  const selectCountry = useDashboard((s) => s.selectCountry);
  const [open, setOpen] = useState(true);

  const mine = useMemo(() => {
    if (!view || !country) return null;
    let out = 0;
    let into = 0;
    const to = new Set<string>();
    const from = new Set<string>();
    for (const f of view.flows) {
      if (f.from === country) {
        out += f.value;
        to.add(f.to);
      } else if (f.to === country) {
        into += f.value;
        from.add(f.from);
      }
    }
    return { out, into, to: to.size, from: from.size, name: view.places[country]?.name ?? country };
  }, [view, country]);

  if (!on) return null;
  const info = TRADE_INFO[commodity];

  return (
    <section className={`flows-card${open ? "" : " is-collapsed"}`} aria-label="Trade flows">
      <header className="flows-card__head">
        <span className="flows-card__swatch" style={{ background: FLOW_COLOR[info.group] }} aria-hidden="true" />
        <select
          className="select flows-card__select"
          aria-label="Traded good shown as arcs"
          value={commodity}
          onChange={(e) => setCommodity(e.target.value as TradeCommodity)}
        >
          {TRADE_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {TRADE_COMMODITIES.filter((c) => TRADE_INFO[c].group === g.id).map((c) => (
                <option key={c} value={c} title={TRADE_INFO[c].definition}>
                  {TRADE_INFO[c].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {view && <span className="mono muted">{view.year}</span>}
        <button type="button" className="flows-card__toggle" aria-expanded={open} onClick={() => setOpen(!open)} title={open ? "Collapse" : "Expand"}>
          {open ? "–" : "+"}
        </button>
      </header>

      {open && (
        <div className="flows-card__body">
          {info.group === "chips" && <ChipChain commodity={commodity} onPick={setCommodity} />}
          {error ? (
            <p className="flows-card__note">Trade data unavailable: {error}</p>
          ) : loading || !view ? (
            <p className="flows-card__note">
              Reading UN Comtrade… The first load of each good takes a minute or two (the public API allows about one table a second); after that it is cached.
            </p>
          ) : (
            <>
              {mine ? (
                <div className="flows-card__country">
                  <strong>{mine.name}</strong>
                  <div>
                    exports <span className="mono">{usd(mine.out)}</span> to {mine.to} {mine.to === 1 ? "country" : "countries"}
                    {" · "}imports <span className="mono">{usd(mine.into)}</span> from {mine.from}
                  </div>
                  <div className="muted">on the routes read{mine.out + mine.into === 0 ? ": none for this country" : ""}</div>
                  <button type="button" className="btn btn--small" onClick={() => selectCountry(null)}>
                    All routes
                  </button>
                </div>
              ) : (
                <ul className="flows-card__facts">
                  {view.facts.map((f, i) => (
                    <li key={i} title={f.basis}>
                      <Rich text={f.text} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="flows-card__note">
                {country
                  ? `${drawn} routes to and from ${mine?.name ?? country}.`
                  : `The ${Math.min(TOP_FLOWS, drawn)} largest routes. Click a country or a route to see one country’s trade.`}{" "}
                Pulses run exporter → importer. {info.definition}.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
