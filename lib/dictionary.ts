import rawDict from '@/data/dictionary.json';

const DICT: ReadonlySet<string> = new Set(rawDict as string[]);

export function isDictionaryWord(word: string): boolean {
  if (word.length < 4 || word.length > 8) return false;
  return DICT.has(word.toLowerCase());
}

export const DICTIONARY_SIZE = DICT.size;
