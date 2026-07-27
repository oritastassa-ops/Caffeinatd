import { NotificationKind } from "../types";

/** What every template returns. `text` is first-class, never a fallback. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Ambient context the worker supplies (not part of the enqueued payload). */
export interface TemplateContext {
  /** Signed, per-(user,kind) link that turns this notification's emails off. */
  unsubscribeUrl: string;
}

/** A template renders a stored `payload` (jsonb) plus context into an email. */
export type EmailTemplate = (payload: unknown, ctx: TemplateContext) => RenderedEmail;

/** Kinds that have an email template. Others fail loudly in the worker. */
export type TemplatedKind = Extract<
  NotificationKind,
  "daily_plan" | "reminder" | "finance_review"
>;
