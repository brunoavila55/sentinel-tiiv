import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { CIRCLE_SIZE, LABEL_GAP, NODE_HEIGHT, STATUS_COLOR, STATUS_TEXT } from "@/lib/topology-style";
import type { AssetStatus } from "@/lib/types";

/** Símbolo dentro do círculo, para o estado não depender só da cor. */
const STATUS_GLYPH: Record<AssetStatus, string> = { up: "", warning: "!", down: "×", unknown: "?" };

export interface TopologyNodeData {
  name: string;
  status: AssetStatus;
  width: number;
  labelWidth: number;
  /** Largura do botão de recolher, incluindo a margem (0 se não tem filhos). */
  toggleWidth: number;
  childCount: number;
  hiddenCount: number;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
  editing: boolean;
  onToggle: (id: string) => void;
  [key: string]: unknown;
}

function handleStyle(side: "left" | "right", visible: boolean): CSSProperties {
  return {
    [side]: 0,
    top: "50%",
    width: visible ? 8 : 1,
    height: visible ? 8 : 1,
    minWidth: 0,
    minHeight: 0,
    border: 0,
    background: visible ? "var(--primary)" : "transparent",
    transform: `translate(${side === "left" ? "-50%" : "50%"}, -50%)`,
  };
}

export const TopologyNode = memo(function TopologyNode({ id, data }: NodeProps) {
  const d = data as TopologyNodeData;
  const color = STATUS_COLOR[d.status] ?? STATUS_COLOR.unknown;
  const ring = d.selected
    ? "0 0 0 2px var(--background), 0 0 0 4px var(--primary)"
    : d.highlighted
      ? "0 0 0 2px var(--background), 0 0 0 4px var(--foreground)"
      : undefined;

  return (
    <div
      className="flex items-center"
      style={{ width: d.width, height: NODE_HEIGHT, opacity: d.dimmed ? 0.25 : 1 }}
      title={`${d.name} — ${STATUS_TEXT[d.status]}`}
    >
      <Handle type="target" position={Position.Left} style={handleStyle("left", d.editing)} />
      <span
        className="flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] leading-none font-bold text-black/70"
        style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE, background: color, boxShadow: ring }}
        aria-label={STATUS_TEXT[d.status]}
      >
        {STATUS_GLYPH[d.status]}
      </span>
      <span
        className="shrink-0 whitespace-nowrap text-xs leading-4 text-foreground"
        style={{ marginLeft: LABEL_GAP, width: d.labelWidth, fontWeight: d.selected || d.highlighted ? 600 : 500 }}
      >
        {d.name}
      </span>
      {d.childCount > 0 && (
        <button
          type="button"
          className="nodrag nopan ml-1.5 flex h-4 shrink-0 items-center justify-center rounded-sm border border-border bg-background px-1 font-mono text-[10px] leading-none text-muted-foreground hover:border-foreground hover:text-foreground"
          style={{ width: d.toggleWidth - 6 }}
          onClick={(e) => {
            e.stopPropagation();
            d.onToggle(id);
          }}
          aria-label={d.hiddenCount > 0 ? `Expandir ${d.hiddenCount} ativos` : "Recolher ramificação"}
          title={d.hiddenCount > 0 ? `Expandir ${d.hiddenCount} ativos` : "Recolher ramificação"}
        >
          {d.hiddenCount > 0 ? `+${d.hiddenCount}` : "−"}
        </button>
      )}
      <Handle type="source" position={Position.Right} style={handleStyle("right", d.editing)} />
    </div>
  );
});
