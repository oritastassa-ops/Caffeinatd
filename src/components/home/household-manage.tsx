"use client";

import { useState, useTransition } from "react";
import { CollectionSchedule, HouseholdMember } from "@/lib/types";
import { deleteCollectionSchedule, removeMember } from "@/app/(app)/home/actions";
import { collectionLabel, nextCollection } from "@/lib/home/collections";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function MembersList({ members }: { members: HouseholdMember[] }) {
  const [, startTransition] = useTransition();
  return (
    <ul className="flex flex-col">
      {members.map((m) => (
        <li key={m.id} className="group flex items-center gap-3 border-b py-2.5 last:border-b-0">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: m.color }}
          >
            {m.initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{m.name}</p>
            <p className="text-xs text-text-dim">
              {m.role === "owner" ? "Owner" : "Member"}
              {!m.user_id && " · no account (still assignable)"}
            </p>
          </div>
          {m.role !== "owner" && (
            <button
              aria-label={`Remove ${m.name}`}
              onClick={() => startTransition(() => removeMember(m.id))}
              className="transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CollectionsList({ schedules, today }: { schedules: CollectionSchedule[]; today: string }) {
  const [, startTransition] = useTransition();
  if (schedules.length === 0) {
    return <p className="text-sm text-text-dim">None configured — add garbage/recycling below, or tell me: &ldquo;garbage day is Tuesday&rdquo;.</p>;
  }
  return (
    <ul className="flex flex-col">
      {schedules.map((s) => (
        <li key={s.id} className="group flex items-center gap-3 border-b py-2.5 text-sm last:border-b-0">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{collectionLabel(s.type)}</span>
            <span className="text-text-dim">
              {" "}
              · {s.frequency} on {DAYS[s.day_of_week]}
            </span>
          </span>
          <span className="tabular shrink-0 text-xs text-text-dim">next {nextCollection(s, today).slice(5)}</span>
          <button
            aria-label="Remove schedule"
            onClick={() => startTransition(() => deleteCollectionSchedule(s.id))}
            className="transition-fast shrink-0 text-text-dim opacity-0 hover:text-bad group-hover:opacity-100"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

export function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <code className="rounded-lg border bg-surface-2 px-3 py-1.5 text-sm tracking-widest">{code}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="text-sm text-accent hover:underline"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
