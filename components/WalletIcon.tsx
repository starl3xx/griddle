import { Wallet } from '@phosphor-icons/react';

/**
 * Brand-matched icon + display label for a wagmi connector.
 *
 * Keeping the mapping inline (rather than importing per-brand SVG
 * files) sidesteps an extra network request per wallet tile and lets
 * each mark stay a crisp vector at any size. The `kind` returned by
 * `connectorKind()` is also what the picker uses for the visible
 * label — so renaming "Injected" to "MetaMask" / "Rabby" / "Browser
 * wallet" and swapping the icon stay in lockstep.
 *
 * The icon swatch is a fixed 36×36 rounded square so every tile
 * aligns regardless of the underlying SVG's viewBox.
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
  | 'browser';

export interface ConnectorIdentity {
  id: string;
  name: string;
  icon?: string;
}

/**
 * Classify a wagmi connector into a brand bucket. For the generic
 * `injected` connector we peek at `window.ethereum` flags — the
 * de-facto way dapps identify which extension is actually installed,
 * since the connector itself reports `name: "Injected"`.
 */
export function connectorKind(c: ConnectorIdentity): ConnectorKind {
  const id = c.id.toLowerCase();
  const name = c.name.toLowerCase();

  if (id.includes('farcaster') || name.includes('farcaster')) return 'farcaster';
  if (id.includes('coinbase') || name.includes('coinbase')) return 'coinbase';
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
  browser: 'Browser wallet',
};

export function connectorLabel(c: ConnectorIdentity): string {
  return LABELS[connectorKind(c)];
}

export function WalletIcon({ connector }: { connector: ConnectorIdentity }) {
  const kind = connectorKind(connector);
  return (
    <span
      className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0"
      style={{ background: SWATCH_BG[kind] }}
      aria-hidden
    >
      {MARKS[kind]()}
    </span>
  );
}

const SWATCH_BG: Record<ConnectorKind, string> = {
  farcaster: '#F3EEFC',
  coinbase: '#0052FF',
  metamask: '#FFF4EB',
  rabby: '#EEF3FF',
  brave: '#FFEEE6',
  rainbow: '#F4F8FF',
  trust: '#E8F2FF',
  phantom: '#F0ECFF',
  browser: '#F3F4F6',
};

// Marks are kept intentionally simple — flat single-path logos scale
// cleanly at 20 px and don't need to reproduce the full brand art.
// Each path uses the brand's primary color.
const MARKS: Record<ConnectorKind, () => React.ReactElement> = {
  farcaster: () => (
    <svg viewBox="0 0 1000 1000" className="w-5 h-5">
      <path
        fill="#855DCD"
        d="M257.778 155.556h484.444v688.889h-71.111v-315.556h-0.697c-7.86-86.964-80.934-155.556-170.414-155.556-89.48 0-162.554 68.592-170.414 155.556h-0.697v315.556H257.778V155.556z"
      />
      <path
        fill="#855DCD"
        d="M128.889 253.333l28.889 97.778h24.444v395.556c-12.273 0-22.222 9.949-22.222 22.222v26.667h-4.444c-12.273 0-22.222 9.949-22.222 22.222v26.666H382.222v-26.666c0-12.273-9.949-22.222-22.222-22.222h-4.444v-26.667c0-12.273-9.95-22.222-22.223-22.222h-26.666V253.333H128.889z"
      />
      <path
        fill="#855DCD"
        d="M675.556 746.667c-12.273 0-22.223 9.949-22.223 22.222v26.667h-4.444c-12.273 0-22.222 9.949-22.222 22.222v26.666H875.556v-26.666c0-12.273-9.95-22.222-22.223-22.222h-4.444v-26.667c0-12.273-9.949-22.222-22.222-22.222V351.111h24.444l28.889-97.778H702.222v493.334h-26.666z"
      />
    </svg>
  ),
  coinbase: () => (
    <svg viewBox="0 0 32 32" className="w-5 h-5">
      <circle cx="16" cy="16" r="16" fill="#0052FF" />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M16 22.4a6.4 6.4 0 1 1 6.315-7.473H15.68a1.067 1.067 0 0 0-1.067 1.067v.853c0 .59.478 1.067 1.067 1.067h6.635A6.4 6.4 0 0 1 16 22.4Z"
        clipRule="evenodd"
      />
    </svg>
  ),
  metamask: () => (
    // Simplified flat fox silhouette — keeps the MetaMask orange +
    // signature chevron outline recognizable at 20 px without
    // reproducing the full 3D illustration.
    <svg viewBox="0 0 32 32" className="w-5 h-5">
      <path fill="#E2761B" d="M26.5 4 17.6 10.6 19.3 6.8z" />
      <path fill="#E2761B" d="M5.5 4l8.8 6.7-1.6-3.9z" />
      <path
        fill="#F6851B"
        d="M22.7 20.5 20.3 24l5 1.4 1.5-5.3zm-17.6-.4L6.5 25.4l5-1.4-2.4-3.5z"
      />
      <path
        fill="#E4761B"
        d="M11.2 14.5 9.8 16.6l5 .2-.2-5.4zm9.6 0-3.5-3.2-.1 5.5 5-.2zM11.5 24l3-1.5-2.6-2zm6.1-1.5 3 1.5-.4-3.5z"
      />
    </svg>
  ),
  rabby: () => (
    <svg viewBox="0 0 32 32" className="w-5 h-5">
      <path
        fill="#7084FF"
        d="M16 6c5.523 0 10 4.477 10 10 0 4.59-3.093 8.456-7.307 9.628l.019-3.42c0-1.71-.863-3.31-2.28-4.27l-2.77-1.876a1.2 1.2 0 0 1-.528-.994v-.022c0-.597.406-1.117.984-1.262l4.75-1.187a3.3 3.3 0 0 0 2.491-3.194V8.57A9.97 9.97 0 0 0 16 6Zm-3.7 14.6a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z"
      />
    </svg>
  ),
  brave: () => (
    <svg viewBox="0 0 32 32" className="w-5 h-5">
      <path
        fill="#FB542B"
        d="m16 27 8-4v-8l-2-5-3-3h-3l-2 2h-4l-2-2H5l-3 3-2 5v8zm0-14 4 3-4 4-4-4z"
      />
    </svg>
  ),
  rainbow: () => (
    <svg viewBox="0 0 32 32" className="w-5 h-5">
      <rect width="32" height="32" rx="8" fill="url(#rbw)" />
      <defs>
        <linearGradient id="rbw" x1="0" x2="32" y1="0" y2="32">
          <stop offset="0" stopColor="#174299" />
          <stop offset=".3" stopColor="#FC5BC5" />
          <stop offset=".6" stopColor="#FFB913" />
          <stop offset="1" stopColor="#17A9FD" />
        </linearGradient>
      </defs>
      <path
        fill="#fff"
        d="M8 22h2a4 4 0 0 1 4 4v0h2a6 6 0 0 0-6-6h-2v2Zm0-4h2a10 10 0 0 1 10 10h2c0-6.627-5.373-12-12-12v2Zm0-4h2c7.732 0 14 6.268 14 14h2c0-8.837-7.163-16-16-16v2Z"
      />
    </svg>
  ),
  trust: () => (
    <svg viewBox="0 0 32 32" className="w-5 h-5">
      <path
        fill="#3375BB"
        d="M16 4 6 7v8.5c0 5.7 3.9 11 10 12.5 6.1-1.5 10-6.8 10-12.5V7z"
      />
      <path fill="#fff" d="M16 8v16c-4.2-1.3-7-5-7-9V9.5z" opacity=".25" />
    </svg>
  ),
  phantom: () => (
    <svg viewBox="0 0 32 32" className="w-5 h-5">
      <rect width="32" height="32" rx="8" fill="#AB9FF2" />
      <path
        fill="#fff"
        d="M23 16.5a7 7 0 1 0-11.67 5.2c.2.18.5.04.5-.23v-3.2c0-.8.64-1.44 1.43-1.44.63 0 1.17.4 1.37 1l.35 1.08a.54.54 0 0 0 1 0l.35-1.08c.2-.6.74-1 1.37-1 .79 0 1.43.64 1.43 1.43v3.2c0 .28.3.42.5.24A6.98 6.98 0 0 0 23 16.5Z"
      />
    </svg>
  ),
  browser: () => <Wallet className="w-5 h-5 text-gray-600" weight="fill" />,
};
