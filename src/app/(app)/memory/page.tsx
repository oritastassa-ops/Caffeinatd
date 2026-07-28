import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Memory } from "@/lib/types";
import { Button, Card, CardTitle, EmptyState, Input, PageHeader, Select } from "@/components/ui";
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title={`${profile.display_name}'s World`}
        description="Everything the assistant knows about you. Click any line to edit it, or delete it and it's forgotten immediately."
      />

      <Card>
        <CardTitle>Add something manually</CardTitle>
        <form action={addMemory} className="flex flex-wrap items-end gap-2">
          <Select name="kind" aria-label="Kind" defaultValue="preference" containerClassName="w-44">
            {SECTIONS.map((s) => (
              <option key={s.kind} value={s.kind}>
                {s.label}
              </option>
            ))}
          </Select>
          <Input
            name="content"
            aria-label="What to remember"
            placeholder="e.g. Favorite food is sushi"
            autoComplete="off"
            containerClassName="min-w-[240px] flex-1"
          />
          <Button type="submit">Add</Button>
        </form>
      </Card>

      {grouped.length === 0 ? (
        <Card>
          <EmptyState
            title="Your memory is a blank slate"
            hint="This is what the assistant knows about you — preferences, goals, people, habits. Say “I hate morning meetings” or “my sister’s name is Dana” in ⌘K and it lands here, editable and deletable anytime."
          />
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
