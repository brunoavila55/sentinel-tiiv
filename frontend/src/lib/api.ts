// Cliente HTTP fino para /api. Mantém o access token só em memória (nunca
// em localStorage) e faz uma tentativa de refresh silencioso quando uma
// chamada volta 401, reaproveitando o cookie httpOnly de refresh.

let accessToken: string | null = null;
let currentOrganizationId: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setCurrentOrganizationId(id: string | null): void {
  currentOrganizationId = id;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

const ENTITLEMENT_LIMIT_LABELS: Record<string, string> = {
  assets: "ativos",
  users: "usuários",
  storage_bytes: "armazenamento",
};

function formatEntitlementDetail(detail: {
  error: string;
  limit_type: string;
  limit: number;
  current: number;
  plan: string;
}): string {
  const label = ENTITLEMENT_LIMIT_LABELS[detail.limit_type] ?? detail.limit_type;
  if (detail.limit_type === "storage_bytes") {
    const limitMb = Math.round(detail.limit / (1024 * 1024));
    return `Limite de ${label} do plano ${detail.plan} atingido (${limitMb} MB). Fale com o owner da organização para mudar de plano.`;
  }
  return `Limite de ${label} do plano ${detail.plan} atingido (${detail.current}/${detail.limit}). Fale com o owner da organização para mudar de plano.`;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    let message: string | undefined;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object" && (detail as { error?: string }).error === "entitlement_limit_reached") {
      message = formatEntitlementDetail(detail as Parameters<typeof formatEntitlementDetail>[0]);
    }
    super(message ?? `Erro ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function rawFetch(path: string, options: RequestInit): Promise<Response> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (currentOrganizationId) headers.set("X-Organization-Id", currentOrganizationId);
  // FormData (upload de arquivo) precisa que o browser defina o
  // Content-Type sozinho (multipart/form-data com o boundary correto) —
  // nunca forçar aqui.
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`/api${path}`, { ...options, headers, credentials: "include" });
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = rawFetch("/auth/refresh", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as { access_token: string };
        accessToken = data.access_token;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, options);

  if (res.status === 401 && path !== "/auth/refresh" && path !== "/auth/login") {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawFetch(path, options);
    } else {
      sessionExpiredHandler?.();
    }
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // sem corpo JSON
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
