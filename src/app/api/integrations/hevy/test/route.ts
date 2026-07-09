import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { testHevyConnection } from "@/lib/integrations/hevy";

const bodySchema = z.object({ apiKey: z.string().min(1) });

/** "Test Connection" button — validates the key against the real Hevy API, never stores it. */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Enter an API key." }, { status: 400 });
  }

  const result = await testHevyConnection(parsed.data.apiKey);
  return NextResponse.json(result);
}
