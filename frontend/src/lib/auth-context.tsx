import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { apiFetch, setAccessToken, setCurrentOrganizationId, setSessionExpiredHandler } from "@/lib/api";
import type { AccessTokenResponse, MembershipOut, MeResponse, UserOut } from "@/lib/types";

const CURRENT_ORG_STORAGE_KEY = "sentinel_current_org";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: AuthStatus;
  user: UserOut | null;
  memberships: MembershipOut[];
  currentOrganizationId: string | null;
}

interface AuthContextValue extends AuthState {
  currentMembership: MembershipOut | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, organizationName: string) => Promise<void>;
  logout: () => Promise<void>;
  selectOrganization: (organizationId: string) => void;
  applySession: (data: AccessTokenResponse) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredOrgId(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistOrgId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(CURRENT_ORG_STORAGE_KEY, id);
    else window.localStorage.removeItem(CURRENT_ORG_STORAGE_KEY);
  } catch {
    // localStorage indisponível (modo privado etc.): segue sem persistir.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
    memberships: [],
    currentOrganizationId: null,
  });

  const resetToAnonymous = useCallback(() => {
    setAccessToken(null);
    setCurrentOrganizationId(null);
    persistOrgId(null);
    setState({ status: "anonymous", user: null, memberships: [], currentOrganizationId: null });
  }, []);

  const applyMe = useCallback((me: MeResponse) => {
    const stored = readStoredOrgId();
    const valid = me.memberships.find((m) => m.organization_id === stored);
    const resolvedOrgId = valid?.organization_id ?? me.memberships[0]?.organization_id ?? null;
    setCurrentOrganizationId(resolvedOrgId);
    persistOrgId(resolvedOrgId);
    setState({
      status: "authenticated",
      user: me.user,
      memberships: me.memberships,
      currentOrganizationId: resolvedOrgId,
    });
  }, []);

  const applySession = useCallback(
    async (data: AccessTokenResponse) => {
      setAccessToken(data.access_token);
      const me = await apiFetch<MeResponse>("/auth/me");
      applyMe(me);
    },
    [applyMe],
  );

  useEffect(() => {
    setSessionExpiredHandler(resetToAnonymous);
    (async () => {
      try {
        // Reaproveita o cookie httpOnly de refresh, se existir: apiFetch já
        // tenta /auth/refresh sozinho quando recebe 401 aqui.
        const me = await apiFetch<MeResponse>("/auth/me");
        applyMe(me);
      } catch {
        resetToAnonymous();
      }
    })();
    return () => setSessionExpiredHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiFetch<AccessTokenResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await applySession(data);
    },
    [applySession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, organizationName: string) => {
      const data = await apiFetch<AccessTokenResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, organization_name: organizationName }),
      });
      await applySession(data);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      resetToAnonymous();
    }
  }, [resetToAnonymous]);

  const selectOrganization = useCallback((organizationId: string) => {
    setCurrentOrganizationId(organizationId);
    persistOrgId(organizationId);
    setState((s) => ({ ...s, currentOrganizationId: organizationId }));
  }, []);

  const currentMembership = useMemo(
    () => state.memberships.find((m) => m.organization_id === state.currentOrganizationId) ?? null,
    [state.memberships, state.currentOrganizationId],
  );

  const value: AuthContextValue = {
    ...state,
    currentMembership,
    login,
    register,
    logout,
    selectOrganization,
    applySession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
