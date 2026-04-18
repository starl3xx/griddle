import type { ReactNode } from 'react';
import WalletProvider from '@/components/WalletProvider';

// Mounts wagmi here (not in the root layout) so the homepage bundle
// stays free of the ~140 kB wagmi/viem stack — see WalletProvider for
// the M4-perf rationale. Admin traffic is low-volume so mounting the
// provider even for tabs that don't sign txs is irrelevant overhead.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
