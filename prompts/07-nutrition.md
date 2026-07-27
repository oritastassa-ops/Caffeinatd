# Phase 7 — Real nutrition

Read `CLAUDE.md` first. Requires Phase 6 for the goal-tracking integration, though the food
database work is independent.

## Goal

Replace LLM macro guessing with looked-up food data.

## The problem, stated honestly

`meals` (`supabase/schema.sql:67-78`) stores a free-text `description` and four integers.
Those integers come from the model: `log_meal` in `src/lib/pipeline/tools.ts` asks for
`calories` with the description "Your best estimate for the whole portion."

`docs/04-roadmap.md` already names this as the design's weakest point — *"LLM macro estimation
drifts. Mitigation shipped: estimates are visible + editable at capture; roadmap adds a food-DB
lookup tool the model can call."* This phase is that roadmap item.

Why it matters beyond accuracy: there is no quantity anywhere in the schema. "Chicken and rice"
and "chicken and rice" are two identical rows that were different meals. Nothing can be
recomputed, corrected, or trended, because the portion was never recorded. The macros are the
only trace of an estimate nobody can audit.

## Deliverables

### 1. Choose a food data source — decide before building

Options, with the tradeoffs I know of:

- **USDA FoodData Central** — free, no rate limit worth worrying about, authoritative, US-centric,
  API key by email. Excellent for whole foods, thin on branded and restaurant items.
- **Open Food Facts** — free, open, huge branded/barcode coverage, crowd-sourced so quality
  varies, global. No key.
- **Nutritionix / Edamam** — better natural-language parsing and restaurant coverage, but paid
  tiers and per-request limits.

My lean is **USDA primary, Open Food Facts for branded/barcode**, behind one interface so the
choice is reversible — the same pattern as `AIProvider` and `channelRegistry`. But you may know
these APIs better than I do. **Recommend and justify before implementing.**

Whatever you pick: an API key goes in env, and if it's ever per-user it goes through
`encryptSecret` in `src/lib/integrations/crypto.ts`.

### 2. Provider abstraction — `src/lib/nutrition/`

```ts
export interface FoodSearchResult {
  id: string;                 // provider-namespaced
  name: string;
  brand?: string;
  servingOptions: ServingOption[];   // "100 g", "1 cup (158 g)", "1 medium (182 g)"
  per100g: Macros;
}

export interface FoodProvider {
  readonly name: string;
  search(query: string, limit?: number): Promise<FoodSearchResult[]>;
  byBarcode?(code: string): Promise<FoodSearchResult | null>;
}
```

Registry + factory following `src/lib/notifications/registry.ts`. A provider without credentials
is simply absent.

**Cache aggressively.** Food data is effectively immutable — a `foods_cache` table keyed by
provider id turns the second lookup of "chicken breast" into a DB read. This is the difference
between a snappy log flow and a two-second API round trip every meal.

### 3. Schema — `supabase/migrations/012_nutrition.sql`

- **`foods_cache`** — normalized food records with macros per 100g and serving options as jsonb.
  Shared across users; readable by all authenticated users, writable only server-side. Note the
  RLS asymmetry explicitly, since every other table here is strictly per-user.
- **`meal_items`** — the missing layer. One row per food in a meal: `meal_id`, `food_id`
  (nullable — freeform entries stay possible), `description`, `quantity`, `unit`,
  `grams_resolved`, and the computed macros. **`meals` becomes a container; `meal_items` holds
  the truth.**
- Keep `meals`' existing macro columns as a **denormalized rollup** of its items, maintained on
  write. Rewriting every consumer (`src/app/(app)/nutrition/page.tsx`, `readiness.ts`, insights,
  the daily plan) is out of scope, and they all read those four integers today. Say in the doc
  that the rollup is derived and must never be written directly.
- Backfill: existing `meals` rows have no items. They must keep displaying correctly. A migration
  that orphans historical data is a failure.

### 4. Assistant tools

- **`search_food`** — `{ query, limit? }`. The model calls this *before* logging.
- **`log_meal`** — extend to accept structured `items: [{ food_id?, description, quantity, unit }]`
  while still accepting the current freeform shape. **Do not break the existing contract**; the
  model must be able to fall back when lookup fails or the food isn't in any database.
- Update the tool description to steer toward lookup: something like *"Search for each food with
  search_food first; only estimate macros yourself when lookup returns nothing, and say so."*

The honesty requirement: a meal whose macros came from a database and one where the model guessed
must be **distinguishable in the data and visible in the UI**. Add an `estimated` flag on
`meal_items`. A user should never be unable to tell which of their numbers are real.

### 5. Portion resolution — `src/lib/nutrition/portions.ts`

Pure, unit-tested. `("2", "cups", servingOptions) → grams`. Handles the units people actually
speak: g, kg, oz, lb, ml, cup, tbsp, tsp, "slice", "medium", "handful".

Two rules:
- **Volume→mass needs a density and is food-specific.** A cup of flour and a cup of water are not
  the same mass. Only convert when the provider supplies a serving option in that unit; otherwise
  return unresolved and let the model ask.
- **Unresolved is a valid answer.** Guessing a portion silently is exactly the failure mode this
  phase exists to eliminate.

### 6. Surface

`src/app/(app)/nutrition/page.tsx` is currently a read-only summary. Add:

- Meal detail showing its items with quantities, and which are looked-up vs. estimated.
- Inline food search when logging manually — type, pick, choose serving, adjust quantity. This
  flow's speed determines whether the feature gets used. Keyboard-first, matching ⌘K.
- Macro goals against actuals. `profiles.settings` already holds `calorieGoal`, `proteinGoal`,
  `carbsGoal`, `fatGoal` (`supabase/schema.sql:9`) and the page already reads `calorieGoal`.

### 7. Docs

`docs/16-nutrition.md`: provider choice and why, the cache strategy, the rollup invariant, the
estimated-vs-looked-up distinction, and a self-critique.

## Tests

- Portion resolution across every supported unit, plus the unresolved cases.
- Rollup: adding, editing, deleting an item keeps `meals` macros consistent with its items.
- Backfill: a pre-migration meal with no items still renders.
- Provider mapping: USDA/OFF response → `FoodSearchResult`, including missing-field handling.
- Cache hit path issues no network call.

## Out of scope

Barcode *scanning* UI (the `byBarcode` interface is enough). Recipes. Meal planning. Photo
recognition. Micronutrients beyond the big four — note them as a natural extension.

## Boundary

Same rule as Phase 6: descriptive only. No dietary advice, no "you should eat more protein"
framing beyond a neutral goal-vs-actual comparison the user configured themselves. No
interpretation of eating patterns.

Be deliberate about tone in this pillar specifically. Nutrition tracking sits close to
disordered-eating patterns for some users, and a system that editorializes about food intake can
do real harm. Neutral, factual, no streaks-and-shame mechanics, no unprompted commentary on
whether a day was "good."

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- "I had 200g of chicken breast and a cup of rice" produces two `meal_items` with looked-up
  macros and a resolved gram weight.
- A food the database doesn't know still logs, flagged as estimated, and the UI says so.
- Pre-existing meals render unchanged.
- One commit, imperative message.

Recommend a provider with reasoning before you start, and tell me if the rollup-plus-items design
is the wrong call — a full normalization with every consumer rewritten is the alternative, and I
may be under-investing to avoid churn.
