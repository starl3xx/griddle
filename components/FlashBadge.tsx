'use client';

interface FlashBadgeProps {
  word: string | null;
  flashKey: number;
}

export function FlashBadge({ word, flashKey }: FlashBadgeProps) {
  return (
    <div className="h-10 flex items-center justify-center">
      {word && (
        <div
          key={flashKey}
          className="bg-accent text-white rounded-pill px-4 py-1.5 text-sm font-semibold uppercase tracking-wide animate-flash-pop shadow-btn"
        >
          {word}
        </div>
      )}
    </div>
  );
}
