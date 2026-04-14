import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind class merger used by the shadcn-style primitives in
 * `components/ui/*`. `clsx` handles conditional class composition
 * (strings, arrays, objects, falsy), `twMerge` resolves conflicts
 * between later classes overriding earlier ones (e.g. `px-4` + `px-6`
 * → `px-6`). Shadcn's canonical `cn` helper — we keep the same name
 * so ported components work without edits.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
