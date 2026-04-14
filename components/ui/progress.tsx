import * as React from 'react';

import { cn } from '@/lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

function Progress({ className, value = 0, ...props }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-pill bg-gray-100',
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full bg-brand transition-all duration-normal"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
