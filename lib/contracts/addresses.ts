/**
 * Contract addresses on Base mainnet, read from env lazily.
 *
 * Evaluated on-access rather than at module load because Next 14's
 * build-time page data collection runs module top-level code without
 * env vars populated. Throwing on import would break `bun build` even
 * though the values are fine at runtime on Vercel.
 */

function parse(value: string | undefined): `0x${string}` | null {
  if (!value || value === '' || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

/**
 * $WORD token on Base (Clanker v4). Null if the env var is missing —
 * callers should treat that as "crypto checkout not configured" and
 * fall back to the fiat path rather than rendering a broken flow.
 */
export function getWordTokenAddress(): `0x${string}` | null {
  return parse(process.env.NEXT_PUBLIC_WORD_TOKEN_ADDRESS);
}

/**
 * GriddlePremium contract. Null until M5-contracts deploys it on Base mainnet
 * and the env var is set. Crypto-unlock flow checks for non-null
 * before rendering and surfaces a "crypto checkout is not configured"
 * message if missing.
 */
export function getGriddlePremiumAddress(): `0x${string}` | null {
  return parse(process.env.NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS);
}

/**
 * Native Base USDC. Defaults to the canonical address so the crypto
 * flow works out-of-the-box on mainnet; still overridable via env for
 * testnets / forks.
 */
export function getUsdcAddress(): `0x${string}` {
  const fromEnv = parse(process.env.NEXT_PUBLIC_USDC_ADDRESS);
  return fromEnv ?? '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
}

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '8453');
