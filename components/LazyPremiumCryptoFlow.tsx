'use client';

import WalletProvider from './WalletProvider';
import { PremiumCryptoFlow } from './PremiumCryptoFlow';

/**
 * Dynamic-import entry point for the crypto unlock flow. Wraps the real
 * PremiumCryptoFlow in WalletProvider so it has wagmi context available,
 * mirroring LazyConnectFlow's pattern. Loaded via next/dynamic so the
 * wagmi stack isn't pulled into the main bundle for users who never
 * open the premium modal.
 */
export default function LazyPremiumCryptoFlow({
  onUnlocked,
  onCancel,
}: {
  onUnlocked: (wallet: string) => void;
  onCancel: () => void;
}) {
  return (
    <WalletProvider>
      <PremiumCryptoFlow onUnlocked={onUnlocked} onCancel={onCancel} />
    </WalletProvider>
  );
}
