'use client';

import { useState } from 'react';
import { FAQ_ITEMS, type FaqItem } from '@/lib/faq-data';

interface FaqAccordionProps {
  /** Override the shared FAQ set if a caller wants a trimmed list. */
  items?: FaqItem[];
}

/**
 * Accordion-style FAQ, modeled on the `FAQSheet` component in
 * Let’s Have A Word. Clicking a question expands its answer inline and
 * collapses any other open question. Used both in the standalone /faq
 * page and inside the Settings modal — there’s no link-out, the
 * expansion happens in whatever container hosts the accordion.
 */
export function FaqAccordion({ items = FAQ_ITEMS }: FaqAccordionProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const open = expandedIndex === index;
        return (
          <div
            key={item.question}
            className="border border-gray-200 dark:border-gray-700 rounded-btn overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setExpandedIndex(open ? null : index)}
              aria-expanded={open}
              className="w-full text-left p-3 bg-gray-50 dark:bg-gray-700/40 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors duration-fast flex items-center justify-between"
            >
              <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm pr-2">
                {item.question}
              </span>
              <span className="text-gray-500 text-xl leading-none flex-shrink-0 w-4 text-center">
                {open ? '−' : '+'}
              </span>
            </button>
            {open && (
              <div className="p-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  {item.answer}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
