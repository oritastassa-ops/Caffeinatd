import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { normalizeAddress } from "@/lib/notifications/address";
import { startVerification } from "@/lib/notifications/verification";

const bodySchema = z.object({
  channel: z.enum(["email", "sms"]),
  address: z.string().min(1),
  label: z.string().trim().max(60).optional(),
});

/**
 * Add a destination and send it a verification code. The address is normalized
 * and validated here — before any row is written — so we never store a malformed
 * or unverifiable contact. Session-scoped: no service-role client.
 */
export async function POST(req: NextRequest) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a channel and address." }, { status: 400 });
  }

  const normalized = normalizeAddress(parsed.data.channel, parsed.data.address);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const result = await startVerification(
    userCtx.supabase,
    userCtx.user.id,
    parsed.data.channel,
    normalized.address,
    parsed.data.label ?? null,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, contactId: result.contactId });
}
