'use client';

import { type ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';

/**
 * Wraps the app in WagmiProvider + QueryClientProvider so any descendant
 * can use wagmi hooks. Mounted lazily by GameClient via a dynamic import
 * so the wagmi/viem/connector bundle (~80 kB) only loads when the user
 * actually clicks Connect — keeps the M4-perf bundle wins intact for
 * users who never connect a wallet.
 *
 * QueryClient is created once via useState init so it survives re-renders
 * but is bound to this provider's lifetime.
 */
export default function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
