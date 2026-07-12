"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionReceipt, AssistantResponse, CommunicationStyle, Workspace } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import { Brewing } from "./brewing";
import { PixelAvatar } from "./avatars/pixel-avatar";
import { DEFAULT_PERSONALITY, PERSONALITIES } from "@/lib/personalities";
import { SearchResult, universalSearch } from "@/app/(app)/search-actions";
import { addCapture } from "@/app/(app)/capture-actions";
import { createNote } from "@/app/(app)/notes/actions";

type Status = "idle" | "busy" | "done" | "error";
type ConfirmState = "pending" | "remembered" | "declined";
type Mode = "command" | "ask";

/** Fired by quick actions / the persistent trigger to open the bar in ask mode (optionally pre-filled). */
export const OPEN_COMMAND_BAR_EVENT = "caffeinatd:open-command-bar";

const RECENT_KEY = "caffeinatd:recent-commands";

// Discoverability: users shouldn't need to know commands. These seed the
// ask-mode empty state — some are complete prompts, some are scaffolds to finish.
const SUGGESTIONS: { label: string; fill: string }[] = [
  { label: "Plan my day", fill: "Plan my day" },
  { label: "What should I train today?", fill: "What should I train today?" },
  { label: "Log a meal", fill: "I ate " },
  { label: "Log an expense", fill: "I spent $" },
  { label: "Can I afford…?", fill: "Can I afford " },
  { label: "We need…", fill: "We need " },
  { label: "What housework today?", fill: "What housework do I have today?" },
];

/** Mirrors the sidebar — the palette is the keyboard route to the same places. */
const NAV_COMMANDS = [
  { href: "/", title: "Today", icon: "◈" },
  { href: "/home", title: "Home", icon: "⌂" },
  { href: "/tasks", title: "Tasks", icon: "☑" },
  { href: "/notes", title: "Notes", icon: "✎" },
  { href: "/calendar", title: "Calendar", icon: "▦" },
  { href: "/fitness", title: "Fitness", icon: "⚡" },
  { href: "/nutrition", title: "Nutrition", icon: "◐" },
  { href: "/finance", title: "Finance", icon: "◎" },
  { href: "/memory", title: "Memory", icon: "✦" },
  { href: "/settings", title: "Settings", icon: "⚙" },
];

const RESULT_ICONS: Record<SearchResult["kind"], string> = {
  workspace: "❖",
  task: "☑",
  note: "✎",
  conversation: "✦",
  memory: "✦",
};

interface PaletteItem {
  key: string;
  icon: string;
  title: string;
  sub?: string;
  section: string;
  run: () => void;
}

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
 * The ⌘K surface, now a full command palette with two modes:
 *
 * - "command" (default on ⌘K): keyboard-first navigation, actions, and
 *   universal search across tasks, notes, workspaces, memories, conversations.
 * - "ask": the natural-language assistant — unchanged pipeline, receipts,
 *   undo, and memory confirmation. Entered via Tab, the Ask row, or any
 *   OPEN_COMMAND_BAR_EVENT (quick actions pre-fill prompts).
 */
export function CommandBar({
  personality = DEFAULT_PERSONALITY,
  workspaces = [],
}: {
  personality?: CommunicationStyle;
  workspaces?: Pick<Workspace, "slug" | "name" | "icon">[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("command");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState("");
  const [undone, setUndone] = useState<Set<number>>(new Set());
  const [confirmStates, setConfirmStates] = useState<Record<number, ConfirmState>>({});
  const [recent, setRecent] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMode("command");
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onQuickAction(e: Event) {
      setInput((e as CustomEvent<string>).detail ?? "");
      setMode("ask");
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
      setResults([]);
      setSelected(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Universal search: debounced, command mode only. Stale responses are
  // dropped by re-checking the query when they land.
  useEffect(() => {
    if (!open || mode !== "command") return;
    const q = input.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const found = await universalSearch(q).catch(() => []);
      setResults((prev) => (inputRef.current?.value.trim() === q ? found : prev));
    }, 150);
    return () => clearTimeout(t);
  }, [input, open, mode]);

  const close = useCallback(() => setOpen(false), []);

  const submit = useCallback(
    async (override?: string) => {
      const message = (override ?? input).trim();
      if (!message || status === "busy") return;
      setMode("ask");
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

  // ── Command-mode item list ────────────────────────────────────────────────
  const items = useMemo<PaletteItem[]>(() => {
    if (mode !== "command") return [];
    const q = input.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const go = (href: string) => () => {
      close();
      router.push(href);
    };

    const nav: PaletteItem[] = [
      ...workspaces
        .filter((w) => match(w.name) || match("workspace"))
        .map((w) => ({
          key: `ws:${w.slug}`,
          icon: w.icon,
          title: w.name,
          sub: "Workspace",
          section: "Go to",
          run: go(`/workspaces/${w.slug}`),
        })),
      ...NAV_COMMANDS.filter((n) => match(n.title)).map((n) => ({
        key: `nav:${n.href}`,
        icon: n.icon,
        title: n.title,
        section: "Go to",
        run: go(n.href),
      })),
    ];

    const actions: PaletteItem[] = [];
    if (match("focus mode") || match("start focus") || match("deep work")) {
      actions.push({
        key: "act:focus",
        icon: "❂",
        title: "Start focus mode",
        sub: "one task, one timer",
        section: "Actions",
        run: go("/focus"),
      });
    }
    if (match("new note") || match("create note")) {
      actions.push({
        key: "act:new-note",
        icon: "✎",
        title: "New note",
        section: "Actions",
        run: () => {
          close();
          // Server action redirects into the fresh editor.
          createNote(null).catch(() => null);
        },
      });
    }
    if (match("new task") || match("create task") || match("remind")) {
      actions.push({
        key: "act:new-task",
        icon: "☑",
        title: "New task…",
        sub: "via assistant",
        section: "Actions",
        run: () => {
          setMode("ask");
          setInput("Remind me to ");
          inputRef.current?.focus();
        },
      });
    }
    if (q) {
      actions.push({
        key: "act:capture",
        icon: "↯",
        title: `Capture "${input.trim()}"`,
        sub: "save to inbox",
        section: "Actions",
        run: () => {
          addCapture(input.trim()).then(() => router.refresh());
          close();
        },
      });
    }

    const found: PaletteItem[] = results.map((r) => ({
      key: `res:${r.kind}:${r.id}`,
      icon: RESULT_ICONS[r.kind],
      title: r.title,
      sub: r.sub,
      section: "Results",
      run: go(r.href),
    }));

    const ask: PaletteItem = {
      key: "ask",
      icon: "✦",
      title: q ? `Ask ${PERSONALITIES[personality].name}: "${input.trim()}"` : `Ask ${PERSONALITIES[personality].name}…`,
      sub: "natural language",
      section: "Assistant",
      run: () => {
        if (q) submit(input);
        else {
          setMode("ask");
          inputRef.current?.focus();
        }
      },
    };

    return [...nav, ...actions, ...found, ask];
  }, [mode, input, workspaces, results, personality, close, router, submit]);

  // Keep the selection valid and visible as the list changes under it.
  useEffect(() => setSelected(0), [input, mode]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (mode === "ask") {
      if (e.key === "Enter") submit();
      // Empty backspace walks back out to the palette.
      if (e.key === "Backspace" && input === "" && status !== "busy") {
        setMode("command");
        setStatus("idle");
        setResponse(null);
        setError("");
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      items[selected]?.run();
    } else if (e.key === "Tab") {
      e.preventDefault();
      setMode("ask");
    }
  }

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

  const showSuggestions = mode === "ask" && status === "idle" && !error && input.trim().length === 0;

  // Group consecutive items by section for headed rendering.
  const sections = useMemo(() => {
    const out: { name: string; items: { item: PaletteItem; index: number }[] }[] = [];
    items.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.name === item.section) last.items.push({ item, index });
      else out.push({ name: item.section, items: [{ item, index }] });
    });
    return out;
  }, [items]);

  return (
    <>
      {/* Mobile floating trigger */}
      <button
        onClick={() => {
          setMode("command");
          setOpen(true);
        }}
        aria-label="Open assistant"
        className="fixed bottom-16 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent shadow-lg md:hidden"
      >
        <LogoMark className="h-6 w-6 text-white" uid="mobile-fab" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[14vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label={mode === "ask" ? "Assistant" : "Command palette"}
            className="overlay-enter w-full max-w-xl overflow-hidden rounded-2xl border bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b px-4 py-3">
              {mode === "ask" ? (
                <PixelAvatar
                  personality={personality}
                  size={28}
                  mode={status === "busy" ? "thinking" : "idle"}
                />
              ) : (
                <span aria-hidden className="flex h-7 w-7 items-center justify-center text-text-dim">
                  ⌘
                </span>
              )}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={
                  mode === "ask"
                    ? `Ask ${PERSONALITIES[personality].name} anything…`
                    : "Search, jump, or act… (Tab to ask AI)"
                }
                aria-label={mode === "ask" ? "Ask the assistant" : "Search commands"}
                role={mode === "command" ? "combobox" : undefined}
                aria-expanded={mode === "command" ? true : undefined}
                className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-dim"
                disabled={status === "busy"}
              />
              <kbd className="rounded border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-dim">esc</kbd>
            </div>

            {/* ── Command mode: sectioned, keyboard-driven list ─────────── */}
            {mode === "command" && (
              <div ref={listRef} className="max-h-[46vh] overflow-y-auto px-2 py-2" role="listbox">
                {sections.map((section) => (
                  <div key={section.name}>
                    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
                      {section.name}
                    </p>
                    {section.items.map(({ item, index }) => (
                      <button
                        key={item.key}
                        data-index={index}
                        role="option"
                        aria-selected={index === selected}
                        onClick={item.run}
                        onMouseMove={() => setSelected(index)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm",
                          index === selected ? "bg-accent-soft text-accent" : "text-text",
                        )}
                      >
                        <span aria-hidden className="w-4 shrink-0 text-center text-text-dim">
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.sub && (
                          <span className="max-w-[40%] shrink-0 truncate text-xs text-text-dim">{item.sub}</span>
                        )}
                        {index === selected && (
                          <kbd aria-hidden className="rounded border bg-surface-2 px-1 text-[10px] text-text-dim">
                            ↵
                          </kbd>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* ── Ask mode: suggestions, then the response thread ───────── */}
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

            {mode === "ask" && (status === "busy" || status === "done" || error) && (
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
