import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

/** Stops future imports. Already-imported workouts stay — disconnecting isn't destructive to history. */
export async function POST() {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  await userCtx.supabase
    .from("fitness_integrations")
    .delete()
    .eq("user_id", userCtx.user.id)
    .eq("provider", "hevy");

  return NextResponse.json({ ok: true });
}
