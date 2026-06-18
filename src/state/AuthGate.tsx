import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { api, setUnauthenticatedHandler } from "@/lib/api";
import logoUrl from "../../assets/logo.svg";

type Phase = "checking" | "ok" | "login" | "error";

/**
 * Wraps the app and enforces Hermes gated-mode auth in place (no redirect).
 *
 * - Loopback mode (`auth_required: false`) → renders children immediately.
 * - Gated mode → checks the session cookie via `/api/auth/me`; if absent,
 *   shows a username/password form that POSTs to `/auth/password-login`
 *   (sets the `hermes_session_at` cookie), then loads the app.
 * - A mid-session 401 re-shows the form (via the api re-auth handler).
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [provider, setProvider] = useState("basic");
  const [bootError, setBootError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setPhase("checking");
    try {
      const status = await api.getStatus();
      if (!status.auth_required) {
        setPhase("ok");
        return;
      }
      // Gated: the WS upgrades must use single-use tickets, not the token.
      window.__HERMES_AUTH_REQUIRED__ = true;
      setProvider(status.auth_providers?.[0] || "basic");
      try {
        await api.getAuthMe();
        setPhase("ok");
      } catch {
        setPhase("login");
      }
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Re-show the login form if a session expires mid-use.
  useEffect(() => {
    setUnauthenticatedHandler(() => setPhase("login"));
    return () => setUnauthenticatedHandler(null);
  }, []);

  if (phase === "ok") return <>{children}</>;

  if (phase === "checking") {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-white/50" />
      </Centered>
    );
  }

  if (phase === "error") {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <p className="text-sm text-red-300">Can't reach the Hermes server.</p>
          <p className="mt-1 text-xs wrap-break-word text-white/40">
            {bootError}
          </p>
          <button
            onClick={() => void check()}
            className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
          >
            Retry
          </button>
        </div>
      </Centered>
    );
  }

  return <LoginForm provider={provider} onSuccess={() => setPhase("ok")} />;
}

function LoginForm({
  provider,
  onSuccess,
}: {
  provider: string;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.passwordLogin(provider, username, password);
      // Confirm the cookie actually authenticates before entering the app.
      await api.getAuthMe();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <Centered>
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/3 p-7"
      >
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <img src={logoUrl} alt="Hermes" className="h-10 w-auto" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
            <p className="mt-0.5 text-xs text-white/45">
              This dashboard is protected. Enter your credentials.
            </p>
          </div>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium tracking-wide text-white/50 uppercase">
            Username
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium tracking-wide text-white/50 uppercase">
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          />
        </label>

        {error && (
          <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!username || !password || submitting}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          Sign in
        </button>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-dvh place-items-center p-4">{children}</div>;
}
