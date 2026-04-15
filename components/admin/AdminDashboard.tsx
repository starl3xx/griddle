'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PulseTab } from './PulseTab';
import { FunnelTab } from './FunnelTab';
import { AnomaliesTab } from './AnomaliesTab';
import { GrantTab } from './GrantTab';
import { UsersTab } from './UsersTab';
import { Gauge, Funnel, Warning, Gift, Users } from '@phosphor-icons/react';

type Tab = 'pulse' | 'funnel' | 'anomalies' | 'grant' | 'users';

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

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto py-8 px-4 max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-black tracking-tight text-gray-900">
            Admin dashboard
          </h1>
          <p className="text-sm font-medium text-gray-500 mt-1">
            Operator console ·{' '}
            <span className="font-mono">
              {adminWallet.slice(0, 6)}…{adminWallet.slice(-4)}
            </span>
          </p>
        </header>

        <TabGroup title="Analytics">
          <TabButton
            active={activeTab === 'pulse'}
            onClick={() => setActiveTab('pulse')}
            icon={<Gauge className="h-4 w-4" weight="bold" />}
            label="Pulse"
          />
          <TabButton
            active={activeTab === 'funnel'}
            onClick={() => setActiveTab('funnel')}
            icon={<Funnel className="h-4 w-4" weight="bold" />}
            label="Funnel"
          />
        </TabGroup>

        <TabGroup title="Operations">
          <TabButton
            active={activeTab === 'users'}
            onClick={() => setActiveTab('users')}
            icon={<Users className="h-4 w-4" weight="bold" />}
            label="Users"
          />
          <TabButton
            active={activeTab === 'anomalies'}
            onClick={() => setActiveTab('anomalies')}
            icon={<Warning className="h-4 w-4" weight="bold" />}
            label="Anomalies"
          />
          <TabButton
            active={activeTab === 'grant'}
            onClick={() => setActiveTab('grant')}
            icon={<Gift className="h-4 w-4" weight="bold" />}
            label="Grant"
          />
        </TabGroup>

        <div className="mt-6">
          {activeTab === 'pulse' && <PulseTab />}
          {activeTab === 'funnel' && <FunnelTab />}
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'anomalies' && <AnomaliesTab />}
          {activeTab === 'grant' && <GrantTab />}
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
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
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
