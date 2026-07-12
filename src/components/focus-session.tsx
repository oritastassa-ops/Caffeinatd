"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Task } from "@/lib/types";
import { toggleTask } from "@/app/(app)/tasks/actions";
import { ProgressRing } from "./progress-ring";
import { cn } from "@/lib/utils";

const PRESETS = [25, 50] as const;

type Phase = "setup" | "running" | "paused" | "done";

/**
 * Focus mode: one task, one timer, nothing else. Renders as a full-screen
 * layer above the app chrome so entering feels like the room going quiet.
 * (Music controls are a deliberate extension point — see docs/13.)
 */
export function FocusSession({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("setup");
  const [minutes, setMinutes] = useState<number>(PRESETS[0]);
  const [taskId, setTaskId] = useState<string | null>(tasks[0]?.id ?? null);
  const [secondsLeft, setSecondsLeft] = useState(PRESETS[0] * 60);
  const [taskDone, setTaskDone] = useState(false);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  const task = tasks.find((t) => t.id === taskId) ?? null;
  const total = minutes * 60;

  const exit = useCallback(() => {
    router.push("/");
  }, [router]);

  // Esc leaves — but pauses first if mid-session, so an accidental Esc
  // never throws away a running block.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setPhase((p) => {
        if (p === "running") return "paused";
        exit();
        return p;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit]);

  useEffect(() => {
    if (phase !== "running") {
      if (interval.current) clearInterval(interval.current);
      return;
    }
    interval.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setPhase("done");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (interval.current) clearInterval(interval.current);
    };
  }, [phase]);

  function start(mins: number) {
    setMinutes(mins);
    setSecondsLeft(mins * 60);
    setPhase("running");
  }

  function markDone() {
    if (!task || taskDone) return;
    setTaskDone(true);
    toggleTask(task.id, true);
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="overlay-enter fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-bg px-6">
      <button
        onClick={exit}
        aria-label="Exit focus mode"
        className="transition-fast absolute right-5 top-5 rounded-lg border px-2.5 py-1 text-xs text-text-dim hover:border-accent hover:text-accent"
      >
        esc
      </button>

      {/* Current task — the single thing this block is for */}
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
          {phase === "done" ? "Block complete" : "Focusing on"}
        </p>
        {phase === "setup" && tasks.length > 0 ? (
          <select
            value={taskId ?? ""}
            onChange={(e) => setTaskId(e.target.value || null)}
            aria-label="Choose a task to focus on"
            className="max-w-full rounded-xl border bg-surface px-3 py-2 text-center text-lg font-medium outline-none focus:border-accent"
          >
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
            <option value="">Just focus — no task</option>
          </select>
        ) : (
          <p className={cn("text-xl font-semibold tracking-tight", taskDone && "text-text-dim line-through")}>
            {task?.title ?? "Deep work"}
          </p>
        )}
      </div>

      <ProgressRing progress={phase === "setup" ? 0 : 1 - secondsLeft / total}>
        <div className="text-center">
          <p className="tabular text-5xl font-semibold tracking-tight">
            {phase === "setup" ? `${minutes}:00` : `${mm}:${ss}`}
          </p>
          <p className="mt-1 text-xs text-text-dim">
            {phase === "running" && "stay with it"}
            {phase === "paused" && "paused"}
            {phase === "done" && "well earned ☕"}
            {phase === "setup" && "minutes"}
          </p>
        </div>
      </ProgressRing>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {phase === "setup" && (
          <>
            {PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => setMinutes(m)}
                className={cn(
                  "transition-fast rounded-xl border px-4 py-2 text-sm",
                  minutes === m ? "border-accent bg-accent-soft text-accent" : "hover:border-accent",
                )}
              >
                {m} min
              </button>
            ))}
            <button
              onClick={() => start(minutes)}
              className="transition-fast rounded-xl bg-accent px-6 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Start
            </button>
          </>
        )}
        {(phase === "running" || phase === "paused") && (
          <>
            <button
              onClick={() => setPhase(phase === "running" ? "paused" : "running")}
              className="transition-fast rounded-xl bg-accent px-6 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {phase === "running" ? "Pause" : "Resume"}
            </button>
            <button
              onClick={() => setPhase("setup")}
              className="transition-fast rounded-xl border px-4 py-2 text-sm text-text-dim hover:border-accent hover:text-accent"
            >
              Reset
            </button>
          </>
        )}
        {phase === "done" && (
          <>
            {task && !taskDone && (
              <button
                onClick={markDone}
                className="transition-fast rounded-xl bg-good px-5 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                ✓ Mark task done
              </button>
            )}
            <button
              onClick={() => setPhase("setup")}
              className="transition-fast rounded-xl border px-4 py-2 text-sm hover:border-accent hover:text-accent"
            >
              Another block
            </button>
            <button
              onClick={exit}
              className="transition-fast rounded-xl border px-4 py-2 text-sm text-text-dim hover:border-accent hover:text-accent"
            >
              Back to it
            </button>
          </>
        )}
      </div>

      {task?.notes && phase !== "setup" && (
        <p className="max-w-md text-center text-sm leading-relaxed text-text-dim">{task.notes}</p>
      )}
    </div>
  );
}
