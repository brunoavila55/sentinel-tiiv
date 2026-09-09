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
  [key: string]: unknown;
}

const handleClass = "!h-1.5 !w-1.5 !border !border-border !bg-background";

export function AssetNode({ data, selected }: NodeProps) {
  const { name, status, rtt, direction, highlighted } = data as AssetNodeData;
  const horizontal = direction === "LR";

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-md border bg-card px-2 py-1.5 text-center transition-colors ${
        selected || highlighted ? "border-primary" : "border-border"
      }`}
      style={{ width: 112 }}
    >
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} className={handleClass} />
      <StatusShape status={status} size={10} />
      <span className="w-full truncate text-xs font-medium" title={name}>
        {name}
      </span>
      {rtt != null && <span className="font-mono text-[10px] text-muted-foreground">{rtt} ms</span>}
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} className={handleClass} />
    </div>
  );
}
