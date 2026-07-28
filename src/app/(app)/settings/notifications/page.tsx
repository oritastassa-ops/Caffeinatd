import { requireUser } from "@/lib/supabase/server";
import { loadProfile } from "@/lib/pipeline/run";
import { PageHeader } from "@/components/ui";
import { loadNotificationSettings } from "@/lib/notifications/settings-data";
import { ContactsSection } from "@/components/notifications/contacts-section";
import { PreferenceMatrix } from "@/components/notifications/preference-matrix";
import { TestSend } from "@/components/notifications/test-send";
import { DeliveryLog } from "@/components/notifications/delivery-log";
import { NotificationChannelName } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const { supabase, user } = await requireUser();
  const profile = await loadProfile(supabase, user.id);
  const data = await loadNotificationSettings(supabase, user.id);

  // A channel is testable when it's both configured on the server and verified.
  const testable = data.configuredChannels.filter((c) =>
    data.verifiedChannels.includes(c),
  ) as NotificationChannelName[];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title="Notifications"
        description="Choose how Caffeinatd reaches you off-app — your daily plan, reminders, and nudges."
        back={{ href: "/settings", label: "Settings" }}
      />

      <div id="contacts" className="scroll-mt-4">
        <ContactsSection contacts={data.contacts} />
      </div>

      <PreferenceMatrix
        preferences={data.preferences}
        configuredChannels={data.configuredChannels}
        verifiedChannels={data.verifiedChannels}
        timezone={profile.timezone}
        smsEditable
      />

      <TestSend testableChannels={testable} />

      <DeliveryLog deliveries={data.deliveries} />
    </div>
  );
}
