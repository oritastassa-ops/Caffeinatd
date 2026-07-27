import { z } from "zod";
import { EmailTemplate, RenderedEmail } from "./types";
import { bulletList, escapeHtml, renderLayout, textUnsubscribe } from "./layout";

const schema = z.object({
  name: z.string().optional(),
  weekStart: z.string(),
  summary: z.string().default(""),
  netWorth: z.number().nullable().optional(),
  highlights: z.array(z.string()).default([]),
});

const UNSUB_LABEL = "finance review";

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const renderFinanceReview: EmailTemplate = (payload, ctx): RenderedEmail => {
  const { name, weekStart, summary, netWorth, highlights } = schema.parse(payload);
  const subject = `Your week in money — ${weekStart}`;
  const greeting = name ? `${name}, here's your week` : "Here's your week";
  const netWorthLine =
    typeof netWorth === "number" ? `Net worth: ${formatMoney(netWorth)}` : "";

  const text = [
    summary || greeting,
    netWorthLine,
    highlights.length ? `\nHighlights:\n${highlights.map((h) => `  • ${h}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n") + textUnsubscribe(ctx.unsubscribeUrl, UNSUB_LABEL);

  const contentHtml = [
    summary ? `<p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:#1a1a1a;">${escapeHtml(summary)}</p>` : "",
    netWorthLine
      ? `<p style="margin:12px 0 0 0;font-size:20px;font-weight:700;color:#1a1a1a;">${escapeHtml(formatMoney(netWorth as number))}<span style="font-size:13px;font-weight:400;color:#6b7280;"> net worth</span></p>`
      : "",
    highlights.length
      ? `<p style="margin:14px 0 2px 0;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Highlights</p>${bulletList(highlights)}`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const html = renderLayout({
    preheader: summary || subject,
    heading: greeting,
    contentHtml,
    unsubscribeUrl: ctx.unsubscribeUrl,
    unsubscribeLabel: UNSUB_LABEL,
  });

  return { subject, text, html };
};
