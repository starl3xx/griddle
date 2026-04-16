/**
 * Shared session-id format constants.
 *
 * Lives in its own module (separate from `lib/session.ts`) so both
 * middleware and server handlers can import from the same source of
 * truth. `lib/session.ts` pulls in `next/headers`, which the middleware
 * edge runtime can't use — keeping the regex here avoids forcing that
 * dependency chain on the edge bundle.
 *
 * The canonical format is `crypto.randomUUID()` with dashes stripped:
 * exactly 32 lowercase hex chars. Every id the middleware has ever
 * minted matches this; a wider range would only make spoofing /
 * brute force cheaper.
 */

export const SESSION_ID_REGEX = /^[0-9a-f]{32}$/i;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_REGEX.test(value);
}
