import { BaseEdge, type EdgeProps } from "@xyflow/react";

/**
 * Aresta com uma curva suave (bézier quadrática com um único ponto de controle deslocado
 * perpendicularmente ao segmento pai-filho), em vez de uma linha reta ou dos ângulos fixos
 * (topo/base) que a curva bézier padrão do React Flow assume — aqui os nós ficam em qualquer
 * direção ao redor do centro, então uma curva baseada em lado fixo ficaria torta.
 */
export function RadialEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = Math.min(dist * 0.18, 28);
  const nx = -dy / dist;
  const ny = dx / dist;
  const cx = (sourceX + targetX) / 2 + nx * bow;
  const cy = (sourceY + targetY) / 2 + ny * bow;

  const path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`;

  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}
