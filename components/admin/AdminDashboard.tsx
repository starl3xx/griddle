'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { useDarkMode } from '@/lib/useDarkMode';
import { PulseTab } from './PulseTab';
import { Gauge, Funnel, Warning, Gift, Users, Receipt, ChartLine, PuzzlePiece, Coins, Broadcast, Moon, Sun } from '@phosphor-icons/react';

// Pulse is the default tab, so it's statically imported (the user sees
// it on every admin page load). The remaining 8 tabs render only when
// clicked — deferring their modules keeps Recharts (imported by
// Funnel/Retention/Costs) and per-tab icon sets out of the initial
// admin chunk. ssr: false because tabs are client-only and admin is
// `force-dynamic` anyway.
const FunnelTab = dynamic(() => import('./FunnelTab').then((m) => ({ default: m.FunnelTab })), { ssr: false });
const RetentionTab = dynamic(() => import('./RetentionTab').then((m) => ({ default: m.RetentionTab })), { ssr: false });
const AnomaliesTab = dynamic(() => import('./AnomaliesTab').then((m) => ({ default: m.AnomaliesTab })), { ssr: false });
const GrantTab = dynamic(() => import('./GrantTab').then((m) => ({ default: m.GrantTab })), { ssr: false });
const UsersTab = dynamic(() => import('./UsersTab').then((m) => ({ default: m.UsersTab })), { ssr: false });
const PuzzlesTab = dynamic(() => import('./PuzzlesTab').then((m) => ({ default: m.PuzzlesTab })), { ssr: false });
const TransactionsTab = dynamic(() => import('./TransactionsTab').then((m) => ({ default: m.TransactionsTab })), { ssr: false });
const CostsTab = dynamic(() => import('./CostsTab').then((m) => ({ default: m.CostsTab })), { ssr: false });
const OracleTab = dynamic(() => import('./OracleTab').then((m) => ({ default: m.OracleTab })), { ssr: false });

type Tab = 'pulse' | 'funnel' | 'retention' | 'anomalies' | 'grant' | 'users' | 'puzzles' | 'transactions' | 'costs' | 'oracle';

interface AdminDashboardProps {
  /** Connected admin wallet — shown in the header for context. */
  adminWallet: string;
}

/**
 * Client shell for the /admin route. Owns tab state and renders the
 * section-grouped tab nav + the active tab body. All data fetching
 * happens inside each tab component, so dropping in a new tab doesn't
 * require plumbing state through here.
 *
 * Auth is enforced by the server component that mounts this — we
 * trust `adminWallet` as already-verified.
 */
export function AdminDashboard({ adminWallet }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('pulse');
  // Admin shell ships its own toggle so operators viewing /admin
  // without first touching the main app's SettingsModal can still flip
  // themes. Keyed on the admin wallet so the preference round-trips
  // through /api/settings the same way the main app's toggle does.
  const { dark, toggle: toggleDark } = useDarkMode(adminWallet);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="container mx-auto py-8 px-4 max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Admin dashboard
            </h1>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">
              Operator console ·{' '}
              <span className="font-mono">
                {adminWallet.slice(0, 6)}…{adminWallet.slice(-4)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={toggleDark}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="shrink-0 p-2 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {dark ? <Sun className="h-4 w-4" weight="bold" /> : <Moon className="h-4 w-4" weight="bold" />}
          </button>
        </header>

        <TabGroup title="Analytics">
          <TabButton active={activeTab === 'pulse'} onClick={() => setActiveTab('pulse')}
            icon={<Gauge className="h-4 w-4" weight="bold" />} label="Pulse" />
          <TabButton active={activeTab === 'funnel'} onClick={() => setActiveTab('funnel')}
            icon={<Funnel className="h-4 w-4" weight="bold" />} label="Funnel" />
          <TabButton active={activeTab === 'retention'} onClick={() => setActiveTab('retention')}
            icon={<ChartLine className="h-4 w-4" weight="bold" />} label="Retention" />
        </TabGroup>

        <TabGroup title="Operations">
          <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')}
            icon={<Users className="h-4 w-4" weight="bold" />} label="Users" />
          <TabButton active={activeTab === 'puzzles'} onClick={() => setActiveTab('puzzles')}
            icon={<PuzzlePiece className="h-4 w-4" weight="bold" />} label="Puzzles" />
          <TabButton active={activeTab === 'transactions'} onClick={() => setActiveTab('transactions')}
            icon={<Receipt className="h-4 w-4" weight="bold" />} label="Transactions" />
          <TabButton active={activeTab === 'anomalies'} onClick={() => setActiveTab('anomalies')}
            icon={<Warning className="h-4 w-4" weight="bold" />} label="Anomalies" />
          <TabButton active={activeTab === 'grant'} onClick={() => setActiveTab('grant')}
            icon={<Gift className="h-4 w-4" weight="bold" />} label="Grant" />
        </TabGroup>

        <TabGroup title="Settings">
          <TabButton active={activeTab === 'costs'} onClick={() => setActiveTab('costs')}
            icon={<Coins className="h-4 w-4" weight="bold" />} label="Costs" />
          <TabButton active={activeTab === 'oracle'} onClick={() => setActiveTab('oracle')}
            icon={<Broadcast className="h-4 w-4" weight="bold" />} label="Oracle" />
        </TabGroup>

        <div className="mt-6">
          {activeTab === 'pulse' && <PulseTab />}
          {activeTab === 'funnel' && <FunnelTab />}
          {activeTab === 'retention' && <RetentionTab />}
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'puzzles' && <PuzzlesTab />}
          {activeTab === 'transactions' && <TransactionsTab />}
          {activeTab === 'anomalies' && <AnomaliesTab />}
          {activeTab === 'grant' && <GrantTab />}
          {activeTab === 'costs' && <CostsTab />}
          {activeTab === 'oracle' && <OracleTab />}
        </div>
      </div>
    </div>
  );
}

function TabGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {title}
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">{children}</div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}
