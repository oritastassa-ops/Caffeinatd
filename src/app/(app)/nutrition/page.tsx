import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { endOfDayISO, formatTime, localDateStr, startOfDayISO } from "@/lib/utils";
import { Meal } from "@/lib/types";
import { Card, CardTitle, EmptyState, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NutritionPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const tz = profile.timezone;
  const today = localDateStr(tz);

  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await supabase
    .from("meals")
    .select("*")
    .gte("eaten_at", weekAgo)
    .order("eaten_at", { ascending: false });

  const meals = (data ?? []) as Meal[];
  const todayStart = startOfDayISO(today, tz);
  const todayEnd = endOfDayISO(today, tz);
  const todayMeals = meals.filter((m) => m.eaten_at >= todayStart && m.eaten_at <= todayEnd);

  const sum = (rows: Meal[], key: keyof Pick<Meal, "calories" | "protein_g" | "carbs_g" | "fat_g">) =>
    rows.reduce((a, m) => a + (m[key] ?? 0), 0);

  // 7-day average over days that have logs
  const byDay = new Map<string, Meal[]>();
  for (const m of meals) {
    const d = localDateStr(tz, new Date(m.eaten_at));
    byDay.set(d, [...(byDay.get(d) ?? []), m]);
  }
  const avg = byDay.size
    ? Math.round([...byDay.values()].reduce((a, rows) => a + sum(rows, "calories"), 0) / byDay.size)
    : 0;

  const goal = profile.settings.calorieGoal;
  const todayKcal = sum(todayMeals, "calories");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Nutrition" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Today"
          value={`${todayKcal}`}
          sub={goal ? `of ${goal} kcal` : "kcal"}
          tone={goal && todayKcal > goal ? "bad" : "default"}
        />
        <Stat
          label="Protein"
          value={`${sum(todayMeals, "protein_g")}g`}
          sub={profile.settings.proteinGoal ? `of ${profile.settings.proteinGoal}g` : "today"}
        />
        <Stat
          label="Carbs · Fat"
          value={`${sum(todayMeals, "carbs_g")} · ${sum(todayMeals, "fat_g")}g`}
          sub="today"
        />
        <Stat label="7-day avg" value={`${avg}`} sub="kcal / logged day" />
      </div>

      <Card>
        <CardTitle>Log — last 7 days</CardTitle>
        {meals.length === 0 ? (
          <EmptyState hint='Press ⌘K and say what you ate — "I ate chicken and rice". I estimate the macros.' />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {meals.map((m) => (
              <li key={m.id} className="flex items-baseline gap-3 text-sm">
                <span className="tabular w-32 shrink-0 text-xs text-text-dim">
                  {localDateStr(tz, new Date(m.eaten_at)) === today
                    ? formatTime(m.eaten_at, tz)
                    : new Date(m.eaten_at).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}
                  {m.meal_type ? ` · ${m.meal_type}` : ""}
                </span>
                <span className="min-w-0 flex-1 truncate">{m.description}</span>
                <span className="tabular shrink-0 text-xs text-text-dim">
                  {m.calories ?? "–"} kcal · {m.protein_g ?? 0}P {m.carbs_g ?? 0}C {m.fat_g ?? 0}F
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
