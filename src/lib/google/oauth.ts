import { SupabaseClient } from "@supabase/supabase-js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// calendar.events: create/edit/delete events (writes go to the primary calendar).
// calendar.readonly: list every calendar the user has and read their events —
// needed to check the whole calendar, not just primary. It also covers
// free/busy queries, so a separate calendar.freebusy scope isn't needed.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

function redirectUri(): string {
  return `${process.env.APP_URL}/api/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance
    state,
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json();
}

/** Returns a valid access token for the user, refreshing if expired. Null if not connected. */
export async function getAccessToken(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!data) return null;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (data.access_token && expiresAt > Date.now() + 60_000) return data.access_token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: data.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null; // revoked → UI shows "reconnect calendar"

  const token = (await res.json()) as TokenResponse;
  await supabase
    .from("google_tokens")
    .update({
      access_token: token.access_token,
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return token.access_token;
}

export async function saveTokens(
  supabase: SupabaseClient,
  userId: string,
  token: TokenResponse,
): Promise<void> {
  const { error } = await supabase.from("google_tokens").upsert({
    user_id: userId,
    refresh_token: token.refresh_token,
    access_token: token.access_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to store Google tokens: ${error.message}`);
}
