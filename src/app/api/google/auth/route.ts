import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { googleAuthUrl } from "@/lib/google/oauth";
import { signState } from "@/lib/google/state";

/** Kicks off the Google OAuth consent flow. State is an HMAC of the user id. */
export async function GET() {
  let userCtx;
  try {
    userCtx = await requireUser();
  } catch {
    return NextResponse.redirect(`${process.env.APP_URL}/login`);
  }
  return NextResponse.redirect(googleAuthUrl(signState(userCtx.user.id)));
}
