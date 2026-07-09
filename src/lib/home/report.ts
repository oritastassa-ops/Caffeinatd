import { SupabaseClient } from "@supabase/supabase-js";
import { fetchHomeData } from "./data";
import { computeChoreStats, isDueOn, nextAssignee, overdueDays } from "./schedule";
import { collectionLabel, nextCollection } from "./collections";

/**
 * Compact digest handed to the model — the home analog of the fitness and
 * finance reports. Every date/count is deterministic; the model only phrases.
 */
export async function buildHomeReport(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<string> {
  const data = await fetchHomeData(supabase, userId);
  if (!data) return "No household set up yet — the user can create or join one on the Home page.";

  const lines: string[] = [`Household: ${data.household.name} (${data.members.map((m) => m.name).join(", ")}).`];

  const due = data.chores.filter((c) => isDueOn(c, today, data.completions));
  if (due.length > 0) {
    lines.push(
      "Due today: " +
        due
          .map((c) => {
            const who = nextAssignee(c, data.members, data.completions);
            const od = overdueDays(c, today, data.completions);
            return `${c.title}${who ? ` (${who.name})` : ""}${od > 0 ? ` [${od}d overdue]` : ""}`;
          })
          .join("; "),
    );
  } else {
    lines.push("No chores due today.");
  }

  if (data.collections.length > 0) {
    lines.push(
      "Collections: " +
        data.collections
          .map((s) => `${collectionLabel(s.type)} next on ${nextCollection(s, today)} (${s.frequency})`)
          .join("; "),
    );
  }

  const openByList = data.lists
    .map((l) => ({ name: l.name, items: data.items.filter((i) => i.list_id === l.id && !i.completed_at) }))
    .filter((l) => l.items.length > 0);
  lines.push(
    openByList.length > 0
      ? "Shopping: " +
          openByList
            .map((l) => `${l.name}: ${l.items.map((i) => i.name + (i.quantity ? ` (${i.quantity})` : "")).join(", ")}`)
            .join(" | ")
      : "Shopping lists are empty.",
  );

  const stats = computeChoreStats(data.chores, data.completions, data.members, today);
  const active = data.members.find((m) => m.id === stats.mostActiveMemberId);
  lines.push(
    `Stats: ${stats.completedThisWeek} chores completed this week` +
      (stats.completionRatePercent !== null ? `, ${stats.completionRatePercent}% 30-day completion rate` : "") +
      (active ? `, most active: ${active.name}` : "") +
      ".",
  );

  return lines.join("\n");
}
