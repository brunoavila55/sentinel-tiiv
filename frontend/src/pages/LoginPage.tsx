import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="w-full space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">Entrar</h1>
          <p className="text-sm text-muted-foreground">Acesse o monitoramento da sua organização.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Entrando..." : "Entrar"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Não tem conta?{" "}
          <Link to="/register" className="text-foreground underline underline-offset-2">
            Criar organização
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
