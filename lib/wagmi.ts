'use client';

import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';

/**
 * wagmi config for Griddle's wallet integration.
 *
 * Targets Base mainnet (chain 8453), the only network we ever interact
 * with. The connector list is ordered by intended priority:
 *
 *   1. farcasterMiniApp — when running inside a Farcaster client, this
 *      hands us the user's Farcaster-attested wallet via the mini-app
 *      SDK's ethProvider. No popup, no signature dance.
 *   2. coinbaseWallet — Base App and Coinbase Wallet (mobile + extension).
 *      Smart-wallet flow ("Coinbase Smart Wallet") works for users with
 *      no extension or seed phrase.
 *   3. injected — fallback for any EIP-1193 provider on `window.ethereum`
 *      (MetaMask, Rabbit, etc.).
 *
 * Matches the LHAW convention (wagmi 2.x, no RainbowKit). RainbowKit's
 * connect button is ~150 kB; we ship our own minimal modal in
 * `components/ConnectModal.tsx` to keep the bundle lean.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    farcasterMiniApp(),
    coinbaseWallet({
      appName: 'Griddle',
      preference: 'smartWalletOnly',
    }),
    injected(),
  ],
  transports: {
    [base.id]: http(),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
