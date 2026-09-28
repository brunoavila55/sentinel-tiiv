import { memo, type CSSProperties } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";

import type { LabelPlacement } from "@/lib/topology-layout";
import { STATUS_LABEL, TOPOLOGY_STATUS_COLOR } from "@/lib/topology-status";
import type { AssetStatus } from "@/lib/types";

/** Glifo dentro do círculo: o estado não depende só da cor. */
const STATUS_GLYPH: Record<AssetStatus, string> = {
  up: "",
  warning: "!",
  down: "×",
  unknown: "?",
};

export interface TopologyHostNodeData {
  name: string;
  status: AssetStatus;
  radius: number;
  label: LabelPlacement;
  /** Filhos ocultos (nó recolhido) — desenhado com anel grosso, como no Checkmk. */
  hiddenChildren: number;
  focused: boolean;
  highlighted: boolean;
  dimmed: boolean;
  [key: string]: unknown;
}

const handleStyle: CSSProperties = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  opacity: 0,
};

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2];

function labelStyle(label: LabelPlacement, r: number): CSSProperties {
  const gap = r + 3;
  if (label.kind === "corner") {
    // Checkmk: translate(r + 3, r + 3), text-anchor start
    return { left: r + gap, top: r + gap - 9 };
  }
  if (label.kind === "right") {
    return { left: r + gap, top: r, transform: "translateY(-50%)" };
  }
  // Radial: texto ao longo do raio, virado para não ficar de cabeça para baixo.
  const deg = (label.angle * 180) / Math.PI;
  const flip = Math.cos(label.angle) < 0;
  return {
    left: r,
    top: r - 6,
    height: 12,
    lineHeight: "12px",
    transformOrigin: "0 50%",
    transform: `rotate(${flip ? deg + 180 : deg}deg) translateX(${flip ? `calc(-100% - ${gap}px)` : `${gap}px`})`,
    textAlign: flip ? "right" : "left",
  };
}

export const TopologyHostNode = memo(function TopologyHostNode({ data, selected }: NodeProps) {
  const { name, status, radius, label, hiddenChildren, focused, highlighted, dimmed } =
    data as TopologyHostNodeData;
  const zoom = useStore(zoomSelector);
  const d = radius * 2;
  const color = TOPOLOGY_STATUS_COLOR[status] ?? TOPOLOGY_STATUS_COLOR.unknown;

  // Anel: seleção (azul), busca (cor do texto) ou recolhido (anel grosso na cor do estado).
  let ring: CSSProperties = {};
  if (selected || focused) ring = { boxShadow: "0 0 0 3px #1e90ff" };
  else if (highlighted) ring = { boxShadow: "0 0 0 3px var(--foreground)" };
  else if (hiddenChildren > 0) ring = { boxShadow: `0 0 0 5px ${color}55` };

  return (
    <div
      className="relative"
      style={{ width: d, height: d, opacity: dimmed ? 0.25 : 1 }}
      title={`${name} — ${STATUS_LABEL[status]}${hiddenChildren > 0 ? ` · ${hiddenChildren} ocultos` : ""}`}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div
        className="flex items-center justify-center rounded-full font-mono font-bold leading-none text-black/75"
        style={{ width: d, height: d, background: color, fontSize: radius, ...ring }}
      >
        {STATUS_GLYPH[status]}
      </div>
      {hiddenChildren > 0 && zoom > 0.45 && (
        <span
          className="absolute rounded-sm bg-foreground px-0.5 font-mono text-[8px] font-semibold leading-tight text-background"
          style={{ left: d - 3, top: -7 }}
        >
          +{hiddenChildren}
        </span>
      )}
      {zoom > 0.45 && (
        <span
          className="topology-host-label pointer-events-none absolute whitespace-nowrap text-[11px] leading-none text-foreground"
          style={{ ...labelStyle(label, radius), fontWeight: selected || highlighted ? 600 : 400 }}
        >
          {name}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </div>
  );
});
