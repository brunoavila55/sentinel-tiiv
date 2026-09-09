import type { Edge, Node } from "@xyflow/react";
import dagre from "dagre";

export const NODE_WIDTH = 112;
export const NODE_HEIGHT = 58;

export type LayoutDirection = "TB" | "LR";

export function layoutWithDagre<T extends Node>(nodes: T[], edges: Edge[], direction: LayoutDirection): T[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: direction, nodesep: 32, ranksep: 64 });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const pos = graph.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}
