'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';

/**
 * Click-to-reveal for puzzle answers. Hidden by default so the admin
 * doesn't spoil today/upcoming by walking past a tab or the Pulse
 * overview, revealed on explicit click. Bullets (not blur) are used
 * for the hidden state — blurred bold text still leaks word shape,
 * and bullets also hide the exact letter count since every puzzle is
 * padded to the same width (`MAX_WIDTH`).
 */
const MAX_WIDTH = 12;

export function SpoilerAnswer({
  answer,
  revealed,
  onToggle,
  size,
}: {
  answer: string;
  revealed: boolean;
  onToggle: () => void;
  size: 'lg' | 'sm';
}) {
  const label = revealed ? 'Hide answer' : 'Reveal answer';
  const Icon = revealed ? EyeSlash : Eye;
  const hidden = '•'.repeat(MAX_WIDTH);
  if (size === 'lg') {
    return (
      <div className="inline-flex items-center gap-2">
        <span
          className="text-2xl font-black tracking-widest text-gray-900 dark:text-gray-100"
          aria-hidden={!revealed}
        >
          {revealed ? answer.toUpperCase() : hidden}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          title={label}
          className="rounded-md p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Icon className="w-4 h-4" weight="bold" />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="group inline-flex items-center gap-1.5 font-mono tracking-wider text-gray-800 dark:text-gray-200"
    >
      <span aria-hidden={!revealed}>
        {revealed ? answer : hidden}
      </span>
      <Icon className="w-3 h-3 text-gray-400 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-200 transition-colors" weight="bold" />
    </button>
  );
}
