import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Card, CardTitle } from "@/components/ui";
import { fetchHomeData } from "@/lib/home/data";
import { CollectionsList, InviteCode, MembersList } from "@/components/home/household-manage";
import { localDateStr } from "@/lib/utils";
import { COLLECTION_TYPES } from "@/lib/types";
import { collectionLabel } from "@/lib/home/collections";
import { addMember, upsertCollectionSchedule } from "../actions";

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEMBER_COLORS = ["#d97706", "#7c5c3e", "#4a7c59", "#5b6da8", "#a85b7d"];

export default async function HouseholdPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const data = await fetchHomeData(supabase, user.id);
  if (!data) redirect("/home");

  const today = localDateStr(profile.timezone);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Household</h1>
        <Link href="/home" className="text-sm text-text-dim hover:text-text hover:underline">
          ← Home
        </Link>
      </div>

      <Card>
        <CardTitle>Invite your partner</CardTitle>
        <p className="mb-2 text-sm text-text-dim">
          They sign in with their own account, then enter this code on their Home page.
        </p>
        <InviteCode code={data.household.invite_code} />
      </Card>

      <Card>
        <CardTitle>Members · {data.members.length}</CardTitle>
        <MembersList members={data.members} />
        <form action={addMember} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="Add a person (no account needed)"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <select name="color" defaultValue={MEMBER_COLORS[1]} className="rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent">
            {MEMBER_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="transition-fast rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-90">
            Add
          </button>
        </form>
      </Card>

      <Card>
        <CardTitle>Garbage &amp; recycling</CardTitle>
        <CollectionsList schedules={data.collections} today={today} />
        <form action={upsertCollectionSchedule} className="mt-3 flex flex-wrap gap-2">
          <select name="type" defaultValue="garbage" className={selectCls}>
            {COLLECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {collectionLabel(t)}
              </option>
            ))}
          </select>
          <select name="day_of_week" defaultValue="2" className={selectCls}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select name="frequency" defaultValue="weekly" className={selectCls}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button className="transition-fast rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-90">
            Save
          </button>
        </form>
        <p className="mt-2 text-xs text-text-dim">
          Biweekly and monthly schedules anchor to the week you save them — save during an
          &ldquo;on&rdquo; week.
        </p>
      </Card>
    </div>
  );
}

const selectCls = "rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";
