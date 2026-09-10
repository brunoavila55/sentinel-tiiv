import { STATUS_LABELS, type AssetStatus } from "@/lib/types";

const STATUS_COLOR: Record<AssetStatus, string> = {
  up: "var(--status-up)",
  warning: "var(--status-warning)",
  down: "var(--status-down)",
  unknown: "var(--status-unknown)",
};

/**
 * Forma distinta por status, não só cor — daltonismo/baixa visão não pode
 * depender de diferenciar verde de vermelho (regra explícita do projeto).
 *   up      -> círculo cheio
 *   warning -> triângulo cheio
 *   down    -> quadrado cheio
 *   unknown -> anel tracejado (vazio)
 */
export function StatusShape({ status, size = 8 }: { status: AssetStatus; size?: number }) {
  const color = STATUS_COLOR[status];

  if (status === "warning") {
    return (
      <svg width={size + 2} height={size + 2} viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
        <polygon points="5,0.5 9.5,9 0.5,9" fill={color} />
      </svg>
    );
  }

  if (status === "down") {
    return (
      <span
        aria-hidden="true"
        className="inline-block shrink-0"
        style={{ width: size, height: size, backgroundColor: color }}
      />
    );
  }

  if (status === "unknown") {
    return (
      <span
        aria-hidden="true"
        className="inline-block shrink-0 rounded-full"
        style={{ width: size, height: size, border: `1.5px dashed ${color}` }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

export function StatusBadge({ status, className = "" }: { status: AssetStatus; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <StatusShape status={status} />
      <span style={{ color: STATUS_COLOR[status] }}>{STATUS_LABELS[status]}</span>
    </span>
  );
}

/** Versão com mais peso visual (fundo tonal), para cabeçalhos de página onde o status é a informação central. */
export function StatusPill({ status, className = "" }: { status: AssetStatus; className?: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        color,
        borderColor: `color-mix(in oklch, ${color}, transparent 65%)`,
        backgroundColor: `color-mix(in oklch, ${color}, transparent 90%)`,
      }}
    >
      <StatusShape status={status} size={7} />
      {STATUS_LABELS[status]}
    </span>
  );
}
