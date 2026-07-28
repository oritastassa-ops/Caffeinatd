import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Button, Card, CardTitle, Input, LinkButton, PageHeader, Select, Stat } from "@/components/ui";
import { fetchHomeData } from "@/lib/home/data";
import { computeChoreStats, isDueOn, nextAssignee, overdueDays } from "@/lib/home/schedule";
import { collectionStatuses, collectionLabel, nextCollection } from "@/lib/home/collections";
import { ChoreList, ChoreRow } from "@/components/home/chore-list";
import { localDateStr } from "@/lib/utils";
import { CHORE_CATEGORIES } from "@/lib/types";
import { addChore, createHousehold, joinHousehold } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const today = localDateStr(profile.timezone);
  const data = await fetchHomeData(supabase, user.id);

  // ── No household yet: setup card ─────────────────────────────────────────
  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <PageHeader title="Home" />
        <Card className="card-enter border-accent/30 bg-accent-soft/40">
          <p className="text-base font-medium">Set up your household ☕</p>
          <p className="mt-1 text-sm text-text-dim">
            Chores, shopping lists, and garbage day — shared with the people you live with.
            Create a household, or join one with an invite code.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <form action={createHousehold} className="flex items-end gap-2">
              <Input
                name="name"
                aria-label="Household name"
                placeholder="Household name"
                autoComplete="off"
                containerClassName="min-w-0 flex-1"
              />
              <Button type="submit">Create</Button>
            </form>
            <form action={joinHousehold} className="flex items-end gap-2">
              <Input
                name="code"
                aria-label="Invite code"
                placeholder="Invite code"
                autoComplete="off"
                containerClassName="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary">
                Join
              </Button>
            </form>
          </div>
        </Card>
      </div>
    );
  }

  const { chores, completions, members, collections, lists, items } = data;
  const dueChores: ChoreRow[] = chores
    .filter((c) => isDueOn(c, today, completions))
    .map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      cadence: c.cadence,
      overdueDays: overdueDays(c, today, completions),
      assignee: nextAssignee(c, members, completions),
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays);
  const overdue = dueChores.filter((c) => c.overdueDays > 0);
  const dueToday = dueChores.filter((c) => c.overdueDays === 0);

  const statuses = collectionStatuses(collections, today);
  const stats = computeChoreStats(chores, completions, members, today);
  const mostActive = members.find((m) => m.id === stats.mostActiveMemberId);
  const openItemCount = items.filter((i) => !i.completed_at).length;

  // Next 7 days preview (chores + collections)
  const upcoming: { date: string; label: string }[] = [];
  for (let d = 1; d <= 7; d++) {
    const date = new Date(new Date(`${today}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10);
    for (const c of chores) {
      if (c.cadence !== "daily" && isDueOn(c, date, completions) && !isDueOn(c, today, completions)) {
        if (!upcoming.some((u) => u.label === c.title)) upcoming.push({ date, label: c.title });
      }
    }
    for (const s of collections) {
      if (nextCollection(s, date) === date && date !== today) {
        if (!upcoming.some((u) => u.label === collectionLabel(s.type) && u.date === date)) {
          upcoming.push({ date, label: `${collectionLabel(s.type)} pickup` });
        }
      }
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const recentActivity = completions.slice(0, 6).map((c) => ({
    id: c.id,
    date: c.completed_on,
    member: members.find((m) => m.id === c.member_id) ?? null,
    chore: chores.find((ch) => ch.id === c.chore_id)?.title ?? "a chore",
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={data.household.name}
        action={
          <div className="flex gap-2">
            <LinkButton href="/home/shopping" variant="secondary" size="sm">
              Shopping {openItemCount > 0 && `(${openItemCount})`}
            </LinkButton>
            <LinkButton href="/home/household" variant="ghost" size="sm">
              Household
            </LinkButton>
          </div>
        }
      />

      {/* Collections strip */}
      {statuses.length > 0 && (
        <div className="flex flex-col gap-2">
          {statuses.map((s) => (
            <div
              key={s.type}
              className="card-enter flex items-center gap-3 rounded-card border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm"
            >
              <span aria-hidden>🗑</span>
              <span className="flex-1 font-medium">{s.label}</span>
              <span className="tabular text-xs text-text-dim">{s.date.slice(5)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <Card className="border-bad/30">
          <CardTitle>Overdue · {overdue.length}</CardTitle>
          <ChoreList chores={overdue} />
        </Card>
      )}

      {/* Today's chores */}
      <Card className="card-enter">
        <CardTitle>Today&rsquo;s chores</CardTitle>
        <ChoreList chores={dueToday} />
      </Card>

      {/* Glance row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="This week" value={stats.completedThisWeek} sub="chores completed" />
        <Stat
          label="30-day rate"
          value={stats.completionRatePercent !== null ? `${stats.completionRatePercent}%` : "—"}
          sub="of expected chores done"
        />
        <Stat label="Most active" value={mostActive?.name ?? "—"} sub="completions (90d)" />
        <Stat
          label="Shopping"
          value={openItemCount}
          sub={`items across ${lists.length} list${lists.length === 1 ? "" : "s"}`}
        />
      </div>

      {/* Add a chore */}
      <Card>
        <CardTitle>Add a chore</CardTitle>
        <form action={addChore} className="flex flex-wrap items-end gap-2">
          <Input
            name="title"
            aria-label="Chore title"
            placeholder="e.g. Vacuum living room"
            autoComplete="off"
            containerClassName="min-w-[160px] flex-1"
          />
          <Select name="cadence" aria-label="Cadence" defaultValue="weekly" containerClassName="w-32">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="one_time">One-time</option>
          </Select>
          <Select name="category" aria-label="Category" defaultValue="other" containerClassName="w-32">
            {CHORE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select name="assigned_member_id" aria-label="Assignee" defaultValue="" containerClassName="w-32">
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <label className="flex h-11 items-center gap-1.5 text-xs text-text-dim">
            <input type="checkbox" name="rotate" className="accent-[var(--accent)]" /> rotate
          </label>
          <Button type="submit">Add</Button>
        </form>
      </Card>

      {/* Upcoming + activity — parallel lists, side by side on desktop */}
      <div className="grid gap-4 lg:grid-cols-2">
      {upcoming.length > 0 && (
        <Card>
          <CardTitle>Next 7 days</CardTitle>
          <ul className="flex flex-col gap-2">
            {upcoming.slice(0, 8).map((u, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="tabular w-16 shrink-0 text-xs text-text-dim">{u.date.slice(5)}</span>
                <span>{u.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Activity */}
      {recentActivity.length > 0 && (
        <Card>
          <CardTitle>Recent activity</CardTitle>
          <ul className="flex flex-col gap-2">
            {recentActivity.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 text-sm">
                {a.member ? (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: a.member.color }}
                  >
                    {a.member.initial}
                  </span>
                ) : (
                  <span className="w-5 text-center">✓</span>
                )}
                <span className="min-w-0 flex-1 truncate">
                  {a.member?.name ?? "Someone"} completed {a.chore}
                </span>
                <span className="tabular shrink-0 text-xs text-text-dim">{a.date.slice(5)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      </div>
    </div>
  );
}
