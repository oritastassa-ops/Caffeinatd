import { z } from "zod";
import { RenderedEmail } from "./types";
import { escapeHtml } from "./layout";

/**
 * Verification is transactional — no unsubscribe footer, no marketing chrome,
 * and it must render as `text` too because SMS (Phase 3) sends the same code
 * through `body`. Kept standalone (not on the shared layout) precisely so it
 * carries no List-Unsubscribe affordance.
 */
const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresMinutes: z.number().int().positive().default(10),
});

export interface VerificationPayload {
  code: string;
  expiresMinutes?: number;
}

export function renderVerificationCode(payload: VerificationPayload): RenderedEmail {
  const { code, expiresMinutes } = schema.parse(payload);
  const subject = `${code} is your Caffeinatd verification code`;
  const text =
    `Your Caffeinatd verification code is ${code}.\n` +
    `It expires in ${expiresMinutes} minutes. If you didn't request this, ignore this message.`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"></head>
<body style="margin:0;padding:0;background:#f6f6f7;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f6f7;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;">
      <tr><td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <div style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Caffeinatd</div>
        <p style="margin:16px 0 8px 0;font-size:15px;color:#1a1a1a;">Your verification code is</p>
        <div style="font-size:34px;font-weight:700;letter-spacing:0.24em;color:#1a1a1a;font-variant-numeric:tabular-nums;">${escapeHtml(code)}</div>
        <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">It expires in ${expiresMinutes} minutes. If you didn't request this, you can ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}
