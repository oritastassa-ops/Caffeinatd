import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/server";

/** Supabase magic-link landing: exchanges the code for a session cookie. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await getSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", process.env.APP_URL));
}
