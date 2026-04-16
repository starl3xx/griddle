'use client';

import { Crown, Check } from '@phosphor-icons/react';

/**
 * Canonical list of Premium benefits surfaced on every upsell gate.
 * Keeping this one-list-one-import means the Leaderboard, Archive,
 * Stats, and Settings gate screens never drift from each other on
 * feature messaging. Reorder by priority, not alphabetical — the
 * first items are what gets scanned first in a 2-second glance.
 */
export const PREMIUM_BENEFITS: readonly string[] = [
  'Daily ranked leaderboards',
  'Full puzzle archive',
  'Detailed stats dashboard',
  'Streak protection (once a week)',
  'Unassisted solve mode',
  'Wordmarks & Lexicon tracking',
];

interface PremiumBenefitsListProps {
  /**
   * Contextual sentence rendered above the list, usually describing
   * the single benefit the user is bumping into right now (e.g. the
   * ranked leaderboard on the Leaderboard gate). Optional — callers
   * that don't have a specific hook can omit.
   */
  hook?: string;
  onUpgrade: () => void;
}

export function PremiumBenefitsList({ hook, onUpgrade }: PremiumBenefitsListProps) {
  return (
    <div className="py-6 flex flex-col items-center gap-4">
      <Crown className="w-8 h-8 text-accent" weight="fill" aria-hidden />
      {hook && (
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed max-w-xs text-center">
          {hook}
        </p>
      )}
      <ul className="self-center space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
        {PREMIUM_BENEFITS.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <Check
              className="w-4 h-4 text-accent flex-shrink-0 mt-0.5"
              weight="bold"
              aria-hidden
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onUpgrade}
        className="btn-accent !py-3 !px-6 text-sm"
      >
        Upgrade to Premium
      </button>
    </div>
  );
}
