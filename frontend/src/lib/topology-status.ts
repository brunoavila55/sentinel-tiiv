import type { AssetStatus } from "@/lib/types";

/** Cores de estado do Checkmk (tema facelift): OK, WARN, CRIT e pendente. */
export const TOPOLOGY_STATUS_COLOR: Record<AssetStatus, string> = {
  up: "#13d389",
  warning: "#ffd703",
  down: "#ff3232",
  unknown: "#9a9a9a",
};

export const STATUS_LABEL: Record<AssetStatus, string> = {
  up: "UP",
  warning: "WARN",
  down: "DOWN",
  unknown: "PEND",
};

/** Raio do círculo (px), como no nodevis do Checkmk: host 9, raiz maior. */
export const HOST_RADIUS = 9;
export const ROOT_RADIUS = 13;
