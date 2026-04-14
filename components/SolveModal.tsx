'use client';

import { useEffect, useState } from 'react';
import { Diamond, Confetti, ShareNetwork, ArrowCounterClockwise } from '@phosphor-icons/react';
import { formatShareText } from '@/lib/share';
import { formatMs } from '@/lib/format';
import { composeCast } from '@/lib/farcaster';
import { SITE_URL } from '@/lib/site';

interface SolveModalProps {
  dayNumber: number;
  word: string;
  grid: string;
  solveMs: number;
  unassisted?: boolean;
  /**
   * True when the app is running inside a Farcaster mini-app container.
   * Passed down from page.tsx’s single `useFarcaster()` call so we don’t
   * re-run the async detection cycle on modal mount (which would leave
   * `inMiniApp=false` for the first ~2s after solving — exactly when the
   * user hits Share).
   */
  inMiniApp: boolean;
  onPlayAgain: () => void;
  onClose: () => void;
}

export function SolveModal({
  dayNumber,
  word,
  grid,
  solveMs,
  unassisted = false,
  inMiniApp,
  onPlayAgain,
  onClose,
}: SolveModalProps) {
  type ShareStatus = 'idle' | 'copied' | 'error';
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');

  useEffect(() => {
    if (shareStatus === 'idle') return;
    const t = setTimeout(() => setShareStatus('idle'), 1800);
    return () => clearTimeout(t);
  }, [shareStatus]);

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
      if (result === 'cast') return;
      if (result === 'cancelled') return;
      // result === 'failed' → SDK threw or unavailable. Fall through to
      // the Web Share / clipboard chain so there’s still a share surface.
    }

    // Priority 2: Web Share API — OS handles the UX, no status needed.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Griddle #${dayNumber}`, text, url: embedUrl });
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
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in">
      <div className="modal-sheet sm:rounded-card animate-slide-up text-center">
        <div className="flex justify-center mb-2" aria-hidden>
          <Confetti className="w-12 h-12 text-accent" weight="fill" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
          Solved!
        </h2>
        <p className="text-sm text-gray-500 mt-1 tabular-nums">
          Griddle #{dayNumber.toString().padStart(3, '0')}
        </p>

        <p className="mt-4 text-xl sm:text-2xl font-bold uppercase tracking-wider text-brand">
          {word}
        </p>

        <div className="mt-4 inline-flex items-baseline gap-2">
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
              <Diamond className="w-4 h-4" weight="fill" aria-hidden />
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-6">
          <button
            type="button"
            onClick={handleShare}
            className="btn-accent flex-1 relative inline-flex items-center justify-center gap-2"
            aria-live="polite"
          >
            <ShareNetwork className="w-4 h-4" weight="bold" aria-hidden />
            {shareLabel}
          </button>
          <button
            type="button"
            onClick={onPlayAgain}
            className="btn-secondary flex-1 inline-flex items-center justify-center gap-2"
          >
            <ArrowCounterClockwise className="w-4 h-4" weight="bold" aria-hidden />
            Play again
          </button>
        </div>

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
