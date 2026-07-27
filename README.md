# Caffeinatd ✦

A self-hosted personal AI secretary. Talk to it in natural language (⌘K anywhere); it manages
your calendar, tasks, fitness, nutrition, finances, household, and long-term memory — and plans
your day every morning before you wake up.

Built for a household of one or two people who want a private assistant on their own
infrastructure, with their own AI provider keys, and full ownership of their data.

> **Screenshots**
>
> _Placeholder: Today dashboard_ · _Placeholder: ⌘K command bar_ · _Placeholder: Fitness page_

## Features

- **Natural-language assistant (⌘K)** — one command bar for everything: "remind me to call mom
  tomorrow", "we're out of milk", "how recovered are my legs?", "move my 3pm". Every mutating
  action returns an undoable receipt.
- **Daily plan** — a cron job assembles each morning's plan (calendar, tasks, sleep
  recommendation, readiness) before you wake up.
- **Notifications (email + SMS)** — the daily plan, reminders, insights, and finance reviews reach
  you off-app through a channel-agnostic delivery layer (Resend for email, Twilio for SMS).
  Verified opt-in, per-notification channel preferences, quiet hours, spend caps, digest batching,
  and a delivery log with test sends. The assistant can schedule its own reminders ("remind me to
  call the lab at 4pm tomorrow") and knows which channels it can actually reach you on.
- **Google Calendar** — full read/write integration via OAuth (create, edit, list, free/busy).
- **Fitness intelligence** — syncs workouts from [Hevy](https://www.hevyapp.com/), computes
  per-muscle recovery, readiness scores, PR detection, progression trends, and program
  consistency.
- **Long-term memory** — the assistant remembers stated preferences and facts across sessions
  (pgvector semantic search with keyword fallback, ranked by similarity + importance + recency).
- **Finance pillar** — accounts, net-worth tracking, financial health score, compound-interest
  and what-if simulators.
- **Home pillar** — shared household chores with rotation, shopping list, garbage/recycling
  collection schedules.
- **Insights** — rule-based observations surfaced on the dashboard (cheap: DB reads only, no AI
  calls).
- **AI personalities** — selectable assistant personas with pixel-art avatars.
- **Provider-agnostic AI** — Gemini (free tier) by default; switch to OpenAI, Anthropic,
  OpenRouter, NVIDIA NIM, or local Ollama with two env vars.
- **Data export** — one-click JSON export of everything from Settings.

## Architecture

```
Browser (Next.js App Router, React 19, Tailwind 4)
   │
   ├─ Server components / server actions ──► Supabase (Postgres + pgvector + RLS + auth)
   │
   └─ /api/assistant ──► AI pipeline:
         1. recall   — retrieve relevant memories (pgvector semantic + keyword fallback)
         2. compose  — system prompt from personality + profile + memories
         3. act loop — provider function-calling against the Zod tool catalog,
                       each tool validated then executed against Supabase / Google / Hevy
         4. answer   — final text + undoable action receipts

Vercel cron (04:00 UTC) ──► /api/cron/daily-plan (authenticated by CRON_SECRET)
```

Key design decisions:

- **Zod tool catalog as single source of truth** ([src/lib/pipeline/tools.ts](src/lib/pipeline/tools.ts)) —
  each schema validates LLM-supplied arguments at runtime *and* generates the function-calling
  contract sent to providers.
- **Provider abstraction** ([src/lib/ai/](src/lib/ai)) — one `AIProvider` interface; Gemini,
  Anthropic, and an OpenAI-compatible client (OpenAI/OpenRouter/NIM/Ollama) behind a factory
  selected by `AI_PROVIDER`.
- **Row-level security everywhere** — the request-scoped Supabase client acts as the signed-in
  user; the service-role key is used only by the cron route.
- **Encrypted third-party keys** — integration API keys (e.g. Hevy) are encrypted at rest with
  AES-256-GCM (`ENCRYPTION_KEY`) and only decrypted server-side immediately before an outbound
  call.
- **No Google SDK** — OAuth2 + Calendar REST are called directly
  ([src/lib/google/](src/lib/google)).

Deeper design docs live in [docs/](docs): [product](docs/01-product.md) ·
[architecture](docs/02-architecture.md) · [UX](docs/03-ux.md) · [roadmap](docs/04-roadmap.md).

## Technology stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript, React 19) |
| Database & auth | Supabase (Postgres, pgvector, RLS, invite-only auth) |
| Styling | Tailwind CSS 4 |
| AI | Provider-agnostic: Gemini (default), OpenAI, Anthropic, OpenRouter, NVIDIA NIM, Ollama |
| Integrations | Google Calendar (OAuth2 + REST), Hevy (workout sync) |
| Notifications | Resend (email), Twilio (SMS) — REST via `fetch`, no SDKs |
| Validation | Zod (tool contracts + runtime validation) |
| Testing | Vitest (300+ unit tests) |
| Hosting | Vercel (app + daily cron) |

## Installation

Prerequisites: Node.js 20+, a Supabase account, a Gemini API key (or another provider),
and a Google Cloud project for Calendar OAuth.

### 1. Supabase (~2 min)

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste and run `supabase/schema.sql`, then each file in `supabase/migrations/`
   **in numeric order** (002 → 003 → 004 → 005 → 006 → 006d → 007 → 008 → 009 → 010). Together they
   add insights, reminders, memory ranking, the Hevy integration, fitness intelligence, the Finance
   and Home pillars, workspaces, and the notification pillar (contacts, preferences, delivery queue,
   SMS, and reminder dispatch).
3. Authentication → Sign In / Up → **disable new sign-ups**, then invite your users
   (Authentication → Users → Invite).
4. Copy the project URL, anon key, and service-role key into `.env`.

### 2. AI provider key (~1 min)

Gemini is the default — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) →
create key → `GEMINI_API_KEY`. The free tier is plenty for personal use.
(Any other supported provider works too — see [Switching AI providers](#switching-ai-providers).)

### 3. Google Calendar OAuth (~2 min)

1. [Google Cloud Console](https://console.cloud.google.com) → new project → enable
   **Google Calendar API**.
2. OAuth consent screen → External → add each user's Gmail address as a **test user**.
3. Credentials → OAuth client ID → Web application → redirect URI:
   `http://localhost:3000/api/google/callback` (add the production URL after deploy).
4. Copy client ID/secret into `.env`.

### 4. Notifications (optional — email & SMS)

Off-app delivery is off by default: `NOTIFICATIONS_DRIVER=logging` writes every "send" to the
server log, so everything works in dev with no vendor account. To deliver for real, set
`NOTIFICATIONS_DRIVER=live` and configure a channel:

- **Email (Resend):** create a key at [resend.com](https://resend.com), set `RESEND_API_KEY` and
  `NOTIFICATIONS_FROM_EMAIL`. **Verify your sending domain** (publish the SPF + DKIM DNS records
  Resend gives you) — mail from an unverified domain lands in spam.
- **SMS (Twilio):** set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and a sender
  (`TWILIO_MESSAGING_SERVICE_SID`, preferred, or `TWILIO_FROM_NUMBER`). Point the number/messaging-
  service webhook at `{APP_URL}/api/notifications/sms/inbound` (delivery receipts + STOP/START).
  **US A2P traffic needs A2P 10DLC brand + campaign registration before production sending** — it
  takes *days* to approve, so start it early; toll-free verification is the alternative (also days).

Then finish setup in-app at **Settings → Notifications**: add and verify a contact, choose channels
per notification, and hit **Send test** to confirm it works end to end. Full design in
[docs/14-notifications-architecture.md](docs/14-notifications-architecture.md).

### 5. Environment & run

```bash
cp .env.example .env   # fill in the values above (see comments in the file)
npm install
npm run dev            # http://localhost:3000
```

`ENCRYPTION_KEY` (used to encrypt integration API keys at rest) is generated with:

```bash
openssl rand -hex 32
```

## Production deployment (Vercel)

1. Import the repo into Vercel.
2. Paste the same env vars, with two changes: set `APP_URL` to the production URL and
   `CRON_SECRET` to a long random string.
3. Add the production redirect URI (`https://your-domain/api/google/callback`) to the Google
   OAuth client.
4. Deploy. `vercel.json` registers the 04:00 UTC daily-plan cron automatically — Vercel sends
   `CRON_SECRET` as the bearer token.

## Switching AI providers

Change two env vars, redeploy — nothing else:

| Provider | Env |
|---|---|
| Gemini (default) | `AI_PROVIDER=gemini`, `GEMINI_API_KEY` |
| OpenAI | `AI_PROVIDER=openai`, `OPENAI_API_KEY` |
| Anthropic | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` |
| OpenRouter | `AI_PROVIDER=openrouter`, `OPENAI_API_KEY`, optional `OPENAI_MODEL` |
| NVIDIA NIM | `AI_PROVIDER=nim`, `OPENAI_API_KEY` |
| Ollama (local) | `AI_PROVIDER=ollama`, optional `OPENAI_BASE_URL`/`OPENAI_MODEL` |

## Development

```bash
npm run test        # unit tests (tool contracts, fitness/finance/home math, provider factory)
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

## Project structure

```
src/lib/ai/            provider abstraction (types, gemini, openai-compat, anthropic, factory)
src/lib/pipeline/      tool catalog (Zod = single source of truth), executor, orchestrator
src/lib/memory/        retrieval-based memory (pgvector semantic + keyword fallback, ranking)
src/lib/google/        OAuth2 + Calendar REST (no SDK)
src/lib/planning/      daily plan engine + deterministic sleep math + readiness
src/lib/fitness/       recovery, PRs, programs, metrics, recommendations
src/lib/finance/       net worth, cashflow, health score, simulators
src/lib/home/          chores, rotation scheduling, shopping, collection days
src/lib/insights/      rule-based dashboard insights (no AI calls)
src/lib/integrations/  integration registry, AES-256-GCM key crypto, Hevy client/sync/mapper
src/app/(app)/         Today, Tasks, Calendar, Fitness, Nutrition, Finance, Home, Memory, Settings
src/app/api/           assistant, undo, google oauth, hevy, cron, export
src/components/        UI components (command bar, cards, avatars, pillar views)
supabase/              schema.sql (tables, RLS, pgvector, match_memories RPC) + migrations
tests/                 vitest unit tests
docs/                  product & architecture design docs
```

## Troubleshooting

- **"GEMINI_API_KEY is not set" / provider errors** — check `AI_PROVIDER` matches the key you
  filled in; the factory in [src/lib/ai/index.ts](src/lib/ai/index.ts) lists exact requirements.
- **Google Calendar shows "reconnect"** — the refresh token was revoked (e.g. consent screen in
  testing mode expires tokens after 7 days). Publish the OAuth app or reconnect from Settings.
- **Login redirect loop** — verify `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  and that the user was invited in Supabase (public sign-up is disabled by design).
- **Daily plan never appears** — confirm the Vercel cron is registered (Project → Cron Jobs) and
  `CRON_SECRET` matches the env var.
- **Hevy sync fails** — the API key is validated on connect; if it later fails, reconnect from
  Settings (keys are stored encrypted and can't be displayed back).
- **Notifications aren't arriving** — check `NOTIFICATIONS_DRIVER=live`; for email, that the
  sending domain is verified in Resend (SPF/DKIM); for SMS, that A2P 10DLC/toll-free registration is
  approved. The **Settings → Notifications** delivery log shows the exact per-message failure.

## Known limitations

- Designed for one or two invited users — there is no public sign-up, team support, or
  multi-tenant hardening beyond Supabase RLS.
- Calendar writes go to the user's primary Google calendar only.
- AI responses depend on the configured provider/model; small models may misuse tools more
  often (validation errors are fed back so the model can self-correct).
- Notification dispatch runs on a 5-minute cron, so a reminder can arrive up to ~5 minutes late;
  SMS requires carrier registration (A2P 10DLC) that takes days to approve.
- ESLint is not configured; correctness is covered by TypeScript strict mode and unit tests.

## Roadmap

Email and SMS notifications **shipped** (Phases 1–5 of the notification pillar). Next: web push
(free, no vendor — the natural third channel) → inbound email/SMS replies routed into the assistant
→ voice input (SpeechRecognition → command bar) → Gmail/email triage → Apple Health import →
shared/partner assistant mode → budgeting. Details in [docs/04-roadmap.md](docs/04-roadmap.md).

## License

[MIT](LICENSE)
