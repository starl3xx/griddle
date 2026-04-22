'use client';

import { useEffect, useRef } from 'react';
import WalletProvider from './WalletProvider';
import { ConnectButton } from './ConnectButton';
import { connectorKind } from './WalletIcon';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

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
  /**
   * Forwarded to ConnectButton so the Farcaster tile filter reads the
   * already-resolved mini-app state from GameClient — avoids the 2s
   * hydration gap a local useFarcaster() in ConnectButton would create.
   */
  inMiniApp: boolean;
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
  inMiniApp,
}: LazyConnectFlowProps) {
  return (
    <WalletProvider>
      <ConnectButton onConnect={onConnect} onDisconnect={onDisconnect} inMiniApp={inMiniApp} />
      <AutoOpener openKey={openKey} />
      <AutoConnectMiniapp inMiniApp={inMiniApp} />
    </WalletProvider>
  );
}

/**
 * Inside a Farcaster mini-app, automatically fire the Farcaster
 * connector on mount so the user doesn't have to open the picker.
 * Their wallet + @username + pfp come from the miniapp context —
 * there's no meaningful choice to make at the picker, and requiring
 * a tap breaks the "just works" expectation of a mini app.
 *
 * Safeguards:
 *   - No-op when inMiniApp=false. Plain-web users still see the picker.
 *   - Waits for wagmi's own rehydration (`isReconnecting`) so we don't
 *     race a persisted connect and end up with two in-flight attempts.
 *   - Zombie-connector detection (see below) — if rehydration left a
 *     partial/stale connector in state, force a disconnect + reconnect.
 *   - Fires at most once per mount via `hasFired`. Further connects
 *     go through the normal picker path.
 *   - Skips entirely if the Farcaster connector isn't registered yet
 *     (wagmi connectors array can be empty on first render).
 *
 * Zombie connector rationale: wagmi persists connections to cookie/
 * localStorage by stripping the connector to `{ id, name, type, uid }`
 * (see @wagmi/core createConfig.js:166). On hydration it relies on
 * `reconnect()` to re-attach the methods from the matching registered
 * connector. If that reconnect silently fails — e.g. the Farcaster SDK
 * provider wasn't ready yet — the stripped stub stays in state and
 * `isConnected` reads `true`. The next `useWriteContract()` call then
 * crashes inside `getConnectorClient` with
 * "connector.getChainId is not a function". We spot the stub by
 * probing for expected methods, nuke it, and let the effect re-fire
 * with a real Farcaster connect.
 */
function AutoConnectMiniapp({ inMiniApp }: { inMiniApp: boolean }) {
  const { isConnected, isReconnecting, connector: activeConnector } = useAccount();
  const { connectors, connect, status } = useConnect();
  const { disconnect } = useDisconnect();
  const hasFired = useRef(false);

  useEffect(() => {
    if (!inMiniApp) return;
    if (isReconnecting) return;
    if (status === 'pending') return;

    const farcaster = connectors.find((c) => connectorKind(c) === 'farcaster');
    if (!farcaster) return;

    if (isConnected) {
      const hasMethods =
        typeof activeConnector?.getChainId === 'function' &&
        typeof activeConnector?.getAccounts === 'function';
      const isFarcaster =
        activeConnector && connectorKind(activeConnector) === 'farcaster';
      if (!hasMethods || !isFarcaster) {
        disconnect();
        hasFired.current = false;
      }
      return;
    }

    if (hasFired.current) return;
    hasFired.current = true;
    connect({ connector: farcaster });
  }, [
    inMiniApp,
    isConnected,
    isReconnecting,
    activeConnector,
    connectors,
    connect,
    disconnect,
    status,
  ]);

  return null;
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
