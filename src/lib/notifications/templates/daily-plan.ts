import { z } from "zod";
import { EmailTemplate, RenderedEmail } from "./types";
import { bulletList, escapeHtml, renderLayout, textUnsubscribe } from "./layout";

/**
 * The morning plan email. Payload is the stored DailyPlan (see
 * src/lib/planning/daily.ts) plus the user's display name. Fields are optional-
 * tolerant: an older stored plan missing `home`/`schedule` still renders.
 */
const schema = z.object({
  name: z.string().optional(),
  plan: z.object({
    date: z.string(),
    overview: z.string().default(""),
    priorities: z.array(z.string()).default([]),
    workout: z.string().default(""),
    nutrition: z.string().default(""),
    freeWindows: z.array(z.string()).default([]),
    home: z.string().default(""),
    bedtime: z.string().default(""),
  }),
});

const UNSUB_LABEL = "daily plan";

function section(label: string, value: string): string {
  if (!value) return "";
  return (
    `<p style="margin:14px 0 2px 0;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">${escapeHtml(label)}</p>` +
    `<p style="margin:0;font-size:15px;line-height:1.5;color:#1a1a1a;">${escapeHtml(value)}</p>`
  );
}

export const renderDailyPlan: EmailTemplate = (payload, ctx): RenderedEmail => {
  const { name, plan } = schema.parse(payload);
  const greeting = name ? `Good morning, ${name}` : "Good morning";
  const subject = `Your plan for ${plan.date}`;

  // ── Plain text (watches + text-only clients read this) ──
  const textParts = [
    `${greeting}.`,
    plan.overview,
    plan.priorities.length ? `\nToday's priorities:\n${plan.priorities.map((p) => `  • ${p}`).join("\n")}` : "",
    plan.workout ? `\nWorkout: ${plan.workout}` : "",
    plan.nutrition ? `\nNutrition: ${plan.nutrition}` : "",
    plan.freeWindows.length ? `\nFree windows: ${plan.freeWindows.join(", ")}` : "",
    plan.home ? `\nHome: ${plan.home}` : "",
    plan.bedtime ? `\nBedtime: ${plan.bedtime}` : "",
  ].filter(Boolean);
  const text = textParts.join("\n") + textUnsubscribe(ctx.unsubscribeUrl, UNSUB_LABEL);

  // ── HTML ──
  const priorities = plan.priorities.length
    ? `<p style="margin:14px 0 2px 0;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Today's priorities</p>${bulletList(plan.priorities)}`
    : "";
  const contentHtml = [
    plan.overview
      ? `<p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:#1a1a1a;">${escapeHtml(plan.overview)}</p>`
      : "",
    priorities,
    section("Workout", plan.workout),
    section("Nutrition", plan.nutrition),
    plan.freeWindows.length ? section("Free windows", plan.freeWindows.join(", ")) : "",
    section("Home", plan.home),
    section("Bedtime", plan.bedtime),
  ]
    .filter(Boolean)
    .join("");

  const html = renderLayout({
    preheader: plan.overview || `Your plan for ${plan.date}`,
    heading: greeting,
    contentHtml,
    unsubscribeUrl: ctx.unsubscribeUrl,
    unsubscribeLabel: UNSUB_LABEL,
  });

  return { subject, text, html };
};
