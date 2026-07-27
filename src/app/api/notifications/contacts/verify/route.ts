import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { confirmVerification } from "@/lib/notifications/verification";

const bodySchema = z.object({
  contactId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

/** Confirm a verification code. On success the contact becomes deliverable. */
export async function POST(req: NextRequest) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  const result = await confirmVerification(
    userCtx.supabase,
    userCtx.user.id,
    parsed.data.contactId,
    parsed.data.code,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
