# Caffeinatd — System Architecture (Phase 2)

## Stack (with the "why", per requirement)

| Layer | Choice | Rejected alternatives & why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | Separate FastAPI backend rejected: two deploys, two type systems, CORS/auth glue — no payoff at this scale. Route handlers + server components give us a typed full stack in one repo. |
| Styling | **Tailwind CSS v4 + CSS variables** | Framer Motion deferred; CSS transitions cover the interactions we ship. Adding a 40kb animation lib before it earns its keep is the over-engineering the brief warns about. |
| DB + Auth | **Supabase (Postgres + pgvector + RLS + magic-link auth)** | SQLite/IndexedDB rejected: serverless functions need a network DB, and pgvector gives semantic memory for free. Supabase auth removes an entire custom auth surface. |
| AI | **Provider abstraction, Gemini default** | See below. |
| Calendar | **Google Calendar REST, direct fetch** | `googleapis` npm package rejected: ~10MB dep for 5 endpoints. Hand-rolled OAuth2 + fetch is ~150 lines and fully understood. |
| Scheduling | **Vercel Cron → route handler** | In-process schedulers don't survive serverless. |
| Tests | **Vitest** | Fast, TS-native, zero config. |

## Topology

```
Browser ── Next.js (Vercel) ──┬── Supabase Postgres (tasks, meals, workouts, memories, plans, tokens)
   │             │            ├── Google Calendar API (OAuth2, per-user refresh token)
   ⌘K command bar│            └── AI provider (Gemini | any OpenAI-compatible | Anthropic)
                 └── Vercel Cron (daily-plan @ 04:00 UTC)
```

## AI provider abstraction

One interface, three adapters:

- `GeminiProvider` — native REST (`generateContent` + `embedContent`, 768-dim embeddings). **Default.**
- `OpenAICompatProvider` — one adapter covers **OpenAI, OpenRouter, NVIDIA NIM, Ollama** (all speak
  the OpenAI chat-completions dialect; only `baseURL`/key/model differ).
- `AnthropicProvider` — native `/v1/messages` with tool_use blocks.

Switching providers = changing `AI_PROVIDER` + one key in env. Nothing else moves because the
pipeline only sees `AIProvider { chat(), embed?() }`. Providers without `embed` fall back to
keyword memory search — the app never hard-depends on embeddings.

**Provider comparison (why Gemini is default):**

| | Cost | Latency | Tool-use quality | Setup |
|---|---|---|---|---|
| Gemini flash (free tier) | $0 | fast | strong, native function calling | 2 min (one key) |
| OpenAI | $ | fast | strongest | 2 min, needs billing |
| Anthropic | $ | fast | strongest | 2 min, needs billing |
| OpenRouter free models | $0 | varies | varies/rotates | 2 min |
| NVIDIA NIM | free credits | ok | model-dependent | 5 min |
| Ollama local | $0 | hardware-bound | weakest at structured extraction | 15 min + GPU |

Gemini is the only option that is simultaneously $0, reliable at function calling, and
sub-5-minute setup. Anyone who later wants max quality flips to Anthropic/OpenAI in env.

## NL pipeline (per assistant request)

1. **Recall** — embed the user message, `match_memories` RPC (pgvector cosine, top 6, threshold
   0.55); fallback ILIKE keyword search when the provider can't embed.
2. **Compose** — system prompt = persona + user profile/settings + local date/time + recalled
   memories + today's agenda summary.
3. **Reason + act** — one `chat()` call with the full tool catalog; execute returned tool calls
   against the DB/Calendar; feed results back; loop (max 5 hops) until the model answers in text.
4. **Receipt** — response returns `{ text, actions[] }`; the UI renders undoable action chips.

Tool schemas are defined once in Zod and serialized to JSON Schema per provider dialect — one
source of truth for validation *and* the LLM contract.

## Memory system

`memories(id, user_id, kind, content, embedding vector(768), importance, last_used_at)` where
`kind ∈ {preference, habit, relationship, routine, goal, event}`. Writes happen via the
`save_memory` tool (the model decides what's durable) and explicitly from Settings. Reads are
retrieval-only (step 1 above) — the store never rides along whole, per the brief. `last_used_at`
updates on recall so stale memories can later be decayed.

## Calendar strategy

Google Calendar is the single source of truth. We store only the OAuth refresh token
(`google_tokens` table, RLS'd). Reads (agenda, free/busy, conflict check) hit the API live with a
60s in-memory cache; writes go straight through. Conflict detection runs *before* insert via
free/busy; the assistant proposes alternatives instead of double-booking.

## Daily planning engine

Cron hits `/api/cron/daily-plan` (guarded by `CRON_SECRET`). For each user: fetch agenda, open
tasks (priority-ranked), last 7 days of workouts + nutrition, then one LLM call composes a typed
`DailyPlan` JSON (overview, top-3 priorities, workout + nutrition suggestion, free windows,
bedtime rec). Stored in `daily_plans(user_id, date, plan jsonb)`; the Today view renders it —
already there when she opens the app. Sleep recommendation is deterministic math (first event
tomorrow − wind-down − target duration) with the LLM only phrasing it.

## Security model

- All AI/Google keys are server-only env vars; no `NEXT_PUBLIC_` secrets. The browser talks only
  to our route handlers.
- Supabase **RLS on every table** (`user_id = auth.uid()`), so even the anon key leaks nothing
  cross-user. Service-role key is used only by the cron route, server-side.
- Google OAuth scope is `calendar.events` + `calendar.freebusy` only — least privilege.
- Signups disabled in Supabase; the two users are invited from the dashboard.
- Cron endpoint requires `Authorization: Bearer CRON_SECRET`.

## Caching

- Agenda reads: 60s per-user in-memory cache (module-scope Map — acceptable on serverless: worst
  case is a cache miss).
- Daily plan: materialized in Postgres, regenerated by cron or on demand.
- Provider responses are not cached (personal data, low volume).

## Error handling & recovery

- Provider calls: 2 retries with exponential backoff on 429/5xx; on final failure the API returns
  a typed error and the UI says exactly what failed ("AI provider rate-limited — logged your text,
  try again in a minute") rather than a generic toast.
- Tool executor validates every LLM-supplied argument with Zod before touching the DB; invalid
  args are returned to the model as tool errors so it can self-correct within the hop budget.
- Google 401 → one token refresh → retry once → surface "reconnect calendar" state.
