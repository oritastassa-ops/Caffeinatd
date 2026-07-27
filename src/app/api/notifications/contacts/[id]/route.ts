import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const idSchema = z.string().uuid();

/** Remove a destination. RLS scopes the delete to the caller's own contacts. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid contact id." }, { status: 400 });
  }

  const { error } = await userCtx.supabase
    .from("notification_contacts")
    .delete()
    .eq("user_id", userCtx.user.id)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Couldn't remove that contact." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
