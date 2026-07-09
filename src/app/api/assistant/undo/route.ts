import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import { deleteEvent } from "@/lib/google/calendar";

// Only tables the assistant can create rows in — undo means delete that row.
// RLS additionally guarantees the row belongs to the caller.
const UNDOABLE_TABLES = [
  "tasks",
  "meals",
  "workouts",
  "memories",
  "reminders",
  "finance_transactions",
  "finance_goals",
  "chores",
  "chore_completions",
  "shopping_items",
  "collection_schedules",
] as const;

const bodySchema = z.union([
  z.object({ table: z.enum(UNDOABLE_TABLES), id: z.string().uuid() }),
  z.object({ calendarId: z.string(), calendarEventId: z.string() }),
]);

export async function POST(req: NextRequest) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid undo target" }, { status: 400 });
  }

  try {
    if ("calendarEventId" in parsed.data) {
      const token = await getAccessToken(userCtx.supabase, userCtx.user.id);
      if (!token) return NextResponse.json({ error: "Calendar not connected" }, { status: 400 });
      await deleteEvent(token, parsed.data.calendarId, parsed.data.calendarEventId);
    } else {
      const { error } = await userCtx.supabase
        .from(parsed.data.table)
        .delete()
        .eq("id", parsed.data.id);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Undo failed" },
      { status: 500 },
    );
  }
}
