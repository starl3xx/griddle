import rawPuzzles from '@/data/puzzles.json';

export type Tier = 'A' | 'B' | 'C' | 'P';

export interface PuzzleWord {
  word: string;
  grid: string;
  tier: Tier;
}

export const PUZZLE_BANK: readonly PuzzleWord[] = rawPuzzles as PuzzleWord[];

export const PUZZLE_COUNT = PUZZLE_BANK.length;
