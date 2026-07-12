"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CommunicationStyle } from "@/lib/types";
import { PIXEL_CHARACTERS } from "./pixel-data";
import { PERSONALITIES } from "@/lib/personalities";
import { cn } from "@/lib/utils";

type Frame = "base" | "blink" | "action" | "sleep" | "alert" | "happy" | "concerned";
export type AvatarMode =
  | "static"
  | "idle"
  | "thinking"
  | "sleeping"
  | "alert"
  | "happy"
  | "concerned";

/**
 * Renders one cast member as crisp SVG pixel art.
 * - static: base frame only (cheap, e.g. tiny list chips)
 * - idle: blinks every few seconds, does their signature move occasionally —
 *   staggered per instance so a page of avatars never blinks in unison
 * - thinking: alternates base/action quickly with a subtle bob (while generating)
 * - sleeping: eyes closed with slow breathing; stirs almost imperceptibly
 * - alert / happy / concerned: locked emotional frames — the companion
 *   choreographs how long each is held
 */
export function PixelAvatar({
  personality,
  size = 32,
  mode = "idle",
  className,
}: {
  personality: CommunicationStyle;
  size?: number;
  mode?: AvatarMode;
  className?: string;
}) {
  const character = PIXEL_CHARACTERS[personality];
  const [frame, setFrame] = useState<Frame>("base");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const locked: Partial<Record<AvatarMode, Frame>> = {
      alert: "alert",
      happy: "happy",
      concerned: "concerned",
    };
    setFrame(locked[mode] ?? (mode === "sleeping" ? "sleep" : "base"));
    if (mode === "static" || locked[mode]) return;

    let cancelled = false;
    const schedule = (fn: () => void, ms: number) => {
      const t = setTimeout(() => !cancelled && fn(), ms);
      timers.current.push(t);
    };

    if (mode === "sleeping") {
      // The occasional stir — lids part for a beat, then back under.
      const stirLoop = () => {
        schedule(() => {
          setFrame("blink");
          schedule(() => {
            setFrame("sleep");
            stirLoop();
          }, 260);
        }, 7000 + Math.random() * 5000);
      };
      stirLoop();
    } else if (mode === "thinking") {
      const tick = (on: boolean) => {
        setFrame(on ? "action" : "base");
        schedule(() => tick(!on), 450);
      };
      tick(true);
    } else {
      // idle: random stagger so multiple avatars never sync up
      const blinkLoop = () => {
        schedule(() => {
          setFrame("blink");
          schedule(() => {
            setFrame("base");
            blinkLoop();
          }, 150);
        }, 3500 + Math.random() * 2500);
      };
      const actionLoop = () => {
        schedule(() => {
          setFrame("action");
          schedule(() => {
            setFrame("base");
            actionLoop();
          }, 700);
        }, 8000 + Math.random() * 4000);
      };
      blinkLoop();
      actionLoop();
    }

    return () => {
      cancelled = true;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [mode, personality]);

  // Run-length encode each row into <rect> spans — ~4× fewer nodes than per-pixel.
  const grid = character.size;
  const rects = useMemo(() => {
    const rows = character.frames[frame];
    const out: { x: number; y: number; w: number; fill: string }[] = [];
    rows.forEach((row, y) => {
      let x = 0;
      while (x < grid) {
        const ch = row[x]!;
        if (ch === ".") {
          x++;
          continue;
        }
        let w = 1;
        while (x + w < grid && row[x + w] === ch) w++;
        out.push({ x, y, w, fill: character.palette[ch]! });
        x += w;
      }
    });
    return out;
  }, [character, frame, grid]);

  return (
    <svg
      viewBox={`0 0 ${grid} ${grid}`}
      width={size}
      height={size}
      role="img"
      aria-label={`${PERSONALITIES[personality].name}, your ${PERSONALITIES[personality].label.toLowerCase()} assistant`}
      className={cn(
        "shrink-0 select-none",
        mode === "thinking" && "avatar-bob",
        mode === "idle" && "avatar-breathe",
        mode === "sleeping" && "avatar-breathe-slow",
        (mode === "alert" || mode === "happy") && "avatar-pop",
        className,
      )}
      style={{ imageRendering: "pixelated", shapeRendering: "crispEdges" }}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
