import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';
import { griddlePremiumAbi, wordOracleAbi } from './griddlePremiumAbi';
import { getGriddlePremiumAddress } from './addresses';

/**
 * Server-side $WORD quoter for the fiat escrow path. Reads the oracle
 * the contract uses, so the amount we escrow matches what the
 * contract itself would compute. Adds a small buffer so the escrowed
 * amount covers oracle drift over the 30-day dispute window — once the
 * window closes, `burnEscrowed` burns the whole bucket regardless.
 */

function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });
}

/**
 * Compute how much $WORD (18-dec wei) corresponds to `usdWhole` dollars
 * at the current oracle price, plus `bufferBps` basis points so
 * oracle drift over the escrow window doesn't leave the burn short.
 *
 * Default buffer is 100 bps (1%). The burn after the window cleans up
 * the whole escrow anyway, so the buffer is mostly about making sure
 * `unlockForUser` itself doesn't underfund if the price spikes before
 * the tx lands.
 */
export async function quoteWordForUsd(
  usdWhole: number | bigint,
  bufferBps: number = 100,
): Promise<bigint> {
  const premiumAddress = getGriddlePremiumAddress();
  if (!premiumAddress) throw new Error('GriddlePremium address not configured');

  const client = getPublicClient();

  const oracleAddress = (await client.readContract({
    address: premiumAddress,
    abi: griddlePremiumAbi,
    functionName: 'oracle',
  })) as Address;

  const [price] = (await client.readContract({
    address: oracleAddress,
    abi: wordOracleAbi,
    functionName: 'getWordUsdPrice',
  })) as [bigint, bigint];

  if (price === 0n) throw new Error('oracle returned zero price');

  const usd = typeof usdWhole === 'bigint' ? usdWhole : BigInt(usdWhole);
  const usdScaled = usd * 10n ** 18n;
  const base = (usdScaled * 10n ** 18n) / price;
  const withBuffer = (base * (10_000n + BigInt(bufferBps))) / 10_000n;
  return withBuffer;
}
