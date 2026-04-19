import { Resend } from 'resend';
import { SITE_URL, SITE_NAME } from './site';

/**
 * Resend email client for Griddle.
 *
 * Lazy singleton — avoids throwing at module load during build-time
 * page data collection (same pattern as lib/stripe.ts).
 */

let _resend: Resend | null = null;

function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set.');
  _resend = new Resend(key);
  return _resend;
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

const FROM = `${SITE_NAME} <noreply@griddle.fun>`;

export async function sendMagicLink(
  email: string,
  token: string,
  /**
   * Optional 6-digit verification code. When provided, it's surfaced
   * alongside the magic link so PWA users — whose email clients open
   * the link in a different app from the installed PWA — can type the
   * code into Settings instead of tapping the link. Browser / desktop
   * users still use the link; the code is purely a PWA escape hatch.
   */
  code?: string,
): Promise<{ success: boolean; error?: string }> {
  const link = `${SITE_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  try {
    const { error } = await getResend().emails.send({
      from: FROM,
      to: email,
      subject: `Sign in to ${SITE_NAME}`,
      html: magicLinkHtml(link, code),
      text: magicLinkText(link, code),
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}

function magicLinkHtml(link: string, code?: string): string {
  const codeBlock = code
    ? `<p style="color:#555;margin:28px 0 8px;">Or enter this 6-digit code in Griddle:</p>
  <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:800;letter-spacing:6px;color:#111;background:#f4f4f6;border-radius:8px;padding:14px 20px;display:inline-block;">${code}</div>`
    : '';
  // Apple's domain-bound code format. A final line of the form
  // `@<host> #<code>` lets iOS Mail surface the code as a one-tap
  // QuickType suggestion on any page from that origin. Paired with
  // `autocomplete="one-time-code"` on OtpCodeInput, this is what turns
  // "I got the code" into "iOS just autofilled it."
  const boundCodeBlock = code
    ? `<p style="color:#bbb;font-size:11px;margin-top:24px;">@${SITE_HOST} #${code}</p>`
    : '';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#111;max-width:520px;margin:0 auto;padding:40px 20px;">
  <h2 style="font-size:22px;font-weight:800;margin:0 0 8px;">Sign in to Griddle</h2>
  <p style="color:#555;margin:0 0 28px;">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
  <a href="${link}" style="display:inline-block;background:#2D68C7;color:#fff;padding:13px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Sign in to Griddle</a>
  ${codeBlock}
  <p style="color:#888;font-size:13px;margin-top:28px;">Didn't request this? You can safely ignore this email.</p>
  <p style="color:#bbb;font-size:12px;margin-top:8px;word-break:break-all;">Or copy: ${link}</p>
  ${boundCodeBlock}
</body>
</html>`;
}

function magicLinkText(link: string, code?: string): string {
  const codeLine = code ? `\nOr enter this 6-digit code in Griddle: ${code}\n` : '';
  // See magicLinkHtml for why the `@host #code` line is here. Must be
  // on its own line — iOS Mail's scanner keys off line-anchored tokens,
  // not prose mentions of the code.
  const boundCodeLine = code ? `\n@${SITE_HOST} #${code}\n` : '';
  return `Sign in to Griddle\n\nClick the link below (expires in 15 minutes):\n\n${link}\n${codeLine}\nIf you didn't request this, ignore this email.${boundCodeLine}`;
}
