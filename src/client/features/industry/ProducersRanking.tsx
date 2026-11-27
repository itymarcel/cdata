import { ApiError, useCarbonMajors, useSources } from "../../api/queries.ts";
import { DataStamp } from "../../components/DataStamp.tsx";
import { PanelState } from "../../components/Panel.tsx";
import { formatCompact } from "../../lib/format.ts";
import { ProducerLogo } from "./ProducerLogo.tsx";

const TOP_N = 15;

/**
 * Carbon Majors: emissions traced to the fuels each company or state produced.
 * The dataset needs a free login to download, so until the file is in place the
 * tab explains how to connect it instead of showing anything.
 */
export function ProducersRanking() {
  const { data, isLoading, error } = useCarbonMajors();
  const { data: sources } = useSources();
  const meta = sources?.find((s) => s.id === "carbonMajors");

  if (isLoading) return <PanelState status="loading" />;
  if (error instanceof ApiError && error.status === 424) {
    return (
      <div className="not-connected">
        <strong>Carbon Majors isn't connected yet.</strong>
        <p className="secondary">
          InfluenceMap publishes the dataset free for non-commercial use, behind a login, so the server can't fetch it on
          its own.
        </p>
        <p className="secondary">{meta?.setup}</p>
        <a className="btn" href="https://carbonmajors.org/Downloads" target="_blank" rel="noreferrer">
          Open carbonmajors.org downloads ↗
        </a>
      </div>
    );
  }
  if (error || !data) return <PanelState status="error" />;

  const d = data.data;
  const top = d.entities.slice(0, TOP_N);
  const max = top[0]?.cumulativeMt ?? 1;
  const since = Math.min(...d.entities.map((e) => e.sinceYear));
  return (
    <div className="ranking">
      <p className="tab-chart__lede">
        Cumulative emissions traced to each producer since {since}. Together the {d.entities.length} entities account for{" "}
        <strong className="mono">{formatCompact(d.totalMt / 1000)} Gt CO₂e</strong>.
      </p>
      <ol className="ranking__list">
        {top.map((e, i) => (
          <li key={e.entity}>
            <div className="ranking__row ranking__row--static" title={[e.type, `${e.sinceYear}–${e.latestYear}`, e.commodities.join(", ")].filter(Boolean).join(" · ")}>
              <span className="ranking__rank mono">{i + 1}</span>
              <span className="ranking__name">
                <ProducerLogo producer={e} />
                <span className="ranking__label">{e.entity}</span>
              </span>
              <span className="ranking__bar-track">
                <span className="ranking__bar" style={{ width: `${(e.cumulativeMt / max) * 100}%` }} />
              </span>
              <span className="ranking__value mono">
                {formatCompact(e.cumulativeMt / 1000)} Gt <span className="muted">{((e.cumulativeMt / d.totalMt) * 100).toFixed(1)}%</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <DataStamp source={data.source} extra="non-commercial licence" />
    </div>
  );
}
