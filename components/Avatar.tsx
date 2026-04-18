'use client';

import { getDefaultAvatarDataUri } from '@/lib/default-avatar';

interface AvatarProps {
  /** Custom or Farcaster avatar URL. When present, renders as an img. */
  pfpUrl: string | null;
  /**
   * Identifying string (handle, wallet, email, fid) used to derive a
   * deterministic monogram fallback when `pfpUrl` is null. Passing the
   * same seed always renders the same color + letter, so a user's row
   * looks the same in the leaderboard, the modal, and the gear button.
   * Falls through to "guest" when omitted, which produces the same
   * neutral tile every signed-out viewer sees.
   */
  seed?: string | null;
  /** Size preset. `xs` is the tight-padding tile icon, `sm` fits a row,
   *  `md` is the StatsModal header. */
  size?: 'xs' | 'sm' | 'md';
}

/**
 * Shared profile avatar. Custom upload (Premium) or Farcaster pfp wins
 * when set; otherwise falls back to a deterministic colored monogram
 * derived from `seed`. The monogram replaces the silhouette icon so
 * free users see a real, identifying tile — Premium upgrade is about
 * customizing the photo, not having one at all.
 */
export function Avatar({ pfpUrl, seed, size = 'md' }: AvatarProps) {
  const sizeClass =
    size === 'xs' ? 'w-7 h-7' : size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  const src = pfpUrl ?? getDefaultAvatarDataUri(seed ?? 'guest');
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      className={`${sizeClass} rounded-full bg-gray-100 object-cover flex-shrink-0`}
    />
  );
}
