"use client";

import { useState } from "react";

export function WorkoutAISummary({ workoutId, initialSummary }: { workoutId: string; initialSummary: string | null }) {
  const [summary, setSummary] = useState(initialSummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/fitness/workouts/${workoutId}/summary`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't generate a summary.");
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate a summary.");
    } finally {
      setLoading(false);
    }
  }

  if (summary) {
    return <p className="text-sm leading-relaxed">{summary}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={generate}
        disabled={loading}
        className="transition-fast self-start rounded-xl border px-4 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate summary"}
      </button>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
