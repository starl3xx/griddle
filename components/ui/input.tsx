import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Wrapped in `forwardRef` because form libraries (react-hook-form etc.)
 * and focus-management code routinely need a ref to the underlying
 * input element. React 18 silently drops refs passed to function
 * components that don't use `forwardRef`, even when the TS prop type
 * says `ref` is allowed — so without this wrapper, `<Input ref={r} />`
 * typechecks but the ref is never assigned at runtime.
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          'flex h-9 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1 text-sm text-gray-900 dark:text-gray-100 shadow-sm transition-colors duration-fast file:border-0 file:bg-transparent file:text-sm file:font-semibold placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
