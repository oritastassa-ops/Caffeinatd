"use client";

import { cn } from "@/lib/utils";

/**
 * Companion speech bubble: dark-charcoal coffee palette with amber warmth,
 * anchored above the character with a small tail. Colors are deliberately
 * fixed (not themed) — the bubble reads as "the assistant's voice" in both
 * light and dark mode.
 */
export function SpeechBubble({
  title,
  onMinimize,
  onDismiss,
  className,
  children,
}: {
  title: string;
  onMinimize?: () => void;
  onDismiss?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bubble-in relative w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border p-3.5 shadow-xl",
        className,
      )}
      style={{
        background: "#26201b",
        borderColor: "#4a3728",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(226,137,63,0.08)",
        color: "#f3e9dd",
      }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#e2893f" }}>
          {title}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {onMinimize && (
            <button
              onClick={onMinimize}
              aria-label="Minimize assistant bubble"
              className="transition-fast rounded px-1.5 text-sm leading-none hover:bg-white/10"
              style={{ color: "#a89583" }}
            >
              –
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Dismiss assistant response"
              className="transition-fast rounded px-1.5 text-xs leading-none hover:bg-white/10"
              style={{ color: "#a89583" }}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
      {/* tail — points down-right toward the character */}
      <span
        aria-hidden
        className="absolute -bottom-[7px] right-8 h-3.5 w-3.5 rotate-45 border-b border-r"
        style={{ background: "#26201b", borderColor: "#4a3728" }}
      />
    </div>
  );
}

/** Three-dot thinking indicator, amber on charcoal. */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Thinking">
      {["", "typing-dot-2", "typing-dot-3"].map((extra, i) => (
        <span
          key={i}
          className={cn("typing-dot inline-block h-1.5 w-1.5 rounded-full", extra)}
          style={{ background: "#e2893f" }}
        />
      ))}
    </span>
  );
}
