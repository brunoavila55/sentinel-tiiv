/**
 * Layout por simulação de forças, no mesmo modelo do "nodevis" do Checkmk
 * (que usa d3-force): repulsão entre todos os nós, molas nos links, colisão e
 * uma força fraca puxando para o centro. A simulação roda de forma síncrona até
 * esfriar — o resultado é estático, sem animação contínua na tela.
 *
 * Implementação própria (mesmas equações do d3-force) para não adicionar
 * dependência só por isso. Repulsão e colisão são O(n²) por iteração: ok para
 * algumas centenas de nós por site; acima disso vale trocar por Barnes-Hut.
 */

export interface ForceOptions {
  /** Repulsão entre nós (negativo afasta). */
  charge: number;
  /** Força que puxa todos os nós para o centro. */
  center: number;
  /** Raio da caixa de colisão de cada nó. */
  collide: number;
  /** Comprimento de repouso de cada link. */
  link_distance: number;
  /** Rigidez de cada link. */
  link_strength: number;
}

/** Valores padrão do Checkmk (ForceConfig.get_style_options). */
export const DEFAULT_FORCE_OPTIONS: ForceOptions = {
  charge: -300,
  center: 0.05,
  collide: 15,
  link_distance: 30,
  link_strength: 0.3,
};

export interface ForceNodeInput {
  id: string;
  x: number;
  y: number;
  /** Nó fixo (não se move) — usado para prender a raiz no centro. */
  fixed?: boolean;
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

const ITERATIONS = 300;
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / ITERATIONS);
const VELOCITY_DECAY = 0.4;
const CHARGE_DISTANCE_MAX2 = 800 * 800;

/** PRNG determinístico: o mesmo site sempre produz o mesmo desenho. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (1664525 * s + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function computeForceLayout(
  inputNodes: ForceNodeInput[],
  links: Array<{ source: string; target: string }>,
  options: ForceOptions = DEFAULT_FORCE_OPTIONS,
): Map<string, { x: number; y: number }> {
  const random = lcg(inputNodes.length * 7919 + links.length);
  const jiggle = () => (random() - 0.5) * 1e-6;

  const nodes: SimNode[] = inputNodes.map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    vx: 0,
    vy: 0,
    fixed: !!n.fixed,
  }));
  const byId = new Map(nodes.map((n, i) => [n.id, i]));

  const simLinks = links
    .map((l) => ({ s: byId.get(l.source), t: byId.get(l.target) }))
    .filter((l): l is { s: number; t: number } => l.s != null && l.t != null && l.s !== l.t);

  const degree = new Array(nodes.length).fill(0);
  for (const l of simLinks) {
    degree[l.s]++;
    degree[l.t]++;
  }
  const bias = simLinks.map((l) => degree[l.s] / (degree[l.s] + degree[l.t]));

  const collideR = options.collide;
  const collideR2 = (2 * collideR) * (2 * collideR);

  let alpha = 1;
  for (let iter = 0; iter < ITERATIONS && alpha >= ALPHA_MIN; iter++) {
    alpha += (0 - alpha) * ALPHA_DECAY;

    // Links (molas)
    for (let i = 0; i < simLinks.length; i++) {
      const s = nodes[simLinks[i].s];
      const t = nodes[simLinks[i].t];
      let x = t.x + t.vx - s.x - s.vx || jiggle();
      let y = t.y + t.vy - s.y - s.vy || jiggle();
      let l = Math.sqrt(x * x + y * y);
      l = ((l - options.link_distance) / l) * alpha * options.link_strength;
      x *= l;
      y *= l;
      const b = bias[i];
      t.vx -= x * b;
      t.vy -= y * b;
      s.vx += x * (1 - b);
      s.vy += y * (1 - b);
    }

    // Repulsão (many-body)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if (dx === 0) dx = jiggle();
        if (dy === 0) dy = jiggle();
        let l2 = dx * dx + dy * dy;
        if (l2 >= CHARGE_DISTANCE_MAX2) continue;
        if (l2 < 1) l2 = Math.sqrt(l2);
        const w = (options.charge * alpha) / l2;
        a.vx += dx * w;
        a.vy += dy * w;
        b.vx -= dx * w;
        b.vy -= dy * w;
      }
    }

    // Centro (forceX/forceY com alvo em 0,0)
    for (const n of nodes) {
      n.vx += (0 - n.x) * options.center * alpha;
      n.vy += (0 - n.y) * options.center * alpha;
    }

    // Colisão
    if (collideR > 0) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const ax = a.x + a.vx;
        const ay = a.y + a.vy;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let x = ax - b.x - b.vx;
          let y = ay - b.y - b.vy;
          let l = x * x + y * y;
          if (l >= collideR2) continue;
          if (x === 0) x = jiggle();
          if (y === 0) y = jiggle();
          l = Math.sqrt(x * x + y * y);
          l = (2 * collideR - l) / l / 2;
          a.vx += x * l;
          a.vy += y * l;
          b.vx -= x * l;
          b.vy -= y * l;
        }
      }
    }

    // Integração
    for (const n of nodes) {
      if (n.fixed) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= 1 - VELOCITY_DECAY;
      n.vy *= 1 - VELOCITY_DECAY;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  return new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}
