'use client';

import { Gear } from '@phosphor-icons/react';

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
}

/**
 * Top-right settings affordance. Absolute-positioned so the centered
 * header doesn't reflow around it. Renders as a gear icon by default,
 * swaps to the user's avatar when one is available. Click opens the
 * SettingsModal in the parent.
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
export function SettingsButton({ onClick, avatarUrl, pfpUrl }: SettingsButtonProps) {
  const imgSrc = avatarUrl || pfpUrl;
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
