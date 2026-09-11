import { ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";

import { StatusShape } from "@/components/StatusBadge";
import { RADIAL_NODE_SIZE } from "@/lib/radial-layout";
import type { AssetStatus } from "@/lib/types";

export interface RadialAssetNodeData {
  name: string;
  status: AssetStatus;
  /** Ângulo (radianos) do raio pai→nó no layout radial; usado para orientar o rótulo. */
  angle: number;
  highlighted: boolean;
  hasChildren: boolean;
  childCount: number;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onFocus: (id: string) => void;
  [key: string]: unknown;
}

/** Ponto central do nó, independente de `Position` — as arestas são retas (raios), não curvas com lado fixo. */
const centeredHandle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0 } as const;

const zoomSelector = (state: { transform: [number, number, number] }) => state.transform[2];

/**
 * Nó compacto no estilo "statusmap" (Nagios/Zabbix): só a bolinha de estado, com o rótulo
 * escalado no sentido inverso ao zoom do canvas (permanece do mesmo tamanho na tela em vez de
 * encolher junto com o zoom-out) e ocultado abaixo de um certo zoom para não virar poluição
 * visual com centenas de nós simultâneos.
 */
export function RadialAssetNode({ id, data, selected }: NodeProps) {
  const { name, status, angle, highlighted, hasChildren, childCount, collapsed, onToggleCollapse, onFocus } =
    data as RadialAssetNodeData;
  const zoom = useStore(zoomSelector);
  const labelVisible = zoom > 0.35;
  const labelScale = 1 / Math.max(zoom, 0.001);

  // Rótulo alinhado ao raio pai→nó, para o texto "sair" do nó na mesma direção do galho.
  // Na metade esquerda do círculo o raio aponta para a esquerda, então o rótulo é girado
  // mais 180° e ancorado pela ponta oposta — senão o texto ficaria de cabeça para baixo.
  const angleDeg = (angle * 180) / Math.PI;
  const flip = Math.cos(angle) < 0;
  const labelOffset = RADIAL_NODE_SIZE / 2 + 6;

  return (
    <div className="group relative flex flex-col items-center" style={{ width: RADIAL_NODE_SIZE }}>
      <Handle type="target" position={Position.Top} style={centeredHandle} />

      {hasChildren && (
        <div className="pointer-events-none absolute -top-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFocus(id);
            }}
            className="rounded border border-border bg-card p-0.5 text-muted-foreground hover:text-foreground"
            title="Centralizar a topologia neste ativo"
          >
            <Crosshair className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(id);
            }}
            className="flex items-center rounded border border-border bg-card px-0.5 text-muted-foreground hover:text-foreground"
            title={collapsed ? `Expandir ${childCount} filho(s)` : "Recolher filhos"}
          >
            {collapsed ? <ChevronRight className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
          </button>
        </div>
      )}

      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: RADIAL_NODE_SIZE,
          height: RADIAL_NODE_SIZE,
          boxShadow:
            selected || highlighted ? "0 0 0 3px color-mix(in oklch, var(--primary), transparent 25%)" : undefined,
        }}
      >
        <StatusShape status={status} size={RADIAL_NODE_SIZE} />
        {collapsed && (
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-background bg-foreground px-0.5 text-[8px] font-semibold leading-none text-background">
            {childCount}
          </span>
        )}
      </div>

      {labelVisible && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{ transform: `rotate(${angleDeg}deg)`, transformOrigin: "0 0" }}
        >
          <div style={{ transform: `translateX(${labelOffset}px) rotate(${flip ? 180 : 0}deg)`, transformOrigin: "0 0" }}>
            <span
              className={`absolute top-0 whitespace-nowrap rounded px-1 text-[10px] leading-tight ${
                flip ? "right-0" : "left-0"
              } ${highlighted ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground"}`}
              style={{
                transform: `translateY(-50%) scale(${labelScale})`,
                transformOrigin: flip ? "right center" : "left center",
              }}
              title={name}
            >
              {name}
            </span>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={centeredHandle} />
    </div>
  );
}
