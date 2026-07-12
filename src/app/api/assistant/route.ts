import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";
import { ProviderError } from "@/lib/ai/types";
import { loadProfile, runAssistant } from "@/lib/pipeline/run";
import { recordExchange } from "@/lib/conversations";

// Room to ride out one Gemini free-tier rate-limit wait (see withRetry).
export const maxDuration = 60;

const bodySchema = z.object({ message: z.string().min(1).max(2000) });

export async function POST(req: NextRequest) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const profile = await loadProfile(userCtx.supabase, userCtx.user.id);
    const response = await runAssistant(
      userCtx.supabase,
      getProvider(),
      profile,
      parsed.data.message,
    );
    // Persisting the exchange (for Recent Conversations + search) shouldn't
    // hold up the reply — it runs after the response is sent.
    const { supabase, user } = userCtx;
    after(() => recordExchange(supabase, user.id, parsed.data.message, response.text));
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof ProviderError && err.status === 429) {
      // Log the raw provider body — it names the specific quota metric
      // (RPM vs RPD vs a project-level cap), which a generic "429" doesn't.
      console.error("assistant 429:", err.message);
      const wait = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : 30;
      return NextResponse.json(
        {
          error: `Gemini's free-tier rate limit was hit — wait about ${wait}s before trying again. This is quota, not a bug; it resets automatically.`,
        },
        { status: 429 },
      );
    }
    console.error("assistant error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 500 },
    );
  }
}
