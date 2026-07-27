import { NotificationChannelName, NotificationKind } from "./types";

/**
 * Pure derivation for the preferences matrix (kind × channel). The UI shows a
 * toggle per cell; a cell whose channel can't actually deliver is DISABLED with
 * a reason, never silently hidden — a disabled control that explains itself
 * teaches the system, an absent one confuses. This is the logic behind that.
 */

export interface CellState {
  /** Is the toggle currently on for this (kind, channel)? */
  checked: boolean;
  /** Can the user interact with it (channel configured AND has a verified contact)? */
  usable: boolean;
  /** Why it's disabled, for the hover title. Null when usable. */
  reason: string | null;
}

function channelLabel(channel: NotificationChannelName): string {
  return channel === "email" ? "email" : "phone";
}

export function deriveCellState(
  kind: NotificationKind,
  channel: NotificationChannelName,
  enabledChannels: readonly string[],
  configuredChannels: ReadonlySet<NotificationChannelName>,
  verifiedChannels: ReadonlySet<NotificationChannelName>,
): CellState {
  const checked = enabledChannels.includes(channel);
  if (!configuredChannels.has(channel)) {
    return { checked, usable: false, reason: `${channel === "sms" ? "SMS" : "Email"} isn't set up on this server` };
  }
  if (!verifiedChannels.has(channel)) {
    return { checked, usable: false, reason: `Add and verify a ${channelLabel(channel)} first` };
  }
  return { checked, usable: true, reason: null };
}

/**
 * Test-send rate limit: a small pure predicate so the endpoint's guard is
 * unit-tested. Blocks once `recentCount` reaches the cap in the window.
 */
export const TEST_SEND_WINDOW_MS = 10 * 60_000;
export const TEST_SEND_MAX = 5;

export function testSendBlocked(recentCount: number, max: number = TEST_SEND_MAX): boolean {
  return recentCount >= max;
}
