# Phase 15 — Make the assistant fast and aware

Read `CLAUDE.md` first. Then `src/lib/pipeline/run.ts` and `src/lib/planning/daily.ts` — the whole
diagnosis lives in the gap between those two files.

## The diagnosis

**`generateDailyPlan` is well-built. `runAssistant` is starving.** They solve nearly the same
problem with opposite architectures, and only one of them works.

`src/lib/planning/daily.ts:66-86` gathers calendar events, open tasks, recent workouts, meals,
household state, and set history in **one parallel round trip**, computes sleep and workout
recommendations deterministically, then makes **one** LLM call that returns a time-blocked schedule
placed inside real free windows. That is the right shape.

`src/lib/pipeline/run.ts:43-84` builds its system prompt from: current local time, a personality
line, recalled memories, and available notification channels. That is all. No calendar. No tasks.
No goals from `profile.settings`. **Not even today's plan**, which is already computed and sitting
in the `daily_plans` table.

The consequences, in the user's words and in mechanism:

| Symptom | Cause |
|---|---|
| "doesn't understand my calendar" | No calendar in context. Answering needs a `get_agenda` hop the model may not spend. |
| "isn't personalized" | `profile.settings` (calorie/protein goals, sleep hours, training split) never enters the prompt, though `daily.ts:155` passes it to the planner. |
| "can't schedule around my day" | Time-blocking exists only in the 04:00 cron. There is no conversational path to "re-plan my afternoon." |
| "too slow" | Up to `MAX_HOPS = 5` sequential LLM calls, each carrying 32 tool schemas. `TIME_BUDGET_MS = 100_000` and `maxDuration = 300` encode 100 seconds as acceptable. |
| "does nothing useful" | The above, compounding. |

**The fix is not a better prompt. It is giving the assistant the context the planner already
knows how to gather, and cutting the round trips that context makes unnecessary.**

## Part A — Ambient context (the big one)

Build `src/lib/pipeline/context.ts`: one function that assembles a compact "situation brief" for
the current user and injects it into the system prompt on every turn.

Contents, all cheap DB reads, all fetched in **one `Promise.all`** the way `daily.ts:66` does:

- **Today's plan** from `daily_plans` — overview, priorities, free windows, schedule blocks. This
  is the highest-value item and currently costs nothing because it is already generated.
- **Today's and tomorrow's calendar events** — times and titles only.
- **Top open tasks** — say 8, by priority and due date.
- **Readiness score and its reasons** (`src/lib/planning/readiness.ts`).
- **Goals from `profile.settings`** — calorie/protein targets, sleep hours, training split.
- Keep the existing memories and reachable-channels blocks.

Design constraints:

- **Budget it.** Target ~600–900 tokens for the whole brief. Truncate lists, not fields. State the
  budget in the doc and assert it in a test — an unbounded brief becomes the new latency problem.
- **Degrade gracefully.** No Google connection, no plan yet, no tasks — each section is omitted,
  not rendered as "none" noise. A missing section must never produce an error.
- **Freshness.** Calendar reads hit Google. Cache per request; do not fetch twice in one turn.
  If the round trip is too slow to sit in every request, say so and propose a short-TTL cache —
  but measure before adding one.
- **Reuse, don't reimplement.** `daily.ts` already knows how to fetch most of this. Extract the
  shared gathering into one module both callers use, rather than writing a second copy that drifts.

Then **update the system prompt rules** in `run.ts:63-77`. Today they instruct the model to fetch
things. With the brief present, most of those become "you already know this." Keep `get_agenda`
available for dates outside the brief's window.

Expected effect: the most common questions — what's my day, what should I do now, am I free at 3 —
answer in **one** hop instead of three.

## Part B — Cut the per-hop cost

32 tool schemas ship on every hop. That is a large constant on every call and the reason smaller
models mis-select.

Investigate and recommend, with measurements:

- **Do the tool descriptions justify their tokens?** Some in `tools.ts` are long. Tighten without
  losing the disambiguation they carry.
- **Should tools be selected per turn?** A cheap classifier or keyword pre-filter could expose
  8–10 relevant tools instead of 32. `runAssistant` already accepts `options.allowedTools`, so the
  mechanism exists — this is about deciding the subset. **Argue for or against**: a wrong subset
  makes the assistant unable to do something it should, which is worse than slow.
- **Are 5 hops needed once Part A lands?** Measure the real hop distribution before changing
  `MAX_HOPS`.

Do not guess. Add temporary instrumentation, run realistic prompts, report actual numbers.

## Part C — Perceived speed

Even at one hop this is a multi-second wait, and right now the user watches an animation with no
output.

- **Stream the final response.** The `AIProvider` interface has no streaming method; adding one is
  a real change to `src/lib/ai/types.ts` and every provider. Propose the interface first. First
  token in under a second changes the feel more than shaving two seconds off total latency.
- If streaming is too large for this session, say so and ship Part A and B first — but say it
  explicitly rather than silently dropping it.
- The companion in `src/components/assistant/` already has a state machine. Make its states
  reflect what is actually happening (gathering context → thinking → acting → answering) rather
  than a generic wait.

## Part D — Conversational planning

The planner can time-block a day around real events. That capability is locked inside the 04:00
cron.

Add a tool that exposes it: re-plan the remainder of today given what has changed — a meeting ran
long, a workout got skipped, a deadline moved. It should reuse `daily.ts`'s block placement, not
reimplement scheduling in a prompt.

This is what turns "a chatbot with tools" into something that behaves like a secretary. Keep the
existing rule that math is deterministic and the model only phrases it.

## Tests

- Context brief: shape and token budget; each section omitted cleanly when its data is absent;
  no PII beyond what the prompt already carried.
- Hop count: with the brief present, "what's on my calendar today" resolves without a tool call.
  This is the phase's key regression test.
- Re-plan tool: blocks land inside free windows, never overlap existing events, DST-safe.
- Existing pipeline tests still pass, including `tests/pipeline-failures.test.ts`.

## Out of scope

New pillars. UI redesign. Changing providers (that is `prompts/10-operational-polish.md`).

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- "What does my day look like?" answers correctly in one hop, referencing real calendar events and
  today's plan.
- "I have a free hour, what should I do?" gives an answer grounded in priorities and readiness.
- Measured before/after latency for five representative prompts, reported in the commit body.
- `docs/21-assistant-context.md` explains the brief, the token budget, and the hop-count reasoning,
  with a self-critique.
- One commit, imperative message.

**Before writing code:** measure the current hop count and latency for five realistic prompts and
show me the numbers. Then give me your plan. If you think the tool-subsetting idea in Part B is
wrong, or that streaming should come before context, argue for it — you will have data I don't.
