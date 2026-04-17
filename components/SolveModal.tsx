'use client';

import { useEffect, useState } from 'react';
import { Crown, Medal, ShareNetwork } from '@phosphor-icons/react';
import { formatShareText } from '@/lib/share';
import { formatMs } from '@/lib/format';
import { composeCast } from '@/lib/farcaster';
import { SITE_URL } from '@/lib/site';
import { WORDMARK_BY_ID, isWordmarkId } from '@/lib/wordmarks/catalog';

interface SolveModalProps {
  dayNumber: number;
  word: string;
  grid: string;
  solveMs: number;
  unassisted?: boolean;
  /**
   * Wordmarks newly earned by this solve — returned from /api/solve.
   * Rendered as an earn strip beneath the time. Empty array = no
   * new badges, no strip shown.
   */
  earnedWordmarks?: readonly string[];
  /**
   * True when the app is running inside a Farcaster mini-app container.
   * Passed down from page.tsx’s single `useFarcaster()` call so we don’t
   * re-run the async detection cycle on modal mount (which would leave
   * `inMiniApp=false` for the first ~2s after solving — exactly when the
   * user hits Share).
   */
  inMiniApp: boolean;
  onClose: () => void;
}

export function SolveModal({
  dayNumber,
  word,
  grid,
  solveMs,
  unassisted = false,
  earnedWordmarks = [],
  inMiniApp,
  onClose,
}: SolveModalProps) {
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
    const text = formatShareText({
      dayNumber,
      grid,
      solved: true,
      timeMs: solveMs,
      unassisted,
    });
    const embedUrl = `${SITE_URL}/?puzzle=${dayNumber}`;

    // Priority 1: Farcaster cast composer when we’re inside a Farcaster
    // mini-app container. The embed becomes a playable Griddle frame in
    // the cast, so recipients can tap and play without leaving Farcaster.
    if (inMiniApp) {
      const result = await composeCast(text, embedUrl);
      if (result === 'cast') { awardMegaphone(); return; }
      if (result === 'cancelled') return;
      // result === 'failed' → SDK threw or unavailable. Fall through to
      // the Web Share / clipboard chain so there’s still a share surface.
    }

    // Priority 2: Web Share API — OS handles the UX, no status needed.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Griddle #${dayNumber}`, text, url: embedUrl });
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
        await navigator.clipboard.writeText(text);
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
    shareStatus === 'copied' ? 'Copied!' : shareStatus === 'error' ? 'Copy failed' : 'Share';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="modal-sheet animate-slide-up text-center">
        <div className="flex justify-center mb-2" aria-hidden>
          <Medal className="w-12 h-12 text-brand" weight="fill" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
          Solved!
        </h2>
        <p className="text-sm text-gray-500 mt-1 tabular-nums">
          Griddle #{dayNumber.toString().padStart(3, '0')}
        </p>

        <p className="mt-4 text-xl sm:text-2xl font-bold uppercase tracking-wider text-brand">
          {word}
        </p>

        <div className="mt-4 flex items-baseline justify-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Time
          </span>
          <span className="text-3xl font-black text-gray-900 tabular-nums">
            {formatMs(solveMs)}
          </span>
          {unassisted && (
            <span
              className="text-accent ml-1 inline-flex items-center"
              title="Unassisted solve"
              aria-label="unassisted"
            >
              <Crown className="w-4 h-4" weight="fill" aria-hidden />
            </span>
          )}
        </div>

        {/* Wordmarks earned on THIS solve. Small pill strip beneath
            the time; absent when nothing new was earned. A user who
            already holds every wordmark solves and sees nothing new
            here — correct and intentional. */}
        {earnedBadges.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 animate-fade-in">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Earned
            </span>
            {earnedBadges.map((w) => (
              <span
                key={w.id}
                className="inline-flex items-center gap-1 rounded-pill bg-accent/10 text-accent-800 dark:text-accent-200 border border-accent/30 px-2 py-0.5 text-[11px] font-bold"
                title={w.description}
              >
                <span aria-hidden>{w.emoji}</span>
                {w.name}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleShare}
          className="btn-accent mt-6 w-full relative inline-flex items-center justify-center gap-2"
          aria-live="polite"
        >
          <ShareNetwork className="w-4 h-4" weight="bold" aria-hidden />
          {shareLabel}
        </button>

        <a
          href={`/leaderboard/${dayNumber}`}
          className="block mt-4 text-sm font-semibold text-brand hover:text-brand-700 transition-colors duration-fast"
        >
          View today’s leaderboard →
        </a>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 text-sm text-gray-400 hover:text-gray-600 transition-colors duration-fast"
        >
          close
        </button>
      </div>
    </div>
  );
}
