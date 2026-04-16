import { headers } from 'next/headers';

/**
 * Session id reader.
 *
 * Every request goes through `middleware.ts`, which guarantees an
 * `x-session-id` header is set before any server component or API route
 * runs. This module just reads it.
 *
 * If the header is missing (which only happens if the request bypassed
 * middleware — e.g. a misconfigured matcher), throw loudly so the bug
 * surfaces immediately rather than silently corrupting data.
 */

/**
 * Canonical session id format. Middleware mints `crypto.randomUUID()`
 * with dashes stripped = exactly 32 lowercase hex chars. Shared between
 * the middleware cookie check and any other validation surface (e.g.
 * Stripe webhook metadata) so there's one source of truth.
 */
export const SESSION_ID_REGEX = /^[0-9a-f]{32}$/i;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_REGEX.test(value);
}

export async function getSessionId(): Promise<string> {
  const h = await headers();
  const sid = h.get('x-session-id');
  if (!sid) {
    throw new Error(
      'x-session-id header is missing — session middleware is not running on this route',
    );
  }
  return sid;
}
