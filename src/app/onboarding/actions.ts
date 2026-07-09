"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";
import { saveMemory } from "@/lib/memory";
import { CommunicationStyle, MemoryKind } from "@/lib/types";

export interface OnboardingAnswers {
  displayName: string;
  timezone: string;
  weekday: string; // "What does a normal weekday look like?"
  goals: string;
  fitnessGoals: string;
  dietaryPreferences: string;
  recurringCommitments: string;
  communicationStyle: CommunicationStyle;
}

/**
 * Turns free-text onboarding answers into durable memories (so the
 * assistant already "knows" the user on message one) plus a couple of
 * structured profile settings. Each free-text answer becomes one memory
 * row rather than being crammed into a settings blob — that's exactly what
 * the memory system's retrieval is for.
 */
export async function completeOnboarding(answers: OnboardingAnswers) {
  const { supabase, user } = await requireUser();
  const provider = getProvider();

  await supabase
    .from("profiles")
    .update({
      display_name: answers.displayName || "there",
      timezone: answers.timezone || "UTC",
      settings: { communicationStyle: answers.communicationStyle },
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  const memoryInputs: { kind: MemoryKind; content: string }[] = [
    answers.weekday && { kind: "routine", content: `Typical weekday: ${answers.weekday}` },
    answers.goals && { kind: "goal", content: `Trying to improve: ${answers.goals}` },
    answers.fitnessGoals && { kind: "goal", content: `Fitness goal: ${answers.fitnessGoals}` },
    answers.dietaryPreferences && { kind: "preference", content: `Dietary preference: ${answers.dietaryPreferences}` },
    answers.recurringCommitments && { kind: "routine", content: `Recurring commitment: ${answers.recurringCommitments}` },
  ].filter(Boolean) as { kind: MemoryKind; content: string }[];

  for (const m of memoryInputs) {
    await saveMemory(supabase, provider, user.id, m.kind, m.content, 4, 5);
  }

  redirect("/");
}
