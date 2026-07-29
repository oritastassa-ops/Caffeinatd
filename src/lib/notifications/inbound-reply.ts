/**
 * Reply formatting for inbound conversations. Pure functions — the truncation
 * math is the kind of thing that silently fragments a bill into five texts if it
 * drifts, so it's unit-tested without a network.
 */

/** GSM-7 (single 160 / concatenated 153) vs UCS-2 (single 70 / concatenated 67). */
const GSM_SINGLE = 160;
const GSM_CONCAT = 153;
const UCS2_SINGLE = 70;
const UCS2_CONCAT = 67;

/**
 * The GSM 03.38 basic + extension character set. Anything outside it forces the
 * whole message into UCS-2 encoding, which more than halves the per-segment
 * budget — so a single emoji quietly turns a 160-char reply into a 3-segment
 * one. We detect that up front and truncate to the real budget.
 */
const GSM_CHARS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
// GSM extension characters cost TWO septets each.
const GSM_EXTENDED = new Set("^{}\\[~]|€".split(""));

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM_CHARS.has(ch) && !GSM_EXTENDED.has(ch)) return false;
  }
  return true;
}

/** Encoded length in the unit that matters (septets for GSM-7, else code units). */
function encodedLength(text: string, gsm: boolean): number {
  if (!gsm) return [...text].length; // UCS-2 counts code points closely enough here
  let n = 0;
  for (const ch of text) n += GSM_EXTENDED.has(ch) ? 2 : 1;
  return n;
}

export interface SmsFormat {
  body: string;
  /** True when the reply was shortened to fit the segment budget. */
  truncated: boolean;
}

/**
 * Fit an assistant reply into at most `maxSegments` SMS segments, appending a
 * "see the app" pointer when it has to cut. SMS replies are short and
 * unformatted by design; fragmenting a receipt across five texts is both a worse
 * read and a bigger bill, so we truncate deliberately rather than let the
 * carrier split it.
 */
export function formatSmsReply(text: string, maxSegments = 2, pointer = "— open the app for the rest"): SmsFormat {
  const clean = text.trim().replace(/\s+/g, " ");
  const gsm = isGsm7(clean);
  const single = gsm ? GSM_SINGLE : UCS2_SINGLE;
  const concat = gsm ? GSM_CONCAT : UCS2_CONCAT;
  // A concatenated message spends per-segment budget on the UDH, so once it
  // crosses one segment EVERY segment shrinks to the concat size.
  const budget = maxSegments <= 1 ? single : concat * maxSegments;

  if (encodedLength(clean, gsm) <= budget) return { body: clean, truncated: false };

  // Reserve room for the pointer (with a leading space), then cut on a word
  // boundary so we don't slice a word in half.
  const suffix = ` ${pointer}`;
  const room = budget - encodedLength(suffix, gsm);
  const chars = [...clean];
  let cut = "";
  for (const ch of chars) {
    if (encodedLength(cut + ch, gsm) > room) break;
    cut += ch;
  }
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > room * 0.5) cut = cut.slice(0, lastSpace);
  return { body: `${cut.trimEnd()}${suffix}`, truncated: true };
}
