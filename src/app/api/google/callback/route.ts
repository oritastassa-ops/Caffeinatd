import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { exchangeCode, saveTokens } from "@/lib/google/oauth";
import { verifyState } from "@/lib/google/state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const settingsUrl = `${process.env.APP_URL}/settings`;

  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}?calendar=denied`);
  }

  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.redirect(`${process.env.APP_URL}/login`);
  }

  // The state must match the signed-in user — prevents token substitution.
  if (verifyState(state) !== userCtx.user.id) {
    return NextResponse.redirect(`${settingsUrl}?calendar=state_mismatch`);
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${settingsUrl}?calendar=no_refresh_token`);
    }
    await saveTokens(userCtx.supabase, userCtx.user.id, tokens);
    return NextResponse.redirect(`${settingsUrl}?calendar=connected`);
  } catch (err) {
    console.error("google callback error:", err);
    return NextResponse.redirect(`${settingsUrl}?calendar=error`);
  }
}
