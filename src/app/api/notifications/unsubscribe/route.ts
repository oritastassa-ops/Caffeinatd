import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { parseUnsubscribe } from "@/lib/notifications/unsubscribe";
import { PreferenceRow, resolvePreference } from "@/lib/notifications/preferences";
import { NotificationKind } from "@/lib/notifications/types";

/**
 * One-click unsubscribe reached straight from an email — no session. The signed
 * token IS the authorization, so we use the service client and write only the
 * (user, kind) the token proves. Removing `email` from that kind's channels is
 * deliberately granular: the user still gets other kinds and other channels.
 */
async function turnOffEmail(userId: string, kind: NotificationKind): Promise<boolean> {
  const supabase = getServiceClient();
  const { data: rows, error: readErr } = await supabase
    .from("notification_preferences")
    .select("kind, enabled, channels, quiet_hours_start, quiet_hours_end, digest")
    .eq("user_id", userId);
  if (readErr) return false;

  const pref = resolvePreference(kind, (rows ?? []) as PreferenceRow[]);
  const channels = pref.channels.filter((c) => c !== "email");

  const { error: writeErr } = await supabase.from("notification_preferences").upsert(
    {
      user_id: userId,
      kind,
      enabled: pref.enabled,
      channels,
      quiet_hours_start: pref.quietHoursStart,
      quiet_hours_end: pref.quietHoursEnd,
      digest: pref.digest,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,kind" },
  );
  return !writeErr;
}

function page(body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:440px;margin:15vh auto;padding:0 24px;color:#1a1a1a;">` +
      `${body}</div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Browser click on the emailed link. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const claim = token ? parseUnsubscribe(token) : null;
  if (!claim) return page("<h2>That link isn't valid.</h2><p>The unsubscribe link may be malformed or out of date.</p>", 400);

  const ok = await turnOffEmail(claim.userId, claim.kind);
  if (!ok) return page("<h2>Something went wrong.</h2><p>We couldn't update your preferences. Please try again.</p>", 500);

  const label = claim.kind.replace(/_/g, " ");
  return page(
    `<h2>You're unsubscribed.</h2><p>You'll no longer get <strong>${label}</strong> emails. You can turn them back on anytime in Settings.</p>`,
  );
}

/** RFC 8058 one-click POST (Gmail/Apple do this without opening the browser). */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const claim = token ? parseUnsubscribe(token) : null;
  if (!claim) return NextResponse.json({ error: "invalid token" }, { status: 400 });

  const ok = await turnOffEmail(claim.userId, claim.kind);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "failed" }, { status: 500 });
}
