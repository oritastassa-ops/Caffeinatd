import Link from "next/link";
import { Card, CardTitle, PriorityBadge } from "@/components/ui";
import { Task } from "@/lib/types";

/**
 * Open tasks and near-term deadlines in one card — they're read together, so
 * they share a surface with two dense sections rather than two half-empty cards.
 */
export function TasksAndDeadlines({
  openTasks,
  deadlines,
  nowISO,
}: {
  openTasks: Task[];
  deadlines: Task[];
  nowISO: string;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <section>
          <CardTitle>Open tasks</CardTitle>
          {openTasks.length === 0 ? (
            <p className="text-sm text-text-dim">All clear. Ask me to add something.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {openTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <PriorityBadge priority={t.priority} />
                  <Link href="/tasks" className="min-w-0 truncate hover:underline">
                    {t.title}
                  </Link>
                  {t.due_at && (
                    <span className="tabular ml-auto shrink-0 text-xs text-text-dim">
                      {t.due_at.slice(5, 10)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <CardTitle>Upcoming deadlines</CardTitle>
          {deadlines.length === 0 ? (
            <p className="text-sm text-text-dim">Nothing due in the next 7 days.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {deadlines.map((t) => {
                const overdue = Boolean(t.due_at && t.due_at < nowISO);
                return (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-pill ${overdue ? "bg-bad" : "bg-accent"}`}
                    />
                    <Link href="/tasks" className="min-w-0 flex-1 truncate hover:underline">
                      {t.title}
                    </Link>
                    <span
                      className={`tabular shrink-0 text-xs ${overdue ? "font-medium text-bad" : "text-text-dim"}`}
                    >
                      {overdue ? "overdue" : t.due_at?.slice(5, 10)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}
