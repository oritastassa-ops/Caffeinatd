import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getChannel } from "@/lib/notifications/registry";
import { runWorker } from "@/lib/notifications/worker";

// A batch of 50 sends, each with a 10s provider timeout, fits comfortably under
// 60s even in the pathological all-timeout case because sends within a batch are
// awaited sequentially per row but each row's provider call is bounded. Kept
// deliberate rather than inheriting the platform default, and consistent with
// the batch size below.
export const maxDuration = 60;

const BATCH_SIZE = 50;
const LEASE_MS = 10 * 60_000; // a stranded 'sending' row is reclaimable after 10m
// Global backstop on SMS sends per run — a second line of defense against a
// runaway loop, on top of the per-user caps enforced at enqueue. Overridable so
// a legitimately busy deployment can raise it.
const SMS_MAX_PER_RUN = Number.parseInt(process.env.SMS_MAX_PER_RUN ?? "200", 10);

/**
 * Vercel Cron (every 5 min) — drains the notification queue. Authenticated by
 * CRON_SECRET bearer, exactly as src/app/api/cron/daily-plan/route.ts. Returns a
 * count-only summary; never user content.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runWorker(getServiceClient(), {
    getChannel,
    batchSize: BATCH_SIZE,
    leaseMs: LEASE_MS,
    smsMaxPerRun: Number.isFinite(SMS_MAX_PER_RUN) ? SMS_MAX_PER_RUN : 200,
    appUrl: process.env.APP_URL ?? "",
  });

  return NextResponse.json(summary);
}
