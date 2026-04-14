'use client';

import { useEffect } from 'react';
import WalletProvider from './WalletProvider';
import { ConnectButton } from './ConnectButton';
import { useConnect } from 'wagmi';

interface LazyConnectFlowProps {
  onConnect?: (address: string) => void;
  onDisconnect?: () => void;
}

/**
 * The "real" connect flow — wraps the entire wagmi stack (WalletProvider
 * + ConnectButton). This file is dynamic-imported by GameClient so the
 * 140 kB wagmi/viem/react-query bundle only loads when a user actually
 * clicks Connect, preserving the M4-perf bundle wins for the 99% of
 * page loads that never touch a wallet.
 *
 * On first mount, immediately auto-opens the connector picker via
 * `<AutoOpener />` so the user only has to click Connect once — without
 * this, they’d click the stub, the chunk would load, and they’d have
 * to click again to actually pick a connector.
 */
export default function LazyConnectFlow({ onConnect, onDisconnect }: LazyConnectFlowProps) {
  return (
    <WalletProvider>
      <ConnectButton onConnect={onConnect} onDisconnect={onDisconnect} />
      <AutoOpener />
    </WalletProvider>
  );
}

/**
 * Fires a synthetic click on the ConnectButton sibling on mount so the
 * picker pops immediately. Lives inside WalletProvider so it has access
 * to wagmi context.
 *
 * Implemented as: query the document for the connect button by its
 * accessible label and click it. Cheap, no need for refs across
 * sibling components.
 */
function AutoOpener() {
  // useConnect is here only to ensure the wagmi context is initialized
  // before we try to fire the click — otherwise the click happens
  // before the connectors are ready.
  useConnect();

  useEffect(() => {
    const btn = document.querySelector<HTMLButtonElement>(
      'button[data-griddle-connect="true"]',
    );
    if (btn) btn.click();
  }, []);

  return null;
}
