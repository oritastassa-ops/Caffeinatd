# Quality Pass — Audit (before any code changes)

Scope: the "quality, polish, responsiveness, reliability" brief. Every finding below was
verified by reading the code (file:line), not guessed.

## A. Confirmed bugs — the fake-success pipeline

The reported symptom: "Plan my day" (and sometimes task/event creation) reports success,
but nothing shows up. There is no single bug — there are four layers where failure is
swallowed, and any one of them produces exactly this symptom.

### A1. `daily_plans` upsert error ignored — plan "generated" but never saved
`src/lib/planning/daily.ts:160-163`

```ts
await supabase.from("daily_plans").upsert({ user_id: profile.id, plan_date: planDate, plan });
return plan;   // ← error object never read
```

If the upsert fails (RLS, missing migration, network), `generateDailyPlan` still returns
the plan, the executor still emits `receipt: "Daily plan generated for <date>"`, the user
sees a green chip — and the Today page (which reads `daily_plans`) shows nothing.
**This is the most likely root cause of the reported bug.**

### A2. `parsePlanJSON` silently degrades to an empty plan
`src/lib/planning/daily.ts:166-183`

When the model returns unparseable JSON, the fallback returns
`{ overview: text, priorities: [], workout: "", ... }` — which is then upserted and
receipted as a successful plan. The Today page's "Today's focus" reads `plan.priorities`,
so the user sees a "plan generated" chip and an empty focus list: fake success.

### A3. `complete_task` update error ignored
`src/lib/pipeline/executor.ts:124-127`

```ts
await ctx.supabase.from("tasks").update({ completed_at: ... }).eq("id", task.id);
return { result: `Completed "${task.title}".`, receipt: ... };  // error never read
```

Every other write in the executor checks `error`; this one doesn't.

### A4. No deterministic failure surfacing in `runAssistant`
`src/lib/pipeline/run.ts:65-92`

Tool failures come back as `"Error: …"` strings fed to the model, and honesty then
depends entirely on the model choosing to relay them. Nothing in the deterministic layer
records that a tool failed; `AssistantResponse` has no `failures` field; the command bar
can only render success chips. A model that says "Done! Task created." after a failed
insert is indistinguishable from a real success in the UI.

### A5. UI refresh only happens on close
`src/components/command-bar.tsx:90`

`router.refresh()` fires only when the bar is *closed* and only if `actions.length > 0`.
While the bar is open the page behind it is stale, which reads as "nothing happened".

## B. Tool-by-tool write audit (executor.ts)

| Tool | Write checked? |
|---|---|
| create_task, log_workout (+sets), log_meal, create_reminder, log_expense, log_income, create_finance_goal, add_chore, complete_chore, add_shopping_item, check_off_shopping, remove_shopping_item, set_collection_schedule, save_memory | ✅ `if (error) throw` |
| complete_task | ❌ error ignored (A3) |
| generate_daily_plan → daily.ts upsert | ❌ error ignored (A1) + silent parse fallback (A2) |
| calendar tools (create/update/delete_event) | ✅ Google client throws on non-2xx |
| read-only tools (list_*, get_*, reports, simulate, recommend_bedtime) | n/a |

`recallMemories`' `last_used_at` update (memory/index.ts:72) is unchecked but read-path
telemetry — acceptable, not user-facing success.

## C. Performance bottlenecks

1. **Today page render path** (`src/app/(app)/page.tsx`): awaits `ensureInsights`
   (which internally re-fetches finance + home + set rows) *before* first byte, then the
   page fetches `fetchFinanceData` / `fetchHomeData` / `fetchSetRows` again — duplicate
   round-trips, all blocking render.
2. **Fitness page** (`fitness/page.tsx:28`): `await syncIfStale(...)` blocks navigation on
   a potential Hevy network round-trip.
3. **`recallMemories` N+1** (`memory/index.ts:78-80`): one sequential
   `increment_memory_usage` RPC per recalled memory (up to 6 serial round-trips) on the
   hot path of *every* assistant message.
4. **No route-level `loading.tsx`** anywhere under `src/app/(app)/` — every navigation
   between force-dynamic pages shows a frozen screen until the server responds.

## D. UI responsiveness gaps (perceived latency)

- `TaskList` toggle/delete, `ShoppingView` check-off/clear, chore completion all use bare
  `startTransition(serverAction)` with **no optimistic state** — the checkbox doesn't
  check until the server round-trip + refresh completes.
- Command bar: no immediate `router.refresh()` on success (A5).

## E. Avatar / animation opportunities (sections 4–6 of the brief)

- `pixel-data.ts` grids are 16×16; `pixel-avatar.tsx` hardcodes `viewBox="0 0 16 16"` —
  redesign at native 32×32, parametrize the renderer's grid size from the data.
- Idle animation is blink-only; add a subtle breathing keyframe (respecting
  `prefers-reduced-motion`, already themed in globals.css).
- Presence gaps: fitness "Recommended next session" card (Maggie) and finance weekly
  review card (Juan) have no avatar; greeting/empty states/command bar already do.

## Fix order

1. Pipeline honesty: A1 + A2 + A3, then A4 (failures in `AssistantResponse`, red chips,
   system-prompt honesty rule), then A5.
2. Responsiveness: loading.tsx, defer `ensureInsights`/`syncIfStale` off the render path,
   deduplicate Today fetches, optimistic UI, parallelize memory RPCs.
3. Art: 32×32 redesign, presence, breathing animation, test updates.

Gate each stage with `tsc --noEmit`, the full test suite (163 passing today), and a
production build.
