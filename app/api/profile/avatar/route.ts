import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSessionId } from '@/lib/session';
import { isSessionPremium } from '@/lib/premium-check';

/**
 * POST /api/profile/avatar
 *
 * Body: multipart/form-data with a single `file` field containing an image.
 *
 * Uploads the image to Vercel Blob and returns `{ url }` — the public
 * CDN URL that the caller can then write to the profile's `avatar_url`
 * column via PATCH /api/profile or POST /api/profile/create.
 *
 * The client (lib/avatar-upload.ts) resizes to 512×512 JPEG before
 * sending, so the request is usually ~50–100KB. We still enforce a
 * 5MB cap server-side as a defense against a client that skipped the
 * resize step or a malicious direct POST.
 *
 * Storage: requires `BLOB_READ_WRITE_TOKEN` to be set in env. On
 * Vercel, this is auto-injected once a Blob store is provisioned in
 * the project dashboard. Locally, developers need to run
 * `vercel env pull .env.local` after connecting the project to pull
 * the token down.
 *
 * Session-gated: the upload's blob path includes the session id as a
 * prefix so uploads can be attributed. No auth beyond "has a session
 * cookie" is enforced — consistent with how profile edits work —
 * which means the attack surface is orphan-blob upload abuse. For v1
 * we rely on (a) the 5MB cap, (b) the session cookie being required,
 * and (c) Vercel's built-in edge rate limiting. A follow-up can add
 * per-session upload counts in Upstash if this becomes a problem.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          'Avatar upload is not configured. Provision a Vercel Blob store and set BLOB_READ_WRITE_TOKEN.',
      },
      { status: 503 },
    );
  }

  const sessionId = await getSessionId();

  // Premium gate. Custom avatars are a Premium feature — non-premium
  // users still see a default silhouette or their Farcaster pfp (via
  // the separate /api/profile/farcaster path). Checked server-side in
  // addition to the client-side disabled state so a malicious client
  // can't bypass the gate by POSTing directly.
  const premium = await isSessionPremium(sessionId);
  if (!premium) {
    return NextResponse.json(
      { error: 'Custom avatars are a Premium feature.' },
      { status: 402 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file field' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported mime type ${file.type}` },
      { status: 415 },
    );
  }

  // Path shape: `avatars/{sessionId-prefix}-{ts}.{ext}`. The session
  // prefix lets us scope future cleanup sweeps (e.g. "drop all blobs
  // for a session whose profile never saved"), and the timestamp makes
  // each upload unique so a user changing their photo doesn't CDN-cache
  // their old image. addRandomSuffix on Vercel Blob would also solve
  // the cache-bust, but an explicit timestamp is easier to debug and
  // means the returned URL is self-explanatory.
  const ext = extFromMime(file.type);
  const sessionPrefix = sessionId.slice(0, 12);
  const pathname = `avatars/${sessionPrefix}-${Date.now()}.${ext}`;

  try {
    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error('[profile/avatar] upload failed', err);
    return NextResponse.json(
      { error: 'upload failed; please try again' },
      { status: 500 },
    );
  }
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif':  return 'gif';
    default:           return 'bin';
  }
}
