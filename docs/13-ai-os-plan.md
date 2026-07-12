# 13 · AI Operating System — architecture & phased plan

Caffeinatd is evolving from a set of pillars (fitness, finance, home…) into a
context-first **AI operating system**: opening a workspace surfaces its
projects, notes, tasks, and conversations automatically — no manual gathering.

## Delivered (this iteration)

### Workspace pillar (migration `007_workspaces.sql`)
Four owner-only tables:

| table | purpose |
| --- | --- |
| `workspaces` | first-class contexts (kind: development / university / premed / research / personal / fitness / custom) |
| `notes` | markdown notes, optionally scoped to a workspace, pinnable |
| `captures` | Quick Capture inbox — one NL line, triaged later |
| `ai_conversations` | persisted assistant exchanges (30-min session window) |

`tasks.workspace_id` (nullable) joins the existing task system into workspaces.
Defaults are seeded on first visit (`lib/workspaces/data.ts`) — real rows, not
fixtures.

### Command palette (`components/command-bar.tsx`)
⌘K is now dual-mode:
- **Command mode** (default): navigation, actions (new note / new task /
  capture / focus mode), and universal search (`(app)/search-actions.ts`)
  across tasks, notes, workspaces, memories, conversations. Keyboard-first.
- **Ask mode**: the untouched assistant pipeline (receipts, undo, memory
  confirmation). Entered via Tab, the Ask row, or quick-action prefill events.

### Surfaces
- `/workspaces/[slug]` — workspace overview: scoped quick capture, derived
  project chips (from `task.project`), scoped task add, notes, conversations.
- `/notes`, `/notes/[id]` — autosaving distraction-free editor.
- `/focus` — full-screen deep-work layer (task + ProgressRing timer).
- Today dashboard — timeline (calendar events ⨉ plan blocks), quick capture +
  inline triage, upcoming deadlines, quick notes, workspace tiles, recent
  conversations.

### Reusable components added
`Timeline`, `WorkspaceCard`, `NoteCard`, `QuickCapture`/`CaptureInbox`,
`ProgressRing`, `FocusSession`, `NoteEditor`.

## Integration boundaries (built for, not faked)

- **Capture → AI triage**: captures are stored raw; a later pipeline tool can
  parse them into tasks/reminders/memories. `captureToTask` is the manual path.
- **Workspace-scoped assistant**: `ai_conversations.workspace_id` exists;
  the pipeline doesn't yet set it (needs palette to pass active workspace).
- **Music in focus mode**: deliberate extension point, no fake controls.
- **GitHub / repos in Development workspace**: schema-free today; add an
  `integrations`-registry provider (see `lib/integrations/registry.ts`) before
  any UI.

## Next phases

1. **AI context panel** — persistent right rail (xl screens): loaded context,
   recent conversations, pinned notes, one-click prompts.
2. **University workspace specialization** — courses, assignments, exams as
   structured tables; each course a mini-workspace.
3. **Research workspace specialization** — papers (PDF metadata), questions,
   references; connect to notes.
4. **Knowledge graph** — notes/tasks/workspaces already relate via FKs; add
   `[[wiki-links]]` parsing in notes, then a purposeful graph view.
5. **Draggable timeline** — plan blocks become editable by drag; writes back
   to `daily_plans.plan.schedule`.
6. **Capture AI triage** — assistant tool that empties the inbox.
