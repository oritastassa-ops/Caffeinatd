import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Task } from "@/lib/types";
import { Button, Card, CardTitle, EmptyState, Input, PageHeader } from "@/components/ui";
import { TaskList } from "@/components/task-list";
import { DEFAULT_PERSONALITY, PERSONALITIES } from "@/lib/personalities";
import { addTask } from "./actions";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const style = profile.settings.communicationStyle ?? DEFAULT_PERSONALITY;
  const assistant = PERSONALITIES[style];
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .order("priority")
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const tasks = (data ?? []) as Task[];
  const open = tasks.filter((t) => !t.completed_at);
  const done = tasks.filter((t) => t.completed_at).slice(0, 10);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Tasks" />

      <form action={addTask} className="flex gap-2">
        <Input
          name="title"
          aria-label="Quick add task"
          placeholder="Quick add… (or ⌘K for natural language)"
          autoComplete="off"
          containerClassName="flex-1"
        />
        <Button type="submit">Add</Button>
      </form>

      <Card>
        <CardTitle>Open · {open.length}</CardTitle>
        {open.length === 0 ? (
          <EmptyState
            character={style}
            title={`${assistant.name}'s checklist is happily empty`}
            hint='Nothing to do. Press ⌘K and try "remind me to call mom tomorrow".'
          />
        ) : (
          <TaskList tasks={open} />
        )}
      </Card>

      {done.length > 0 && (
        <Card>
          <CardTitle>Recently completed</CardTitle>
          <TaskList tasks={done} />
        </Card>
      )}
    </div>
  );
}
