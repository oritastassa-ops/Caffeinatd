# Caffeinatd — Implementation Plan (Phase 4)

## Milestones

**M0 — Foundation** *(this build)*
Scaffold, Supabase schema + RLS + pgvector, auth (magic link), AI provider abstraction
(Gemini/OpenAI-compat/Anthropic), app shell + theming.

**M1 — Core loop** *(this build)*
Command bar → NL pipeline → tool executor → tasks / fitness / nutrition / memory actions, with
undoable receipts. Manual CRUD fallbacks in each view. Unit tests for tools, planner math,
provider factory.

**M2 — Calendar intelligence** *(this build: connect + agenda + create/delete + conflict check)*
Google OAuth, agenda on Today, event create/edit/delete via NL, free/busy conflict detection.
*Deferred within M2:* travel-time awareness (needs Maps API), smart rescheduling suggestions.

**M3 — Proactive layer** *(this build: daily plan cron + sleep rec)*
Daily planning engine, Vercel cron, sleep recommendation, weekly summaries (*deferred*).

**M4 — Depth** *(next)*
Recurring tasks execution (schema ships now), progressive-overload analysis, missed-workout
alerts, nutrition trends chart, weekly planning summary, `g`-key navigation.

**M5 — Extensions** *(later, in priority order)*
Voice input (SpeechRecognition → command bar) → push notifications (web push) → Gmail/email
triage → Apple Health import → shared/partner assistant mode → budgeting.

## Dependency graph

Schema → auth → provider layer → pipeline → {tasks, fitness, nutrition, memory} (parallel) →
calendar (needs Google creds) → planning engine (needs all of the above) → cron.

## Deliberate cuts (and why they're safe)

- **Travel time**: needs a Maps key + location memory; the schema's event model doesn't block it.
- **Recurring-task materialization**: `recurrence` column ships in the schema; the cron that
  expands it is additive.
- **Framer Motion / charts**: CSS + minimal SVG sparkline now; a chart lib is a drop-in later.
- **Weekly summaries**: same engine as daily plan with a different window; pure addition.

## Self-critique (continuous-improvement rule, applied to this design)

1. *Weakest point*: LLM macro estimation drifts. Mitigation shipped: estimates are visible +
   editable at capture; roadmap adds a food-DB lookup tool the model can call.
2. *Serverless cache is per-instance* — fine at 2 users; if it ever matters, swap the Map for
   Vercel KV behind the same function signature.
3. *Gemini free-tier limits* could pinch during heavy use; the retry/backoff + provider switch in
   env is the pressure valve, and the app stays usable without AI.
4. *One repo, one deploy* was chosen over microservices on purpose — at this scale the biggest
   technical-debt risk is over-engineering, not under-engineering.
