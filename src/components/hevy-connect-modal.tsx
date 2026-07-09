"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "testing" | "tested-ok" | "tested-fail";

interface TestResult {
  ok: boolean;
  username?: string;
  lastWorkoutAt?: string | null;
  error?: string;
}

/** Self-contained connect flow — drop this anywhere (Fitness onboarding card, Settings) as one button. */
export function HevyConnectButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const router = useRouter();

  function close() {
    setOpen(false);
    setApiKey("");
    setShowKey(false);
    setPhase("idle");
    setConnecting(false);
    setTestResult(null);
  }

  async function testConnection() {
    if (!apiKey.trim()) return;
    setPhase("testing");
    try {
      const res = await fetch("/api/integrations/hevy/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
      setPhase(data.ok ? "tested-ok" : "tested-fail");
    } catch {
      setTestResult({ ok: false, error: "Couldn't reach Caffeinatd — try again." });
      setPhase("tested-fail");
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      const res = await fetch("/api/integrations/hevy/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTestResult({ ok: false, error: data.error ?? "Couldn't connect." });
        setPhase("tested-fail");
        setConnecting(false);
        return;
      }
      close();
      router.refresh();
    } catch {
      setTestResult({ ok: false, error: "Couldn't reach Caffeinatd — try again." });
      setPhase("tested-fail");
      setConnecting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="transition-fast rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="overlay-enter w-full max-w-md rounded-2xl border bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Connect Hevy</h2>
            <p className="mt-1 text-sm text-text-dim">
              Hevy provides a personal API key that lets Caffeinatd securely read your workout
              history. Get yours at{" "}
              <span className="font-medium">hevy.com/settings → Developer</span> (requires Hevy
              Pro).
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <label className="text-xs font-medium text-text-dim">Hevy API Key</label>
              <div className="flex gap-2">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setPhase("idle");
                    setTestResult(null);
                  }}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  autoComplete="off"
                  className="flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  className="rounded-xl border px-3 text-xs text-text-dim hover:text-text"
                  type="button"
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {phase === "tested-ok" && testResult?.ok && (
              <div className="mt-3 rounded-xl border border-good/30 bg-good/5 p-3 text-sm">
                <p className="text-good">✓ Connection verified</p>
                {testResult.username && <p className="mt-1 text-text-dim">Signed in as {testResult.username}</p>}
                {testResult.lastWorkoutAt && (
                  <p className="text-text-dim">
                    Latest workout: {new Date(testResult.lastWorkoutAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}
            {phase === "tested-fail" && (
              <p className="mt-3 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
                {testResult?.error ?? "Couldn't connect to Hevy."}
              </p>
            )}

            <div className="mt-5 flex items-center justify-between">
              <button onClick={close} className="text-sm text-text-dim hover:underline">
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  onClick={testConnection}
                  disabled={!apiKey.trim() || phase === "testing" || connecting}
                  className="transition-fast rounded-xl border px-4 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
                >
                  {phase === "testing" ? "Testing…" : "Test Connection"}
                </button>
                <button
                  onClick={connect}
                  disabled={phase !== "tested-ok" || connecting}
                  className="transition-fast rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
