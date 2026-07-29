# 21 — Assistant context & speed

Why the ⌘K assistant felt slow, unaware, and "does nothing useful," and what Phase 15 (Parts A + D)
changed. The short version: `generateDailyPlan` gathers the whole day in one parallel round trip and
reasons once; `runAssistant` gathered almost nothing and made the model *fetch* its own context one
tool hop at a time. This phase gives the assistant the same situation awareness the planner already
had, and shares the planner's scheduling math so the assistant can re-plan a day — not just read it.

## The diagnosis, in one number

Every reasoning hop ships the full tool catalog to the model. Measured directly from `getToolDefs()`
(`tests/` probe, ~4 chars/token):

| Per-hop payload | ≈ tokens |
|---|---|
| **32 tool schemas, every hop** | **≈ 3,794** |
| — JSON schemas | ≈ 2,410 |
| — top-level descriptions | ≈ 936 |
| — names + scaffolding | ≈ 450 |

So a question that needs a `get_agenda` round trip costs **two** of these preambles plus two model
latencies plus a Google call — when the answer could have been one sentence in the first prompt. That
is the whole diagnosis: the cost isn't the prompt wording, it's the *extra hop*.

## Part A — the situation brief

`src/lib/pipeline/context.ts` (`buildSituationBrief`) assembles a compact snapshot and
`runAssistant` injects it into the system prompt on every turn, in the same `Promise.all` as memory
recall and reachable-channel resolution. Contents, all cheap DB reads gathered in one parallel round
trip (the `daily.ts:66` shape):

- **Today's plan** from `daily_plans` (overview, priorities, free windows) — highest value, already
  computed by the 04:00 cron, so it costs nothing to surface.
- **Today's and tomorrow's calendar** — times + titles only.
- **Top 8 open tasks** by priority then due date.
- **Readiness score + reasons** (`computeReadiness`, deterministic).
- **Goals** from `profile.settings` (calorie/protein, sleep hours, training split).

### Token budget

Target **~600–900 tokens** for the whole brief. `tests/pipeline-context.test.ts` asserts a
fully-loaded brief (plan + 8 tasks + events on both days + goals) stays **≤ 900 tokens**. The rule when
trimming is **truncate lists, not fields** — a shorter task list beats a half-sentence overview. Lists
are capped (8 tasks, 8 events/day, 5 priorities) with a `(+N more)` marker so the model knows the list
was clipped.

The bet: the brief adds ~600–900 tokens *once* per turn but removes an entire ~3,794-token tool hop
(plus a model latency and a Google call) for the most common questions. Net latency falls even though
the first prompt is larger.

### Freshness, without a second cache

The calendar read reuses the existing 10-second agenda cache (`listEvents`, keyed by user id), so a
`get_agenda` tool call later in the *same* turn doesn't re-fetch. Measured against the existing cache;
no new caching layer was added. Every section is independently `catch`-guarded — a missing plan, no
Google connection, or an empty task list omits that section (never "none" noise) and never errors.

### Prompt rules

`run.ts` rules were rewritten from "fetch things" to "you already know this." The model is told to
answer today/tomorrow questions straight from the brief and to call `get_agenda` only for other dates
or to get an event id it needs to modify.

### The result (deterministic hop count)

`tests/pipeline-hopcount.test.ts` runs a scripted provider that behaves like a competent model — it
answers directly when the needed context is in the system prompt, and spends one tool hop when it
isn't. Measured before/after the brief, identical data:

```
2 → 1   What's on my calendar today?
2 → 1   What does my day look like?
2 → 1   Am I free at 3pm?
2 → 1   What should I focus on today?
2 → 1   I have a free hour — what should I do?
```

The permanent guard: *"what's on my calendar today"* must resolve in exactly one hop, and the test
asserts the calendar actually appears in the injected prompt. If a later change stops injecting the
brief (or drops the calendar from it), the scripted provider spends a `get_agenda` hop again and the
suite fails. This is the regression this phase most wanted to lock in.

### Real-world latency — TO BE FILLED FROM A LIVE RUN

Wall-clock latency needs live keys + a seeded DB and so is **not** in the always-on suite. Run the
gated harness and paste its output here:

```
LIVE_LATENCY=1 LATENCY_USER_ID=<uuid> npx vitest run tests/assistant-latency.harness.test.ts
```

| Prompt | Hops (before) | Hops (after) | ms (before) | ms (after) |
|---|---|---|---|---|
| What's on my calendar today? | 2 | 1 | _tbd_ | _tbd_ |
| What does my day look like? | 2 | 1 | _tbd_ | _tbd_ |
| Am I free at 3pm? | 2 | 1 | _tbd_ | _tbd_ |
| What should I focus on today? | 2 | 1 | _tbd_ | _tbd_ |
| I have a free hour — what should I do? | 2 | 1 | _tbd_ | _tbd_ |

(Hop columns are already proven deterministically above; only the millisecond columns need the live
run. The harness prints both so the two can be cross-checked.)

## Part D — conversational re-planning, on shared deterministic math

The planner could time-block a day around real events, but only inside the 04:00 cron. Phase 15
exposes it: the `replan_today` tool reorganizes the *remainder* of today when the plan slips (a meeting
ran long, a workout was skipped).

The scheduling is **deterministic**, per the repo's core rule (CLAUDE.md: "deterministic math, LLM
phrasing"). `src/lib/planning/place-blocks.ts` is a pure module — `busyIntervals` → `freeWindows` →
`placeBlocks` — working in local minutes-from-midnight, unit-tested for no-overlap, inside-window, and
DST-safe conversion (`tests/place-blocks.test.ts`). The model never chooses times: it supplies the
items (the open tasks) and relays the result. `replan_today` reads today's real events, computes the
free gaps from *now* to the day's end, lays the top open tasks into them, and creates the calendar
events (`zonedTimeToUtc`, so both DST directions land correctly).

**This same module now backs the morning plan too.** `daily.ts` previously asked the LLM to invent
`freeWindows` and a `schedule`; it now computes both with `place-blocks`, so there is exactly one
placement implementation and the plan's blocks are guaranteed to sit in real gaps, not hallucinated
ones. The LLM's job shrank to the prose (overview, priorities, workout, nutrition), which is also
marginally faster.

> ⚠️ **Live-verification note.** The `daily.ts` change replaces LLM placement with deterministic
> placement in the working 04:00 cron. `place-blocks` is thoroughly unit-tested and the wiring is thin
> glue, but the cron itself was not run against live Gemini + Google in this session (no interactive
> calendar). First live daily-plan run should be eyeballed once.

## Part B — per-hop cost (SCOPED FOR A KEYED SESSION, not built here)

What the measurement says, so the next session doesn't re-derive it:

- **The schemas dominate, not the prose.** Of the ~3,794 tokens/hop, ~2,410 are JSON schemas and only
  ~936 are top-level descriptions. Tightening descriptions recovers ≤ ~900 tokens *and* risks losing
  the disambiguation they carry — low reward, real downside. **Do not spend the session tightening
  descriptions.**
- **Per-turn tool subsetting is the real lever.** `runAssistant` already accepts `options.allowedTools`
  (built in Phase 14), so the mechanism exists. Exposing ~10 relevant tools instead of 32 cuts
  ≈2,600 tokens/hop — roughly 3× the description-tightening ceiling.
- **Recommendation, argued:** build subsetting as **always-include-core + expand-by-signal** (keyword
  or a cheap classifier), never a hard cap. A wrong subset makes the assistant *unable* to do
  something it should, which is worse than slow — so err toward inclusion, and keep a core set
  (`create_task`, `get_agenda`, `list_tasks`, `complete_task`, `generate_daily_plan`, `replan_today`,
  `notify_me`) always present.
- **This needs a live misclassification eval before shipping** — run realistic prompts against the
  real model and confirm the subset never omits a tool the turn needed. That eval requires keys, which
  is why B is a keyed session, not this one.
- **`MAX_HOPS`: leave at 5.** It's a ceiling the loop already exits early from; lowering it saves
  nothing on the common (now 1-hop) path and risks truncating a legitimate multi-tool flow. Measure the
  real hop distribution live before touching it — don't guess.

## Part C — perceived speed (SCOPED FOR A KEYED SESSION)

- **Streaming the final response** is the biggest felt win (first token < 1s), but it's a real
  cross-cutting change: `AIProvider.chat` has no streaming variant, so it touches `src/lib/ai/types.ts`
  and all four providers (gemini, openai-compat, anthropic, fallback), the assistant route, and the
  companion component. Proposed interface: add an optional `chatStream(req): AsyncIterable<string>` to
  `AIProvider`, fall back to `chat` when a provider doesn't implement it, and have the route emit SSE.
  Deferred because Part A delivered more felt improvement per unit risk.
- **The companion state machine** (`src/components/assistant/store.ts`) currently advances on a timer
  (`brewing → thinking`). Making its states reflect reality (gathering context → thinking → acting →
  answering) needs the server to report progress, which is the same SSE channel streaming introduces —
  so it's deferred to the streaming session rather than faked with more timers.

## Self-critique

1. **The hop-count test proves the pipeline, not the model.** The scripted provider answers-when-context-present
   by construction; a real model *might* still spend a needless hop. The test guards the thing we
   control (context is injected, and a context-aware model needn't hop); the live harness is what
   validates real behavior, and it's on the user to run. Honest, but worth stating.
2. **The brief is rebuilt every turn**, including the Google calendar read. The 10s agenda cache
   absorbs repeated turns within a burst, but a steady conversation pays the calendar round trip each
   turn. If that shows up in the live numbers, a short-TTL per-conversation cache is the fix —
   deliberately not added before measuring (the phase's own "measure before you cache" rule).
2. **`replan_today` uses fixed 45-minute blocks and only open tasks.** It doesn't yet honor per-task
   duration estimates or place the recommended workout. Good enough to be useful; the deterministic
   core (`place-blocks`) already takes per-item durations, so richer inputs are a data change, not a
   rewrite.
3. **The `daily.ts` placement change is unverified against the live cron** (see the note above). The
   risk is bounded by unit tests on the pure module, but a first live run should be watched.
4. **Goals are surfaced as raw settings, lightly formatted.** If `profile.settings` grows, the brief's
   goals line could drift toward noise; it's capped to the few keys that matter today.
