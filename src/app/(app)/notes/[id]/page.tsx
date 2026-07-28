import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { fetchWorkspaces } from "@/lib/workspaces/data";
import { Note } from "@/lib/types";
import { NoteEditor } from "@/components/note-editor";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  const [{ data }, workspaces] = await Promise.all([
    supabase.from("notes").select("*").eq("id", id).maybeSingle(),
    fetchWorkspaces(supabase, user.id),
  ]);
  if (!data) notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link href="/notes" className="transition-fast text-sm text-text-dim hover:text-text">
        ← Notes
      </Link>
      <NoteEditor note={data as Note} workspaces={workspaces} />
    </div>
  );
}
