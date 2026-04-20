'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarBlank, Crown, Flame, Medal, ShareNetwork, Trophy } from '@phosphor-icons/react';
import { formatShareText } from '@/lib/share';
import { formatMs } from '@/lib/format';
import { composeCast } from '@/lib/farcaster';
import { SITE_URL } from '@/lib/site';
import { WORDMARK_BY_ID, WORDMARK_THEMES, isWordmarkId } from '@/lib/wordmarks/catalog';
import { pickOpener } from '@/lib/opener-phrases';

interface SolveModalProps {
  dayNumber: number;
  word: string;
  solveMs: number;
  unassisted?: boolean;
  /**
   * Wordmarks newly earned by this solve — returned from /api/solve.
   * Rendered as an earn strip beneath the time. Empty array = no
   * new badges, no strip shown.
   */
  earnedWordmarks?: readonly string[];
  /**
   * Post-solve summary from /api/solve. Every field is null-safe: a
   * missing datum just hides the affected row rather than failing the
   * modal render. Anonymous callers see `null` for streak / average /
   * ranks and the modal collapses to the lean share-first layout.
   */
  currentStreak: number | null;
  averageMs: number | null;
  percentileRank: number | null;
  dailyRank: number | null;
  isPremium: boolean;
  /**
   * True when the app is running inside a Farcaster mini-app container.
   * Passed down from page.tsx's single `useFarcaster()` call so we don't
   * re-run the async detection cycle on modal mount (which would leave
   * `inMiniApp=false` for the first ~2s after solving — exactly when the
   * user hits Share).
   */
  inMiniApp: boolean;
  onClose: () => void;
  /**
   * Opens the Browse modal on the Leaderboard tab (today's day). The
   * parent is responsible for closing this SolveModal first so the two
   * surfaces don't stack. Replaces the old `/leaderboard/[day]` page
   * navigation — the Browse modal is the primary leaderboard surface
   * everywhere else in the app and the post-solve link now matches.
   */
  onOpenLeaderboard: () => void;
  /** Same deal as onOpenLeaderboard, but opens the Archive tab. */
  onOpenArchive: () => void;
}

// `35s`, `1m 12s`, `2m` — reads naturally in comparison copy like
// "12s faster than your average". Unlike formatMsCompact (which
// returns `12.3s` / `2.1m`) this drops the decimal and uses a
// minute-second split so small deltas stay literal.
function formatDurationShort(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

export function SolveModal({
  dayNumber,
  word,
  solveMs,
  unassisted = false,
  earnedWordmarks = [],
  currentStreak,
  averageMs,
  percentileRank,
  dailyRank,
  isPremium,
  inMiniApp,
  onClose,
  onOpenLeaderboard,
  onOpenArchive,
}: SolveModalProps) {
  // Pin the opener phrase to this modal instance. `useMemo` with [] keeps
  // it stable across re-renders so the wording doesn't flicker if a prop
  // changes (e.g. wordmarks hydrate a tick late).
  const opener = useMemo(() => pickOpener(), []);

  // Narrow the raw id list to typed catalog entries. Unknown ids
  // (future-compat or stale rows) are dropped silently.
  const earnedBadges = earnedWordmarks
    .filter(isWordmarkId)
    .map((id) => WORDMARK_BY_ID[id]);
  type ShareStatus = 'idle' | 'copied' | 'error';
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');

  useEffect(() => {
    if (shareStatus === 'idle') return;
    const t = setTimeout(() => setShareStatus('idle'), 1800);
    return () => clearTimeout(t);
  }, [shareStatus]);

  // Fire-and-forget Megaphone award on any confirmed share success.
  // Server dedups via the (wallet, wordmark_id) unique index, so
  // spamming Share doesn't create duplicate rows. Non-blocking so the
  // UX doesn't wait on a network round-trip after a cast/native-share.
  const awardMegaphone = () => {
    fetch('/api/wordmarks/megaphone', { method: 'POST' }).catch(() => {
      /* silent — share already happened, wordmark is a nice-to-have */
    });
  };

  const handleShare = async () => {
    const message = formatShareText({
      dayNumber,
      solved: true,
      timeMs: solveMs,
      unassisted,
    });
    const embedUrl = `${SITE_URL}/?puzzle=${dayNumber}`;
    // Inline the URL in the share body. iMessage inconsistently drops
    // the `text` field when `url` is passed separately and the URL
    // generates a Link Presentation card — sometimes you get card +
    // message, sometimes just the card. Embedding the URL inside
    // `text` (and not passing a separate `url` to Web Share) sidesteps
    // that: iMessage detects the URL, renders the card, and keeps the
    // surrounding message. Farcaster keeps the split because its SDK
    // takes the embed URL separately to render a playable frame.
    const shareBody = `${message}\n${embedUrl}`;

    // Priority 1: Farcaster cast composer when we're inside a Farcaster
    // mini-app container. The embed becomes a playable Griddle frame in
    // the cast, so recipients can tap and play without leaving Farcaster.
    if (inMiniApp) {
      const result = await composeCast(message, embedUrl);
      if (result === 'cast') { awardMegaphone(); return; }
      if (result === 'cancelled') return;
      // result === 'failed' → SDK threw or unavailable. Fall through to
      // the Web Share / clipboard chain so there's still a share surface.
    }

    // Priority 2: Web Share API — OS handles the UX, no status needed.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Griddle #${dayNumber}`, text: shareBody });
        awardMegaphone();
        return;
      } catch (err) {
        // AbortError = user cancelled the native sheet, not a failure
        if (err instanceof Error && err.name === 'AbortError') return;
        // Any other error → fall through to clipboard fallback
      }
    }
    // Clipboard fallback. Only claim success if writeText actually resolved.
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(shareBody);
        setShareStatus('copied');
        awardMegaphone();
        return;
      } catch {
        // clipboard denied (insecure context, permissions, Firefox default) → error
      }
    }
    setShareStatus('error');
  };

  const shareLabel =
    shareStatus === 'copied' ? 'Copied!' : shareStatus === 'error' ? 'Copy failed' : 'Share your score';

  // Average comparison: only meaningful when there's *another* solve to
  // compare against. A single-solve average equals this solve's time, so
  // the delta would be 0 — suppress that trivial case to avoid the
  // "0s faster than your average" nonsense.
  const avgDelta =
    averageMs != null && Math.abs(solveMs - averageMs) >= 1000
      ? solveMs - averageMs
      : null;

  const showStats =
    (currentStreak != null && currentStreak > 0) ||
    avgDelta != null ||
    percentileRank != null ||
    (isPremium && dailyRank != null);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="modal-sheet animate-slide-up text-center">
        <div className="flex justify-center mb-2" aria-hidden>
          <Medal className="w-12 h-12 text-brand" weight="fill" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {opener}
        </h2>
        <p className="mt-3 text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-200">
          You solved{' '}
          <span className="tabular-nums text-brand">
            Griddle #{dayNumber.toString().padStart(3, '0')}
          </span>{' '}
          in
        </p>
        <p className="mt-2 flex items-baseline justify-center gap-2 text-5xl sm:text-6xl font-black tabular-nums text-gray-900 dark:text-gray-100">
          {formatMs(solveMs)}
          {unassisted && (
            <span
              className="text-accent inline-flex items-center"
              title="Unassisted solve"
              aria-label="unassisted"
            >
              <Crown className="w-6 h-6 sm:w-7 sm:h-7" weight="fill" aria-hidden />
            </span>
          )}
        </p>

        <p className="mt-3 text-xl font-bold uppercase tracking-widest text-brand">
          {word}
        </p>

        {/* Wordmarks earned on THIS solve. Circle badge + title +
            description — matches the Lexicon and leaderboard badge
            language (wordmarks always render as a circle) so the
            post-solve reveal reads as the same collectible the user
            will see on the Stats grid later. Absent when nothing new
            was earned. A user who already holds every wordmark solves
            and sees nothing new here — correct and intentional. */}
        {earnedBadges.length > 0 && (
          <div className="mt-4 animate-fade-in">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 text-center">
              Earned
            </p>
            <div className="mt-2 flex flex-wrap items-start justify-center gap-4">
              {earnedBadges.map((w) => {
                const theme = WORDMARK_THEMES[w.id];
                return (
                  <div key={w.id} className="flex w-24 flex-col items-center text-center">
                    <div
                      className={`w-12 h-12 rounded-full ${theme.bg} ring-2 ${theme.ring} flex items-center justify-center text-xl`}
                      aria-hidden
                    >
                      {w.emoji}
                    </div>
                    <span className="mt-1.5 text-xs font-bold leading-tight text-gray-900 dark:text-gray-100">
                      {w.name}
                    </span>
                    <span className="mt-0.5 text-[10px] font-medium leading-snug text-gray-600 dark:text-gray-400">
                      {w.description}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showStats && (
          <div className="mt-5 space-y-2">
            {currentStreak != null && currentStreak > 0 && (
              <div className="inline-flex items-center gap-1.5 rounded-pill bg-warning-50 dark:bg-warning-900/30 ring-1 ring-warning-200 dark:ring-warning-700 px-3 py-1 text-xs font-bold text-warning-700 dark:text-warning-300">
                <Flame className="w-3.5 h-3.5" weight="fill" aria-hidden />
                {currentStreak}-day streak
              </div>
            )}

            {(avgDelta != null || percentileRank != null) && (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {avgDelta != null && (
                  <>
                    <span className="tabular-nums font-semibold">
                      {formatDurationShort(Math.abs(avgDelta))}
                    </span>{' '}
                    {avgDelta < 0 ? 'faster' : 'slower'} than your average
                  </>
                )}
                {avgDelta != null && percentileRank != null && (
                  <span className="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
                )}
                {percentileRank != null && (
                  <>
                    Faster than{' '}
                    <span className="tabular-nums font-semibold">{percentileRank}%</span>{' '}
                    of solvers
                  </>
                )}
              </p>
            )}

            {isPremium && dailyRank != null && (
              <div className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 dark:bg-brand-900/30 ring-1 ring-brand-200 dark:ring-brand-700 px-3 py-1 text-xs font-bold text-brand-700 dark:text-brand-300">
                <Trophy className="w-3.5 h-3.5" weight="fill" aria-hidden />
                Rank #{dailyRank} today
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onOpenArchive}
          className="mt-5 w-full flex items-center gap-3 rounded-card border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-left transition-colors duration-fast hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <CalendarBlank
            className="w-8 h-8 text-brand flex-shrink-0"
            weight="duotone"
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              Wanna play another?
            </p>
            <p className="mt-0.5 text-sm font-semibold text-brand">
              Visit the Archive →
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={handleShare}
          className="btn-primary mt-5 w-full relative inline-flex items-center justify-center gap-2"
          aria-live="polite"
        >
          <ShareNetwork className="w-4 h-4" weight="bold" aria-hidden />
          {shareLabel}
        </button>

        <button
          type="button"
          onClick={onOpenLeaderboard}
          className="block w-full mt-4 text-sm font-semibold text-brand hover:text-brand-700 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
        >
          View today’s leaderboard →
        </button>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-fast"
        >
          close
        </button>
      </div>
    </div>
  );
}
