import { Section } from "@/components/ui";
import { WorkspaceCard } from "@/components/workspace-card";
import { Workspace } from "@/lib/types";

/** The workspace tiles, below the fold — navigation, not "what's now". */
export function WorkspacesSection({
  workspaces,
  openByWorkspace,
}: {
  workspaces: Workspace[];
  openByWorkspace: Record<string, number>;
}) {
  if (workspaces.length === 0) return null;
  return (
    <Section title="Workspaces">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {workspaces.map((w) => (
          <WorkspaceCard key={w.id} workspace={w} openTasks={openByWorkspace[w.id] ?? 0} />
        ))}
      </div>
    </Section>
  );
}
