import { NotificationChannelName } from "./types";

/**
 * Destination masking for the delivery log and contact list. A verified address
 * is the user's own, but the log is shoulder-surfable and gets screenshotted into
 * support threads — so we show enough to recognize which contact a row used
 * ("was that my gmail or my work address?") without printing the whole thing.
 * Pure and tested: a masking bug that leaks the full value is the failure mode.
 */

/** `jordan.lee@example.com` → `j••@example.com` — first char + domain, middle hidden. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return `${local[0]}••@${domain}`;
}

/** `+14155550123` → `+1 ••• ••• 0123` — last 4 shown, everything else masked. */
export function maskPhone(address: string): string {
  const digits = address.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  const last4 = digits.slice(-4);
  const cc = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : "+";
  return `${cc}••• ••• ${last4}`;
}

export function maskAddress(channel: NotificationChannelName, address: string): string {
  return channel === "email" ? maskEmail(address) : maskPhone(address);
}
