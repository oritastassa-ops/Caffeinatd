import { Card, CardTitle } from "@/components/ui";
import { MacroTotals } from "@/lib/dashboard/today";

/** Compact macro readout for the dashboard rail. */
export function NutritionGlance({ totals, goal }: { totals: MacroTotals; goal?: number | null }) {
  const macros = [
    { label: "Calories", value: `${totals.kcal}${goal ? ` / ${goal}` : ""}` },
    { label: "Protein", value: `${totals.p}g` },
    { label: "Carbs", value: `${totals.c}g` },
    { label: "Fat", value: `${totals.f}g` },
  ];
  return (
    <Card>
      <CardTitle>Nutrition today</CardTitle>
      <div className="tabular grid grid-cols-2 gap-x-4 gap-y-3">
        {macros.map((m) => (
          <div key={m.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">{m.label}</p>
            <p className="mt-0.5 text-lg font-medium">{m.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
