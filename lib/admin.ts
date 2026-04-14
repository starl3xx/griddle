/**
 * Admin allowlist — wallet addresses authorized to view the anomaly
 * dashboard and (in the future) any other operator surfaces.
 *
 * Source of truth is the `ADMIN_WALLETS` env var, comma-separated
 * lowercase 0x addresses. This is a deliberate choice over a DB row:
 * env var changes require a deploy, which is exactly the level of
 * friction we want for "who can see what flagged solves" since
 * compromising it requires a code/deploy compromise, not a DB write.
 */
import { getSessionId } from './session';
import { getSessionWallet } from './wallet-session';

const ADMIN_SET: ReadonlySet<string> = (() => {
  const raw = process.env.ADMIN_WALLETS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[a-f0-9]{40}$/.test(s)),
  );
})();

export function isAdminWallet(wallet: string | null | undefined): boolean {
  if (!wallet) return false;
  return ADMIN_SET.has(wallet.toLowerCase());
}

/**
 * Resolves the wallet bound to the current session and checks the
 * allowlist. Returns the wallet string on success, null on failure.
 * Server components and API routes that need admin gating call this.
 */
export async function requireAdminWallet(): Promise<string | null> {
  const sessionId = await getSessionId();
  const wallet = await getSessionWallet(sessionId);
  if (!isAdminWallet(wallet)) return null;
  return wallet;
}
