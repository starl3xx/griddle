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
