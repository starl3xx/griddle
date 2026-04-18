import type { ReactNode } from 'react';
import WalletProvider from '@/components/WalletProvider';

// Mounts wagmi here (not in the root layout) so the homepage bundle
// stays free of the ~140 kB wagmi/viem stack — see WalletProvider for
// the M4-perf rationale. Admin tabs that sign txs (DeployTab) need
// wagmi context; the analytics tabs don't, but the cost of mounting
// providers for them is irrelevant since /admin is admin-only traffic.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
