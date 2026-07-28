import Link from "next/link";
import { Workspace } from "@/lib/types";

/** Workspace tile — dashboard grid and anywhere contexts are listed. */
export function WorkspaceCard({
  workspace,
  openTasks,
  noteCount,
}: {
  workspace: Pick<Workspace, "slug" | "name" | "icon" | "description">;
  openTasks?: number;
  noteCount?: number;
}) {
  const counts = [
    openTasks !== undefined && openTasks > 0 && `${openTasks} open`,
    noteCount !== undefined && noteCount > 0 && `${noteCount} note${noteCount === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <Link
      href={`/workspaces/${workspace.slug}`}
      className="transition-fast group flex items-center gap-3 rounded-card border bg-surface p-4 hover:border-accent"
    >
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
        {workspace.icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{workspace.name}</p>
        <p className="truncate text-xs text-text-dim">
          {counts.length > 0 ? counts.join(" · ") : workspace.description ?? "Open workspace"}
        </p>
      </div>
    </Link>
  );
}
