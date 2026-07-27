# Phase 8 — Apple Health import

Read `CLAUDE.md` first. Requires Phase 6 — this phase writes into the `body_metrics` layer and
should add no new storage concepts of its own.

## Goal

Ingest an Apple Health export so the metrics layer fills itself instead of depending on manual
logging. Manual entry is fine for proving a feature and terrible as a habit; this is what makes
Phase 6 actually useful.

Listed on `docs/04-roadmap.md` under M5 extensions.

## The constraint that shapes everything

Apple Health exports as a **zip containing `export.xml`, and that file is routinely 100 MB to
over 1 GB** for someone with years of history. It is a single flat XML document with millions of
`<Record>` elements.

That breaks the obvious implementation in three ways:

1. **You cannot `JSON.parse`-equivalent it.** No DOM parser, no loading it into memory. It must
   stream.
2. **Vercel serverless request bodies cap out around 4.5 MB**, and function duration caps well
   below what parsing a gigabyte takes. A `POST /api/import` that accepts the file does not work
   and cannot be made to work by raising a timeout.
3. **Most of it is noise.** Heart-rate samples every few seconds for five years is millions of
   rows the app has no use for.

**Design for this before writing code.** The options I see:

- **Client-side parse, server-side ingest.** Unzip and stream-parse in the browser
  (`DecompressionStream`, `File.stream()`), extract and aggregate only the metrics we care about,
  POST batched daily aggregates. The big file never leaves the machine — good for privacy, and it
  sidesteps every serverless limit. Cost: parsing logic runs in the browser, so it must be
  resilient and cancellable, and a large import ties up a tab.
- **Direct-to-storage, then background job.** Upload to Supabase Storage, process in a worker.
  Cleaner separation, but Vercel functions still cap duration and you'd need chunked resumable
  processing with state.
- **Narrow the input.** Ask for a targeted export rather than the full archive — but Apple
  doesn't offer per-metric export from the Health app, so this mostly isn't available.

**My lean is client-side parse.** Recommend and justify before implementing; if you see a reason
it fails, say so early.

## Deliverables

### 1. Metric mapping — `src/lib/health/apple/mapping.ts`

Apple's `HKQuantityTypeIdentifier*` and `HKCategoryTypeIdentifier*` strings → the metric names
from Phase 6. Explicit allow-list, not a passthrough — unmapped types are dropped, not stored.

Start with: body mass, sleep analysis, resting heart rate, heart rate variability, step count,
active energy, VO2max, body fat percentage. Note in the doc how a new metric gets added.

Two gotchas worth handling explicitly:

- **Sleep analysis is category records with `InBed` / `AsleepCore` / `AsleepDeep` / `AsleepREM` /
  `Awake` values across overlapping intervals**, not a duration. Deriving "hours slept" means
  merging intervals and deciding whether `InBed` counts. Decide, document the choice, and test
  the overlap cases — this is the single most error-prone mapping in the set.
- **Units vary by device and locale.** `lb` vs `kg`, `mi` vs `km`. Read the `unit` attribute and
  convert to canonical; never assume. Reuse `src/lib/fitness/units.ts`.

### 2. Streaming parser — `src/lib/health/apple/parse.ts`

A pure, testable function over a stream of chunks that yields matched records. **No DOM parser**
— a hand-rolled tag scanner over the record elements is appropriate here and is the rare case
where the simple approach is also the correct one, since the schema is flat and known.

Aggregate as you go: emit daily summaries (mean/min/max/sum as appropriate per metric), not raw
samples. Aggregation choice is per-metric and belongs in the mapping table — steps sum, resting
HR averages, weight takes the day's first reading.

Must be cancellable and must report progress.

### 3. Ingest endpoint

`POST /api/health/import` accepting **batched daily aggregates**, not the file. Session-scoped,
RLS applies, batch size bounded, every write checks `error`.

Idempotency is the whole game here. Phase 6's dedupe index on
`(user_id, metric, measured_at, source)` with `source = 'apple_health'` means re-importing an
overlapping export is a no-op. Verify that actually holds — a user re-exporting after three
months and re-uploading is the expected behavior, not an edge case.

**Source precedence:** where Apple Health and a manual entry cover the same instant, manual wins
(the user typed it deliberately). Where Apple Health and Hevy both describe a workout, Hevy wins
(richer data). Encode this in one place.

### 4. Import UI

Settings → a dedicated import surface:

- File picker with clear instructions on producing the export (Health app → profile icon →
  Export All Health Data). Say up front that it can take several minutes on-device and be very
  large, because a user who doesn't know that assumes it's broken.
- **Real progress**, not a spinner. "Parsed 1.2M of ~4M records" — the honest indicator for a
  multi-minute job. A spinner for four minutes reads as a hang.
- A preview before committing: what was found, date range, per-metric counts. **The user confirms
  before anything is written.** Silent bulk writes into someone's health history are unacceptable.
- Cancel that actually cancels.
- Post-import summary: imported, skipped as duplicates, unmapped.

### 5. Docs

`docs/17-apple-health-import.md`: the size constraint and why the architecture is what it is, the
mapping table, the sleep-interval decision, the precedence rules, and a self-critique. Be
specific about what breaks first — likely browser memory on a very large export, or a user
closing the tab mid-import.

## Tests

- Parser against small fixture XML files committed to `tests/fixtures/`: a handful of records per
  type, malformed records, an unmapped type, unit variants.
- Sleep interval merging: overlapping stages, `InBed` spanning `Awake` gaps, a nap plus a night,
  a session crossing midnight.
- Aggregation per metric type.
- Idempotency: same batch twice → one set of rows.
- Precedence: manual beats Apple for the same instant.

Do not commit a real health export as a fixture. Synthesize small ones.

## Out of scope

Live HealthKit sync (needs a native app — note it as the real long-term answer). Writing back to
Apple Health. Google Fit / Fitbit / Garmin, though the mapping layer should make them tractable.

## Privacy

This is the most sensitive data the app will hold, and unlike everything else it arrives in bulk
from a device the user trusts.

- The raw export never touches the server if you take the client-side route. Say so in the UI —
  it's a genuine reassurance and it's true.
- Nothing is written before explicit confirmation.
- Imported metrics appear in the existing `/api/export` data dump alongside everything else.
- Deleting imported data is possible and obvious: a "remove all Apple Health data" action scoped
  by `source`, with confirmation.
- No third party sees any of it. No analytics on health values.

Same medical boundary as Phase 6: descriptive statistics only, no diagnostic language anywhere.

## Definition of done

- `npm run typecheck`, `npm run test`, `npm run build` pass.
- A real export parses, previews accurately, imports, and re-importing the same file writes
  nothing new.
- Progress is visible and cancel works.
- A user can delete everything Apple Health contributed in one action.
- One commit, imperative message.

Recommend the architecture before you start. If client-side parsing has a failure mode I'm not
seeing — browser memory on a 1 GB export is my main worry — tell me now rather than after it's
built.
