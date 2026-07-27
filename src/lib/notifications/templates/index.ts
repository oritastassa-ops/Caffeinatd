import { NotificationKind } from "../types";
import { EmailTemplate, RenderedEmail, TemplateContext } from "./types";
import { renderDailyPlan } from "./daily-plan";
import { renderReminder } from "./reminder";
import { renderFinanceReview } from "./finance-review";
import { makeDigestTemplate } from "./digest";
import { makeNoticeTemplate } from "./notice";

export type { RenderedEmail, TemplateContext } from "./types";
export { renderVerificationCode } from "./verification-code";

/**
 * Kind → email template. Not every kind is queued to email (verification is sent
 * inline; insight/fitness_nudge/system have no email template yet), so a missing
 * entry is expected — the worker treats "no template" as a non-retryable failure
 * rather than silently sending nothing.
 */
const TEMPLATES: Partial<Record<NotificationKind, EmailTemplate>> = {
  daily_plan: renderDailyPlan,
  reminder: renderReminder,
  finance_review: renderFinanceReview,
  insight: makeNoticeTemplate("Something worth knowing", "insight"),
  fitness_nudge: makeNoticeTemplate("Training nudge", "fitness nudge"),
  system: makeNoticeTemplate("Message from Caffeinatd", "message"),
};

export function hasEmailTemplate(kind: NotificationKind): boolean {
  return kind in TEMPLATES;
}

/** Render the email for a kind, or null when the kind has no email template. */
export function renderEmail(
  kind: NotificationKind,
  payload: unknown,
  ctx: TemplateContext,
): RenderedEmail | null {
  // A digest payload ({ digest: true, items }) is rendered by the generic digest
  // template regardless of kind — it coalesces many events into one message.
  if (payload && typeof payload === "object" && (payload as { digest?: unknown }).digest === true) {
    return makeDigestTemplate(kind)(payload, ctx);
  }
  const template = TEMPLATES[kind];
  return template ? template(payload, ctx) : null;
}
