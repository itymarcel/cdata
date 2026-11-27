import { useSources } from "../../api/queries.ts";
import { EvidenceBadge, EvidenceLegend } from "../../components/EvidenceBadge.tsx";
import { Modal } from "../../components/Modal.tsx";
import { formatAsOf, formatRelative } from "../../lib/format.ts";
import { useDashboard } from "../../state/store.ts";
import "./sources.css";

/** Every upstream, its cadence, freshness and health. The credibility page. */
export function SourcesModal() {
  const open = useDashboard((s) => s.sourcesOpen);
  const setOpen = useDashboard((s) => s.setSourcesOpen);
  const { data } = useSources(open);
  return (
    <Modal title="Data sources" open={open} onClose={() => setOpen(false)}>
      <p className="secondary">
        Every figure carries a badge for how it was produced. Sources update at different speeds, so each panel shows
        its own “as of” date. The server re-fetches each source on its own schedule and keeps the last good copy if an
        upstream fails.
      </p>
      <EvidenceLegend />
      <table className="sources-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Updates</th>
            <th>Data as of</th>
            <th>Fetched</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id}>
              <td>
                <div className="sources-table__name">
                  <EvidenceBadge evidence={s.evidence} compact />
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                </div>
                <div className="muted">{s.publisher}</div>
                {s.note && <div className="sources-table__note">{s.note}</div>}
                {!s.connected && s.setup && <div className="sources-table__note sources-table__setup">To connect: {s.setup}</div>}
              </td>
              <td>
                {s.cadence}
                {s.lag && <div className="muted">lag {s.lag}</div>}
              </td>
              <td className="mono">{formatAsOf(s.dataAsOf)}</td>
              <td>{formatRelative(s.fetchedAt)}</td>
              <td>
                {!s.connected ? (
                  <span className="status status--pending" title={s.setup}>
                    ○ not connected
                  </span>
                ) : s.ok ? (
                  <span className="status status--ok">✓ ok</span>
                ) : s.fetchedAt ? (
                  <span className="status status--warn" title={s.error ?? ""}>
                    ⚠ stale
                  </span>
                ) : (
                  <span className="status status--pending">… pending</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Everything on the dashboard comes from these feeds. The only hand-written content is four physical links in the
        connections graph (for example "ocean heat → sea level"), each citing the IPCC AR6 assessment. Not connected,
        because they need a token or a licence: Climate Change Laws of the World, Sabin Center litigation, InfluenceMap
        lobbying, EM-DAT, ReliefWeb.
      </p>
    </Modal>
  );
}
