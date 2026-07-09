import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";
import { saveMemory } from "@/lib/memory";

const bodySchema = z.object({
  kind: z.enum(["preference", "habit", "relationship", "routine", "goal", "event"]),
  content: z.string().min(1),
  importance: z.number().int().min(1).max(5).optional(),
});

/** The "Remember" button's target — saves a suggest_memory candidate the user approved. */
export async function POST(req: NextRequest) {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid memory" }, { status: 400 });
  }

  try {
    const { id } = await saveMemory(
      userCtx.supabase,
      getProvider(),
      userCtx.user.id,
      parsed.data.kind,
      parsed.data.content,
      parsed.data.importance ?? 3,
    );
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save" },
      { status: 500 },
    );
  }
}
