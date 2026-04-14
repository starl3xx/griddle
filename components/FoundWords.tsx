'use client';

interface FoundWordsProps {
  words: string[];
}

/**
 * Horizontal pill strip of 4-8 letter words the player has built on
 * their way to the target 9-letter solution. The list persists across
 * backspaces — reset() and a confirmed solve are the only things that
 * clear it. Newest-first ordering mirrors the dictionary hit order from
 * useGriddle.
 *
 * Renders nothing when the list is empty so it doesn't consume vertical
 * rhythm on a fresh attempt.
 */
export function FoundWords({ words }: FoundWordsProps) {
  if (words.length === 0) return null;

  return (
    <div className="w-full max-w-[420px] flex flex-col items-center gap-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Found along the way
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {words.map((w) => (
          <span
            key={w}
            className="inline-flex items-center rounded-pill bg-brand-50 text-brand-700 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider tabular-nums"
            title={`${w.length} letters`}
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}
