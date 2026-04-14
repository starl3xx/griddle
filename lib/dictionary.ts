/**
 * Lazy-loaded English dictionary (4-to-8 letter words) for the
 * "found a shorter word" flash badge.
 *
 * Why lazy? The bundled JSON is ~200 kB raw / ~60 kB gzipped — it’s
 * the dominant single chunk in the client bundle. Most of that cost is
 * borne by users who load the page and bounce without ever typing a
 * letter. Switching from a static `import rawDict from '...'` to a
 * dynamic `await import(...)` lets the bundler split it into a
 * separate chunk that only loads when actually needed.
 *
 * Lifecycle:
 *   1. Module import: zero work, just exports the loader functions
 *   2. First call to `prefetchDictionary()` (typically the first
 *      keystroke): triggers the dynamic import, kicks off the chunk
 *      download in the background
 *   3. First call to `isDictionaryWord()`: awaits the same promise
 *      (already in flight from prefetch), then does the Set lookup
 *
 * The promise is memoized in a module-level variable so the dynamic
 * import only fires once per page session.
 */

let dictPromise: Promise<ReadonlySet<string>> | null = null;

function loadDict(): Promise<ReadonlySet<string>> {
  if (dictPromise === null) {
    dictPromise = import('@/data/dictionary.json').then(
      (mod) => new Set(mod.default as string[]) as ReadonlySet<string>,
    );
  }
  return dictPromise;
}

/**
 * Kick off the dictionary download without waiting for it. Call this
 * the first time the user starts interacting with the grid so the
 * dictionary is warm by the time they’ve typed 4 letters.
 */
export function prefetchDictionary(): void {
  void loadDict();
}

/**
 * Returns true if `word` is a valid English word in the 4-8 letter
 * range. Async because the dictionary is lazy-loaded — first call
 * after page load may take ~50-100ms while the chunk downloads.
 * Subsequent calls resolve from the in-memory Set in microseconds.
 */
export async function isDictionaryWord(word: string): Promise<boolean> {
  if (word.length < 4 || word.length > 8) return false;
  const dict = await loadDict();
  return dict.has(word.toLowerCase());
}
