import { Wallet } from '@phosphor-icons/react';

/**
 * Brand-matched icon + display label for a wagmi connector.
 *
 * Classifies a connector into a brand bucket (`connectorKind()`) by
 * id/name, and for the generic `injected` connector by peeking at
 * `window.ethereum` feature flags (`isMetaMask`, `isRabby`, etc.) —
 * the de-facto way dapps identify which extension actually injected
 * the provider, since the connector itself reports `name: "Injected"`.
 *
 * Icons are official brand SVGs shipped from `public/wallet-icons/`
 * (sourced from rainbow-me/rainbowkit MIT + simple-icons CC0; see
 * that directory for attribution). Served as static assets, so each
 * tile is a single cache-able request instead of inline-bundled SVG
 * paths that bloat the JS.
 *
 * Every icon sits in a fixed 36×36 swatch so rows align regardless of
 * each SVG's intrinsic viewBox.
 */
type ConnectorKind =
  | 'farcaster'
  | 'coinbase'
  | 'metamask'
  | 'rabby'
  | 'brave'
  | 'rainbow'
  | 'trust'
  | 'phantom'
  | 'walletconnect'
  | 'browser';

export interface ConnectorIdentity {
  id: string;
  name: string;
  icon?: string;
}

export function connectorKind(c: ConnectorIdentity): ConnectorKind {
  const id = c.id.toLowerCase();
  const name = c.name.toLowerCase();

  if (id.includes('farcaster') || name.includes('farcaster')) return 'farcaster';
  if (id.includes('coinbase') || name.includes('coinbase')) return 'coinbase';
  if (id.includes('walletconnect') || name.includes('walletconnect')) return 'walletconnect';
  if (name.includes('metamask')) return 'metamask';
  if (name.includes('rabby')) return 'rabby';
  if (name.includes('brave')) return 'brave';
  if (name.includes('rainbow')) return 'rainbow';
  if (name.includes('trust')) return 'trust';
  if (name.includes('phantom')) return 'phantom';

  if (id === 'injected' && typeof window !== 'undefined') {
    const eth = (window as unknown as { ethereum?: Record<string, boolean> }).ethereum;
    if (eth) {
      if (eth.isMetaMask && !eth.isBraveWallet && !eth.isRabby) return 'metamask';
      if (eth.isRabby) return 'rabby';
      if (eth.isBraveWallet) return 'brave';
      if (eth.isRainbow) return 'rainbow';
      if (eth.isTrust) return 'trust';
      if (eth.isPhantom) return 'phantom';
    }
  }
  return 'browser';
}

const LABELS: Record<ConnectorKind, string> = {
  farcaster: 'Farcaster',
  coinbase: 'Coinbase Smart Wallet',
  metamask: 'MetaMask',
  rabby: 'Rabby',
  brave: 'Brave Wallet',
  rainbow: 'Rainbow',
  trust: 'Trust Wallet',
  phantom: 'Phantom',
  walletconnect: 'WalletConnect',
  browser: 'Browser wallet',
};

export function connectorLabel(c: ConnectorIdentity): string {
  const kind = connectorKind(c);
  // For unrecognized EIP-6963 providers, use the wallet's announced name
  // (e.g. "OKX Wallet", "Frame") rather than the generic "Browser wallet"
  // label — wagmi v2 populates connector.name from the provider's
  // EIP-6963 info.name. Only fall back when the connector is actually
  // the plain wagmi `injected` connector with no better name.
  if (kind === 'browser' && c.name && c.name.toLowerCase() !== 'injected') {
    return c.name;
  }
  return LABELS[kind];
}

const ICON_SRC: Record<Exclude<ConnectorKind, 'browser'>, string> = {
  farcaster: '/wallet-icons/farcaster.svg',
  coinbase: '/wallet-icons/coinbase.svg',
  metamask: '/wallet-icons/metamask.svg',
  rabby: '/wallet-icons/rabby.svg',
  brave: '/wallet-icons/brave.svg',
  rainbow: '/wallet-icons/rainbow.svg',
  trust: '/wallet-icons/trust.svg',
  phantom: '/wallet-icons/phantom.svg',
  walletconnect: '/wallet-icons/walletconnect.svg',
};

export function WalletIcon({ connector }: { connector: ConnectorIdentity }) {
  const kind = connectorKind(connector);
  if (kind === 'browser') {
    // EIP-6963 providers announce their own icon (base64 data URL). Prefer
    // that over the generic phosphor fallback so unknown-but-detected
    // wallets (e.g. OKX, Frame) show their real brand mark.
    if (connector.icon) {
      return (
        <img
          src={connector.icon}
          alt=""
          aria-hidden
          width={36}
          height={36}
          className="w-9 h-9 rounded-lg flex-shrink-0"
        />
      );
    }
    return (
      <span
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-100"
        aria-hidden
      >
        <Wallet className="w-5 h-5 text-gray-600" weight="fill" />
      </span>
    );
  }
  return (
    <img
      src={ICON_SRC[kind]}
      alt=""
      aria-hidden
      width={36}
      height={36}
      className="w-9 h-9 rounded-lg flex-shrink-0"
    />
  );
}
