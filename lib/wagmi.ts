'use client';

import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, walletConnect } from 'wagmi/connectors';
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
 *   3. walletConnect — mobile-wallet path (MetaMask Mobile, Rainbow,
 *      Trust, etc.) via QR / deep link. Needs a Reown/WalletConnect
 *      project ID in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
 *
 * Browser-extension wallets (MetaMask, Rabby, Rainbow, Brave, Phantom,
 * Trust) are picked up automatically by wagmi v2's built-in EIP-6963
 * multi-injected-provider discovery — each announced provider becomes
 * its own connector at runtime with a proper name + icon. No explicit
 * `injected()` entry needed; adding one would duplicate a detected
 * provider as a generic tile.
 *
 * Matches the LHAW convention (wagmi 2.x, no RainbowKit). RainbowKit's
 * connect button is ~150 kB; we ship our own minimal modal in
 * `components/ConnectButton.tsx` to keep the bundle lean.
 */
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    farcasterMiniApp(),
    coinbaseWallet({
      appName: 'Griddle',
      preference: 'smartWalletOnly',
    }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            metadata: {
              name: 'Griddle',
              description: 'Daily on-chain word puzzle on Base.',
              url: 'https://griddle.fun',
              icons: ['https://griddle.fun/icon.png'],
            },
            showQrModal: true,
          }),
        ]
      : []),
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
