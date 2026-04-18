'use client';

import { Gear } from '@phosphor-icons/react';
import { getDefaultAvatarDataUri } from '@/lib/default-avatar';

interface SettingsButtonProps {
  onClick: () => void;
  /**
   * Profile avatar URL (wallet-linked profiles set it via PATCH, email
   * profiles can set it too). When present, the button shows the image
   * instead of the gear icon — same affordance, personalized.
   */
  avatarUrl?: string | null;
  /** Farcaster pfp fallback for miniapp users who haven't set avatarUrl. */
  pfpUrl?: string | null;
  /**
   * Identifier (handle, wallet, email) used to derive a deterministic
   * monogram tile when no `avatarUrl`/`pfpUrl` is present. Lets a
   * signed-in free user see their colored initial here instead of a
   * generic gear. When omitted (truly anonymous viewer) the button
   * keeps its gear icon — there's no identity to monogram yet.
   */
  seed?: string | null;
}

/**
 * Top-right settings affordance. Absolute-positioned so the centered
 * header doesn't reflow around it. Renders as a gear icon for the
 * truly-anonymous viewer, the user's monogram tile once they have an
 * identity (handle/wallet), and their Farcaster/uploaded photo when
 * one is set. Click opens the SettingsModal in the parent.
 *
 * `top` is tuned to put the gear's vertical center on the same axis
 * as the "Griddle" wordmark so the two read as one header row. The
 * wordmark sits at main’s `pt-4`, so the gear follows suit — offset
 * down the difference between the h1 line-height and the 40px button
 * box. Breakpoints match the h1's mobile→sm font-size jump.
 *
 * The profile avatarUrl wins over the Farcaster pfpUrl — a user who
 * explicitly uploads an image shouldn't see their Farcaster photo here
 * just because they're inside a miniapp.
 */
export function SettingsButton({ onClick, avatarUrl, pfpUrl, seed }: SettingsButtonProps) {
  // Stay on `||` (not `??`) end-to-end so empty-string variants of
  // either source — `avatarUrl=null, pfpUrl=""` slipping in from a
  // sync that wrote a blank string — still fall through to the
  // monogram instead of rendering an empty <img>.
  const explicit = avatarUrl || pfpUrl;
  const monogram = !explicit && seed ? getDefaultAvatarDataUri(seed) : null;
  const imgSrc = explicit || monogram;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open settings"
      title="Settings"
      className="absolute top-4 right-3 sm:top-5 sm:right-4 w-10 h-10 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-card text-gray-500 dark:text-gray-400 hover:text-brand hover:border-brand-200 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-gray-700 flex items-center justify-center transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand z-30 overflow-hidden"
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      ) : (
        <Gear className="w-5 h-5" weight="bold" aria-hidden />
      )}
    </button>
  );
}
