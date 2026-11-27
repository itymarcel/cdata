import { useEffect, useMemo, useState } from "react";
import type { GraphData, LinkEvidence, NodeKind } from "@shared/types.ts";
import { useGraph } from "../../api/queries.ts";
import { Panel, PanelState } from "../../components/Panel.tsx";
import { NODE_KIND_COLOR } from "../../lib/colors.ts";
import { useDashboard } from "../../state/store.ts";
import { EDGE_STYLE, buildGraph } from "./buildGraph.ts";
import { GraphCanvas } from "./GraphCanvas.tsx";
import { NodeDetail } from "./NodeDetail.tsx";
import "./graph.css";

const KIND_LABEL: Record<NodeKind, string> = {
  indicator: "Indicators",
  driver: "Drivers",
  actor: "Actors",
  policy: "COPs & policy",
  event: "Events",
  place: "Places",
};
const ALL_KINDS = Object.keys(KIND_LABEL) as NodeKind[];
/** 160+ studies and records swamp the overview; they are one click (or one selection) away. */
const DEFAULT_KINDS: NodeKind[] = ["indicator", "driver", "actor", "policy", "place"];
const ALL_EVIDENCE = Object.keys(EDGE_STYLE) as LinkEvidence[];

/** Nodes allowed by kind filter, search, and whether they have any allowed link. */
function visibleNodes(data: GraphData, kinds: Set<NodeKind>, evidence: Set<LinkEvidence>, query: string): Set<string> {
  const q = query.trim().toLowerCase();
  const byKind = new Set(data.nodes.filter((n) => kinds.has(n.kind)).map((n) => n.id));
  const linked = new Set<string>();
  for (const e of data.edges) {
    if (!evidence.has(e.evidence) || !byKind.has(e.source) || !byKind.has(e.target)) continue;
    linked.add(e.source);
    linked.add(e.target);
  }
  if (!q) return linked;
  const matches = data.nodes.filter((n) => linked.has(n.id) && (n.label + " " + n.description).toLowerCase().includes(q));
  const out = new Set(matches.map((n) => n.id));
  // Keep direct neighbours of matches so the context stays visible.
  for (const e of data.edges) {
    if (!evidence.has(e.evidence)) continue;
    if (out.has(e.source) && linked.has(e.target)) out.add(e.target);
    else if (out.has(e.target) && linked.has(e.source)) out.add(e.source);
  }
  return out;
}

export function ConnectionsPanel() {
  const { data, isLoading, isError } = useGraph();
  const selected = useDashboard((s) => s.selectedNode);
  const selectNode = useDashboard((s) => s.selectNode);
  const expanded = useDashboard((s) => s.graphExpanded);
  const setExpanded = useDashboard((s) => s.setGraphExpanded);
  const [kinds, setKinds] = useState<Set<NodeKind>>(() => new Set(DEFAULT_KINDS));
  const [evidence, setEvidence] = useState<Set<LinkEvidence>>(() => new Set(ALL_EVIDENCE));
  const [query, setQuery] = useState("");

  const graph = useMemo(() => (data ? buildGraph(data) : null), [data]);

  // Selecting something from the timeline or map reveals its kind if it was filtered out.
  useEffect(() => {
    const kind = data?.nodes.find((n) => n.id === selected)?.kind;
    if (kind && !kinds.has(kind)) setKinds((k) => new Set([...k, kind]));
  }, [selected, data, kinds]);
  const visible = useMemo(
    () => (data ? visibleNodes(data, kinds, evidence, query) : new Set<string>()),
    [data, kinds, evidence, query],
  );

  const toggle = <T,>(set: Set<T>, value: T, update: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  return (
    <Panel
      title="Connections"
      subtitle="What drives what, and how sure we are"
      className={`graph-panel${expanded ? " is-expanded" : ""}`}
      actions={
        <button type="button" className="icon-btn" onClick={() => setExpanded(!expanded)} aria-pressed={expanded}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      }
    >
      <div className="graph-toolbar">
        <input
          type="search"
          className="graph-search"
          placeholder="Search nodes… (e.g. Amazon, coal, COP)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the connections graph"
        />
        <div className="graph-filters" role="group" aria-label="Node types">
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${kinds.has(k) ? " is-on" : ""}`}
              aria-pressed={kinds.has(k)}
              onClick={() => toggle(kinds, k, setKinds)}
            >
              <span className="chip__dot" style={{ background: NODE_KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="graph-filters" role="group" aria-label="Link evidence">
          {ALL_EVIDENCE.map((e) => (
            <button
              key={e}
              type="button"
              className={`chip${evidence.has(e) ? " is-on" : ""}`}
              aria-pressed={evidence.has(e)}
              title={EDGE_STYLE[e].label}
              onClick={() => toggle(evidence, e, setEvidence)}
            >
              <span className={`chip__line chip__line--${e}`} />
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="graph-body">
        {isLoading && <PanelState status="loading" />}
        {isError && <PanelState status="error" />}
        {graph && <GraphCanvas graph={graph} visible={visible} selected={selected} onSelect={selectNode} />}
        {data && selected && <NodeDetail data={data} nodeId={selected} onClose={() => selectNode(null)} />}
      </div>
    </Panel>
  );
}
