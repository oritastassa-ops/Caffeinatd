# Phase 10 — Operational polish

Read `CLAUDE.md` first. Then the self-critique section of `docs/14-notifications-architecture.md` —
most of this phase is that document's own list of deferred work, now being paid down.

Small, cohesive fixes across deploy config, model defaults, and the two first-run touches Phase 5
deliberately cut. Nothing here is architectural; the value is that each one is currently costing
something real.

## Part A — The deploy blocker

`vercel.json` registers the notification worker at `*/5 * * * *`. **Vercel Hobby accounts are
limited to cron expressions that run once per day; a more frequent expression fails at
deployment.** Per-minute cadence is a Pro feature. This works locally and breaks on first deploy.

Do not silently change the schedule to daily — a notification worker that drains the queue once a
day is not a notification system. Instead:

1. **Make the schedule configurable rather than hard-coded**, so the deployment target dictates it
   rather than a committed constant. `vercel.json` can't read env, so this means picking a default
   and documenting the alternative clearly.
2. **Make the worker endpoint safe to drive externally.** It already authenticates on
   `CRON_SECRET`, which is most of the work. Confirm it is idempotent under concurrent invocation
   (the lease and dedupe from Phase 2 should cover this — verify, don't assume), and that being
   called every minute by an outside scheduler is fine.
3. **Document all three paths in `README.md`**: Vercel Pro with `*/5`, Vercel Hobby plus an
   external scheduler (cron-job.org, GitHub Actions on a schedule, Upstash QStash), or self-hosted.
   Someone deploying this should not discover the limitation from a failed build.

Then reconsider the interval itself. The self-critique notes that everything — including
`notify_me`'s "text me now" — inherits up to 5 minutes of latency. Recommend an interval and say
why. My instinct is `*/2` or `*/1` for a secretary where a late reminder is the failure mode, but
you know the cost profile of the worker better after building it.

## Part B — Model defaults

`src/lib/ai/index.ts:23,33,37` hard-codes fallback model names:

```
gemini   → gemini-2.0-flash
openai   → gpt-4o-mini
anthropic→ claude-sonnet-5
```

The Gemini default is two generations behind — the current Flash-tier model is `gemini-3.6-flash`
(released 21 July 2026). Every assistant interaction runs on the stale default unless
`GEMINI_MODEL` is set, and it currently isn't in `.env`.

**Before changing anything, check what is actually current.** My information may be stale by the
time you run this — verify against provider docs rather than trusting this brief, and tell me what
you found. That applies to all three providers.

Then:

- Update the defaults to current models.
- **Flag the cost change explicitly.** `gemini-2.0-flash` had a free tier; `gemini-3.6-flash` is
  priced per token. This is a real tradeoff for a personal app, not a pure upgrade. Note it in
  `.env.example` next to `GEMINI_MODEL` so the choice is visible at configuration time.
- Consider whether `AI_FALLBACK_PROVIDER` should be documented as the cost valve — good model
  primary, free model behind it. The plumbing already exists (`src/lib/ai/providers/fallback.ts`).
- Check that `tests/provider-factory.test.ts` asserts against the defaults; update if so.

## Part C — Reachability is invisible

`enqueueNotification` returns `skipped[]` with a reason for every channel it couldn't use
(`src/lib/notifications/enqueue.ts:52-67`). Nothing surfaces it. The self-critique names the
consequence: **a user with only a verified phone silently receives nothing**, because preference
defaults are hard-coded email-only.

Two fixes:

1. **Make defaults adaptive.** When seeding preferences, default to the channels the user can
   actually be reached on rather than a hard-coded list. A user whose only verified contact is a
   phone should get SMS by default.
2. **Surface `skipped[]` where it's actionable.** Somewhere the user can see "your daily plan
   wasn't sent — no verified email." The delivery log from Phase 5 is the natural home; a `skipped`
   delivery row with its reason is more honest than no row at all. Check whether `enqueue` already
   writes those rows or only returns the array, and make them visible either way.

This is the exact fake-success trap `docs/12-quality-audit.md` exists to prevent — a system that
decides not to contact you and never mentions it.

## Part D — The two deferred first-run touches

Phase 5 cut both deliberately rather than rush an already-large settings page. They're one file
each.

1. **Onboarding step.** `src/app/onboarding/` currently gets a user to a working app. Add "How
   should I reach you?" — email prefilled from the auth session, needing only verification.
   Skippable, and skipping is a first-class choice.
2. **Today-dashboard nudge.** A user with no verified contact sees one quiet, dismissible prompt on
   `src/app/(app)/page.tsx`. Once dismissed it never returns for that user — persist the dismissal.
   Not a persistent banner.

## Part E — README screenshots

`README.md:12` still reads:

```
> _Placeholder: Today dashboard_ · _Placeholder: ⌘K command bar_ · _Placeholder: Fitness page_
```

You can't take screenshots. What you *can* do is make the slot ready: create `docs/images/` with a
`.gitkeep`, write the markdown image tags with correct relative paths and alt text, commented out
or pointing at the intended filenames, and leave me a short note in the commit body listing exactly
which three screens to capture and at what width. Then it's a drag-and-drop job for me rather than
a markdown-editing job.

## Tests

- Worker idempotency under two concurrent invocations (may already be covered by Phase 2's lease
  tests — extend rather than duplicate).
- Adaptive preference defaults: phone-only user gets SMS defaults, email-only gets email, both gets
  both.
- Provider factory defaults match whatever you set them to.

## Out of scope

The cap-counter race (the self-critique argues correctly that it isn't worth fixing at this scale
until concurrency is real). Digest hour selection. The tool-count router. Chart library.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- The cron situation is resolved and all three deployment paths are documented in `README.md`.
- Current model names verified against provider docs, defaults updated, cost tradeoff documented.
- A phone-only user gets notifications; a user who can't be reached can find out why.
- Onboarding asks for a contact; the Today nudge appears once and stays dismissed.
- Screenshot slots are ready for me to fill.
- One commit, imperative message.

Start with what you find on current model names — if this brief is already out of date, say so.
And tell me if you disagree with the cron interval recommendation; you have better information
about the worker's cost per run than I do.
