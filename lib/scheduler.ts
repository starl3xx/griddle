import { PUZZLE_BANK, type PuzzleWord } from './puzzles';

/**
 * Deterministic puzzle selection — given a day number, always return the same
 * puzzle. Currently a simple indexed pick ordered by tier (A > B > C > P) so
 * that early puzzles feel accessible. A future iteration (M4) will add the
 * 180-day no-repeat rule and swap in fresh grid arrangements from the
 * ~12,072 alternatives per word.
 */

const ORDERED_BANK: readonly PuzzleWord[] = [...PUZZLE_BANK].sort((a, b) => {
  const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2, P: 3 };
  return tierOrder[a.tier] - tierOrder[b.tier];
});

export interface DailyPuzzle {
  dayNumber: number;
  word: string;
  grid: string;
  tier: string;
}

export function getPuzzleForDay(dayNumber: number): DailyPuzzle {
  const idx = ((dayNumber - 1) % ORDERED_BANK.length + ORDERED_BANK.length) % ORDERED_BANK.length;
  const p = ORDERED_BANK[idx];
  return { dayNumber, word: p.word, grid: p.grid, tier: p.tier };
}

const LAUNCH_DATE = new Date('2026-04-13T00:00:00Z');

export function getCurrentDayNumber(now: Date = new Date()): number {
  const msPerDay = 86_400_000;
  const diff = now.getTime() - LAUNCH_DATE.getTime();
  return Math.max(1, Math.floor(diff / msPerDay) + 1);
}
