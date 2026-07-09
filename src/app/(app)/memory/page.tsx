import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Memory } from "@/lib/types";
import { Card, CardTitle, EmptyState } from "@/components/ui";
import { MemoryList } from "@/components/memory-list";
import { addMemory } from "./actions";

export const dynamic = "force-dynamic";

const SECTIONS: { kind: Memory["kind"]; label: string }[] = [
  { kind: "preference", label: "Preferences" },
  { kind: "goal", label: "Goals" },
  { kind: "relationship", label: "Relationships" },
  { kind: "habit", label: "Habits" },
  { kind: "routine", label: "Routines" },
  { kind: "event", label: "Important events" },
];

export default async function MemoryPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const { data } = await supabase
    .from("memories")
    .select("id, kind, content, importance, confidence, usage_count, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const memories = (data ?? []) as Memory[];
  const grouped = SECTIONS.map((s) => ({
    ...s,
    items: memories.filter((m) => m.kind === s.kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.display_name}'s World</h1>
        <p className="mt-1 text-sm text-text-dim">
          Everything the assistant knows about you. Click any line to edit it, or delete it and
          it's forgotten immediately.
        </p>
      </header>

      <Card>
        <CardTitle>Add something manually</CardTitle>
        <form action={addMemory} className="flex flex-wrap gap-2">
          <select
            name="kind"
            defaultValue="preference"
            className="rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {SECTIONS.map((s) => (
              <option key={s.kind} value={s.kind}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            name="content"
            placeholder="e.g. Favorite food is sushi"
            className="min-w-[240px] flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
            autoComplete="off"
          />
          <button className="transition-fast rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-90">
            Add
          </button>
        </form>
      </Card>

      {grouped.length === 0 ? (
        <Card>
          <EmptyState hint='Nothing remembered yet. Facts you share in conversation ("I hate morning meetings") land here.' />
        </Card>
      ) : (
        grouped.map((g) => (
          <Card key={g.kind}>
            <CardTitle>
              {g.label} · {g.items.length}
            </CardTitle>
            <MemoryList memories={g.items} />
          </Card>
        ))
      )}
    </div>
  );
}
