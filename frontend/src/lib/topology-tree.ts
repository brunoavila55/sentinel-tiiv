import type { TopologyLinkOut, TopologyNodeOut } from "@/lib/types";

export interface TreeIndex {
  childrenOf: Map<string, string[]>;
  parentOf: Map<string, string>;
  roots: string[];
}

/**
 * Deriva a estrutura de árvore a partir do grafo genérico de topologia.
 * Prioriza arestas link_type="parent" (é o que o import em massa e o
 * campo "ativo pai" do formulário produzem). Se um site não tiver
 * nenhuma aresta desse tipo — por exemplo, uma malha desenhada só pelo
 * editor manual com link_type="connection" — usa todas as arestas como
 * fallback, para o recolhimento por hierarquia continuar fazendo sentido
 * mesmo nesse caso.
 */
export function buildTreeIndex(nodes: TopologyNodeOut[], edges: TopologyLinkOut[]): TreeIndex {
  const parentEdges = edges.filter((e) => e.link_type === "parent");
  const treeEdges = parentEdges.length > 0 ? parentEdges : edges;

  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();

  for (const edge of treeEdges) {
    if (parentOf.has(edge.target_asset_id)) continue; // um nó só tem um pai na árvore
    parentOf.set(edge.target_asset_id, edge.source_asset_id);
    const siblings = childrenOf.get(edge.source_asset_id) ?? [];
    siblings.push(edge.target_asset_id);
    childrenOf.set(edge.source_asset_id, siblings);
  }

  const roots = nodes.map((n) => n.id).filter((id) => !parentOf.has(id));

  return { childrenOf, parentOf, roots };
}

/** Caminho raiz → nó, incluindo o próprio nó. */
export function ancestorChain(nodeId: string, tree: TreeIndex): string[] {
  const chain = [nodeId];
  let current = nodeId;
  const visited = new Set([current]);
  while (tree.parentOf.has(current)) {
    const parent = tree.parentOf.get(current) as string;
    if (visited.has(parent)) break; // proteção contra ciclo inesperado
    chain.unshift(parent);
    visited.add(parent);
    current = parent;
  }
  return chain;
}

/** Ids cujos filhos devem começar ocultos — usado pelo modo "Flat" (profundidade 1: raiz + filhos diretos visíveis). */
export function collapseAtDepth(tree: TreeIndex, depth: number): Set<string> {
  const collapsed = new Set<string>();
  function walk(id: string, level: number) {
    const children = tree.childrenOf.get(id) ?? [];
    if (children.length === 0) return;
    if (level >= depth) {
      collapsed.add(id);
      return;
    }
    for (const child of children) walk(child, level + 1);
  }
  for (const root of tree.roots) walk(root, 0);
  return collapsed;
}

/** BFS a partir de `startIds`: não desce para dentro de um nó presente em `collapsedIds`. */
export function visibleDescendants(startIds: string[], tree: TreeIndex, collapsedIds: Set<string>): Set<string> {
  const visible = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visible.has(id)) continue;
    visible.add(id);
    if (collapsedIds.has(id)) continue;
    for (const child of tree.childrenOf.get(id) ?? []) queue.push(child);
  }
  return visible;
}
