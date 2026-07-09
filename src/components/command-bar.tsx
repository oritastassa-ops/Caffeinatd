"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionReceipt, AssistantResponse, CommunicationStyle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import { Brewing } from "./brewing";
import { PixelAvatar } from "./avatars/pixel-avatar";
import { DEFAULT_PERSONALITY, PERSONALITIES } from "@/lib/personalities";

type Status = "idle" | "busy" | "done" | "error";
type ConfirmState = "pending" | "remembered" | "declined";

/** Fired by quick actions / the persistent trigger to open the bar (optionally pre-filled). */
export const OPEN_COMMAND_BAR_EVENT = "caffeinatd:open-command-bar";

const RECENT_KEY = "caffeinatd:recent-commands";

// Discoverability: users shouldn't need to know commands. These seed the
// empty state — some are complete prompts, some are scaffolds to finish.
const SUGGESTIONS: { label: string; fill: string }[] = [
  { label: "Plan my day", fill: "Plan my day" },
  { label: "What should I train today?", fill: "What should I train today?" },
  { label: "Log a meal", fill: "I ate " },
  { label: "Log an expense", fill: "I spent $" },
  { label: "Can I afford…?", fill: "Can I afford " },
  { label: "We need…", fill: "We need " },
  { label: "What housework today?", fill: "What housework do I have today?" },
];

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function pushRecent(cmd: string) {
  const next = [cmd, ...readRecent().filter((c) => c !== cmd)].slice(0, 4);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

/**
 * The assistant lives here: ⌘K anywhere (or the "Ask Caffeinatd…" bar), type
 * natural language, get an answer plus undoable receipt chips. When empty it
 * suggests common commands and recent ones so nothing needs to be memorized.
 */
export function CommandBar({
  personality = DEFAULT_PERSONALITY,
}: {
  personality?: CommunicationStyle;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState("");
  const [undone, setUndone] = useState<Set<number>>(new Set());
  const [confirmStates, setConfirmStates] = useState<Record<number, ConfirmState>>({});
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onQuickAction(e: Event) {
      setInput((e as CustomEvent<string>).detail ?? "");
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_BAR_EVENT, onQuickAction);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_BAR_EVENT, onQuickAction);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setRecent(readRecent());
      inputRef.current?.focus();
    } else {
      if (status === "done" && response?.actions.length) router.refresh();
      setInput("");
      setStatus("idle");
      setResponse(null);
      setError("");
      setUndone(new Set());
      setConfirmStates({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = useCallback(
    async (override?: string) => {
      const message = (override ?? input).trim();
      if (!message || status === "busy") return;
      setStatus("busy");
      setError("");
      setResponse(null);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Something went wrong");
        setResponse(data as AssistantResponse);
        setStatus("done");
        setInput("");
        pushRecent(message);
        // Refresh the page behind the bar right away, so the result is already
        // visible when the user closes it — not only after closing.
        if ((data as AssistantResponse).actions.length > 0) router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setStatus("error");
      }
    },
    [input, status, router],
  );

  function pick(fill: string) {
    setInput(fill);
    inputRef.current?.focus();
    // Complete prompts (no trailing space) can go straight through.
    if (!fill.endsWith(" ")) submit(fill);
  }

  async function undo(action: ActionReceipt, index: number) {
    if (!action.undo || undone.has(index)) return;
    const res = await fetch("/api/assistant/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action.undo),
    });
    if (res.ok) setUndone((s) => new Set(s).add(index));
  }

  async function remember(action: ActionReceipt, index: number) {
    if (!action.confirm) return;
    const res = await fetch("/api/assistant/confirm-memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action.confirm),
    });
    setConfirmStates((s) => ({ ...s, [index]: res.ok ? "remembered" : "pending" }));
  }

  function decline(index: number) {
    setConfirmStates((s) => ({ ...s, [index]: "declined" }));
  }

  const showSuggestions = status === "idle" && !error && input.trim().length === 0;

  return (
    <>
      {/* Mobile floating trigger */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="fixed bottom-16 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent shadow-lg md:hidden"
      >
        <LogoMark className="h-6 w-6 text-white" uid="mobile-fab" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[16vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Assistant"
            className="overlay-enter w-full max-w-xl overflow-hidden rounded-2xl border bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <PixelAvatar
                personality={personality}
                size={28}
                mode={status === "busy" ? "thinking" : "idle"}
              />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={`Ask ${PERSONALITIES[personality].name} anything…`}
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-dim"
                disabled={status === "busy"}
              />
              <kbd className="rounded border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-dim">esc</kbd>
            </div>

            {showSuggestions && (
              <div className="dropdown-enter px-4 py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">Try</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => pick(s.fill)}
                      className="transition-fast rounded-lg border bg-surface-2 px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {recent.length > 0 && (
                  <>
                    <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-text-dim">Recent</p>
                    <div className="flex flex-col gap-1">
                      {recent.map((c) => (
                        <button
                          key={c}
                          onClick={() => submit(c)}
                          className="transition-fast truncate rounded-lg px-2 py-1 text-left text-sm text-text-dim hover:bg-surface-2 hover:text-text"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {(status === "busy" || status === "done" || error) && (
              <div className="px-4 py-3">
                {status === "busy" && (
                  <Brewing label={`${PERSONALITIES[personality].name} is thinking…`} />
                )}
                {error && <p className="text-sm text-bad">{error}</p>}
                {response && (
                  <>
                    <div className="flex items-start gap-3">
                      <PixelAvatar personality={personality} size={32} mode="idle" className="mt-0.5" />
                      <p className="min-w-0 flex-1 text-sm leading-relaxed">{response.text}</p>
                    </div>
                    {response.actions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {response.actions.map((a, i) =>
                          a.confirm ? (
                            <span
                              key={i}
                              className={cn(
                                "transition-fast inline-flex items-center gap-2 rounded-lg border bg-surface-2 px-2.5 py-1 text-xs",
                                confirmStates[i] === "declined" && "line-through opacity-50",
                              )}
                            >
                              <span className="text-accent">?</span>
                              {a.label}
                              {(!confirmStates[i] || confirmStates[i] === "pending") && (
                                <>
                                  <button onClick={() => remember(a, i)} className="font-medium text-accent hover:underline">
                                    Remember
                                  </button>
                                  <button onClick={() => decline(i)} className="text-text-dim hover:underline">
                                    Don&apos;t remember
                                  </button>
                                </>
                              )}
                              {confirmStates[i] === "remembered" && <span className="text-good">✓ Remembered</span>}
                            </span>
                          ) : (
                            <span
                              key={i}
                              className={cn(
                                "transition-fast inline-flex items-center gap-2 rounded-lg border bg-surface-2 px-2.5 py-1 text-xs",
                                undone.has(i) && "line-through opacity-50",
                              )}
                            >
                              <span className="text-good">✓</span>
                              {a.label}
                              {a.undo && !undone.has(i) && (
                                <button onClick={() => undo(a, i)} className="font-medium text-accent hover:underline">
                                  Undo
                                </button>
                              )}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {(response.failures?.length ?? 0) > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {response.failures!.map((f, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-2 rounded-lg border border-bad/40 bg-bad/10 px-2.5 py-1 text-xs text-bad"
                          >
                            <span aria-hidden>⚠</span>
                            <span className="min-w-0">
                              <span className="font-medium">{f.tool.replace(/_/g, " ")}</span> failed — {f.message}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Persistent, discoverable entry point rendered at the top of every app page. */
export function AssistantTrigger({
  personality,
}: {
  personality?: CommunicationStyle;
}) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COMMAND_BAR_EVENT, { detail: "" }))}
      className="transition-fast flex w-full items-center gap-3 rounded-xl border bg-surface px-4 py-2.5 text-sm text-text-dim hover:border-accent"
    >
      {personality ? (
        <PixelAvatar personality={personality} size={20} mode="static" />
      ) : (
        <LogoMark className="h-4 w-4 text-bean" uid="trigger" />
      )}
      <span>Ask {personality ? PERSONALITIES[personality].name : "Caffeinatd"}…</span>
      <kbd className="ml-auto rounded border bg-surface-2 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
    </button>
  );
}
