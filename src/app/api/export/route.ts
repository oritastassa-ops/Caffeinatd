import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

/** Her data, her file — full JSON export of everything the app stores. */
export async function GET() {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { supabase } = userCtx;

  const tables = [
    "profiles",
    "tasks",
    "workouts",
    "workout_sets",
    "meals",
    "memories",
    "daily_plans",
    "insights",
    "reminders",
    "finance_accounts",
    "finance_transactions",
    "finance_goals",
    "finance_snapshots",
    "finance_reviews",
    "households",
    "household_members",
    "chores",
    "chore_completions",
    "collection_schedules",
    "shopping_lists",
    "shopping_items",
  ];
  const dump: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  for (const table of tables) {
    const { data } = await supabase.from(table).select("*");
    dump[table] = data ?? [];
  }

  return new NextResponse(JSON.stringify(dump, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="caffeinatd-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
