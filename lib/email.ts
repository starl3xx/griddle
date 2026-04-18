/**
 * Email shape + normalization. Shared by:
 *   - /api/auth/request (magic-link request)
 *   - /api/premium/verify (crypto unlock optional email)
 *   - Stripe webhook (fiat unlock email snapshot)
 *   - Admin queries that search premium_users.email
 *
 * Keep this file as the single source of truth so a drift between
 * callers can't let a malformed email land in the DB from one path
 * and get rejected on another.
 *
 * The RE is deliberately permissive (no RFC 5322 monster regex). We
 * only need to reject obvious garbage ("foo", whitespace) — Stripe
 * itself validates the address on checkout and the magic-link send
 * path fails loudly if the address is undeliverable.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 254;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

export function isValidEmail(raw: string | null | undefined): boolean {
  const email = normalizeEmail(raw);
  if (!email) return false;
  if (email.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_RE.test(email);
}
