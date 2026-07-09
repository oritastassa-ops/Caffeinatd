import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { testHevyConnection, syncHevyWorkouts } from "@/lib/integrations/hevy";
import { encryptSecret } from "@/lib/integrations/crypto";

const bodySchema = z.object({ apiKey: z.string().min(1) });

/** Validates once more server-side (never trust a client-reported "it worked"), then stores + syncs. */
export async function POST(req: NextRequest) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an API key." }, { status: 400 });
  }

  const test = await testHevyConnection(parsed.data.apiKey);
  if (!test.ok) {
    return NextResponse.json({ error: test.error ?? "Couldn't connect to Hevy." }, { status: 400 });
  }

  const encrypted = encryptSecret(parsed.data.apiKey);
  const { error } = await userCtx.supabase.from("fitness_integrations").upsert(
    {
      user_id: userCtx.user.id,
      provider: "hevy",
      encrypted_api_key: encrypted,
      status: "connected",
      provider_user_id: test.providerUserId ?? null,
      provider_username: test.username ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) {
    return NextResponse.json({ error: "Failed to save the connection." }, { status: 500 });
  }

  const sync = await syncHevyWorkouts(userCtx.supabase, userCtx.user.id);
  return NextResponse.json({ ok: true, username: test.username, sync });
}
