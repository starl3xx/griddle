'use client';

interface TutorialModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function TutorialModal({ open, onDismiss }: TutorialModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in">
      <div className="modal-sheet sm:rounded-card animate-slide-up">
        <h2 className="text-2xl font-black tracking-tight text-gray-900">
          Welcome to Griddle
        </h2>
        <p className="text-sm font-medium text-gray-500 mt-1">
          A daily 3×3 word puzzle
        </p>

        <div className="my-5">
          <TinyGridIllustration />
        </div>

        <ul className="space-y-2 text-sm text-gray-800 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-brand font-bold">1.</span>
            <span>Find the hidden 9-letter word using every cell exactly once.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-brand font-bold">2.</span>
            <span>
              Consecutive letters can’t be direct neighbors — crossed-out cells are
              off-limits.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-brand font-bold">3.</span>
            <span>Type on your keyboard or tap cells. Backspace to undo.</span>
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
   * The four orthogonal neighbors (1, 3, 5, 7) are "blocked" — pale
   * gray, no X overlay, color alone signals "off-limits". The four
   * diagonal corners (0, 2, 6, 8) are "available" — pale green tint
   * signals "go". Same visual story as the real game grid.
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
    available: 'bg-success-50 border-success-200',
    blocked: 'bg-gray-100 border-gray-200',
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
