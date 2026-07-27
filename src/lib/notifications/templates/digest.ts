import { z } from "zod";
import { EmailTemplate, RenderedEmail } from "./types";
import { bulletList, escapeHtml, renderLayout, textUnsubscribe } from "./layout";
import { NotificationKind } from "../types";

/**
 * Generic digest: one email listing every coalesced item for a (user, kind, day).
 * Used when a kind has digest batching on, so five insights become one message
 * instead of five. Item lines are the short summaries the enqueuer supplied.
 */
const schema = z.object({
  digest: z.literal(true),
  items: z.array(z.object({ line: z.string(), at: z.string().optional() })).min(1),
});

const KIND_HEADINGS: Record<NotificationKind, { heading: string; label: string }> = {
  daily_plan: { heading: "Your day", label: "daily plan" },
  reminder: { heading: "Your reminders", label: "reminder" },
  insight: { heading: "A few things worth knowing", label: "insight" },
  finance_review: { heading: "Your finances", label: "finance review" },
  fitness_nudge: { heading: "Training nudges", label: "fitness nudge" },
  system: { heading: "Updates", label: "system" },
};

export function makeDigestTemplate(kind: NotificationKind): EmailTemplate {
  const { heading, label } = KIND_HEADINGS[kind];
  return (payload, ctx): RenderedEmail => {
    const { items } = schema.parse(payload);
    const lines = items.map((i) => i.line);
    const subject = `${heading} — ${items.length} update${items.length > 1 ? "s" : ""}`;

    const text = `${heading}\n\n${lines.map((l) => `  • ${l}`).join("\n")}${textUnsubscribe(ctx.unsubscribeUrl, label)}`;

    const contentHtml =
      `<p style="margin:0 0 6px 0;font-size:15px;color:#6b7280;">${escapeHtml(`${items.length} update${items.length > 1 ? "s" : ""} today.`)}</p>` +
      bulletList(lines);

    const html = renderLayout({
      preheader: lines[0] ?? heading,
      heading,
      contentHtml,
      unsubscribeUrl: ctx.unsubscribeUrl,
      unsubscribeLabel: label,
    });

    return { subject, text, html };
  };
}
