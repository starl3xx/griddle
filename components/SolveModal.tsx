'use client';

import { useEffect, useState } from 'react';
import { formatShareText } from '@/lib/share';
import { formatMs } from '@/lib/format';
import { composeCast, useFarcaster } from '@/lib/farcaster';
import { SITE_URL } from '@/lib/site';

interface SolveModalProps {
  dayNumber: number;
  word: string;
  grid: string;
  solveMs: number;
  unassisted?: boolean;
  onPlayAgain: () => void;
  onClose: () => void;
}

export function SolveModal({
  dayNumber,
  word,
  grid,
  solveMs,
  unassisted = false,
  onPlayAgain,
  onClose,
}: SolveModalProps) {
  type ShareStatus = 'idle' | 'copied' | 'error';
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');
  const { inMiniApp } = useFarcaster();

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
      const ok = await composeCast(text, embedUrl);
      if (ok) return;
      // If composeCast failed for any reason, fall through to the Web
      // Share API chain below so we still have *some* share surface.
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
        <div className="text-5xl mb-2" aria-hidden>
          🎉
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
              className="text-accent text-lg font-bold ml-1"
              title="Unassisted solve"
              aria-label="unassisted"
            >
              ◆
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-6">
          <button
            type="button"
            onClick={handleShare}
            className="btn-accent flex-1 relative"
            aria-live="polite"
          >
            {shareLabel}
          </button>
          <button
            type="button"
            onClick={onPlayAgain}
            className="btn-secondary flex-1"
          >
            Play again
          </button>
        </div>

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
