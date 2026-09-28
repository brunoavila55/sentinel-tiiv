import { computeForceLayout, type ForceOptions } from "@/lib/force-layout";
import type { TreeIndex } from "@/lib/topology-tree";

/**
 * Estilos de layout da topologia, espelhando os do Checkmk (nodevis):
 * - force: simulação de forças (padrão da topologia do Checkmk);
 * - hierarchy: árvore da esquerda para a direita;
 * - radial: raiz no centro, cada nível em um raio maior.
 *
 * Todas as funções devolvem o CENTRO de cada nó; o deslocamento pelo raio
 * do círculo é feito na montagem dos nós do React Flow.
 */
export type TopologyLayoutStyle = "force" | "hierarchy" | "radial";

/** Onde o rótulo fica em relação ao círculo. */
export type LabelPlacement =
  | { kind: "corner" } // abaixo-direita, como no Checkmk
  | { kind: "right" }
  | { kind: "radial"; angle: number };

export interface LayoutPoint {
  x: number;
  y: number;
  label: LabelPlacement;
}

const HIERARCHY_RANK_GAP = 210;
const HIERARCHY_ROW_GAP = 26;
const RADIAL_RING_GAP = 150;
const RADIAL_LEAF_GAP = 24;

function visibleChildren(ids: Set<string>, tree: TreeIndex) {
  const children = new Map<string, string[]>();
  for (const [parent, kids] of tree.childrenOf) {
    if (!ids.has(parent)) continue;
    const vis = kids.filter((k) => ids.has(k));
    if (vis.length > 0) children.set(parent, vis);
  }
  const roots = [...ids].filter((id) => {
    const parent = tree.parentOf.get(id);
    return !parent || !ids.has(parent);
  });
  return { children, roots };
}

function leafCounter(children: Map<string, string[]>) {
  const cache = new Map<string, number>();
  const count = (id: string): number => {
    const cached = cache.get(id);
    if (cached != null) return cached;
    const kids = children.get(id) ?? [];
    const n = kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + count(k), 0);
    cache.set(id, n);
    return n;
  };
  return count;
}

export function layoutHierarchy(ids: Set<string>, tree: TreeIndex): Map<string, LayoutPoint> {
  const { children, roots } = visibleChildren(ids, tree);
  const out = new Map<string, LayoutPoint>();
  let row = 0;

  function place(id: string, depth: number): number {
    const kids = children.get(id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = row * HIERARCHY_ROW_GAP;
      row++;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    out.set(id, { x: depth * HIERARCHY_RANK_GAP, y, label: { kind: "right" } });
    return y;
  }

  for (const root of roots) {
    place(root, 0);
    row += 1; // linha vazia entre árvores independentes
  }
  return out;
}

export function layoutRadial(ids: Set<string>, tree: TreeIndex): Map<string, LayoutPoint> {
  const { children, roots } = visibleChildren(ids, tree);
  const out = new Map<string, LayoutPoint>();
  if (roots.length === 0) return out;

  const leafCount = leafCounter(children);
  const totalLeaves = roots.reduce((sum, r) => sum + leafCount(r), 0);

  let maxDepth = 0;
  const walk = (id: string, d: number) => {
    maxDepth = Math.max(maxDepth, d);
    for (const k of children.get(id) ?? []) walk(k, d + 1);
  };
  const rootDepth = roots.length === 1 ? 0 : 1;
  roots.forEach((r) => walk(r, rootDepth));

  // Raio externo grande o bastante para as folhas não se encostarem.
  const outer = (totalLeaves * RADIAL_LEAF_GAP) / (2 * Math.PI);
  const ringGap = Math.max(RADIAL_RING_GAP, maxDepth > 0 ? outer / maxDepth : 0);

  function place(id: string, start: number, end: number, depth: number) {
    const angle = (start + end) / 2;
    const r = depth * ringGap;
    out.set(id, {
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
      label: depth === 0 ? { kind: "corner" } : { kind: "radial", angle },
    });
    const kids = children.get(id) ?? [];
    let cursor = start;
    const span = end - start;
    const total = leafCount(id);
    for (const k of kids) {
      const slice = (span * leafCount(k)) / total;
      place(k, cursor, cursor + slice, depth + 1);
      cursor += slice;
    }
  }

  if (roots.length === 1) {
    place(roots[0], 0, 2 * Math.PI, 0);
  } else {
    let cursor = 0;
    for (const r of roots) {
      const slice = (2 * Math.PI * leafCount(r)) / totalLeaves;
      place(r, cursor, cursor + slice, 1);
      cursor += slice;
    }
  }
  return out;
}

/**
 * Força: parte do layout radial compactado (converge mais rápido e mantém
 * ramos da mesma sub-árvore juntos) e deixa a simulação acomodar os nós.
 * Com uma única raiz, ela fica presa no centro — como o nó raiz no Checkmk.
 */
export function layoutForce(
  ids: Set<string>,
  tree: TreeIndex,
  links: Array<{ source: string; target: string }>,
  options: ForceOptions,
): Map<string, LayoutPoint> {
  const seed = layoutRadial(ids, tree);
  const { roots } = visibleChildren(ids, tree);
  const singleRoot = roots.length === 1 ? roots[0] : null;

  const positions = computeForceLayout(
    [...ids].map((id) => {
      const p = seed.get(id) ?? { x: 0, y: 0 };
      return { id, x: p.x * 0.35, y: p.y * 0.35, fixed: id === singleRoot };
    }),
    links,
    options,
  );

  const out = new Map<string, LayoutPoint>();
  for (const [id, p] of positions) out.set(id, { x: p.x, y: p.y, label: { kind: "corner" } });
  return out;
}
