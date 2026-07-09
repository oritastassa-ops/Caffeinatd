import crypto from "node:crypto";

/** HMAC-signed OAuth state: binds the callback to the initiating user. */
export function signState(userId: string): string {
  const sig = crypto
    .createHmac("sha256", process.env.CRON_SECRET ?? "state-secret")
    .update(userId)
    .digest("hex")
    .slice(0, 16);
  return `${userId}.${sig}`;
}

export function verifyState(state: string): string | null {
  const [userId, sig] = state.split(".");
  if (!userId || !sig) return null;
  return signState(userId) === state ? userId : null;
}
