import { NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/wallet-session';
import { getSessionId } from '@/lib/session';
import {
  getUserSettings,
  upsertUserSettings,
  DEFAULT_USER_SETTINGS,
  type UpdateUserSettingsInput,
} from '@/lib/db/queries';

/**
 * GET /api/settings
 *
 * Returns the current user settings for the session's bound wallet.
 * Falls back to defaults when no row exists or no wallet is bound.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const wallet = await getSessionWallet(sessionId);
  if (!wallet) {
    return NextResponse.json({ ...DEFAULT_USER_SETTINGS, wallet: null });
  }
  const row = await getUserSettings(wallet);
  if (!row) {
    return NextResponse.json({ ...DEFAULT_USER_SETTINGS, wallet });
  }
  return NextResponse.json({
    wallet: row.wallet,
    streakProtectionEnabled: row.streakProtectionEnabled,
    streakProtectionUsedAt: row.streakProtectionUsedAt,
    unassistedModeEnabled: row.unassistedModeEnabled,
    darkModeEnabled: row.darkModeEnabled,
  });
}

/**
 * PATCH /api/settings
 *
 * Body: `{ streakProtectionEnabled?, unassistedModeEnabled?, darkModeEnabled? }`
 *
 * Partial update — only supplied fields are changed. Requires a wallet to
 * be bound to the session (dark mode for anonymous users is localStorage-only).
 */
export async function PATCH(req: Request): Promise<NextResponse> {
  const sessionId = await getSessionId();
  const wallet = await getSessionWallet(sessionId);
  if (!wallet) {
    return NextResponse.json({ error: 'wallet required' }, { status: 401 });
  }

  let body: UpdateUserSettingsInput;
  try {
    body = (await req.json()) as UpdateUserSettingsInput;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const updated = await upsertUserSettings(wallet, body);
  return NextResponse.json({
    wallet: updated.wallet,
    streakProtectionEnabled: updated.streakProtectionEnabled,
    streakProtectionUsedAt: updated.streakProtectionUsedAt,
    unassistedModeEnabled: updated.unassistedModeEnabled,
    darkModeEnabled: updated.darkModeEnabled,
  });
}
