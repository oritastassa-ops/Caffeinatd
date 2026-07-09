import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { Card, CardTitle } from "@/components/ui";
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
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardTitle>Profile & goals</CardTitle>
        <form action={updateProfile} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input name="display_name" defaultValue={profile.display_name} className={inputCls} />
          </Field>
          <Field label="Timezone">
            <select name="timezone" defaultValue={profile.timezone} className={inputCls}>
              {[profile.timezone, ...COMMON_TIMEZONES.filter((t) => t !== profile.timezone)].map(
                (tzOption) => (
                  <option key={tzOption} value={tzOption}>
                    {tzOption}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Calorie goal (kcal/day)">
            <input name="calorieGoal" type="number" defaultValue={profile.settings.calorieGoal ?? ""} className={inputCls} />
          </Field>
          <Field label="Protein goal (g/day)">
            <input name="proteinGoal" type="number" defaultValue={profile.settings.proteinGoal ?? ""} className={inputCls} />
          </Field>
          <Field label="Sleep target (hours)">
            <input name="sleepHours" type="number" step="0.5" defaultValue={profile.settings.sleepHours ?? 8} className={inputCls} />
          </Field>
          <Field label="Wind-down (minutes)">
            <input name="windDownMinutes" type="number" defaultValue={profile.settings.windDownMinutes ?? 30} className={inputCls} />
          </Field>
          <Field label="Workouts per week (target)">
            <input name="weeklyWorkoutTarget" type="number" defaultValue={profile.settings.weeklyWorkoutTarget ?? 3} className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-medium text-text-dim">AI personality</p>
            <PersonalityPicker defaultValue={profile.settings.communicationStyle ?? "supportive"} />
          </div>
          <Field label="Weight unit">
            <select name="weightUnit" defaultValue={profile.settings.weightUnit ?? "kg"} className={inputCls}>
              <option value="kg">Kilograms (kg)</option>
              <option value="lbs">Pounds (lbs)</option>
            </select>
          </Field>
          <Field label="Training split">
            <select name="trainingProgramId" defaultValue={profile.settings.trainingProgramId ?? ""} className={inputCls}>
              <option value="">None</option>
              {PROGRAMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <button className="transition-fast rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
              Save
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Google Calendar</CardTitle>
        {calendar && calendar !== "connected" && (
          <p className="mb-3 text-sm text-bad">Connection didn’t complete ({calendar}). Try again.</p>
        )}
        {token ? (
          <div className="flex items-center justify-between">
            <p className="text-sm">
              <span className="text-good">●</span> Connected
            </p>
            <form action={disconnectCalendar}>
              <button className="text-sm text-bad hover:underline">Disconnect</button>
            </form>
          </div>
        ) : (
          <Link
            href="/api/google/auth"
            className="transition-fast inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Connect Google Calendar
          </Link>
        )}
      </Card>

      <Card>
        <CardTitle>Fitness integrations</CardTitle>
        <div className="flex items-center justify-between rounded-xl border bg-surface-2 p-3">
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
            <button className="text-sm text-text-dim hover:text-bad hover:underline">Sign out</button>
          </form>
        </div>
      </Card>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-dim">{label}</span>
      {children}
    </label>
  );
}
