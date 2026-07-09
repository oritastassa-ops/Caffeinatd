"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { LogoMark } from "@/components/logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
    else setSent(true);
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
          <form onSubmit={sendLink} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-xl border bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="transition-fast rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white hover:opacity-90"
            >
              Send magic link
            </button>
            {error && <p className="text-center text-sm text-bad">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
