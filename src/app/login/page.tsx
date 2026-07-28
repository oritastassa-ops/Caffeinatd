"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { LogoMark } from "@/components/logo";
import { Button, Input } from "@/components/ui";

/**
 * Magic link is the only sign-in path in production. Password sign-in exists
 * behind NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN as a local escape hatch for when
 * email delivery is down or rate-limited — set it in .env, never in Vercel.
 */
const ALLOW_PASSWORD = process.env.NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN === "true";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"link" | "password">("link");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function client() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await client().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await client().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    // Full navigation, not router.push — the session cookie must be present on
    // the next request for middleware to see it.
    else location.assign("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="h-10 w-10 text-bean" uid="login" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Caffeinatd</h1>
          <p className="mt-1 text-sm text-text-dim">Your AI life assistant, over coffee</p>
        </div>

        {sent ? (
          <p className="rounded-xl border bg-surface p-4 text-center text-sm">
            Check your email — your sign-in link is on its way.
          </p>
        ) : (
          <form
            onSubmit={mode === "password" ? signIn : sendLink}
            className="flex flex-col gap-3"
          >
            <Input
              type="email"
              required
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
            />

            {mode === "password" && (
              <Input
                type="password"
                required
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
              />
            )}

            <Button type="submit" loading={busy} className="w-full">
              {busy
                ? "One moment…"
                : mode === "password"
                  ? "Sign in"
                  : "Send magic link"}
            </Button>

            {ALLOW_PASSWORD && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setError("");
                  setMode(mode === "password" ? "link" : "password");
                }}
              >
                {mode === "password"
                  ? "Use a magic link instead"
                  : "Sign in with a password"}
              </Button>
            )}

            {error && <p className="text-center text-sm text-bad">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
