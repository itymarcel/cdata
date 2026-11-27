import type Graph from "graphology";
import Sigma from "sigma";
import { extremityArrow, layerDashed, pathLine, pathLoop, sdfCircle, sdfDiamond, sdfSquare, sdfTriangle } from "sigma/rendering";
import { useEffect, useRef } from "react";
import type { EdgeDisplayData, NodeDisplayData } from "sigma/types";
import { INK } from "../../lib/colors.ts";
import { DIMMED, orientToContainer, type EdgeAttrs, type NodeAttrs } from "./buildGraph.ts";

const SHOW_ALL_LABELS_BELOW = 25;

interface GraphCanvasProps {
  graph: Graph<NodeAttrs, EdgeAttrs>;
  /** Node ids allowed by the current filters. Hidden nodes take their edges with them. */
  visible: Set<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * WebGL graph via Sigma v4. Evidence levels map to one dashed edge layer:
 * documented edges fill their gaps with the line colour (solid), attributed
 * edges are long dashes, contested edges are dots.
 */
export function GraphCanvas({ graph, visible, selected, onSelect }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const hovered = useRef<string | null>(null);
  // Reducers read the latest props through refs so we refresh instead of rebuilding.
  const state = useRef({ visible, selected });
  state.current = { visible, selected };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    orientToContainer(graph, container.clientWidth, container.clientHeight);

    /** The node whose neighbourhood stays lit: hover wins over selection; filtered-out nodes don't count. */
    const focusNode = (): string | null => {
      const f = hovered.current ?? state.current.selected;
      return f && graph.hasNode(f) && state.current.visible.has(f) ? f : null;
    };
    const focusSet = (): Set<string> | null => {
      const focus = focusNode();
      return focus ? new Set([focus, ...graph.neighbors(focus)]) : null;
    };

    const sigma = new Sigma(graph as never, container, {
      primitives: {
        nodes: {
          shapes: [sdfCircle(), sdfSquare(), sdfTriangle(), sdfDiamond()],
        },
        edges: {
          paths: [pathLine(), pathLoop()],
          extremities: [extremityArrow()],
          variables: {
            dashSize: { type: "number", default: 1 },
            gapSize: { type: "number", default: 0 },
            gapColor: { type: "color", default: "rgba(0,0,0,0)" },
          },
          layers: [
            layerDashed({
              dashSize: { attribute: "dashSize", default: 1, mode: "pixels" },
              gapSize: { attribute: "gapSize", default: 0, mode: "pixels" },
              // Solid edges paint their gaps in the line colour; others leave them clear.
              gapColor: { attribute: "gapColor", default: "rgba(0,0,0,0)" },
            }),
          ],
        },
      },
      styles: {
        nodes: {
          x: { attribute: "x" },
          y: { attribute: "y" },
          size: { attribute: "size" },
          color: { attribute: "color" },
          shape: { attribute: "shape" },
          label: { attribute: "label" },
          labelPosition: { attribute: "labelPosition" },
          labelColor: INK.secondary,
          labelSize: 11,
          backdropVisibility: "hidden",
        },
        edges: {
          size: { attribute: "size" },
          color: { attribute: "color" },
          dashSize: { attribute: "dashSize" },
          gapSize: { attribute: "gapSize" },
          gapColor: { attribute: "gapColor" },
          head: "arrow",
        },
      },
      settings: {
        renderEdgeLabels: false,
        labelDensity: 0.6,
        labelRenderedSizeThreshold: 9,
        stagePadding: 40,
        zoomToSizeRatioFunction: (r: number) => Math.sqrt(r),
        itemSizesReference: "screen",
        minCameraRatio: 0.15,
        maxCameraRatio: 3,
      },
      nodeReducer: (key: string, data: NodeDisplayData): Partial<NodeDisplayData> => {
        const { visible: vis, selected: sel } = state.current;
        if (!vis.has(key)) return { ...data, visibility: "hidden" };
        const focus = focusSet();
        const out: NodeDisplayData = { ...data, labelColor: INK.secondary };
        // A narrowed view (search or filters) is small enough to label everything.
        if (vis.size <= SHOW_ALL_LABELS_BELOW) out.labelVisibility = "visible";
        if (focus && !focus.has(key)) {
          out.color = DIMMED;
          out.labelVisibility = "hidden";
        }
        if (key === sel || key === hovered.current) {
          out.highlighted = true;
          out.zIndex = 2;
          out.labelColor = INK.primary;
          out.labelVisibility = "visible";
        }
        return out;
      },
      edgeReducer: (key: string, data: EdgeDisplayData): Partial<EdgeDisplayData> => {
        const [s, t] = graph.extremities(key);
        const { visible: vis } = state.current;
        if (!vis.has(s) || !vis.has(t)) return { ...data, visibility: "hidden" };
        // With a focus node, keep only its own links bright.
        const focus = focusNode();
        if (focus && s !== focus && t !== focus) return { ...data, color: "#161b22" };
        return data;
      },
    } as never);

    sigma.on("enterNode", ({ node }) => {
      hovered.current = node;
      container.style.cursor = "pointer";
      sigma.refresh();
    });
    sigma.on("leaveNode", () => {
      hovered.current = null;
      container.style.cursor = "";
      sigma.refresh();
    });
    sigma.on("clickNode", ({ node }) => onSelect(node));
    sigma.on("clickStage", () => onSelect(null));

    sigmaRef.current = sigma;

    // The panel resizes (layout settling, expand/collapse, window resize); keep the canvas in step.
    const ro = new ResizeObserver(() => {
      sigma.resize(true);
      sigma.refresh();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      sigma.kill();
      sigmaRef.current = null;
    };
    // onSelect is stable (zustand action); graph identity drives rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Filter or selection changed: re-run reducers, and centre on the selection.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.refresh();
    if (selected && graph.hasNode(selected) && visible.has(selected)) {
      const display = sigma.getNodeDisplayData(selected);
      if (display) void sigma.getCamera().animate({ x: display.x, y: display.y, ratio: 0.6 }, { duration: 500 });
    } else {
      void sigma.getCamera().reset({ duration: 400 });
    }
  }, [visible, selected, graph]);

  return <div ref={containerRef} className="graph-canvas" />;
}
