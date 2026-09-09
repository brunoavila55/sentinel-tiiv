import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABELS, type AccessTokenResponse, type InvitePreviewOut } from "@/lib/types";

const fieldClass =
  "w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { applySession } = useAuth();

  const [preview, setPreview] = useState<InvitePreviewOut | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreviewError("Link de convite inválido: token ausente.");
      return;
    }
    apiFetch<InvitePreviewOut>(`/invites/${token}`)
      .then(setPreview)
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "Convite inválido ou expirado."));
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<AccessTokenResponse>("/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token, name: preview?.account_exists ? undefined : name, password }),
      });
      await applySession(data);
      navigate("/", { replace: true });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Não foi possível aceitar o convite.");
    } finally {
      setSubmitting(false);
    }
  }

  if (previewError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <p className="text-sm text-destructive">{previewError}</p>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <p className="text-sm text-muted-foreground">Carregando convite...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-md border border-border p-6">
        <div>
          <h1 className="text-lg font-semibold">Convite para {preview.organization_name}</h1>
          <p className="text-sm text-muted-foreground">
            {preview.email} · role {ROLE_LABELS[preview.role]}
          </p>
        </div>

        {!preview.account_exists && (
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium">
              Seu nome
            </label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            {preview.account_exists ? "Senha da sua conta" : "Crie uma senha"}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </div>

        {submitError && <p className="text-sm text-destructive">{submitError}</p>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Aceitando..." : preview.account_exists ? "Entrar e aceitar" : "Criar conta e aceitar"}
        </Button>
      </form>
    </main>
  );
}
