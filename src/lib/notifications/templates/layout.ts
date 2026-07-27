/**
 * Shared email chrome. Email HTML is not web HTML: no flexbox/grid, no external
 * CSS, no <link>. Layout is a single centered table, ~600px, every style inline;
 * a <style> block is used ONLY for prefers-color-scheme, as progressive
 * enhancement that degrades to the inline light-mode values. Restrained and
 * typographic, not a marketing blast.
 */

const BRAND = "Caffeinatd";
const MAX_WIDTH = 600;

// Light-mode values live inline (the reliable path); the <style> block only
// nudges dark-mode clients that honor prefers-color-scheme.
const INK = "#1a1a1a";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const BG = "#f6f6f7";
const CARD = "#ffffff";

/** Escape text destined for an HTML context. Every payload string goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A bulleted list as inline-styled rows; empty input renders nothing. */
export function bulletList(items: string[]): string {
  if (items.length === 0) return "";
  const rows = items
    .map(
      (item) =>
        `<tr><td style="padding:2px 0;color:${INK};font-size:15px;line-height:1.5;">` +
        `&bull;&nbsp;&nbsp;${escapeHtml(item)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>`;
}

export interface LayoutInput {
  /** Hidden preview text shown in the inbox list before the body. */
  preheader: string;
  heading: string;
  /** Pre-escaped HTML for the body (callers build it with escapeHtml/bulletList). */
  contentHtml: string;
  unsubscribeUrl: string;
  /** e.g. "daily plan" — used in the unsubscribe footer copy. */
  unsubscribeLabel: string;
}

export function renderLayout(input: LayoutInput): string {
  const { preheader, heading, contentHtml, unsubscribeUrl, unsubscribeLabel } = input;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<style>
  @media (prefers-color-scheme: dark) {
    .bg { background:#0b0b0c !important; }
    .card { background:#161618 !important; }
    .ink { color:#f4f4f5 !important; }
    .muted { color:#9ca3af !important; }
    .divider { border-color:#26262a !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" class="bg" cellpadding="0" cellspacing="0" width="100%" style="background:${BG};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" class="card" cellpadding="0" cellspacing="0" width="100%" style="max-width:${MAX_WIDTH}px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;">
        <tr>
          <td style="padding:28px 32px 8px 32px;">
            <div class="muted" style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${BRAND}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:4px 32px 0 32px;">
            <h1 class="ink" style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:${INK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(heading)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            ${contentHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px 32px;">
            <hr class="divider" style="border:none;border-top:1px solid ${BORDER};margin:0 0 16px 0;">
            <p class="muted" style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              You're receiving this because ${escapeHtml(unsubscribeLabel)} notifications are on.
              <a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">Turn these off</a>.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Plain-text footer counterpart to the HTML unsubscribe line. */
export function textUnsubscribe(unsubscribeUrl: string, unsubscribeLabel: string): string {
  return `\n\n—\nYou're receiving this because ${unsubscribeLabel} notifications are on.\nTurn these off: ${unsubscribeUrl}`;
}
