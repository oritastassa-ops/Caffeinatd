import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { CommandBar, AssistantTrigger } from "@/components/command-bar";
import { AssistantCompanion } from "@/components/assistant/companion";
import { DEFAULT_PERSONALITY } from "@/lib/personalities";
import { CommunicationStyle } from "@/lib/types";
import { fetchWorkspaces } from "@/lib/workspaces/data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("profiles")
    .select("onboarded_at, settings")
    .eq("id", user.id)
    .single();
  if (!data?.onboarded_at) redirect("/onboarding");

  const personality: CommunicationStyle =
    (data.settings?.communicationStyle as CommunicationStyle | undefined) ?? DEFAULT_PERSONALITY;

  // Workspaces feed both the sidebar and the command palette; only the three
  // display fields cross the server/client boundary.
  const workspaces = (await fetchWorkspaces(supabase, user.id)).map((w) => ({
    slug: w.slug,
    name: w.name,
    icon: w.icon,
  }));

  return (
    <div className="flex min-h-screen">
      <Sidebar workspaces={workspaces} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 pb-24 md:px-8 md:pb-8">
        {/* Persistent, discoverable assistant entry point on every page. */}
        <div className="mb-5">
          <AssistantTrigger personality={personality} />
        </div>
        {children}
      </main>
      <CommandBar personality={personality} workspaces={workspaces} />
      {/* The desk companion — asleep in the corner until asked. */}
      <AssistantCompanion personality={personality} />
    </div>
  );
}
