import { LoggingChannel } from "./channels/logging";
import { NotificationChannel, NotificationChannelName } from "./types";

/**
 * Channel name → live implementation, built from env exactly the way
 * createProvider() builds AIProviders. A channel with no configured credentials
 * is simply absent from the map — callers check presence (getChannel !== null)
 * rather than catching construction errors. Phase 2 adds one `email` entry and
 * Phase 3 one `sms` entry; nothing else in this file changes.
 */
export interface NotificationEnv {
  /** `logging` (default) routes every channel to LoggingChannel. */
  NOTIFICATIONS_DRIVER?: string;
  // Phase 2/3 read their own vendor keys here (RESEND_API_KEY, TWILIO_*).
}

function buildRegistry(
  env: NotificationEnv,
): Partial<Record<NotificationChannelName, NotificationChannel>> {
  const driver = (env.NOTIFICATIONS_DRIVER ?? "logging").toLowerCase();

  if (driver === "logging") {
    // Both channel names resolve to a logging stub so the full path is testable
    // without a vendor. Each gets the right normalizer via its channel name.
    return { email: new LoggingChannel("email"), sms: new LoggingChannel("sms") };
  }

  // Phase 2/3 populate `email`/`sms` from their vendor env here. Until then a
  // non-logging driver yields an empty registry — callers degrade, not crash.
  return {};
}

let cached: Partial<Record<NotificationChannelName, NotificationChannel>> | null = null;

function registry(): Partial<Record<NotificationChannelName, NotificationChannel>> {
  if (!cached) cached = buildRegistry(process.env as NotificationEnv);
  return cached;
}

/** The live channel for `name`, or null when it isn't configured. */
export function getChannel(name: NotificationChannelName): NotificationChannel | null {
  return registry()[name] ?? null;
}

/** Channel names that can actually send right now. */
export function availableChannels(): NotificationChannelName[] {
  return Object.keys(registry()) as NotificationChannelName[];
}

/** Test seam: rebuild the registry from an explicit env (bypasses the cache). */
export function buildChannelRegistry(
  env: NotificationEnv,
): Partial<Record<NotificationChannelName, NotificationChannel>> {
  return buildRegistry(env);
}
