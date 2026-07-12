import { requireUser } from "@/lib/supabase/server";
import { Task } from "@/lib/types";
import { FocusSession } from "@/components/focus-session";

export const dynamic = "force-dynamic";

/** Deep-work surface: renders above the app chrome (fixed full-screen layer). */
export default async function FocusPage() {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .is("completed_at", null)
    .order("priority")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(10);

  return <FocusSession tasks={(data ?? []) as Task[]} />;
}
