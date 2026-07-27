import { LoggingChannel } from "./channels/logging";
import { ResendChannel } from "./channels/email";
import { TwilioChannel } from "./channels/sms";
import { NotificationChannel, NotificationChannelName } from "./types";

/**
 * Channel name → live implementation, built from env exactly the way
 * createProvider() builds AIProviders. A channel with no configured credentials
 * is simply absent from the map — callers check presence (getChannel !== null)
 * rather than catching construction errors. Phase 3 adds one `sms` entry;
 * nothing else in this file changes.
 *
 * NOTIFICATIONS_DRIVER is the single dev/prod switch:
 *   - `logging` (default): both channels → LoggingChannel (zero-cost, no vendor).
 *   - `live`: assemble real channels from vendor creds; a channel whose creds
 *     are missing is absent, so callers degrade instead of crashing.
 */
export interface NotificationEnv {
  NOTIFICATIONS_DRIVER?: string;
  RESEND_API_KEY?: string;
  NOTIFICATIONS_FROM_EMAIL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
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

  const registry: Partial<Record<NotificationChannelName, NotificationChannel>> = {};
  if (env.RESEND_API_KEY && env.NOTIFICATIONS_FROM_EMAIL) {
    registry.email = new ResendChannel(env.RESEND_API_KEY, env.NOTIFICATIONS_FROM_EMAIL);
  }
  // SMS needs the account creds plus a sender (a Messaging Service SID, preferred,
  // or a bare From number). Missing either → the channel stays unregistered.
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_MESSAGING_SERVICE_SID || env.TWILIO_FROM_NUMBER)) {
    registry.sms = new TwilioChannel({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from: env.TWILIO_FROM_NUMBER,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    });
  }
  return registry;
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
