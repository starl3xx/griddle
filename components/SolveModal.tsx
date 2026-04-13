'use client';

import { useEffect, useState } from 'react';
import { formatShareText } from '@/lib/share';
import { formatMs } from '@/lib/format';

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const handleShare = async () => {
    const text = formatShareText({
      dayNumber,
      grid,
      solved: true,
      timeMs: solveMs,
      unassisted,
    });
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        await navigator.share({ title: `Griddle #${dayNumber}`, text });
        return;
      }
    } catch {
      // user cancelled or share unsupported — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(true);
    }
  };

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
          >
            {copied ? 'Copied!' : 'Share'}
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
