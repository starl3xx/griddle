import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireAdminWallet } from '@/lib/admin';
import { AdminDashboard } from '@/components/admin';

export const metadata: Metadata = {
  title: 'Griddle | Admin',
};

/**
 * Admin dashboard root. Server component — the wallet-bound session
 * is checked against `ADMIN_WALLETS` before rendering anything. Non-admin
 * visitors get a 404 (not 403) so the page's existence isn't leaked.
 *
 * This route replaces the old `/admin/anomalies` page. The tab shell
 * lives in the client component `<AdminDashboard />`; each tab
 * (Pulse, Anomalies) fetches its own data through an admin-gated API
 * endpoint so no props travel from server to client here.
 */
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const adminWallet = await requireAdminWallet();
  if (!adminWallet) notFound();

  return <AdminDashboard adminWallet={adminWallet} />;
}
