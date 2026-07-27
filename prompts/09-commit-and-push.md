# Phase 9 — Clean up the tree and push

Read `CLAUDE.md` first. This is housekeeping, not feature work — but do it carefully, because
it's the commit history a research lab or admissions reader would actually scroll through.

## Situation

`origin/main` is 16 commits behind local. On top of that, twelve files have been uncommitted
since before the notification work began, and they are not one logical change:

```
 M .env.example
 M src/app/api/assistant/route.ts
 M src/components/assistant/store.ts
 M src/lib/ai/index.ts
 M src/lib/ai/providers/{anthropic,gemini,openai-compat}.ts
 M src/lib/pipeline/{executor,run}.ts
 M src/lib/planning/daily.ts
 M tests/provider-factory.test.ts
?? CLAUDE.md
?? prompts/
?? src/lib/ai/providers/fallback.ts
```

Do **not** commit this as one blob. Read the diffs, work out what the distinct changes are, and
group them.

## Tasks

### 1. Pre-push security audit

Before anything else, verify and report:

- `.env` is untracked and absent from all history (`git log --all -- .env`).
- `.env.example` contains only placeholders — no real keys, tokens, phone numbers, or project
  refs.
- No secret-shaped strings anywhere in tracked files: JWTs (`eyJhbGciOi`), `sk-`/`re_` prefixed
  keys, Twilio SIDs (`AC` + 32 hex), private key blocks, Supabase project refs.
- `.claude/settings.local.json` is ignored.
- No personal data in test fixtures.

If anything fails, **stop and tell me before pushing.** A secret in git history is not fixed by
a follow-up commit.

### 2. Split the loose work into logical commits

From reading the diffs, the groups look roughly like:

- **AI provider fallback** — `fallback.ts`, `ai/index.ts`, the three provider files,
  `tests/provider-factory.test.ts`, and the `AI_FALLBACK_PROVIDER` part of `.env.example`.
- **Assistant latency / pipeline changes** — `assistant/route.ts`, `assistant/store.ts`,
  `pipeline/executor.ts`, `pipeline/run.ts`.
- **Daily plan honesty** — whatever remains loose in `planning/daily.ts`. Check whether this
  overlaps the A1/A2 fix already committed in `6734442`; if it's the same work half-committed,
  say so rather than committing a confusing partial.
- **Working agreement and prompts** — `CLAUDE.md`, `prompts/`.

Verify that grouping against the actual diffs — I inferred it from filenames and may be wrong.
Use `git add -p` where a single file spans two logical changes.

Each commit: imperative one-line subject, body explaining the *change* and *why*, matching the
style in `git log`. No "Co-Authored-By" or session links on these — they're cleanup of work
that predates the automated sessions.

### 3. Sanity-check before pushing

```bash
npm run typecheck && npm run test && npm run build
```

All three must pass. If they don't, fix or tell me — do not push a broken `main`.

Note: the Supabase project may be paused, so anything that hits the network at build time could
fail for reasons unrelated to the code. Distinguish those clearly.

### 4. Push

```bash
git push origin main
```

Report what went up: commit count, files, and anything you flagged along the way.

### 5. Repo presentation pass

This repo is portfolio-visible. After pushing, check and fix:

- `README.md` accurately describes the shipped system, including the notification pillar. Someone
  cloning it should be able to set up from the README alone.
- The feature list and tech-stack table mention Resend and Twilio.
- Known limitations are honest and current — stale limitations read worse than acknowledged ones.
- `docs/` numbering is contiguous and every doc is linked from somewhere.
- The screenshot placeholders in `README.md` are still literal `_Placeholder:_` text. Flag this;
  I need to take real screenshots, and it's the single highest-impact fix for how the repo reads
  to someone landing on it cold.

Fix what's fixable in code; list what needs me.

## Out of scope

Rewriting history. Squashing the 16 existing commits — they're well-formed and tell the story of
the build. Branch protection, CI, releases.

## Definition of done

- Security audit passes and is reported explicitly.
- Working tree is clean.
- Local `main` and `origin/main` are level.
- Typecheck, tests, and build pass.
- A short list of what still needs me (screenshots, anything else).

Report the audit result before you start committing. If you find a secret, stop.
