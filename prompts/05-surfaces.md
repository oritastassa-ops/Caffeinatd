# Phase 5 — Settings, observability, and polish

Requires Phases 1–4. This is the phase where the pillar becomes usable by someone who is not you.

## Goal

Every capability built in Phases 1–4 is currently reachable only through an API call or the
database. Give it surfaces: manage contacts, tune preferences, see what was sent, and understand
what failed and why.

The design bar is the existing app — Tailwind 4, clean, generous whitespace, subtle motion,
nothing that reads as a default component library. Reference points: Linear, Raycast, Vercel,
Stripe. Read `src/app/(app)/settings/`, `src/components/`, and `docs/03-ux.md` first and match
what is there rather than introducing a new visual language.

## Deliverables

### 1. Notifications settings — `src/app/(app)/settings/notifications/`

Three sections, in this order (most concrete first):

**Contacts.** List verified and pending email addresses and phone numbers. Add flows inline —
enter address → code sent → enter code → verified, without a page navigation. Show verification
state clearly; a pending contact is visibly different from a verified one, and an opted-out SMS
number says so with the reason. Deleting a contact asks for confirmation and explains what stops
working.

**Preferences.** A matrix: notification kind down, channel across. Each cell is a toggle, and a
cell for a channel with no verified contact is disabled with a reason on hover, not silently
missing — a disabled control that explains itself teaches the system; an absent one confuses.

Below it: quiet hours (two time inputs, shown in the user's timezone with the timezone named),
digest toggle per kind, and SMS caps if the user is allowed to change them.

**Test send.** One button per configured channel that sends a real test message. This is the
single highest-value affordance on the page — it converts "I think it's set up" into "it works",
and it will save you every support conversation you would otherwise have. Rate-limit it.

### 2. Delivery log — a view, not a raw table

Recent deliveries with kind, channel, destination (masked: `o••@gmail.com`, `+1 ••• ••• 4567`),
status, and time. Failures show the user-facing error and, where the fix is user-side (unverified
number, opted out, over cap), a direct action to fix it.

Prefer showing the last ~50 with a filter over building pagination. Given the scale, pagination
is speculative complexity — note it as a future extension instead.

Never render `last_error` if it might contain a raw provider body; Phases 2–3 specified that
`error` is always user-safe, so verify that contract holds here rather than assuming it.

### 3. Onboarding integration

`src/app/onboarding/` currently gets a user to a working app. Add one step: "How should I reach
you?" — email prefilled from the auth session, needing only verification. Skippable, and skipping
is a first-class choice, not a dark pattern.

A user who finishes onboarding without a verified contact should see a single, quiet prompt on
the Today dashboard — not a persistent banner. One nudge, dismissible, and it never comes back
for that user.

### 4. Assistant awareness

Two things the assistant should know about itself:

- The system prompt (see `src/lib/pipeline/`, composition step) should state which channels are
  actually available for this user, so it stops offering to text someone with no verified number.
  Compose this from `availableChannels()` intersected with the user's verified contacts.
- When a tool fails because of a notification-config problem, the failure chip should link to the
  settings page that fixes it.

### 5. README and docs

Update `README.md`: the feature list, the technology-stack table (add Resend / Twilio), the
installation section (new env vars, domain verification, A2P registration lead time), and the
known-limitations section. Remove "push notifications" from the roadmap's near-term slot if
Phases 2–3 shipped email and SMS; add web push as the next channel.

Update `docs/04-roadmap.md` to reflect what actually shipped. Add a `docs/03-ux.md` section for
the notification surfaces.

Finish `docs/14-notifications-architecture.md` with an honest self-critique in the style of
`docs/04-roadmap.md`'s: what is weakest, what breaks first at scale, and what you deliberately
did not build.

## Tests

UI is lightly tested in this repo and that is a reasonable choice — keep it. Test the logic, not
the pixels:

- Address masking is correct and never leaks the full value.
- The preference matrix's disabled-state derivation (channel available AND contact verified).
- Test-send rate limiting.

## Polish pass

Before committing, do a real pass:

- Every interactive element is keyboard reachable with a visible focus ring. The app is
  keyboard-first (⌘K is the primary interface); a settings page that requires a mouse is
  inconsistent with that.
- Loading, empty, and error states exist for every async surface. An empty delivery log says
  something useful, not "No results."
- Responsive down to mobile — the preference matrix is the hard one; consider stacking by kind
  on small screens rather than horizontal scroll.
- Reduced-motion respected on any animation.
- Color contrast meets WCAG AA in both themes.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- A new user can go from zero to a verified email and a successful test send without leaving the
  settings page or reading docs.
- The delivery log makes a failed send self-explanatory.
- `README.md` accurately describes the shipped system — someone cloning the repo can set up
  notifications from it alone.
- One commit, imperative message.

Plan first, and tell me where you think this scope is too large for one session — I would rather
split it than get a rushed settings page.
