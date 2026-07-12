"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CommunicationStyle } from "@/lib/types";
import { PixelAvatar, AvatarMode } from "@/components/avatars/pixel-avatar";
import { PERSONALITIES } from "@/lib/personalities";
import { OPEN_COMMAND_BAR_EVENT } from "@/components/command-bar";
import { useAssistant, minimizeBubble, reopenBubble, dismissResponse, CompanionPhase } from "./store";
import { COMPANION_VOICE } from "./config";
import { SpeechBubble, TypingDots } from "./speech-bubble";
import { ReceiptChips } from "./receipt-chips";

/**
 * The desk companion: your assistant, always present in the corner —
 * asleep at their little desk until asked, then waking, taking a sip of
 * coffee, working, and delivering the answer in a speech bubble. Purely a
 * subscriber of the assistant store; it owns no AI logic.
 */
export function AssistantCompanion({ personality }: { personality: CommunicationStyle }) {
  const state = useAssistant();
  const router = useRouter();
  const voice = COMPANION_VOICE[personality];
  const name = PERSONALITIES[personality].name;
  const [celebrating, setCelebrating] = useState(false);
  const refreshedFor = useRef<object | null>(null);

  // One celebration beat when a response lands, then settle to idle.
  useEffect(() => {
    if (state.phase !== "responding" || !state.response) return;
    // Refresh the page data behind the companion exactly once per response.
    if (refreshedFor.current !== state.response && state.response.actions.length > 0) {
      refreshedFor.current = state.response;
      router.refresh();
    }
    setCelebrating(true);
    const t = setTimeout(() => setCelebrating(false), 1600);
    return () => clearTimeout(t);
  }, [state.phase, state.response, router]);

  const hasResult = state.response !== null || state.error !== null;
  const showBubble = state.bubbleOpen && (state.phase === "thinking" || state.phase === "responding" || state.phase === "error");

  const avatarMode = toAvatarMode(state.phase, celebrating, Boolean(state.response?.failures?.length));

  function onCharacterClick() {
    if (showBubble) {
      minimizeBubble();
    } else if (hasResult) {
      reopenBubble();
    } else if (state.phase === "sleeping") {
      window.dispatchEvent(new CustomEvent(OPEN_COMMAND_BAR_EVENT, { detail: "" }));
    }
    // waking/brewing/thinking with bubble minimized: clicking re-opens below
    if (!showBubble && !hasResult && state.phase === "thinking") reopenBubble();
  }

  return (
    <div
      className="pointer-events-none fixed bottom-3 right-4 z-40 flex flex-col items-end gap-2 max-md:bottom-16"
      aria-live="polite"
    >
      {showBubble && (
        <div className="pointer-events-auto">
          <SpeechBubble
            title={name}
            onMinimize={minimizeBubble}
            onDismiss={state.phase === "thinking" ? undefined : dismissResponse}
          >
            {state.phase === "thinking" && (
              <span className="flex items-center gap-2.5">
                <span style={{ color: "#d9c7a8" }}>{voice.thinking}</span>
                <TypingDots />
              </span>
            )}
            {state.phase === "responding" && state.response && (
              <>
                {state.prompt && (
                  <p className="mb-1.5 truncate text-xs italic" style={{ color: "#a89583" }}>
                    “{state.prompt}”
                  </p>
                )}
                <p>{state.response.text}</p>
                <ReceiptChips response={state.response} />
              </>
            )}
            {state.phase === "error" && (
              <>
                <p style={{ color: "#d9c7a8" }}>{voice.error}</p>
                <p className="mt-1 text-xs" style={{ color: "#e0685c" }}>
                  {state.error}
                </p>
              </>
            )}
          </SpeechBubble>
        </div>
      )}

      {/* ── The character at their desk ─────────────────────────────────── */}
      <button
        onClick={onCharacterClick}
        aria-label={companionLabel(state.phase, name, hasResult && !showBubble)}
        className="transition-fast group pointer-events-auto relative flex flex-col items-center rounded-2xl p-1.5 hover:scale-[1.04] focus-visible:scale-[1.04]"
      >
        {/* Sleep Z's — cool-toned, drifting up */}
        {state.phase === "sleeping" && (
          <span aria-hidden className="absolute -top-4 right-0 select-none text-[11px] font-semibold">
            <span className="companion-zzz absolute right-4 top-3" style={{ color: "#8b93b8" }}>z</span>
            <span className="companion-zzz companion-zzz-2 absolute right-1.5 top-1 text-[13px]" style={{ color: "#9a8fc0" }}>z</span>
            <span className="companion-zzz companion-zzz-3 absolute -right-1 -top-2 text-[15px]" style={{ color: "#a3a3ad" }}>Z</span>
          </span>
        )}

        {/* Unread-response dot when minimized */}
        {hasResult && !showBubble && (
          <span
            aria-hidden
            className="companion-dot absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-accent shadow"
          />
        )}

        <span className="flex items-end gap-1">
          <CompanionCup phase={state.phase} />
          <PixelAvatar personality={personality} size={56} mode={avatarMode} />
        </span>

        {/* the little desk */}
        <span
          aria-hidden
          className="mt-0.5 h-1.5 w-[4.5rem] rounded-full bg-gradient-to-r from-bean/50 via-bean/70 to-bean/50 shadow-sm"
        />
      </button>
    </div>
  );
}

function toAvatarMode(phase: CompanionPhase, celebrating: boolean, hadFailures: boolean): AvatarMode {
  switch (phase) {
    case "sleeping":
      return "sleeping";
    case "waking":
      return "alert";
    case "brewing":
    case "thinking":
      return "thinking"; // signature-move loop: sip / jot / pump / sip
    case "responding":
      if (celebrating) return hadFailures ? "concerned" : "happy";
      return "idle";
    case "error":
      return "concerned";
  }
}

function companionLabel(phase: CompanionPhase, name: string, hasUnread: boolean): string {
  if (hasUnread) return `${name} has a response for you`;
  switch (phase) {
    case "sleeping":
      return `${name} is resting — click to ask something`;
    case "waking":
    case "brewing":
      return `${name} is getting ready`;
    case "thinking":
      return `${name} is working on it`;
    default:
      return `${name}, your assistant`;
  }
}

/** The desk-side coffee cup. Steam always drifts; the brewing phase energizes it. */
function CompanionCup({ phase }: { phase: CompanionPhase }) {
  const strong = phase === "brewing";
  const steamClass = (extra?: string) => `steam ${extra ?? ""} ${strong ? "steam-strong" : ""}`;
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5 text-bean" fill="none" aria-hidden>
      <path className={steamClass()} d="M12 10 C 10 8, 14 7, 12 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path className={steamClass("steam-2")} d="M16 10 C 14 8, 18 7, 16 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {strong && (
        <path className={steamClass("steam-3")} d="M20 10 C 18 8, 22 7, 20 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      )}
      <path d="M8 14 h14 v5 a5 5 0 0 1 -5 5 h-4 a5 5 0 0 1 -5 -5 z" fill="currentColor" opacity="0.9" />
      <path d="M22 15 h2 a2.5 2.5 0 0 1 0 5 h-2" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}
