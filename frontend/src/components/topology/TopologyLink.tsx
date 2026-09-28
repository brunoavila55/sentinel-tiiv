import { memo } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";

/**
 * Link em "S" simétrico: sai do fim do nó pai na horizontal e chega no início
 * do nó filho na horizontal, com os dois pontos de controle no meio do caminho.
 */
export const TopologyLink = memo(function TopologyLink({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  interactionWidth,
}: EdgeProps) {
  const mx = (sourceX + targetX) / 2;
  const path = `M ${sourceX} ${sourceY} C ${mx} ${sourceY}, ${mx} ${targetY}, ${targetX} ${targetY}`;
  return <BaseEdge path={path} style={style} interactionWidth={interactionWidth} />;
});
