import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Button, Card, CardTitle, Input, PageHeader, Select } from "@/components/ui";
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Household" back={{ href: "/home", label: "Home" }} />

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
        <form action={addMember} className="mt-3 flex items-end gap-2">
          <Input
            name="name"
            aria-label="Person's name"
            placeholder="Add a person (no account needed)"
            autoComplete="off"
            containerClassName="min-w-0 flex-1"
          />
          <Select name="color" aria-label="Color" defaultValue={MEMBER_COLORS[1]} containerClassName="w-28">
            {MEMBER_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Button type="submit">Add</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Garbage &amp; recycling</CardTitle>
        <CollectionsList schedules={data.collections} today={today} />
        <form action={upsertCollectionSchedule} className="mt-3 flex flex-wrap items-end gap-2">
          <Select name="type" aria-label="Collection type" defaultValue="garbage" containerClassName="w-40">
            {COLLECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {collectionLabel(t)}
              </option>
            ))}
          </Select>
          <Select name="day_of_week" aria-label="Day of week" defaultValue="2" containerClassName="w-36">
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
          <Select name="frequency" aria-label="Frequency" defaultValue="weekly" containerClassName="w-32">
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </Select>
          <Button type="submit">Save</Button>
        </form>
        <p className="mt-2 text-xs text-text-dim">
          Biweekly and monthly schedules anchor to the week you save them — save during an
          &ldquo;on&rdquo; week.
        </p>
      </Card>
    </div>
  );
}
