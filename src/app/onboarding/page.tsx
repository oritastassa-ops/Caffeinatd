import { requireUser } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { LogoMark } from "@/components/logo";

export default async function OnboardingPage() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("profiles").select("display_name, timezone").eq("id", user.id).single();
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="h-10 w-10 text-bean" uid="onboarding" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Let&apos;s get to know each other</h1>
          <p className="mt-1 text-sm text-text-dim">
            A few quick questions so I already understand your life before you ask me anything.
          </p>
        </div>
        <OnboardingWizard defaultName={data?.display_name ?? ""} defaultTimezone={data?.timezone || browserTz} />
      </div>
    </main>
  );
}
