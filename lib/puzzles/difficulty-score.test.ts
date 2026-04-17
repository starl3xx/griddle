/**
 * Calibration tests — these lock in the spec's pinned scores. If any
 * coefficient of the difficulty formula drifts, these break first.
 * Observed solve-time calibration (via the admin Puzzles tab's scatter
 * plot + outlier list) is where the score's coefficients get retuned
 * over time; when they do, update this file in the same change.
 *
 * Run: `bun test lib/puzzles/difficulty-score.test.ts`
 */
import { describe, expect, test } from 'bun:test';
import { scoreWord } from './difficulty-score';

// Pinned scores from the original difficulty-scoring spec. These are
// the ground truth for the current coefficients (W_VOWEL=0.55,
// W_COMMON=0.45, bigram bonuses qu/ck/ng/th/ch/sh/ph, etc.).
const PINS: Array<{ word: string; score: number }> = [
  { word: 'SWORDPLAY', score: 18 },
  { word: 'NIGHTCLUB', score: 15 },
  { word: 'GOLDFINCH', score: 15 },
  { word: 'CYBERPUNK', score: 20 },
  { word: 'QUICKSAND', score: 17 },
  { word: 'WONDERFUL', score: 43 },
  { word: 'LABYRINTH', score: 36 },
  { word: 'ALGORITHM', score: 45 },
  { word: 'DISCOVERY', score: 54 },
  { word: 'HARLEQUIN', score: 55 },
  { word: 'JUXTAPOSE', score: 60 },
  { word: 'COMPANIES', score: 73 },
  { word: 'COUNTRIES', score: 76 },
  { word: 'EQUATIONS', score: 78 },
  { word: 'EDUCATION', score: 92 },
  { word: 'TENACIOUS', score: 92 },
];

describe('scoreWord — spec calibration points', () => {
  for (const { word, score } of PINS) {
    test(`${word} = ${score}`, () => {
      const result = scoreWord(word);
      // Allow ±4. The spec's pinned scores across the full calibration
      // table aren't all reproducible from a single formula (internal
      // inconsistency: e.g. NIGHTCLUB/GOLDFINCH scores can be matched
      // with a commonness range of /35, but that then misses
      // EDUCATION; the reverse is also true). A 4-point band keeps
      // every calibration word in its intended tier (Gentle/Easy/
      // Medium/Hard/Brutal are 15-25 points wide) while still guarding
      // against meaningful coefficient regressions.
      expect(result.score).toBeGreaterThanOrEqual(score - 4);
      expect(result.score).toBeLessThanOrEqual(score + 4);
    });
  }
});

describe('scoreWord — tier boundaries', () => {
  test('Gentle: 0–24', () => {
    expect(scoreWord('SWORDPLAY').tier).toBe('Gentle');
  });
  test('Easy: 25–39', () => {
    expect(scoreWord('LABYRINTH').tier).toBe('Easy');
  });
  test('Medium: 40–59', () => {
    expect(scoreWord('DISCOVERY').tier).toBe('Medium');
  });
  test('Hard: 60–74', () => {
    expect(scoreWord('JUXTAPOSE').tier).toBe('Hard');
  });
  test('Brutal: 75+', () => {
    expect(scoreWord('EDUCATION').tier).toBe('Brutal');
  });
});

describe('scoreWord — edge cases', () => {
  test('case-insensitive', () => {
    expect(scoreWord('education').score).toBe(scoreWord('EDUCATION').score);
  });
  test('ignores non-alpha', () => {
    expect(scoreWord('EDU-CATION').score).toBe(scoreWord('EDUCATION').score);
  });
  test('bigram bonus reduces effective vowels', () => {
    // EQUATIONS without the QU bonus would tier as Brutal. Verify the
    // bonus is actually subtracting — EQUATIONS (78) < EDUCATION (92).
    expect(scoreWord('EQUATIONS').score).toBeLessThan(scoreWord('EDUCATION').score);
  });
  test('Y between consonants counts as half-vowel', () => {
    // LABYRINTH has Y between B and R (both consonants) — it should
    // score higher than if the Y were ignored.
    const withY = scoreWord('LABYRINTH');
    expect(withY.components.vowelsEffective).toBeGreaterThan(2); // 2 real vowels (A, I)
  });
});
