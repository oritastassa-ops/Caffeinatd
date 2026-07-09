# Caffeinatd — Technical & Product Review

**Purpose of this document:** a complete, as-built snapshot of the application for handoff to
another expert. This is descriptive, not evaluative-with-recommendations — Sections 7–8 assess
strengths/weaknesses as requested, but no redesign or optimization proposals are made anywhere in
this document.

**Status at time of writing:** local development only. Never deployed. One real user account
exercising it manually (magic-link auth, Gemini AI, Google Calendar OAuth all live and connected).

---

## 1. Product Overview

Caffeinatd is a personal AI secretary for one (soon two) named individuals — not a general-purpose
product, not multi-tenant SaaS. It manages a person's calendar, tasks, fitness log, nutrition log,
and long-term personal context ("memory") through natural language, and proactively assembles a
daily plan without being asked.

**Who it's for:** a single non-technical end user (the "primary" account) plus a second invited
account for her partner. Access is invite-only — there is no public sign-up.

**Core problem it solves:** the cognitive overhead of juggling a calendar, a task list, workout
logs, food logs, and remembering personal context across all of them, by collapsing the *entry*
step into one text box that a) knows what silo a request belongs to, and b) already knows relevant
context about the person without being told again.

**How it differs from a chatbot:**
- Every input resolves to a **typed action** against a real table or the Google Calendar API — the
  system never just replies with text when an action was implied.
- The primary UI is **views of state** (Today, Tasks, Calendar, Fitness, Nutrition, Memory,
  Settings), not a persistent message thread. The assistant is an overlay (⌘K), summoned and
  dismissed, not a permanent chat panel.
- The system **initiates**: a cron-generated daily plan is meant to be sitting in the Today view
  before the user opens the app, unprompted.
- Memory is **queried against durable facts**, not a chat history the model "remembers" — it's a
  separate database table the model explicitly writes to and reads from.

**Intended user experience:** press ⌘K from anywhere in the app, say something in plain language
("I ate chicken and rice," "remind me to call mom tomorrow," "schedule dentist Thursday at 3"),
see a one-to-three-sentence confirmation plus a chip showing exactly what was created (with an
Undo button), and get on with your day. Separately, opening the app in the morning should surface
a plan without any input at all.

---

## 2. Current Feature List

### 2.1 Chat assistant (the command bar)
- **Purpose:** single entry point for all natural-language interaction with the system.
- **User interaction:** `⌘K`/`Ctrl+K` opens a centered modal overlay anywhere in the app; typing
  and pressing Enter submits; `Esc` or a click outside closes it. A floating ✦ button provides the
  same entry point on mobile (no keyboard shortcut affordance there).
- **Inputs:** free-text string, max 2000 characters (enforced server-side via Zod).
- **Outputs:** a short text reply plus zero or more "action receipt" chips (`✓ Task created: Call
  mom — tomorrow  Undo`). Chips with an `undo` field render a live Undo button that calls a
  separate endpoint.
- **AI behavior:** see Section 4 in full; in short, one call is made to the configured AI provider
  with the user's message, a system prompt, recalled memory, and the full tool catalog; the model
  may request 0–5 rounds of tool calls before producing a final text answer.
- **Connected systems:** the AI provider (Gemini by default), Supabase (all writes), Google
  Calendar (calendar-related tool calls only).
- **Current limitations:** no conversation history — every message is a fresh, stateless
  interaction (memory recall substitutes for continuity, but there is no multi-turn back-and-forth
  within one command-bar session; closing the overlay discards the exchange). No streaming — the
  UI shows a "Working on it…" state and then the full response at once. No voice input. No way to
  see past assistant exchanges (only their *effects*, via the feature views).

### 2.2 Calendar management
- **Purpose:** create, read, update, and delete Google Calendar events via natural language or the
  Calendar page; detect double-bookings before creating an event.
- **User interaction:** via ⌘K ("schedule dentist Thursday at 3", "move my 2pm to 4", "cancel the
  dentist appointment"), or passively via the Today page's agenda card and the dedicated Calendar
  page (7-day list view).
- **Inputs:** natural language date/time/summary/location; the model normalizes relative dates
  ("Thursday," "tomorrow") against the current local time injected into the system prompt.
- **Outputs:** a created/updated/deleted Google Calendar event; a confirmation chip; on conflict, a
  text explanation of what's already booked and (per the system prompt) a request that the model
  propose alternatives rather than double-book.
- **AI behavior:** the model is instructed never to invent event IDs — it must call `get_agenda`
  first to obtain real IDs before calling `update_event`/`delete_event`.
- **Connected systems:** Google Calendar REST API v3 directly (no SDK, hand-written OAuth2 +
  fetch). Reads pull from **every calendar the user has** (via `calendarList.list`), not just
  primary; writes (new events) always go to the primary calendar. Free/busy conflict checking also
  spans every calendar.
- **Current limitations:** no travel-time awareness. No "smart rescheduling" beyond surfacing a
  conflict and busy blocks — the model proposes alternatives conversationally, there's no
  algorithmic slot-finder. No recurring-event UI (RRULE strings are accepted as a tool parameter
  but there's no interface to build one, and Google's own recurrence expansion is relied upon, not
  a custom engine). No multi-day/all-day event creation flow distinct from timed events beyond
  what the API naturally supports. The 10-second agenda cache means a just-added external change
  (e.g., from a phone) can take up to 10 seconds to reflect. OAuth requires re-consent if scopes
  ever change (already happened once during development).

### 2.3 Task management
- **Purpose:** general to-do/reminder list with priority, due dates, categories, and projects.
- **User interaction:** ⌘K natural language ("I need groceries," "remind me to call mom
  tomorrow"), or the dedicated Tasks page with a manual quick-add text field, a checkbox to
  complete, and a delete (✕) button per row (visible on hover).
- **Inputs:** title (required), notes, priority (1–4, defaults to 3), category, project, due date,
  recurrence (RRULE string — accepted but not expanded by any scheduler).
- **Outputs:** a row in the `tasks` table; UI reflects it immediately (server-rendered, revalidated
  via Next.js server actions after manual edits, or via a client-side `router.refresh()` after an
  assistant action).
- **AI behavior:** `create_task` tool; the model is instructed to treat requests like "I need
  groceries" as an implicit task. `complete_task` matches an open task by substring on its title
  (`ILIKE %query%`) and refuses/asks for clarification if more than one match is found.
- **Connected systems:** Supabase only.
- **Current limitations:** `recurrence` is stored but never expanded into future task instances —
  a recurring task is a single row with an RRULE string that nothing currently reads. No
  sub-tasks/checklists. No drag-to-reorder. No bulk actions. `complete_task`'s substring match can
  be ambiguous or silently wrong for short/generic titles. Manual quick-add on the Tasks page
  creates a task with no priority/category/due date (defaults only) — full-featured creation
  requires going through the assistant.

### 2.4 Reminders
- **Purpose:** there is no reminders feature distinct from tasks. "Remind me to X" is handled
  entirely by `create_task` with an optional `due_at`. There is no separate notification/alert
  mechanism — no push notifications, no email, no in-app toast at the due time. A task with a due
  date only surfaces by appearing (sorted by priority/due date) in the Tasks list and, if
  high-priority/soon-due, potentially in the daily plan's "priorities" list.

### 2.5 Memory system
- **Purpose:** durable, cross-session personalization — the assistant should recall stated
  preferences, habits, relationships, routines, goals, and important events without them being
  re-stated every time, and without dumping the entire store into every prompt.
- **User interaction:** implicit — the model decides when something is worth remembering during
  normal conversation (no explicit "remember that..." command is required, though one would also
  work). A dedicated Memory page lists everything stored, grouped by kind, each with a delete (✕)
  button. This is the only screen where memory is directly visible/editable by the user.
- **Inputs (write path):** a `save_memory` tool call from the model with `kind` (one of
  preference/habit/relationship/routine/goal/event), free-text `content`, and an `importance`
  score (1–5, currently stored but not used in any ranking/decay logic).
- **Outputs (read path):** up to 6 recalled memory snippets injected into the system prompt for a
  given user message, each labeled with its kind.
- **AI behavior / retrieval mechanism:** two-tier. If the provider supports embeddings (Gemini
  does, via `text-embedding-004`), the user's message is embedded and matched against stored
  memory embeddings using pgvector cosine similarity (`match_memories` Postgres RPC, threshold
  0.55, top 6). If that returns nothing (or the provider can't embed), it falls back to a keyword
  `ILIKE` search over the 5 longest words in the message. As an optimization, if the user has zero
  stored memories at all, the embedding call is skipped entirely (a cheap `count`-only query short
  -circuits it) to avoid burning an AI call for no possible result.
- **Connected systems:** Supabase (`memories` table with a `vector(768)` column), Gemini embeddings
  endpoint.
- **Current limitations:** no memory editing (delete-and-recreate only, no in-place edit). No
  automatic decay/pruning — `last_used_at` is tracked but nothing acts on it. No importance-based
  ranking in retrieval (all matches above threshold are treated equally, ordered only by
  similarity). No de-duplication — the model could save the same fact twice across sessions. No
  UI to manually add a memory (only via conversation).

### 2.6 Fitness tracking
- **Purpose:** log workouts (strength, cardio, mobility, other) including individual sets, and
  view recent history / weekly volume.
- **User interaction:** ⌘K natural language describing a workout ("logged bench 3x8 at 60kg and
  squats 3x5 at 80"); no manual-entry form exists in the UI — the Fitness page is read-only
  (display of history and two summary stat cards).
- **Inputs:** workout title, kind, optional date (defaults to today), duration, distance, notes,
  and an optional array of sets (exercise name, set number, reps, weight in kg).
- **Outputs:** a `workouts` row plus zero or more `workout_sets` rows; UI shows a "This week" count
  card, a "Volume (7d)" card (sum of reps × weight across all sets logged in the last 7 days), and
  a reverse-chronological list of the last 20 workouts with their sets rendered as small pill tags.
- **AI behavior:** `log_workout` tool; the model is responsible for parsing free-text into
  structured sets (exercise/reps/weight) — there is no client-side parser as a fallback.
- **Connected systems:** Supabase only.
- **Current limitations:** no progressive-overload analysis (mentioned in the original product
  brief, not implemented — the "Volume (7d)" figure is the only derived fitness metric that
  exists). No missed-workout alerting. No editing of a logged workout — only create; no delete UI
  either (though the row could be deleted via the assistant's undo receipt within the same
  session). No exercise history/PR tracking per movement. No cardio-specific metrics beyond
  duration/distance (no pace, heart rate, etc.).

### 2.7 Nutrition tracking
- **Purpose:** log meals from natural-language descriptions with AI-estimated macros, and track
  daily/weekly totals against goals.
- **User interaction:** ⌘K natural language ("I ate chicken and rice"); the Nutrition page is
  read-only (four stat cards plus a 7-day log list) — no manual entry form.
- **Inputs:** free-text description; optional meal type (breakfast/lunch/dinner/snack); optional
  explicit `eaten_at`.
- **Outputs:** a `meals` row with calories/protein/carbs/fat **estimated entirely by the model** —
  there is no nutrition database lookup of any kind. The UI shows: today's total vs. calorie goal
  (turns red if over), today's protein, today's carbs+fat, a 7-day average of calories on logged
  days, and a chronological list of every meal logged in the last 7 days with its macros.
- **AI behavior:** the `log_meal` tool schema *requires* calorie/protein/carb/fat fields (not
  optional) and the tool description explicitly instructs the model to estimate rather than ask
  the user for numbers.
- **Connected systems:** Supabase only. No external food/nutrition API.
- **Current limitations:** macro accuracy is entirely dependent on model estimation quality — no
  ground truth, no correction mechanism beyond deleting and re-logging. No editing of a logged
  meal. No goal-tracking UI for protein/carbs/fat beyond calories (protein goal is stored in
  settings but only surfaces as an "of Xg" label; carbs/fat have no goal fields at all). No
  visual trend chart (numbers only, no sparkline/graph).

### 2.8 Sleep optimization
- **Purpose:** recommend a bedtime, wind-down time, and wake time.
- **User interaction:** passive — appears as a line in the daily plan card on the Today page
  (`recommend_bedtime` can also be invoked directly via natural language, e.g. "when should I go
  to bed").
- **Inputs:** the user's sleep-hours goal and wind-down-minutes setting (from Settings), and
  tomorrow's first non-all-day calendar event, if any.
- **Outputs:** a bedtime, a wind-down start time, and a wake time, plus a one-line rationale
  ("8h target; no early commitments tomorrow" or similar).
- **AI behavior:** this is the one "intelligent" feature in the product that is **not** an LLM
  call — it's pure deterministic arithmetic (wake = first commitment − 60min prep buffer, or a
  default 07:30; bedtime = wake − sleep-hours goal; wind-down = bedtime − wind-down-minutes). The
  LLM is only used, elsewhere, to phrase the daily-plan sentence that references it.
- **Connected systems:** Google Calendar (read-only, for tomorrow's first event), Supabase (user
  settings).
- **Current limitations:** does not account for workout load, "workload" in the sense of task
  count/deadlines, or historical sleep consistency — despite these being listed as inputs in the
  original product brief, none are implemented. No sleep *logging* — there is no way to record
  actual sleep, so there's no feedback loop or consistency tracking at all. It's a one-shot
  recommendation, not an adaptive system.

### 2.9 Daily planning engine
- **Purpose:** produce a single structured "here's your day" summary each morning without the user
  asking.
- **User interaction:** primarily passive (a Vercel Cron job runs it server-side at 04:00 UTC for
  every user); can also be triggered on demand via natural language ("plan my day") which calls
  the `generate_daily_plan` tool synchronously.
- **Inputs:** today's calendar events (across all calendars), up to 15 open tasks (ordered by
  priority), the last 7 days of workout titles/dates, the last 7 days of meal calorie/protein
  data, and the user's settings (goals).
- **Outputs:** a `daily_plans` row (one per user per date, upserted) containing: a 2-sentence
  overview, up to 3 priorities, one workout suggestion sentence, one nutrition suggestion
  sentence, a list of free time windows (as strings like "14:00–16:30"), and the deterministically
  computed bedtime block appended after the LLM response.
- **AI behavior:** one LLM call with `temperature: 0.5`, prompted to return *only* a JSON object
  (parsed defensively with a regex + Zod validation; falls back to a degraded plan using the raw
  text if JSON parsing fails).
- **Connected systems:** Google Calendar, Supabase (reads across `tasks`/`workouts`/`meals`,
  writes `daily_plans`), the AI provider, Vercel Cron (for the scheduled trigger only — this piece
  has never actually run, since the app has not been deployed).
- **Current limitations:** no weekly planning summary (mentioned in the original brief, not built
  — only daily). The "free time windows" field is model-computed from the calendar list textually,
  not derived by a deterministic gap-finding algorithm, so its accuracy depends on the model
  correctly reasoning about a text description of the day rather than doing interval arithmetic.
  Regenerating a plan simply overwrites the existing row for that date — no history of previous
  plans. The cron path has literally never executed against a live deployment, so it is
  code-reviewed and unit-adjacent-tested (via the underlying functions) but not field-verified end
  -to-end.

### 2.10 Automation features
Beyond the daily-plan cron, there is no other automation. No recurring-task materialization, no
scheduled digests, no proactive nudges (e.g., "you haven't logged food today"), no automatic
memory pruning, no webhook-driven anything.

### 2.11 Personalization features
- Per-user timezone, display name, and a settings JSON blob (calorie goal, protein goal, sleep
  hours, wind-down minutes) editable via a form on the Settings page.
- The memory system (2.5) is the primary personalization mechanism.
- Theming: manual dark/light toggle (persisted to `localStorage`), defaulting to the OS preference
  on first load.
- No per-user customization of the AI's tone/persona, no configurable notification preferences (no
  notifications exist), no layout customization.

### 2.12 Data export & account
- A JSON export endpoint (`/api/export`) dumps every row across all user-owned tables for the
  signed-in user, served as a downloadable file.
- Sign-out is available from Settings.
- Google Calendar can be disconnected (deletes the stored refresh token) and reconnected from the
  same screen.

---

## 3. User Experience / UI Review

**Design philosophy:** deliberately modeled on Raycast (command bar), Linear (density, hairline
borders), and Notion (calm, restrained color). One accent color (amber, `#D97706` light /
`#F59E0B` dark) is reserved exclusively for primary actions and the active nav item; everything
else is near-monochrome (warm off-white/near-black surfaces with a mid-gray "dim" text tone for
secondary information).

**Layout:** a persistent left sidebar (desktop, 208px wide, icon + label) with seven destinations,
collapsing to a bottom tab bar (icons only) on mobile. The main content column is capped at
`max-w-3xl` and centered, regardless of screen width — the app never uses the full width of a wide
monitor. There is no header/topbar; each page renders its own `<h1>` inline with the content.

**Navigation:** Today (`/`), Tasks, Calendar, Fitness, Nutrition, Memory, Settings — a flat,
seven-item structure with no nesting, no breadcrumbs, no search. Active state is a filled
accent-tinted pill on the current nav item.

**Main screens:**
- **Today** — greeting (time-of-day aware: "Good morning/afternoon/evening, {name}"), current date,
  a highlighted daily-plan card (or an empty-state prompt if none exists yet), a two-column grid of
  "Agenda" (today's events) and "Top tasks" (5 highest-priority open tasks), and a nutrition-totals
  card.
- **Tasks** — a quick-add text input, an "Open" card listing all incomplete tasks (checkbox,
  priority badge, due date, delete-on-hover), and a "Recently completed" card (last 10).
- **Calendar** — either a "Connect Google Calendar" prompt (if not connected) or seven stacked
  day-cards (today through +6 days), each listing that day's events or "Free."
- **Fitness** — two stat cards (workout count, 7-day volume) and a chronological workout history
  list with set details as inline pill tags.
- **Nutrition** — four stat cards (today's calories/protein/carbs+fat, 7-day average) and a 7-day
  meal log list.
- **Memory** — memories grouped into cards by kind (preference/habit/routine/goal/relationship
  /event), each row deletable.
- **Settings** — a profile/goals form, a Google Calendar connect/disconnect control, a read-only
  display of the active AI provider, and data-export/sign-out links.
- **Login** — a single email field triggering a Supabase magic-link email; no password flow exists
  anywhere in the app.

**Components:** a small shared set — `Card` (bordered rounded container with a `CardTitle` label),
`PriorityBadge` (colored pill: urgent/high/normal/low), `EmptyState` (icon + hint text), plus
page-specific list components (`TaskList`, `MemoryList`) that use React Server Actions
(`useTransition`) for optimistic-feeling toggle/delete without full page reloads.

**The command bar itself** is the most interactive piece of UI: a centered modal with a backdrop
blur, a single text input, and an inline response area below it that appears only after
submission — showing either a "Working on it…" state, an error in red, or the assistant's text
reply followed by a wrapped row of action-receipt chips (each a small pill with a checkmark, the
action label, and an "Undo" link where applicable).

**Animations:** minimal and utilitarian — a 160ms fade/scale-in on the command bar overlay
appearing, and a blanket 150ms ease-out transition class applied to hover states, nav item
switches, and button opacity. No page-transition animation, no skeleton loaders (pages are
server-rendered and arrive complete or not at all), no list-item enter/exit animation (a deleted
task simply disappears on the next render).

**Information hierarchy:** each page leads with an `<h1>`, then cards ordered roughly by
importance (e.g., Today's plan card before the agenda/tasks grid). Within cards, an all-caps,
letter-spaced, dim `CardTitle` functions as a section label. Numbers that matter (macros, set
weights, volume) use tabular figures (`font-variant-numeric: tabular-nums`) for alignment.

**Color system:** CSS custom properties swapped wholesale via a `.dark` class on `<html>` (applied
before paint via an inline script reading `localStorage`, to avoid a flash of the wrong theme).
Semantic colors are limited to `--good` (green, used for completed-task checkmarks and success
checkmarks) and `--bad` (red, used for errors, over-budget calories, and delete-hover states).

**Typography:** Inter, loaded from rsms.me's CDN, at a 15px base body size; headings use tighter
tracking; no distinct heading font.

**Mobile vs. desktop:** the sidebar becomes a bottom tab bar under Tailwind's `md` breakpoint; the
command bar's keyboard trigger doesn't exist on mobile (no physical ⌘K), so a floating circular ✦
button is fixed above the tab bar instead. No other layout adaptation — cards and grids collapse
to single-column via standard responsive grid classes, and the max-width content column means
desktop and tablet look nearly identical, just more centered.

**User journey (as built):**
1. Land on `/login` (unauthenticated) → enter email → receive a Supabase magic link → click it →
   redirected through `/auth/callback` → land on `/` (Today).
2. Today shows either a real daily plan (if the cron or a manual "plan my day" has run) or an
   empty-state prompt, plus today's agenda and top tasks if calendar/tasks have data.
3. Pressing ⌘K from any page opens the assistant. Typing a request and hitting Enter shows a
   loading state, then a text reply and receipt chips. Closing the overlay (`Esc` or backdrop
   click) triggers a `router.refresh()` if any action mutated data, so the underlying page (e.g.
   Tasks) reflects the change immediately without a manual reload.
4. Dedicated pages (Tasks, Calendar, Fitness, Nutrition, Memory) are otherwise reached only via
   sidebar/tab navigation — there is no cross-linking from the Today page into, say, the full
   Tasks list beyond the implicit sidebar click (the "Top tasks" card doesn't itself link to
   `/tasks`).
5. Settings is where the two "setup" actions live: connecting Google Calendar and configuring
   personal goals; both are one-time-ish tasks rather than everyday interactions.

---

## 4. AI System Design

**Provider in active use:** Google Gemini, model `gemini-2.5-flash-lite` (recently changed from
`gemini-2.0-flash` after hitting a zero-quota wall on that model under the current Google Cloud
project — see Section 8 for the underlying cause). Embeddings always use `text-embedding-004`
regardless of the chat model setting.

**Provider abstraction:** a single `AIProvider` interface (`chat()`, optional `embed()`) with three
concrete implementations:
- `GeminiProvider` — talks to `generativelanguage.googleapis.com` directly via `fetch`, translating
  the app's provider-neutral message/tool format to and from Gemini's `contents`/`functionCall`
  /`functionResponse` shape.
- `OpenAICompatProvider` — one implementation shared by OpenAI, OpenRouter, NVIDIA NIM, and Ollama,
  since all four speak the OpenAI `chat/completions` dialect; only `baseURL`/key/model differ.
- `AnthropicProvider` — talks to `/v1/messages` directly, translating to/from Anthropic's
  `tool_use`/`tool_result` content-block shape.

A factory (`createProvider`/`getProvider`) reads `AI_PROVIDER` from the environment and constructs
the matching instance, module-cached for the life of the server process. Switching providers is a
two-environment-variable change with no code edits.

**Retry/error handling:** a shared `withRetry` wrapper retries on 429/5xx. For 429s specifically,
it now parses the provider's advised wait time (Google's `retryDelay` field in the error body, or
a `Retry-After` header) and only retries inline if that wait is under 4 seconds — otherwise it
fails fast with a `ProviderError` carrying the real wait time, rather than silently re-hitting a
per-minute quota with a too-short backoff (an earlier, since-fixed bug).

**Tool/function-calling system:** thirteen tools (`create_task`, `complete_task`, `list_tasks`,
`log_workout`, `log_meal`, `get_agenda`, `create_event`, `update_event`, `delete_event`,
`save_memory`, `recommend_bedtime`, `generate_daily_plan`) are defined **once**, as Zod schemas, in
a single file. Two things are derived from each schema: (a) a JSON Schema tool definition sent to
whichever provider is active (with a sanitization pass stripping keys Gemini's function-calling
implementation rejects — `$schema`, `additionalProperties`, `exclusiveMinimum`/`Maximum`,
`minimum`/`maximum` — discovered empirically during development), and (b) the runtime validator
that checks the model's actual tool-call arguments before any handler executes. There is no
separate "intent classifier" — tool selection is entirely the underlying model's native
function-calling behavior.

**Prompt structure (system prompt, composed per request):** persona line, current local date/time
in the user's timezone, a fixed list of behavioral rules (resolve every actionable request into
tool calls; estimate nutrition rather than asking; never invent calendar IDs; explain conflicts
plainly; keep final replies to 1–3 sentences with no markdown), and — only if any were recalled —
a bulleted list of relevant memories labeled by kind. This is followed by exactly one user message
(the current input) in the conversation array; there is no prior conversation history included.

**Context passed to the model:** (1) the system prompt described above, (2) the user's raw text,
(3) as the tool-call loop progresses, each tool's string result is appended as a `tool` role
message so the model can reference real data (e.g., actual event IDs from `get_agenda`) in
subsequent calls within the same request.

**Reasoning/action loop (`runAssistant`):**
1. Recall relevant memories (skipped entirely if the user has none stored yet).
2. Compose the system + user message pair, call the provider with the full tool catalog attached.
3. If the response contains no tool calls, return its text as the final answer.
4. If it does, execute each tool call server-side (validated against its Zod schema first),
   append the assistant's tool-call message and each tool's result to the conversation, and loop
   back to step 2 — up to 5 hops.
5. If the hop budget is exhausted without a final text answer, return whatever actions did
   complete plus an honest "ran out of steps" message rather than fabricating a summary.

**Tool execution (`executeToolCall`):** validates arguments against the tool's Zod schema (a
failure is fed back to the model as a tool error, not thrown to the user, so the model can retry
with corrected arguments within the hop budget); dispatches to a per-tool handler that performs
the actual Supabase write or Google Calendar API call; returns a plain-text result string (for the
model) and, for mutating actions, an `ActionReceipt` (for the UI) that may include an `undo`
target (`{table, id}` for Supabase rows, `{calendarId, calendarEventId}` for calendar events).

**Memory as part of the AI system:** covered in detail in 2.5. Architecturally relevant here: the
same `AIProvider.embed()` call used for memory recall is also used when *saving* a memory
(`save_memory` tool → `saveMemory()` helper), so every save costs one additional AI call beyond
the reasoning-loop calls.

**End-to-end workflow, concretely, for "I ate chicken and rice":**
User message → recall check (skipped if no memories exist) → provider `chat()` call #1 with the
full tool catalog → model returns a `log_meal` tool call with model-estimated macros → server
validates args with Zod → inserts a `meals` row → tool result ("Meal logged: ... (~520 kcal ...)")
appended to the conversation → provider `chat()` call #2 → model returns final text with no
further tool calls → response `{ text, actions: [...] }` returned to the client → command bar
renders the text and an undoable chip → on close, `router.refresh()` re-renders the Nutrition/Today
pages with the new row.

**Daily plan generation** is architecturally distinct from the conversational loop: it is a
single, non-agentic LLM call (no tool-calling, no loop) that receives a large pre-assembled
context block (agenda, tasks, workout/meal history, goals) and is instructed to return raw JSON,
parsed with a regex-then-Zod fallback chain. The sleep-recommendation component of the plan is not
an LLM output at all — it's deterministic arithmetic computed separately and appended.

**No agent architecture beyond the single-loop tool-caller described above** — there is no
planner/executor split, no sub-agents, no multi-model routing, no retrieval-augmented generation
beyond the memory-recall step, and no persistent "conversation" object; each command-bar
submission is a fully self-contained request/response cycle.

---

## 5. Technical Architecture

### Frontend
- **Framework:** Next.js 15 (App Router), React 19, TypeScript (strict mode, plus
  `noUncheckedIndexedAccess`).
- **Structure:** a `(app)` route group holds all authenticated pages behind a shared layout
  (sidebar + command bar); `/login` and API routes sit outside it. Server Components fetch data
  directly via a request-scoped Supabase client (`requireUser()`); the few interactive pieces
  (command bar, task/memory list toggles, theme toggle) are Client Components using either local
  `useState` or Next.js Server Actions invoked through `useTransition` for non-blocking updates.
- **State management:** no client-side global state library (no Redux/Zustand/Context beyond
  React's own). Server state is the source of truth, re-fetched via full page re-renders
  (`export const dynamic = "force-dynamic"` on every data page) or `router.refresh()`; the only
  meaningful client state is the command bar's open/input/response/undo-tracking state and the
  dark-mode boolean (mirrored to `localStorage`).
- **Styling:** Tailwind CSS v4 (CSS-first config via `@theme inline`, no `tailwind.config.js`),
  with a custom CSS-variable-based design-token layer for colors (`--bg`, `--surface`, `--accent`,
  etc.) swapped by a `.dark` class. No component library (no shadcn/Radix/MUI) — every UI piece is
  hand-built in `src/components/ui.tsx` and page files.

### Backend
- **Framework:** Next.js Route Handlers (`src/app/api/**/route.ts`) — there is no separate backend
  service or process; "backend" and "frontend" are the same Next.js application.
- **APIs exposed:** `POST /api/assistant` (the main NL pipeline entry point), `POST
  /api/assistant/undo`, `GET /api/google/auth` + `GET /api/google/callback` (OAuth flow), `GET
  /api/cron/daily-plan` (bearer-token-guarded, intended for Vercel Cron), `GET /api/export`, and
  `GET /auth/callback` (Supabase magic-link landing).
- **Business logic location:** almost entirely in `src/lib/` — `pipeline/` (tool schemas, executor,
  orchestrator), `google/` (OAuth + Calendar REST client), `memory/`, `planning/` (daily plan +
  sleep math), `ai/` (provider abstraction) — route handlers are thin wrappers that authenticate,
  validate the request body, call into `lib/`, and shape the HTTP response.

### Database
- **Engine:** Supabase (managed Postgres) with the `pgvector` extension enabled.
- **Schema:** eight tables — `profiles`, `tasks`, `workouts`, `workout_sets`, `meals`, `memories`,
  `daily_plans`, `google_tokens` — all detailed in Section 6.
- **Row-Level Security:** enabled on every table, policy pattern `user_id = auth.uid()` (or `id =
  auth.uid()` for `profiles`) for all operations. The cron job uses a service-role client that
  bypasses RLS by design, with manual per-user query scoping applied via a `Proxy` wrapper around
  the Supabase client (`scopedClient` in the cron route) since there's no session to scope it
  automatically.
- **Auth:** Supabase Auth, magic-link (OTP-via-email) only — no password, no OAuth social login for
  the app itself (Google OAuth is used only for Calendar API access, entirely separate from
  Supabase Auth's own session).

### Integrations
- **Google Calendar:** OAuth2 authorization-code flow implemented by hand (no `googleapis` npm
  package) — `googleAuthUrl()`/`exchangeCode()`/`getAccessToken()` (with automatic refresh-token
  -based renewal)/`saveTokens()` in `lib/google/oauth.ts`, plus `listCalendars()`, `listEvents()`,
  `createEvent()`, `updateEvent()`, `deleteEvent()`, `getBusy()`, `findConflicts()` in
  `lib/google/calendar.ts`. OAuth state is HMAC-signed (using `CRON_SECRET` as the signing key,
  reused for convenience rather than a dedicated secret) to bind the callback to the initiating
  user and prevent token substitution.
- **AI providers:** see Section 4.
- **Authentication:** Supabase Auth (magic link) is the only user-identity system in the app.
- **No other external APIs** — no nutrition database, no maps/travel-time API, no push
  notification service, no email service beyond what Supabase's auth emails handle internally.

### Deployment
- **Target (per design docs):** Vercel for hosting, with `vercel.json` declaring a cron trigger
  (`0 4 * * *` → `/api/cron/daily-plan`).
- **Actual current status:** **never deployed.** All testing to date has been against `next dev`
  on localhost. The cron path, the production OAuth redirect URI, and any serverless cold-start
  behavior of the in-memory caches (agenda cache, calendar-list cache) are unverified outside
  local development.
- **Environment configuration:** a single `.env` file (`.env.example` documents every variable)
  covering Supabase keys, the active AI provider's credentials, Google OAuth client
  ID/secret, `APP_URL`, and `CRON_SECRET`. No secrets are prefixed `NEXT_PUBLIC_` except the two
  Supabase values that are safe to expose (URL + anon key, protected by RLS).
- **Production considerations documented but not exercised:** RLS as the multi-tenant boundary,
  least-privilege OAuth scopes, service-role key confined to the cron route only.

---

## 6. Data Models

All tables live in a single Postgres schema (`supabase/schema.sql`), owned by Supabase's built-in
`auth.users` via foreign key, with a trigger (`handle_new_user`) auto-creating a `profiles` row on
signup.

**`profiles`** (one row per user, PK = `auth.users.id`)
- `display_name` (text) — used in greetings and AI persona line.
- `timezone` (text, default `'UTC'`) — drives all date/time math app-wide.
- `settings` (jsonb) — free-form bag currently holding `calorieGoal`, `proteinGoal`, `sleepHours`,
  `windDownMinutes` (no `carbsGoal`/`fatGoal` despite the type definition in `lib/types.ts`
  allowing for them — they're never written by the Settings form).
- Relationship: implicit 1:1 with every other user-scoped table via `user_id`.

**`tasks`**
- `title` (text, required), `notes`, `priority` (1–4, default 3), `category`, `project`, `due_at`
  (timestamptz), `recurrence` (text, RRULE — stored, never expanded), `completed_at` (null =
  open), `created_at`.
- Purpose: general to-do/reminder storage. No relationship to other tables beyond `user_id`.

**`workouts`**
- `performed_on` (date, default today), `kind` (enum: strength/cardio/mobility/other), `title`,
  `duration_min`, `distance_km`, `notes`, `created_at`.
- Relationship: one-to-many with `workout_sets` (cascade delete).

**`workout_sets`**
- `workout_id` (FK → workouts, cascade), `exercise` (text), `set_no`, `reps`, `weight_kg`.
- Purpose: normalized per-set detail for strength workouts; unused for pure-cardio entries.

**`meals`**
- `eaten_at` (timestamptz, default now), `meal_type` (enum, nullable), `description` (text,
  required — the raw user phrasing is preserved), `calories`/`protein_g`/`carbs_g`/`fat_g`
  (integers, all AI-estimated), `created_at`.
- No relationship to other tables beyond `user_id`.

**`memories`**
- `kind` (enum: preference/habit/relationship/routine/goal/event), `content` (text), `importance`
  (1–5, stored but unused in retrieval logic), `embedding` (`vector(768)`, nullable — null when the
  active provider can't embed or the embed call failed), `last_used_at` (updated on recall, unused
  for decay), `created_at`.
- Supported by a Postgres function `match_memories(user_id, embedding, threshold, count)` doing a
  pgvector cosine-distance nearest-neighbor query.

**`daily_plans`**
- Composite PK (`user_id`, `plan_date`) — one plan per user per calendar date, upserted.
- `plan` (jsonb) — the full `DailyPlan` object (overview, priorities[], workout, nutrition,
  freeWindows[], bedtime), `created_at`.
- No historical versioning — regenerating overwrites.

**`google_tokens`**
- PK = `user_id` (one Google connection per user, no support for multiple Google accounts).
- `refresh_token` (text, long-lived), `access_token` + `expires_at` (short-lived, refreshed
  on-demand by `getAccessToken()`), `updated_at`.

**Entities described in the original product brief but with no corresponding table:** a distinct
"Sleep Record" (sleep is recommended, never logged), a distinct "Habit" entity (habits are just one
`kind` value within `memories`, not a first-class tracked/streaked object), and any kind of
"Reminder" entity separate from `tasks`.

---

## 7. Current Strengths

- **The tool-calling architecture is unusually disciplined for a project this size.** One Zod
  schema per tool serves simultaneously as the LLM-facing contract, the runtime input validator,
  and (via a small sanitization pass) the cross-provider JSON Schema — there is exactly one place
  to add or change a capability, and it can't drift out of sync with what's actually validated.
- **The AI provider abstraction is genuinely provider-agnostic**, not just in theory: three
  concrete adapters (native Gemini, one shared OpenAI-dialect adapter covering four different
  named providers, native Anthropic) sit behind one interface, and switching which one is active
  is purely an environment-variable change. This was exercised for real during development (a
  live model swap from `gemini-2.0-flash` to `gemini-2.5-flash-lite` required editing one line).
- **The memory system correctly implements "retrieval, not dump."** It never sends the whole store
  to the model; it does semantic search when possible and degrades gracefully to keyword search
  when it can't, and it was optimized mid-development to skip the embedding call entirely for
  users with nothing stored yet — a real cost/latency consideration acted on, not just designed.
- **The undo mechanism is a thoughtful UX answer to NL ambiguity.** Rather than confirmation
  dialogs before every action (which would defeat the point of a fast command bar), every mutating
  action returns a receipt with a one-click reversal, including for calendar events, which
  required threading a calendar-scoped identity through the whole action-receipt/undo pipeline.
- **Conflict detection runs before booking, not after**, and does so across every calendar the
  user has (not just primary) — this was specifically re-engineered after the "entire calendar"
  requirement surfaced, rather than left as a primary-only shortcut.
- **RLS is applied uniformly** across all eight tables with a consistent, auditable policy pattern,
  meaning the security boundary between the two intended users is enforced at the database layer,
  not just in application logic.
- **Deterministic math is used where determinism is actually available** (the sleep-time
  calculation is a pure function, unit-tested across DST and midnight-rollover cases) rather than
  routing everything through the LLM by default — the daily plan engine uses the LLM only for the
  genuinely unstructured parts (phrasing, prioritization judgment) and arithmetic for the rest.
- **Real production incidents were diagnosed and fixed against live behavior**, not hypothetically:
  a Gemini function-calling schema rejection (`exclusiveMinimum`), an inadequate retry backoff for
  per-minute rate limits, a zero-quota Google Cloud project, and a stale-cache complaint about a
  phone-added calendar event were each traced to a specific root cause and resolved in the actual
  codebase.

---

## 8. Current Weaknesses

- **Never deployed.** Every "production consideration" in the architecture doc — the cron job, the
  production OAuth redirect, serverless cold-start behavior of the in-memory caches — is
  unverified outside `next dev` on one machine. This is the single largest gap between the
  documented design and the demonstrated system.
- **Fragile dependency on a specific Google Cloud project's quota state.** The app currently runs
  against a Gemini API key whose project was discovered, live, to have a `limit: 0` free-tier
  quota grant — a state that recurred even after generating a fresh key in a fresh project, which
  was never fully root-caused (billing-account requirement vs. regional restriction vs. something
  else remains an open question) and was worked around only by switching models, with unverified
  effect. The application has no fallback provider behavior if the configured one is
  quota-exhausted — a rate-limited request just fails with a message telling the user to wait.
- **AI cost/latency scales per message in a way that isn't bounded or visible.** A single
  user message can trigger 2 (simple) to 4+ (if memory-saving and multi-hop reasoning both occur)
  separate provider calls, with no per-request or per-day ceiling, no usage counter shown anywhere,
  and no circuit breaker beyond the retry logic's fail-fast behavior.
- **Nutrition and fitness logging are AI-estimation-only with no correction path.** There is no
  edit capability for a logged meal or workout — a bad macro estimate or a mis-parsed set can only
  be fixed by deleting (via undo, only within the same command-bar session, or not at all once that
  session closes) and re-entering. This is a real data-integrity gap for a tracking feature.
- **Several brief-listed features don't exist despite being implied as "implemented" by their
  presence in the UI or tool catalog:** progressive-overload analysis, missed-workout alerts,
  weekly planning/nutrition summaries, recurring-task expansion (the field exists, nothing reads
  it), travel-time-aware scheduling, and habit streak tracking. A reviewer skimming the schema or
  tool list could reasonably assume more depth than exists.
- **No conversation continuity.** Every command-bar submission is a stateless, single-turn
  exchange — if the model asks a clarifying question (e.g., an ambiguous `complete_task` match), or
  the user wants to correct their previous message, there is no mechanism for a follow-up within
  context; they must issue a brand-new, fully self-contained request.
- **The daily plan's "free time windows" are LLM-inferred from a text description of the day**,
  not computed by interval arithmetic against the actual event list — this is a plausible source of
  subtly wrong output (an incorrect gap) that would be easy to get definitively right
  deterministically, in the same spirit as the sleep-time calculation, but currently isn't.
- **No automated tests exercise the AI pipeline's actual behavior** (tool selection accuracy,
  multi-hop conversation correctness, memory recall relevance) — the 22 existing unit tests cover
  tool-schema shape, sleep-math correctness, timezone conversion, and the provider factory's
  wiring, all of which are real and passing, but none of them touch a live model or verify that a
  given natural-language input produces the intended tool call.
- **Manual CRUD UI is inconsistent in depth across features.** Tasks has a real (if minimal)
  manual-entry form and full checkbox/delete controls; Fitness, Nutrition, and Memory are
  read/delete-only from their dedicated pages — any creation or editing there must go through the
  assistant, which contradicts the stated design goal ("the app stays usable without AI").
- **Security-adjacent shortcuts exist that would need attention before any real deployment:** the
  OAuth state HMAC reuses `CRON_SECRET` as its signing key rather than a dedicated secret; the cron
  route's per-user query scoping is implemented via a hand-rolled `Proxy` around the service-role
  client rather than a more auditable mechanism; there is no rate-limiting on the `/api/assistant`
  endpoint itself beyond whatever the upstream AI provider enforces, meaning a compromised or
  buggy client could still hammer the endpoint (and, transitively, the AI provider's quota) with
  authenticated requests.
- **No observability.** Errors are `console.error`'d to the dev server's stdout and nothing else —
  no structured logging, no error tracking service, no usage/cost dashboard, no health check
  endpoint. Diagnosing the Gemini quota issue during development required manually reading raw
  provider error bodies out of the terminal.
- **Prototype-feeling surfaces:** the Settings page's AI-provider display is read-only text
  instructing the user to edit environment variables directly — there is no in-app way to change
  provider/model/API key without redeploying; the Calendar page's 7-day view has no way to
  navigate to a different week; there is no in-app onboarding or empty-state walkthrough beyond
  static hint text.

---

## 9. Competitive Position

*(Descriptive positioning only, as requested — not a recommendation.)*

**vs. ChatGPT / Claude (as consumer chat apps):** Caffeinatd's model is action-first — its "chat"
surface exists to *do things in a private, structured personal database* (tasks, calendar, logs),
not to converse or answer open-ended questions. It has no general knowledge/Q&A ambition and no
persistent conversation thread at all, which is the opposite of how ChatGPT/Claude are designed to
be used. It is also single-purpose to one person's life data, whereas both are general-purpose
assistants with no concept of "your task list" or "your calendar" unless manually connected via
their own more general plugin/connector ecosystems.

**vs. Apple Intelligence:** both aim for ambient, low-friction personal assistance woven into
daily tools rather than a standalone chat destination, and both use natural language as the
primary input to structured actions (reminders, calendar). Apple Intelligence is OS-integrated and
system-wide across every app; Caffeinatd is a single web app with its own siloed data model,
entirely dependent on the user actively opening it (or the daily-plan cron, which has never run in
production) rather than being ambient at the OS level.

**vs. Motion / Reclaim AI:** those products' core differentiator is *automatic time-blocking* —
algorithmically placing tasks into calendar gaps and re-optimizing a schedule continuously.
Caffeinatd has no scheduling optimizer of any kind; task due dates and calendar events are two
separate, unlinked systems that the daily-plan LLM call merely *describes* together in a summary.
It also has no scheduling automation loop — Motion/Reclaim actively move things; Caffeinatd only
reacts to explicit user requests plus a one-shot daily summary.

**vs. Notion AI:** Notion AI is a writing/knowledge-base assistant layered onto a flexible
document/database product the user builds themselves. Caffeinatd has fixed, opinionated
schemas for a specific set of life domains (tasks, fitness, nutrition, calendar) rather than a
general-purpose flexible data model — there is no way to define a custom entity type or view.

**vs. Todoist AI:** Todoist AI's natural-language features (quick-add date parsing, task
suggestions) operate within a mature, feature-complete task manager (sub-tasks, filters, labels,
collaboration, mobile apps). Caffeinatd's task feature is comparatively minimal (flat list,
priority, category/project as free-text strings, no sub-tasks, no filters/views) but is one of
five integrated domains rather than the entire product, and its natural-language layer additionally
spans calendar, fitness, and nutrition, which Todoist does not address at all.

**Distinctive characteristics as currently built:** the combination of five personal-tracking
domains (calendar, tasks, fitness, nutrition, sleep) behind one natural-language entry point, with
a genuinely swappable AI backend and a visible/editable long-term memory store, in a codebase
built for exactly two named users rather than as a scalable multi-tenant product. No competitor
in this comparison set combines calendar + task + fitness + nutrition + sleep in one
natural-language surface; each of them is deep in one or two of those domains and absent from the
rest.

---

## 10. Future Potential

*(Directions mentioned in the project's own roadmap document as deferred, stated descriptively —
not new recommendations.)*

Per `docs/04-roadmap.md`, work already identified as later-milestone or extension-tier: recurring
-task expansion into future instances, progressive-overload analysis and missed-workout alerts,
weekly (not just daily) planning and nutrition summaries, `g`-key power-user navigation, travel
-time-aware scheduling (blocked on a Maps API key and a location-memory concept), voice input via
the browser's SpeechRecognition API feeding the same command bar, web push notifications, Gmail
/email triage, Apple Health import, a shared/partner "assistant mode" distinct from today's
two-independent-accounts setup, and budgeting. The roadmap document also names chart-based
nutrition trend visualization and a food-database lookup tool (to reduce reliance on pure LLM
macro estimation) as identified-but-deferred, in its own self-critique section.

---

## 11. Development Status

**Complete and exercised against live services:**
- Auth (Supabase magic link).
- The core NL pipeline end-to-end (recall → reason/act loop → receipts → undo) for tasks, meals,
  workouts, and memory.
- Google Calendar OAuth connect/disconnect flow, multi-calendar agenda reads, conflict-checked
  event creation, and update/delete via natural language.
- Manual CRUD for tasks (create, complete, delete); read/delete for memory.
- Settings (profile/goals form, calendar connect state, data export, sign-out).
- Provider abstraction, actively used to switch both provider (Gemini as sole one tested live) and
  model (`gemini-2.0-flash` → `gemini-2.5-flash-lite`) during development.
- 22 unit tests covering tool-schema validation/sanitization, sleep-time math, timezone
  conversion, conflict-interval logic, and provider-factory wiring — all passing; TypeScript
  strict-mode typecheck clean; production build succeeds locally.

**Complete in code but not field-verified:**
- The daily-plan cron endpoint (correct logic, unit-adjacent-verified via its underlying
  functions, but has never actually been triggered by a real Vercel Cron invocation since the app
  isn't deployed).
- Multi-user isolation via RLS (correct policies exist and are exercised implicitly by every query
  going through a session-scoped client, but there has only ever been one real user account
  active).

**Partially complete:**
- Nutrition and fitness tracking (logging and read views work; no edit capability, no derived
  insights beyond a single volume figure).
- Sleep optimization (the recommendation math works and is calendar-aware; it ignores workload and
  workout load as inputs despite the product brief listing them, and there is no sleep logging to
  close the loop).
- Memory system (recall/save/delete work; no editing, no decay, no de-duplication, no
  importance-weighted ranking despite the field existing).

**Missing entirely:**
- Any form of push/email/in-app-toast reminder delivery at a due time.
- Recurring-task materialization (field exists, nothing expands it).
- Weekly summaries of any kind.
- Progressive-overload / missed-workout intelligence.
- Travel-time awareness.
- Voice input.
- Any deployment to a live environment.
- Any usage/cost observability for AI calls.
- Conversation continuity / multi-turn context within the command bar.

**What the project's own roadmap document identifies as the next priority tier (M4):** recurring
-task expansion, progressive-overload analysis, missed-workout alerts, a nutrition trend chart,
weekly planning summaries, and `g`-key navigation — stated there as the next milestone after the
current one, which this document describes as substantially, though not entirely, complete.

---

## 12. Final Product Specification

Caffeinatd, as it exists today, is a locally-run, single-tenant (two-user-capacity) Next.js 15
web application providing one natural-language command surface (a ⌘K overlay) over five personal
-life domains — calendar, tasks, fitness, nutrition, and a durable cross-session memory store —
backed by Supabase Postgres with row-level security, and a swappable AI backend currently
configured to Google Gemini (`gemini-2.5-flash-lite`, having been changed once already from
`gemini-2.0-flash` mid-development due to a live quota issue). Every natural-language input is
resolved through a single-loop, five-hop-max tool-calling pipeline against a fixed catalog of
thirteen Zod-defined tools that write directly to Postgres or the Google Calendar REST API (the
latter now spanning every calendar the user owns, not just primary, with pre-write conflict
detection across all of them); every mutating action returns an undoable UI receipt. A once-daily
planning routine (LLM-composed narrative fields plus deterministically computed sleep timing) is
implemented and unit-verified but has never executed against a real deployment, because the
application itself has never been deployed — all development and manual testing to date has
occurred against a local `next dev` server with one live user account, one connected Google
Calendar, and one active Gemini API key. The codebase is TypeScript-strict, passes its 22 existing
unit tests, builds cleanly for production, and follows a consistent architectural pattern (Zod
schema as single source of truth; provider-agnostic AI interface; RLS-enforced multi-tenancy;
deterministic math where determinism is available) — but several features implied by its data
schema or original product brief (recurring tasks, progressive overload, weekly summaries, sleep
logging, notification delivery) exist only as unfilled schema columns or absent code paths, and the
manual (non-AI) CRUD surface is complete for tasks but read-only for fitness, nutrition, and
memory. A new engineer should treat "designed and documented" and "built and running in
production" as two distinct, currently non-overlapping claims about this project, and should
specifically confirm the Gemini quota situation and complete a first real deployment before
assuming any cron-, scale-, or multi-user-dependent behavior works as designed.
