import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphData, LinkEvidence, NodeKind } from "@shared/types.ts";
import { INK, NODE_KIND_COLOR } from "../../lib/colors.ts";

export interface NodeAttrs {
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  size: number;
  color: string;
  shape: string;
  labelPosition: "left" | "right";
}

export interface EdgeAttrs {
  evidence: LinkEvidence;
  relation: string;
  color: string;
  size: number;
  /** Dash pattern in pixels. */
  dashSize: number;
  gapSize: number;
  /** Colour painted in the gaps: the line colour for solid edges, transparent otherwise. */
  gapColor: string;
}

/** Shape carries kind as well as colour, so the graph reads in greyscale. */
export const NODE_SHAPE: Record<NodeKind, string> = {
  indicator: "circle",
  driver: "square",
  actor: "circle",
  event: "triangle",
  policy: "diamond",
  place: "square",
};

export const EDGE_STYLE: Record<LinkEvidence, { dash: number; gap: number; color: string; label: string }> = {
  // Sigma's dash shader drops gap-0 patterns, so "solid" is a dash whose gaps are painted in.
  documented: { dash: 6, gap: 4, color: "#7d8794", label: "Documented: measured or on the public record" },
  attributed: { dash: 6, gap: 4, color: "#b59a7a", label: "Attributed by a study, with stated confidence" },
  contested: { dash: 1.5, gap: 4, color: "#8a7fb0", label: "Claimed or contested" },
};

/** Seeds each kind on its own ring sector so ForceAtlas2 starts from a readable arrangement. */
const KIND_ANGLE: Record<NodeKind, number> = {
  indicator: 0,
  driver: 1,
  actor: 2,
  policy: 3,
  event: 4,
  place: 5,
};

export function buildGraph(data: GraphData): Graph<NodeAttrs, EdgeAttrs> {
  const graph = new Graph<NodeAttrs, EdgeAttrs>({ multi: true, type: "directed" });
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  data.nodes.forEach((n, i) => {
    const sector = (KIND_ANGLE[n.kind] / 6) * Math.PI * 2;
    const jitter = (i % 7) * 0.12;
    const r = n.kind === "indicator" ? 2 : 10 + (i % 5);
    graph.addNode(n.id, {
      // Long event titles crowd the canvas; the detail card shows the full text.
      label: n.label.length > 34 ? `${n.label.slice(0, 32)}…` : n.label,
      kind: n.kind,
      x: Math.cos(sector + jitter) * r,
      y: Math.sin(sector + jitter) * r,
      size: Math.min(16, 4 + Math.sqrt(degree.get(n.id) ?? 1) * 2.4) + (n.kind === "indicator" ? 3 : 0),
      color: NODE_KIND_COLOR[n.kind],
      shape: NODE_SHAPE[n.kind],
      labelPosition: "right",
    });
  });

  for (const e of data.edges) {
    const style = EDGE_STYLE[e.evidence];
    graph.addEdgeWithKey(e.id, e.source, e.target, {
      evidence: e.evidence,
      relation: e.relation,
      color: style.color,
      size: e.evidence === "attributed" ? 1.6 : 1.2,
      dashSize: style.dash,
      gapSize: style.gap,
      gapColor: e.evidence === "documented" ? style.color : "rgba(0,0,0,0)",
    });
  }

  forceAtlas2.assign(graph, {
    iterations: 600,
    settings: {
      ...forceAtlas2.inferSettings(graph),
      gravity: 0.6,
      scalingRatio: 30,
      strongGravityMode: true,
      barnesHutOptimize: false,
      adjustSizes: true,
    },
  });

  return graph;
}

export const DIMMED = INK.grid;

/**
 * Fits the layout to its container: rotates it 90° when the layout is landscape
 * and the panel portrait (or vice versa), then points labels on the right half
 * leftwards so they stay inside the canvas.
 */
export function orientToContainer(graph: Graph<NodeAttrs, EdgeAttrs>, width: number, height: number): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  graph.forEachNode((_, a) => {
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y);
    maxY = Math.max(maxY, a.y);
  });
  const layoutLandscape = maxX - minX > maxY - minY;
  const panelLandscape = width > height;
  if (width > 0 && height > 0 && layoutLandscape !== panelLandscape) {
    graph.updateEachNodeAttributes((_, a) => ({ ...a, x: a.y, y: a.x }));
    [minX, maxX] = [minY, maxY];
  }
  const midX = (minX + maxX) / 2;
  graph.updateEachNodeAttributes((_, a) => ({ ...a, labelPosition: a.x > midX ? "left" : "right" }));
}
