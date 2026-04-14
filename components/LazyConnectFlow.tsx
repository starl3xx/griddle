'use client';

import { useEffect } from 'react';
import WalletProvider from './WalletProvider';
import { ConnectButton } from './ConnectButton';
import { useConnect } from 'wagmi';

interface LazyConnectFlowProps {
  onConnect?: (address: string) => void;
  onDisconnect?: () => void;
  /**
   * Monotonic counter that force-opens the connector picker each time
   * it bumps. Needed for the "disconnected, reopen StatsModal, click
   * Connect again" path — without the counter, the AutoOpener effect
   * only fires on first mount and subsequent triggerConnect calls
   * become silent no-ops because LazyConnectFlow never re-mounts.
   */
  openKey?: number;
}

/**
 * The "real" connect flow — wraps the entire wagmi stack (WalletProvider
 * + ConnectButton). This file is dynamic-imported by GameClient so the
 * 140 kB wagmi/viem/react-query bundle only loads when a user actually
 * clicks Connect, preserving the M4-perf bundle wins for the 99% of
 * page loads that never touch a wallet.
 *
 * On first mount (and every `openKey` bump afterwards), immediately
 * auto-opens the connector picker via `<AutoOpener />` so the user
 * only has to click Connect once — without this, they'd click the
 * stub, the chunk would load, and they'd have to click again to
 * actually pick a connector.
 */
export default function LazyConnectFlow({
  onConnect,
  onDisconnect,
  openKey = 0,
}: LazyConnectFlowProps) {
  return (
    <WalletProvider>
      <ConnectButton onConnect={onConnect} onDisconnect={onDisconnect} />
      <AutoOpener openKey={openKey} />
    </WalletProvider>
  );
}

/**
 * Fires a synthetic click on the ConnectButton sibling whenever its
 * `openKey` prop changes. Lives inside WalletProvider so it has access
 * to wagmi context.
 *
 * Implemented as: query the document for the connect button by its
 * accessible label and click it. Cheap, no need for refs across
 * sibling components. The query returns `null` once the user is
 * already connected (ConnectButton renders a different element for
 * the connected state), so bumping `openKey` while connected is a
 * harmless no-op.
 */
function AutoOpener({ openKey }: { openKey: number }) {
  // useConnect is here only to ensure the wagmi context is initialized
  // before we try to fire the click — otherwise the click happens
  // before the connectors are ready.
  useConnect();

  useEffect(() => {
    // openKey=0 is the initial mount — LazyConnectFlow is now mounted
    // eagerly on page load for wagmi auto-reconnect, but we must NOT open
    // the connector picker on load. Only bump-triggered opens (openKey > 0)
    // should open the picker.
    if (openKey === 0) return;
    const btn = document.querySelector<HTMLButtonElement>(
      'button[data-griddle-connect="true"]',
    );
    if (btn) btn.click();
  }, [openKey]);

  return null;
}
