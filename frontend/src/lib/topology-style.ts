import type { AssetStatus } from "@/lib/types";

/** Cores de estado dos nós (as do Checkmk). */
export const STATUS_COLOR: Record<AssetStatus, string> = {
  up: "#13d389",
  warning: "#ffd703",
  down: "#ff3232",
  unknown: "#9a9a9a",
};

export const STATUS_TEXT: Record<AssetStatus, string> = {
  up: "UP",
  warning: "WARNING",
  down: "DOWN",
  unknown: "UNKNOWN",
};

/** Medidas do nó — usadas pelo componente e pelo layout para calcular as colunas. */
export const NODE_HEIGHT = 16;
export const CIRCLE_SIZE = 14;
export const LABEL_GAP = 6;

/** Largura do botão "−" / "+N" (com a margem de 6 px antes dele). */
export function toggleWidth(hiddenCount: number): number {
  const text = hiddenCount > 0 ? `+${hiddenCount}` : "−";
  return 6 + Math.max(20, text.length * 6 + 10);
}
export const LABEL_FONT = "500 12px 'Geist Variable', system-ui, sans-serif";
