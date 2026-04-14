'use client';

interface HowToPlayCardProps {
  onDismiss: () => void;
}

export function HowToPlayCard({ onDismiss }: HowToPlayCardProps) {
  return (
    <div className="relative w-full max-w-md mx-auto bg-brand-50 rounded-card px-5 py-4 pr-11 text-sm text-gray-800 leading-relaxed animate-fade-in">
      <span className="font-bold text-brand-700">How to play:</span> Find the 9-letter
      word using all cells. After picking a letter, dimmed cells are off-limits —
      consecutive letters can’t be neighbors. Type or tap to build your word.
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss how to play"
        className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center text-brand-400 hover:text-brand-700 hover:bg-brand-100 rounded-full transition-colors duration-fast"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="w-4 h-4"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
