import type { TopologyLinkOut, TopologyNodeOut } from "@/lib/types";

/**
 * Árvore da topologia desenhada da esquerda para a direita:
 *
 *             ┌─● SW-01 ─┬─● ONU-01
 *             │          └─● ONU-02
 *   ● CORE ───┼─● SW-02 ───● ONU-03
 *             └─● SW-03
 *
 * - cada nível de profundidade é uma coluna; a largura da coluna é a do nó
 *   (círculo + nome) mais largo dela, então nenhum nome invade a próxima;
 * - irmãos ficam empilhados; cada sub-árvore ocupa só a altura que precisa
 *   (árvore compacta) e o pai fica centralizado entre o primeiro e o último
 *   filho, o que deixa cada leque simétrico.
 */

export interface TreeIndex {
  childrenOf: Map<string, string[]>;
  parentOf: Map<string, string>;
  roots: string[];
}

/** Espaço vertical entre dois nós vizinhos. */
export const ROW_GAP = 28;
/** Espaço horizontal entre o fim de uma coluna e o início da próxima. */
export const COLUMN_GAP = 56;
/** Espaço extra entre árvores independentes (várias raízes). */
const ROOT_GAP = 16;

/**
 * Deriva a hierarquia do grafo de topologia. Usa os links "parent" (os que o
 * campo "ativo pai" gera); se o site não tiver nenhum, usa todos os links.
 * Cada nó fica com no máximo um pai, e links que fechariam ciclo são ignorados.
 */
export function buildTreeIndex(nodes: TopologyNodeOut[], edges: TopologyLinkOut[]): TreeIndex {
  const known = new Set(nodes.map((n) => n.id));
  const parentEdges = edges.filter((e) => e.link_type === "parent");
  const treeEdges = parentEdges.length > 0 ? parentEdges : edges;

  const parentOf = new Map<string, string>();
  const createsCycle = (parent: string, child: string) => {
    let cur: string | undefined = parent;
    while (cur) {
      if (cur === child) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };
  for (const e of treeEdges) {
    const { source_asset_id: parent, target_asset_id: child } = e;
    if (!known.has(parent) || !known.has(child) || parent === child) continue;
    if (parentOf.has(child) || createsCycle(parent, child)) continue;
    parentOf.set(child, parent);
  }

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    const parent = parentOf.get(n.id);
    if (!parent) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(n.id);
    childrenOf.set(parent, list);
  }
  const roots = nodes.filter((n) => !parentOf.has(n.id)).map((n) => n.id);
  return { childrenOf, parentOf, roots };
}

/** Caminho raiz → nó, incluindo o próprio nó. */
export function ancestorChain(id: string, tree: TreeIndex): string[] {
  const chain = [id];
  let cur = tree.parentOf.get(id);
  while (cur) {
    chain.unshift(cur);
    cur = tree.parentOf.get(cur);
  }
  return chain;
}

/** Quantos descendentes um nó tem (para o "+N" de um nó recolhido). */
export function countDescendants(id: string, tree: TreeIndex): number {
  let count = 0;
  const stack = [...(tree.childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    count++;
    stack.push(...(tree.childrenOf.get(cur) ?? []));
  }
  return count;
}

export interface TreeLayout {
  /** Canto superior esquerdo de cada nó visível. */
  positions: Map<string, { x: number; y: number }>;
  /** Filhos visíveis de cada nó (os de nós recolhidos ficam de fora). */
  visibleChildren: Map<string, string[]>;
}

/**
 * Calcula a posição de cada nó visível.
 * @param nodeWidth largura do nó (círculo + nome + botão de recolher)
 * @param nodeHeight altura do nó; y é o topo, centralizado na linha
 */
export function layoutTree(
  tree: TreeIndex,
  collapsed: Set<string>,
  nodeWidth: (id: string) => number,
  nodeHeight: number,
): TreeLayout {
  const visibleChildren = new Map<string, string[]>();
  const depthOf = new Map<string, number>();
  const columnWidth: number[] = [];

  const walk = (id: string, depth: number) => {
    depthOf.set(id, depth);
    columnWidth[depth] = Math.max(columnWidth[depth] ?? 0, nodeWidth(id));
    const kids = collapsed.has(id) ? [] : (tree.childrenOf.get(id) ?? []);
    visibleChildren.set(id, kids);
    kids.forEach((k) => walk(k, depth + 1));
  };
  tree.roots.forEach((r) => walk(r, 0));

  const columnX: number[] = [0];
  for (let d = 1; d < columnWidth.length; d++) columnX[d] = columnX[d - 1] + columnWidth[d - 1] + COLUMN_GAP;

  // Árvore compacta: contornos (menor e maior y por nível) de cada sub-árvore,
  // relativos ao próprio nó. Cada sub-árvore irmã desce só o necessário para
  // ficar a ROW_GAP da anterior em todos os níveis.
  const offset = new Map<string, number>();
  const measure = (id: string): { top: number[]; bottom: number[] } => {
    const kids = visibleChildren.get(id) ?? [];
    if (kids.length === 0) return { top: [0], bottom: [0] };

    let top: number[] = [];
    let bottom: number[] = [];
    const shifts: number[] = [];
    kids.forEach((kid, i) => {
      const c = measure(kid);
      let shift = 0;
      if (i > 0) {
        shift = -Infinity;
        for (let l = 0; l < Math.min(bottom.length, c.top.length); l++) {
          shift = Math.max(shift, bottom[l] + ROW_GAP - c.top[l]);
        }
      }
      shifts.push(shift);
      const levels = Math.max(top.length, c.top.length);
      const nextTop: number[] = [];
      const nextBottom: number[] = [];
      for (let l = 0; l < levels; l++) {
        const inAcc = l < top.length;
        const inKid = l < c.top.length;
        nextTop.push(inAcc ? top[l] : c.top[l] + shift);
        nextBottom.push(inKid ? c.bottom[l] + shift : bottom[l]);
      }
      top = nextTop;
      bottom = nextBottom;
    });

    const mid = (shifts[0] + shifts[shifts.length - 1]) / 2;
    kids.forEach((kid, i) => offset.set(kid, shifts[i] - mid));
    return { top: [0, ...top.map((v) => v - mid)], bottom: [0, ...bottom.map((v) => v - mid)] };
  };

  const positions = new Map<string, { x: number; y: number }>();
  const place = (id: string, centerY: number) => {
    positions.set(id, { x: columnX[depthOf.get(id) ?? 0], y: centerY - nodeHeight / 2 });
    for (const kid of visibleChildren.get(id) ?? []) place(kid, centerY + (offset.get(kid) ?? 0));
  };

  let cursorY = 0;
  for (const root of tree.roots) {
    const contour = measure(root);
    const above = -Math.min(...contour.top);
    const below = Math.max(...contour.bottom);
    place(root, cursorY + above);
    cursorY += above + below + ROW_GAP + ROOT_GAP;
  }

  return { positions, visibleChildren };
}
