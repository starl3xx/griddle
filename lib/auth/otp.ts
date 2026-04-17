/**
 * Short-lived one-time password codes for email sign-in, keyed in KV.
 *
 * Why this exists: the magic-link flow breaks when the user is in an
 * installed PWA. Tapping the link in their email client opens their
 * default browser — which is a different app from the installed PWA,
 * and carries a different session cookie. The verify endpoint consumes
 * the token in the browser, not in the PWA, so the user remains
 * anonymous in the PWA after sign-in.
 *
 * The fix is to give the user an alternative they can type into the
 * PWA directly: a 6-digit code delivered alongside the magic link.
 * The browser path still works (nothing changes for desktop or mobile
 * web); PWA users enter the code into Settings instead of tapping
 * the link.
 *
 * Storage: one Upstash key per (email, codeHash) pair with a 15-minute
 * TTL. We hash the code (SHA-256) so a KV dump doesn’t leak usable
 * codes. We store per (email, codeHash) rather than indexing by email
 * so a new send doesn’t invalidate codes still in flight — matching
 * the magic-link table’s multi-token semantics.
 *
 * Rate limiting is inherited from /api/auth/request — the OTP is
 * generated alongside the magic-link token, so the 5/hour cap already
 * applies.
 */

import { createHash, randomInt } from 'crypto';
import { kv } from '@/lib/kv';

const OTP_TTL_SECONDS = 15 * 60;

const KEY = (email: string, codeHash: string) =>
  `griddle:otp:${email.toLowerCase().trim()}:${codeHash}`;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Generate a zero-padded 6-digit code (`000000`–`999999`). */
function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Create a fresh 6-digit OTP for `email` and stash its hash in KV.
 * Returns the raw code — caller includes it in the email body.
 *
 * Does NOT rate-limit on its own; the parent route already rate-
 * limits by hitting createMagicLink first.
 */
export async function createOtp(email: string): Promise<string> {
  const code = generateCode();
  const hash = hashCode(code);
  await kv.set(KEY(email, hash), 1, { ex: OTP_TTL_SECONDS });
  return code;
}

/**
 * Verify a 6-digit OTP. Consumes on success (DEL) so the code can't
 * be replayed. Returns the normalized email on success or null on
 * failure — so callers can't distinguish "unknown email" from "wrong
 * code" by behavior, only by return value.
 */
export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const normalizedCode = code.trim();
  if (!/^[0-9]{6}$/.test(normalizedCode)) return false;
  const hash = hashCode(normalizedCode);
  const key = KEY(email, hash);
  const existed = await kv.del(key);
  return existed === 1;
}
