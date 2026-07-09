"use client";

import { useState, useTransition } from "react";
import { completeOnboarding, OnboardingAnswers } from "@/app/onboarding/actions";
import { PERSONALITY_LIST } from "@/lib/personalities";
import { PixelAvatar } from "./avatars/pixel-avatar";

type TextAnswerKey = Exclude<keyof OnboardingAnswers, "timezone" | "communicationStyle">;

type Step = {
  key: TextAnswerKey;
  question: string;
  placeholder?: string;
};

const STEPS: Step[] = [
  { key: "displayName", question: "What should I call you?", placeholder: "Sarah" },
  { key: "weekday", question: "What does a normal weekday look like?", placeholder: "Up at 7, work 9-5, gym some evenings…" },
  { key: "goals", question: "What are you trying to improve right now?", placeholder: "Sleep more, stress less, stay consistent with…" },
  { key: "fitnessGoals", question: "What are your fitness goals?", placeholder: "Run a 10k, get stronger, just stay active…" },
  { key: "dietaryPreferences", question: "Any dietary preferences I should know?", placeholder: "Vegetarian, high protein, no dairy…" },
  { key: "recurringCommitments", question: "Any important recurring commitments?", placeholder: "Gym every Mon/Wed/Fri, therapy Tuesdays…" },
];

// The cast doubles as the style options — same registry the rest of the app reads.
const STYLES = PERSONALITY_LIST.map((p) => ({
  value: p.id,
  label: `${p.name} · ${p.label}`,
  hint: p.tagline,
}));

export function OnboardingWizard({
  defaultName,
  defaultTimezone,
}: {
  defaultName: string;
  defaultTimezone: string;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Omit<OnboardingAnswers, "timezone">>({
    displayName: defaultName,
    weekday: "",
    goals: "",
    fitnessGoals: "",
    dietaryPreferences: "",
    recurringCommitments: "",
    communicationStyle: "supportive",
  });
  const [isPending, startTransition] = useTransition();

  const totalSteps = STEPS.length + 1; // +1 for the communication-style step
  const isStyleStep = step === STEPS.length;
  const current = STEPS[step];

  function next() {
    if (step < totalSteps - 1) setStep(step + 1);
    else submit();
  }
  function back() {
    if (step > 0) setStep(step - 1);
  }
  function submit() {
    startTransition(() => completeOnboarding({ ...answers, timezone: defaultTimezone }));
  }
  function skip() {
    startTransition(() => completeOnboarding({ ...answers, timezone: defaultTimezone }));
  }

  return (
    <div className="rounded-2xl border bg-surface p-6">
      <div className="mb-5 flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-surface-2"}`} />
        ))}
      </div>

      {!isStyleStep && current && (
        <div className="flex flex-col gap-3">
          <label className="text-base font-medium">{current.question}</label>
          <input
            autoFocus
            value={answers[current.key] as string}
            onChange={(e) => setAnswers((a) => ({ ...a, [current.key]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && next()}
            placeholder={current.placeholder}
            className="rounded-xl border bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent"
          />
        </div>
      )}

      {isStyleStep && (
        <div className="flex flex-col gap-3">
          <label className="text-base font-medium">Who should be your assistant?</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => setAnswers((a) => ({ ...a, communicationStyle: s.value }))}
                className={`transition-fast rounded-xl border p-3 text-left ${
                  answers.communicationStyle === s.value ? "border-accent bg-accent-soft" : "hover:border-accent/50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <PixelAvatar
                    personality={s.value}
                    size={36}
                    mode={answers.communicationStyle === s.value ? "idle" : "static"}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="mt-0.5 text-xs text-text-dim">{s.hint}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={back} disabled={step === 0} className="text-sm text-text-dim disabled:opacity-0">
          Back
        </button>
        <div className="flex items-center gap-3">
          <button onClick={skip} className="text-sm text-text-dim hover:underline">
            Skip for now
          </button>
          <button
            onClick={next}
            disabled={isPending}
            className="transition-fast rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {step === totalSteps - 1 ? (isPending ? "Setting up…" : "Finish") : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
