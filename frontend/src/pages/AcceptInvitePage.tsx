import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABELS, type AccessTokenResponse, type InvitePreviewOut } from "@/lib/types";

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
      <AuthShell>
        <p className="text-sm text-destructive">{previewError}</p>
      </AuthShell>
    );
  }

  if (!preview) {
    return (
      <AuthShell>
        <p className="text-sm text-muted-foreground">Carregando convite...</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="w-full space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
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
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            {preview.account_exists ? "Senha da sua conta" : "Crie uma senha"}
          </label>
          <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {submitError && <p className="text-sm text-destructive">{submitError}</p>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Aceitando..." : preview.account_exists ? "Entrar e aceitar" : "Criar conta e aceitar"}
        </Button>
      </form>
    </AuthShell>
  );
}
