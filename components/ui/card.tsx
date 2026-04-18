import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn-style card. Uses Griddle's existing `rounded-card` +
 * `shadow-card` tokens so admin cards share the same rhythm as
 * the game modals (SolveModal / TutorialModal / StatsModal).
 *
 * Hover shadow bump is subtle — not every card is clickable, so we
 * avoid implying interactivity.
 */
function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col gap-6 rounded-card border border-gray-200 dark:border-gray-700 py-6 shadow-sm hover:shadow-card transition-shadow duration-normal',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 [&.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-bold text-gray-900 dark:text-gray-100 tracking-tight', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm font-medium text-gray-500 dark:text-gray-400', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="card-content" className={cn('px-6', className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 [&.border-t]:pt-6', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
