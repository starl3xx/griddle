'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { WalletIcon, connectorLabel, connectorKind } from './WalletIcon';

interface ConnectButtonProps {
  /** Called once a wallet successfully connects, with the address. */
  onConnect?: (address: string) => void;
  /** Called once a wallet disconnects (or session expires). */
  onDisconnect?: () => void;
  /**
   * Whether the app is running inside a Farcaster mini-app client
   * (Warpcast / Base App). Plumbed as a prop rather than fetched via
   * a local `useFarcaster()` call so we share the already-resolved
   * value from `GameClient` — a second call would restart the async
   * detection cycle and leave `inMiniApp=false` for ~2s, long enough
   * for a first-time Warpcast user to open the picker and miss the
   * Farcaster tile. Matches the SolveModal plumbing pattern.
   */
  inMiniApp: boolean;
}

/**
 * Custom minimal connect button — no RainbowKit. Matches LHAW's pattern
 * of using wagmi primitives directly with our own UI shell.
 *
 * UX:
 *   - Disconnected: pill button "Connect" → click opens a small connector
 *     picker (Farcaster / Coinbase / Browser wallet, with brand icons
 *     + friendly labels via WalletIcon / connectorLabel)
 *   - Connecting: spinner
 *   - Connected: shows truncated address `0x1234…abcd`, click to disconnect
 *
 * Visual treatment matches the brand-blue chip language already used
 * elsewhere in the game. Sized to fit in the page header without
 * disrupting the Griddle wordmark layout.
 */
export function ConnectButton({ onConnect, onDisconnect, inMiniApp }: ConnectButtonProps) {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Hide the Farcaster connector when we aren't inside a Farcaster
  // mini-app client (Warpcast / Base App). Outside that context the
  // connector's `connect()` silently no-ops because there's no
  // `sdk.wallet.ethProvider` to attach to — the picker closes and the
  // user sees nothing. Filtering keeps the tile only on surfaces where
  // it actually works.
  const visibleConnectors = useMemo(
    () => connectors.filter((c) => connectorKind(c) !== 'farcaster' || inMiniApp),
    [connectors, inMiniApp],
  );

  // Fire onConnect once on the first time we transition into a connected
  // state, and onDisconnect on the disconnect transition. Track the
  // previously-seen address to avoid double-firing on reconnect to the
  // same wallet.
  //
  // Also: close the picker if it’s still open when we transition to
  // connected. Without this, wagmi’s persisted-state auto-reconnect
  // (which happens AFTER the AutoOpener click sets pickerOpen=true)
  // can leave stale pickerOpen=true state. Then when the user
  // eventually disconnects, the picker would reappear unexpectedly.
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  useEffect(() => {
    if (isConnected && address && address !== lastSeen) {
      setLastSeen(address);
      onConnect?.(address);
      setPickerOpen(false);
    }
    if (!isConnected && lastSeen) {
      setLastSeen(null);
      onDisconnect?.();
      setPickerOpen(false);
    }
  }, [isConnected, address, lastSeen, onConnect, onDisconnect]);

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="bg-brand-50 text-brand-700 rounded-pill px-3 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-brand-100 transition-colors duration-fast"
        title={`Disconnect ${address}`}
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        data-griddle-connect="true"
        onClick={() => setPickerOpen(true)}
        disabled={isPending}
        className="bg-brand text-white rounded-pill px-4 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-brand-600 transition-colors duration-fast disabled:opacity-60"
      >
        {isPending ? 'Connecting…' : 'Connect'}
      </button>

      {pickerOpen && (
        // z-[60] sits one tier above every other modal (all z-50) so the
        // picker always paints on top when chained from another modal —
        // e.g. "Pay with crypto" in PremiumGateModal triggers this picker
        // while the gate modal stays mounted. With equal z the picker
        // lost to whichever modal rendered later in the DOM, since
        // LazyConnectFlow is mounted early for wagmi auto-reconnect.
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-fade-in"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="modal-sheet animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Connect a wallet
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Connect once to claim solves and unlock Premium.
            </p>

            <div className="flex flex-col gap-2 mt-5">
              {visibleConnectors.map((connector) => (
                <button
                  key={connector.uid}
                  type="button"
                  onClick={() => {
                    connect({ connector });
                    setPickerOpen(false);
                  }}
                  className="btn-secondary text-left flex items-center gap-3"
                >
                  <WalletIcon connector={connector} />
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{connectorLabel(connector)}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="mt-4 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
