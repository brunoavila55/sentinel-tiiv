import type { Node } from "@xyflow/react";

import type { TreeIndex } from "@/lib/topology-tree";

/** Diâmetro do nó (bolinha) usado para converter centro <-> posição (canto superior esquerdo) do React Flow. */
export const RADIAL_NODE_SIZE = 14;

/** Distância mínima (px) entre dois anéis — ou seja, comprimento mínimo da linha entre pai e filho. */
const MIN_RING_SPACING = 170;
/** Distância mínima (px) entre duas folhas adjacentes no anel mais externo, para as bolinhas não colarem. */
const MIN_LEAF_GAP = 46;

/**
 * Posiciona os nós em anéis concêntricos a partir da(s) raiz(es) visível(is), como uma árvore
 * radial (dendrograma circular): profundidade -> raio, e cada nó recebe uma fatia angular
 * proporcional ao número de folhas na sua subárvore. Isso usa o espaço 2D de forma muito mais
 * eficiente que uma árvore top-down quando há muitos nós, e evita que irmãos se sobreponham.
 */
export function layoutRadial<T extends Node>(nodes: T[], tree: TreeIndex): T[] {
  const visible = new Set(nodes.map((n) => n.id));
  if (visible.size === 0) return nodes;

  const children = new Map<string, string[]>();
  for (const [parent, kids] of tree.childrenOf) {
    const visKids = kids.filter((k) => visible.has(k));
    if (visKids.length > 0) children.set(parent, visKids);
  }

  const roots = nodes.map((n) => n.id).filter((id) => {
    const parent = tree.parentOf.get(id);
    return !parent || !visible.has(parent);
  });
  if (roots.length === 0) return nodes;

  const leafCountCache = new Map<string, number>();
  function leafCount(id: string): number {
    const cached = leafCountCache.get(id);
    if (cached != null) return cached;
    const kids = children.get(id) ?? [];
    const count = kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + leafCount(k), 0);
    leafCountCache.set(id, count);
    return count;
  }
  const totalLeaves = roots.reduce((sum, r) => sum + leafCount(r), 0);

  let maxDepth = 0;
  function walkDepth(id: string, depth: number) {
    maxDepth = Math.max(maxDepth, depth);
    for (const kid of children.get(id) ?? []) walkDepth(kid, depth + 1);
  }
  const rootDepth = roots.length === 1 ? 0 : 1;
  for (const r of roots) walkDepth(r, rootDepth);

  const anglePerLeaf = (2 * Math.PI) / Math.max(totalLeaves, 1);
  const outerRadius = MIN_LEAF_GAP / anglePerLeaf;
  // Nunca deixa o anel mais espremido que MIN_RING_SPACING só porque a árvore é funda — a
  // densidade de folhas só pode *aumentar* o espaçamento entre pai e filho, nunca reduzi-lo.
  const ringSpacing = maxDepth > 0 ? Math.max(MIN_RING_SPACING, outerRadius / maxDepth) : MIN_RING_SPACING;

  const positions = new Map<string, { x: number; y: number }>();

  function place(id: string, angleStart: number, angleEnd: number, depth: number) {
    const angle = (angleStart + angleEnd) / 2;
    const radius = depth === 0 ? 0 : depth * ringSpacing;
    positions.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });

    const kids = children.get(id) ?? [];
    if (kids.length === 0) return;
    const counts = kids.map((k) => leafCount(k));
    const total = counts.reduce((a, b) => a + b, 0);
    let cursor = angleStart;
    kids.forEach((kid, i) => {
      const span = (angleEnd - angleStart) * (counts[i] / total);
      place(kid, cursor, cursor + span, depth + 1);
      cursor += span;
    });
  }

  if (roots.length === 1) {
    place(roots[0], 0, 2 * Math.PI, 0);
  } else {
    const counts = roots.map((r) => leafCount(r));
    const total = counts.reduce((a, b) => a + b, 0);
    let cursor = 0;
    roots.forEach((r, i) => {
      const span = 2 * Math.PI * (counts[i] / total);
      place(r, cursor, cursor + span, 1);
      cursor += span;
    });
  }

  return nodes.map((node) => {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    return { ...node, position: { x: pos.x - RADIAL_NODE_SIZE / 2, y: pos.y - RADIAL_NODE_SIZE / 2 } };
  });
}
