import rawPuzzles from '@/data/puzzles.json';

export type Tier = 'A' | 'B' | 'C' | 'P';

export interface PuzzleWord {
  word: string;
  grid: string;
  tier: Tier;
}

export const PUZZLE_BANK: readonly PuzzleWord[] = rawPuzzles as PuzzleWord[];

export const PUZZLE_COUNT = PUZZLE_BANK.length;

/**
 * Safety: every grid must hide the first letter of its target word. Having
 * word[0] sitting in cell 0 (top-left) is a huge visual spoiler — players’
 * eyes land there first and the puzzle answer is half-revealed. The bank
 * is preprocessed by `scripts/fix-grids.mjs` to enforce this; this guard
 * runs once at module load and throws loudly if a future data edit
 * silently regresses. Cost is 279 string comparisons — negligible.
 */
for (const p of PUZZLE_BANK) {
  if (p.grid[0] === p.word[0]) {
    throw new Error(
      `Puzzle "${p.word}" leaks its first letter at cell 0 — run scripts/fix-grids.mjs`,
    );
  }
}
