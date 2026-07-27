import { z } from "zod";
import { EmailTemplate, RenderedEmail } from "./types";
import { escapeHtml, renderLayout, textUnsubscribe } from "./layout";

/**
 * A single short notice — one message, optional supporting reason. Backs the
 * insight and fitness_nudge kinds, which are one-liners the rule engine produced
 * ("You're 25g behind on protein today"). Deliberately generic so a new
 * message-shaped kind needs no new template.
 */
const schema = z.object({
  message: z.string().min(1),
  reason: z.string().optional(),
});

export function makeNoticeTemplate(heading: string, label: string): EmailTemplate {
  return (payload, ctx): RenderedEmail => {
    const { message, reason } = schema.parse(payload);
    const subject = message.length > 70 ? `${message.slice(0, 67)}…` : message;

    const text =
      message + (reason ? `\n\n${reason}` : "") + textUnsubscribe(ctx.unsubscribeUrl, label);

    const contentHtml =
      `<p style="margin:0;font-size:16px;line-height:1.5;color:#1a1a1a;">${escapeHtml(message)}</p>` +
      (reason ? `<p style="margin:12px 0 0 0;font-size:13px;color:#6b7280;">${escapeHtml(reason)}</p>` : "");

    const html = renderLayout({
      preheader: message,
      heading,
      contentHtml,
      unsubscribeUrl: ctx.unsubscribeUrl,
      unsubscribeLabel: label,
    });

    return { subject, text, html };
  };
}
