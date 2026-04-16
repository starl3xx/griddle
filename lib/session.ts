import { headers } from 'next/headers';

// Re-exported from `lib/session-id` so existing callers keep their
// import path. The constants live in a standalone module because
// middleware.ts also needs them and can't transitively pull in
// `next/headers` via this file.
export { SESSION_ID_REGEX, isValidSessionId } from '@/lib/session-id';

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
