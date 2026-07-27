import { z } from "zod";
import { EmailTemplate, RenderedEmail } from "./types";
import { escapeHtml, renderLayout, textUnsubscribe } from "./layout";

const schema = z.object({
  message: z.string().min(1),
  /** ISO timestamp the reminder was due, if any. */
  remindAt: z.string().optional(),
});

const UNSUB_LABEL = "reminder";

export const renderReminder: EmailTemplate = (payload, ctx): RenderedEmail => {
  const { message, remindAt } = schema.parse(payload);
  const subject = `Reminder: ${message.length > 60 ? `${message.slice(0, 57)}…` : message}`;
  const when = remindAt ? new Date(remindAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";

  const text =
    `${message}` +
    (when ? `\n\n(Due ${when})` : "") +
    textUnsubscribe(ctx.unsubscribeUrl, UNSUB_LABEL);

  const contentHtml =
    `<p style="margin:0;font-size:16px;line-height:1.5;color:#1a1a1a;">${escapeHtml(message)}</p>` +
    (when
      ? `<p style="margin:12px 0 0 0;font-size:13px;color:#6b7280;">Due ${escapeHtml(when)}</p>`
      : "");

  const html = renderLayout({
    preheader: message,
    heading: "Reminder",
    contentHtml,
    unsubscribeUrl: ctx.unsubscribeUrl,
    unsubscribeLabel: UNSUB_LABEL,
  });

  return { subject, text, html };
};
