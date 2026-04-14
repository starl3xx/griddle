'use client';

interface AvatarProps {
  /** Farcaster profile picture URL. When present, renders as an img. */
  pfpUrl: string | null;
  /** Single-character fallback shown when `pfpUrl` is null (or fails). */
  monogram: string;
  /** Size preset. `sm` is used in HomeTiles, `md` in StatsModal. */
  size?: 'sm' | 'md';
}

/**
 * Shared profile avatar — Farcaster pfp when the player is authed in a
 * miniapp, brand-blue monogram fallback otherwise. Two size presets cover
 * both current call sites (HomeTiles stat tile and StatsModal header);
 * adding more sizes here keeps both rendering surfaces in lockstep.
 */
export function Avatar({ pfpUrl, monogram, size = 'md' }: AvatarProps) {
  const sizeClass = size === 'sm' ? 'w-9 h-9 text-base' : 'w-11 h-11 text-lg';
  if (pfpUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={pfpUrl}
        alt=""
        className={`${sizeClass} rounded-full bg-gray-100 object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-black flex-shrink-0`}
    >
      {monogram}
    </div>
  );
}
