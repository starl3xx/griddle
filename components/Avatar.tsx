'use client';

import { User } from 'lucide-react';

interface AvatarProps {
  /** Farcaster profile picture URL. When present, renders as an img. */
  pfpUrl: string | null;
  /**
   * Legacy monogram fallback — kept on the prop type for backwards
   * compatibility with existing call sites, but no longer rendered.
   * The silhouette icon is a cleaner "unknown player" affordance than
   * a single letter pulled from the wallet address, which could be
   * mistaken for the player's initial.
   */
  monogram?: string;
  /** Size preset. `xs` is the tight-padding tile icon, `sm` fits a row,
   *  `md` is the StatsModal header. */
  size?: 'xs' | 'sm' | 'md';
}

/**
 * Shared profile avatar — Farcaster pfp when the player is authed in a
 * miniapp, neutral person-silhouette fallback otherwise. Two size
 * presets cover both current call sites (HomeTiles stat tile and
 * StatsModal header); adding more sizes here keeps both rendering
 * surfaces in lockstep.
 */
export function Avatar({ pfpUrl, size = 'md' }: AvatarProps) {
  const sizeClass =
    size === 'xs' ? 'w-7 h-7' : size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  const iconClass =
    size === 'xs' ? 'w-4 h-4' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
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
      className={`${sizeClass} rounded-full bg-brand-100 text-brand-700 flex items-center justify-center flex-shrink-0`}
      aria-label="Anonymous player"
    >
      <User className={iconClass} strokeWidth={2.5} aria-hidden />
    </div>
  );
}
