import type { GraphData, GraphEdge, NodeKind, VitalId } from "@shared/types.ts";
import { useVitals } from "../../api/queries.ts";
import { formatNumber, formatYear } from "../../lib/format.ts";
import { NODE_KIND_COLOR } from "../../lib/colors.ts";
import { useDashboard } from "../../state/store.ts";
import { EDGE_STYLE } from "./buildGraph.ts";

const INDICATOR_TO_VITAL: Record<string, string> = {
  co2: "co2",
  temperature: "temperature",
  seaIce: "seaIce",
  seaLevel: "seaLevel",
  oceanHeat: "oceanHeat",
};

const KIND_NAME: Record<NodeKind, string> = {
  indicator: "Indicator",
  driver: "Driver",
  actor: "Actor",
  policy: "COP / policy",
  event: "Event",
  place: "Place",
};

/** Detail card for the selected node: what it is, what it links to and how strongly, plus jumps. */
export function NodeDetail({ data, nodeId, onClose }: { data: GraphData; nodeId: string; onClose: () => void }) {
  const node = data.nodes.find((n) => n.id === nodeId);
  const setYear = useDashboard((s) => s.setYear);
  const flyTo = useDashboard((s) => s.flyTo);
  const selectNode = useDashboard((s) => s.selectNode);
  const selectCountry = useDashboard((s) => s.selectCountry);
  const openVital = useDashboard((s) => s.setView);
  const { data: vitals } = useVitals();
  if (!node) return null;

  const label = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id;
  const links = data.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  const vital = node.indicator ? vitals?.find((v) => v.id === INDICATOR_TO_VITAL[node.indicator!]) : undefined;

  return (
    <aside className="node-detail" aria-label={`Details for ${node.label}`}>
      <header className="node-detail__head">
        <span className="node-detail__kind">
          <span className="chip__dot" style={{ background: NODE_KIND_COLOR[node.kind] }} />
          {KIND_NAME[node.kind]}
          {node.t !== undefined && ` · ${formatYear(node.t)}`}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>
      <h3 className="node-detail__title">{node.label}</h3>
      <p className="node-detail__desc">{node.description}</p>
      {vital && vital.value !== null && (
        <button type="button" className="node-detail__vital" onClick={() => openVital(vital.id as VitalId)}>
          <span className="mono">
            {formatNumber(vital.value, vital.decimals)} {vital.unit}
          </span>
          <span className="muted">latest · open chart</span>
        </button>
      )}

      <div className="node-detail__actions">
        {node.t !== undefined && (
          <button type="button" className="btn" onClick={() => setYear(node.t!)}>
            Go to {formatYear(node.t)}
          </button>
        )}
        {node.lon !== undefined && node.lat !== undefined && (
          <button type="button" className="btn" onClick={() => flyTo(node.lon!, node.lat!, node.zoom ?? 4)}>
            Show on map
          </button>
        )}
        {node.iso3 && (
          <button type="button" className="btn" onClick={() => selectCountry(node.iso3!)}>
            Select country
          </button>
        )}
        {node.sourceUrl && (
          <a className="btn" href={node.sourceUrl} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        )}
      </div>

      <h4 className="node-detail__sub">Links ({links.length})</h4>
      <ul className="node-detail__links">
        {links.map((e) => (
          <LinkRow key={e.id} edge={e} nodeId={nodeId} label={label} onJump={selectNode} />
        ))}
      </ul>
    </aside>
  );
}

function LinkRow({ edge, nodeId, label, onJump }: { edge: GraphEdge; nodeId: string; label: (id: string) => string; onJump: (id: string) => void }) {
  const outgoing = edge.source === nodeId;
  const other = outgoing ? edge.target : edge.source;
  return (
    <li className="link-row" title={EDGE_STYLE[edge.evidence].label}>
      <span className={`chip__line chip__line--${edge.evidence}`} aria-label={edge.evidence} />
      <div className="link-row__text">
        <div>
          {outgoing ? (
            <>
              <span className="muted">{edge.relation} →</span>{" "}
              <button type="button" className="link-btn" onClick={() => onJump(other)}>
                {label(other)}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="link-btn" onClick={() => onJump(other)}>
                {label(other)}
              </button>{" "}
              <span className="muted">→ {edge.relation}</span>
            </>
          )}
        </div>
        {(edge.note || edge.confidence) && (
          <div className="link-row__note">
            {edge.confidence && <span className={`conf conf--${edge.confidence}`}>{edge.confidence} confidence</span>}
            {edge.note && <span>{edge.note}</span>}
            {edge.sourceUrl && (
              <a href={edge.sourceUrl} target="_blank" rel="noreferrer">
                source ↗
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
