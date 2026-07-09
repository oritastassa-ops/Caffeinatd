import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { syncHevyWorkouts } from "@/lib/integrations/hevy";

/** "Sync Now" button. */
export async function POST() {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const result = await syncHevyWorkouts(userCtx.supabase, userCtx.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Sync failed." }, { status: 502 });
  }
  return NextResponse.json(result);
}
