import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
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
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-md border border-border p-6">
        <div>
          <h1 className="text-lg font-semibold">Sentinel</h1>
          <p className="text-sm text-muted-foreground">Entre com sua conta.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Entrando..." : "Entrar"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Não tem conta?{" "}
          <Link to="/register" className="underline underline-offset-2">
            Criar organização
          </Link>
        </p>
      </form>
    </main>
  );
}
