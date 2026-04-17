'use client';

import { Play } from '@phosphor-icons/react';

interface StartGateProps {
  onStart: () => void;
  /** Disable while the /api/puzzle/start POST is in flight. */
  pending: boolean;
}

/**
 * Centered Start button + subtitle that sits on top of the blurred
 * grid until the player commits. Tap / click triggers the Start POST
 * in the parent — the blur and pointer-events gating are handled by
 * the parent's wrapper div.
 *
 * Absolute positioning with `inset-0` lets the gate fill whatever area
 * the parent sizes it over. Parent is `position: relative`.
 */
export function StartGate({ onStart, pending }: StartGateProps) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
      <button
        type="button"
        onClick={onStart}
        disabled={pending}
        className="btn-primary text-xl sm:text-2xl font-black uppercase tracking-wider px-8 py-4 inline-flex items-center gap-2 shadow-lg disabled:opacity-60"
      >
        <Play className="w-5 h-5" weight="fill" aria-hidden />
        Start
      </button>
      <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300 text-center px-4">
        Timer starts immediately
      </p>
    </div>
  );
}
