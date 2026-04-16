import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_ID_REGEX } from '@/lib/session-id';

/**
 * Session cookie middleware.
 *
 * Next.js server components can’t set cookies (the page renders after
 * headers have already been sent), so the only place to mint a fresh
 * session cookie is middleware. This runs on every non-static request
 * and:
 *
 *   1. Reads `griddle_sid` from the incoming cookies
 *   2. If missing / malformed, generates a new UUID-derived id
 *   3. Forwards the id to downstream handlers via an `x-session-id`
 *      request header (so the server component or API route can read
 *      it even on the FIRST request, before the cookie round-trips)
 *   4. Sets the cookie on the response when a new id was minted
 *
 * Downstream code reads `headers().get('x-session-id')` via `lib/session.ts`.
 */

const SESSION_COOKIE_NAME = 'griddle_sid';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function middleware(req: NextRequest) {
  const existing = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isValid = existing != null && SESSION_ID_REGEX.test(existing);
  const sessionId = isValid ? existing : crypto.randomUUID().replace(/-/g, '');

  // Forward to downstream handlers so they can read it on the FIRST
  // request (before the cookie round-trips to the browser and back).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-session-id', sessionId);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  if (!isValid) {
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionId,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
    });
  }

  return res;
}

/**
 * Skip middleware for static assets, fonts, icons, the Satori OG route,
 * and Next internals. Every other route (pages + /api/*) runs through it.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.svg|icon.svg|apple-icon.svg|robots.txt|manifest.webmanifest|fonts|api/og|\\.well-known).*)',
  ],
};
