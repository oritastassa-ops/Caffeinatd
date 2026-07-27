import { NotificationKind } from "../types";
import { EmailTemplate, RenderedEmail, TemplateContext } from "./types";
import { renderDailyPlan } from "./daily-plan";
import { renderReminder } from "./reminder";
import { renderFinanceReview } from "./finance-review";

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
  const template = TEMPLATES[kind];
  return template ? template(payload, ctx) : null;
}
