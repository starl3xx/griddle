'use client';

interface TutorialModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function TutorialModal({ open, onDismiss }: TutorialModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="modal-sheet animate-slide-up">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Welcome to Griddle
        </h2>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1">
          A daily 3×3 word puzzle
        </p>

        <div className="my-5">
          <TinyGridIllustration />
        </div>

        <ul className="space-y-2 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-brand font-bold">1.</span>
            <span>
              Find the hidden 9-letter word using every tile exactly once.
              Words can begin with any tile.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-brand font-bold">2.</span>
            <span>
              Consecutive letters <strong>cannot be</strong> direct neighbors —
              dimmed tiles are off-limits.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-brand font-bold">3.</span>
            <span>
              Type on your keyboard or tap tiles. Backspace to undo, Reset to
              clear.
            </span>
          </li>
        </ul>

        <button type="button" onClick={onDismiss} className="btn-primary w-full mt-6">
          Got it
        </button>
      </div>
    </div>
  );
}

function TinyGridIllustration() {
  /**
   * 3×3 diagram: center cell (idx 4) is "current" — solid brand blue.
   * The four orthogonal neighbors (1, 3, 5, 7) are "blocked" — dimmed
   * gray signals "off-limits". The four diagonal corners (0, 2, 6, 8)
   * are "available" — pale green tint signals "go". Same visual story
   * as the real game grid.
   */
  const state = [
    'available',
    'blocked',
    'available',
    'blocked',
    'current',
    'blocked',
    'available',
    'blocked',
    'available',
  ] as const;

  const cls: Record<(typeof state)[number], string> = {
    available: 'bg-success-100 dark:bg-success-900/30 border-success-300 dark:border-success-700',
    blocked: 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600',
    current: 'bg-brand border-brand',
  };

  return (
    <div className="mx-auto w-fit grid grid-cols-3 gap-1.5">
      {state.map((s, i) => (
        <div
          key={i}
          className={`w-11 h-11 rounded-md border-2 ${cls[s]}`}
        />
      ))}
    </div>
  );
}
