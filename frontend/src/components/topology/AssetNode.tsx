import { ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { StatusShape } from "@/components/StatusBadge";
import type { AssetStatus } from "@/lib/types";
import type { LayoutDirection } from "@/lib/dagre-layout";

export interface AssetNodeData {
  name: string;
  status: AssetStatus;
  rtt: number | null;
  direction: LayoutDirection;
  highlighted: boolean;
  hasChildren: boolean;
  childCount: number;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onFocus: (id: string) => void;
  [key: string]: unknown;
}

const handleClass = "!h-1.5 !w-1.5 !border !border-border !bg-background";

export function AssetNode({ id, data, selected }: NodeProps) {
  const { name, status, rtt, direction, highlighted, hasChildren, childCount, collapsed, onToggleCollapse, onFocus } =
    data as AssetNodeData;
  const horizontal = direction === "LR";

  return (
    <div
      className={`group flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs transition-all ${
        selected || highlighted ? "border-primary shadow-sm ring-1 ring-primary/30" : "border-border"
      }`}
      style={{ width: 176 }}
    >
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} className={handleClass} />

      <StatusShape status={status} size={10} />

      <span className="flex min-w-0 flex-1 items-baseline gap-1 truncate">
        <span className="truncate font-medium" title={name}>
          {name}
        </span>
        {rtt != null && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">({rtt} ms)</span>}
      </span>

      {hasChildren && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFocus(id);
            }}
            className="shrink-0 text-muted-foreground opacity-40 hover:text-foreground hover:opacity-100 group-hover:opacity-100"
            title="Centralizar a topologia neste ativo"
          >
            <Crosshair className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(id);
            }}
            className="flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-[10px] text-muted-foreground hover:text-foreground"
            title={collapsed ? `Expandir ${childCount} filho(s)` : "Recolher filhos"}
          >
            {collapsed ? <ChevronRight className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            {collapsed && childCount}
          </button>
        </>
      )}

      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} className={handleClass} />
    </div>
  );
}
