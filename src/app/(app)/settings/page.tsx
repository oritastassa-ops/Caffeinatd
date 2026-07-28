import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Button, Card, CardTitle, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { HevyConnectButton } from "@/components/hevy-connect-modal";
import { IntegrationControls } from "@/components/integration-controls";
import { relativeTime } from "@/lib/utils";
import { PROGRAMS } from "@/lib/fitness/programs";
import { PersonalityPicker } from "@/components/personality-picker";
import { disconnectCalendar, signOut, updateProfile } from "./actions";

export const dynamic = "force-dynamic";

const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Jerusalem",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const { data: token } = await supabase
    .from("google_tokens")
    .select("user_id")
    .maybeSingle();
  const { data: hevy } = await supabase
    .from("fitness_integrations")
    .select("status, provider_username, last_synced_at, last_sync_error")
    .eq("provider", "hevy")
    .maybeSingle();
  const { calendar } = await searchParams;

  const provider = process.env.AI_PROVIDER ?? "gemini";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />

      <Card>
        <CardTitle>Profile & goals</CardTitle>
        <form action={updateProfile} className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" name="display_name" defaultValue={profile.display_name} />
          <Select label="Timezone" name="timezone" defaultValue={profile.timezone}>
            {[profile.timezone, ...COMMON_TIMEZONES.filter((t) => t !== profile.timezone)].map(
              (tzOption) => (
                <option key={tzOption} value={tzOption}>
                  {tzOption}
                </option>
              ),
            )}
          </Select>
          <Input
            label="Calorie goal (kcal/day)"
            name="calorieGoal"
            type="number"
            defaultValue={profile.settings.calorieGoal ?? ""}
          />
          <Input
            label="Protein goal (g/day)"
            name="proteinGoal"
            type="number"
            defaultValue={profile.settings.proteinGoal ?? ""}
          />
          <Input
            label="Sleep target (hours)"
            name="sleepHours"
            type="number"
            step="0.5"
            defaultValue={profile.settings.sleepHours ?? 8}
          />
          <Input
            label="Wind-down (minutes)"
            name="windDownMinutes"
            type="number"
            defaultValue={profile.settings.windDownMinutes ?? 30}
          />
          <Input
            label="Workouts per week (target)"
            name="weeklyWorkoutTarget"
            type="number"
            defaultValue={profile.settings.weeklyWorkoutTarget ?? 3}
          />
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-medium text-text-dim">AI personality</p>
            <PersonalityPicker defaultValue={profile.settings.communicationStyle ?? "supportive"} />
          </div>
          <Select label="Weight unit" name="weightUnit" defaultValue={profile.settings.weightUnit ?? "kg"}>
            <option value="kg">Kilograms (kg)</option>
            <option value="lbs">Pounds (lbs)</option>
          </Select>
          <Select
            label="Training split"
            name="trainingProgramId"
            defaultValue={profile.settings.trainingProgramId ?? ""}
          >
            <option value="">None</option>
            {PROGRAMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="custom">Custom</option>
          </Select>
          <div className="sm:col-span-2">
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Notifications</CardTitle>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-text-dim">
            Manage contacts, choose channels per notification, quiet hours, and send a test message.
          </p>
          <LinkButton href="/settings/notifications" variant="secondary" size="sm" className="shrink-0">
            Manage
          </LinkButton>
        </div>
      </Card>

      <Card>
        <CardTitle>Google Calendar</CardTitle>
        {calendar && calendar !== "connected" && (
          <p className="mb-3 text-sm text-bad">Connection didn’t complete ({calendar}). Try again.</p>
        )}
        {token ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">
              <span className="text-good">●</span> Connected
            </p>
            <form action={disconnectCalendar}>
              <Button type="submit" variant="danger" size="sm">
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <LinkButton href="/api/google/auth">Connect Google Calendar</LinkButton>
        )}
      </Card>

      <Card>
        <CardTitle>Fitness integrations</CardTitle>
        <div className="flex items-center justify-between rounded-card border bg-surface-2 p-3">
          <div>
            <p className="text-sm font-medium">Hevy</p>
            {hevy ? (
              <div className="mt-1 flex flex-col gap-0.5 text-xs text-text-dim">
                <p>
                  Status:{" "}
                  {hevy.status === "connected" ? (
                    <span className="text-good">✓ Connected</span>
                  ) : (
                    <span className="text-bad">Error — {hevy.last_sync_error ?? "sync failed"}</span>
                  )}
                </p>
                {hevy.provider_username && <p>Username: {hevy.provider_username}</p>}
                <p>Last sync: {hevy.last_synced_at ? relativeTime(hevy.last_synced_at) : "never"}</p>
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-text-dim">Import workouts automatically — no manual logging.</p>
            )}
          </div>
          {hevy ? <IntegrationControls provider="hevy" /> : <HevyConnectButton label="Connect" />}
        </div>
        <p className="mt-2 text-xs text-text-dim">More integrations (Apple Health, Garmin, Strava) coming later.</p>
      </Card>

      <Card>
        <CardTitle>AI provider</CardTitle>
        <p className="text-sm">
          Active: <span className="font-medium capitalize">{provider}</span>
        </p>
        <p className="mt-1 text-xs text-text-dim">
          Switch by changing <code>AI_PROVIDER</code> in the deployment’s environment variables.
        </p>
      </Card>

      <Card>
        <CardTitle>Your data</CardTitle>
        <div className="flex items-center gap-4">
          <a href="/api/export" className="text-sm text-accent hover:underline">
            Export everything (JSON)
          </a>
          <form action={signOut}>
            <Button type="submit" variant="danger" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
