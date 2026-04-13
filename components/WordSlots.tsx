'use client';

interface WordSlotsProps {
  letters: string[];
}

export function WordSlots({ letters }: WordSlotsProps) {
  return (
    <div className="flex gap-1.5 justify-center">
      {Array.from({ length: 9 }, (_, i) => {
        const letter = letters[i];
        return (
          <div
            key={i}
            className="w-7 h-10 sm:w-8 sm:h-11 border-b-2 border-gray-300 flex items-end justify-center pb-0.5"
          >
            {letter && (
              <span className="text-xl sm:text-2xl font-bold uppercase text-gray-900 animate-fade-in">
                {letter}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
