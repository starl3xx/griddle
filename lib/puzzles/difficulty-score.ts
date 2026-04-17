/**
 * Griddle puzzle difficulty heuristic. A 0–100 score combining vowel
 * density and letter commonness with bigram-anchor bonuses. Full spec
 * and calibration rationale in `/docs/difficulty-scoring.md` (or the
 * original design note).
 *
 * Pure function, no DB. Used by:
 *   - Pulse hardest-word tile (show heuristic alongside observed ms)
 *   - Puzzles tab (sort + scatter plot + outlier list)
 *   - Upcoming puzzles view (eyeball pipeline difficulty balance)
 *
 * The heuristic is intentionally kept as a standalone module so its
 * coefficients can be retuned without touching admin-dashboard code.
 * Observed solve time is the ground truth; this score is the prior.
 * Calibration points are pinned in the adjacent test file.
 */

// Norvig letter frequency table (standard English, %). Source: original
// design spec; matches the widely-cited Norvig "Letter frequency in
// English" distribution.
const LETTER_FREQ: Record<string, number> = {
  E: 12.49, T: 9.28, A: 8.04, O: 7.64, I: 7.57, N: 7.23,
  S: 6.51, R: 6.28, H: 5.05, L: 4.07, D: 3.82, C: 3.34,
  U: 2.73, M: 2.51, F: 2.40, P: 2.14, G: 1.87, W: 1.68,
  Y: 1.66, B: 1.48, V: 1.05, K: 0.54, X: 0.23, J: 0.16,
  Q: 0.12, Z: 0.09,
};

// Bigram-anchor bonuses. When present, the anchor letter effectively
// pre-places its partner, shrinking the search space — so we subtract
// from the effective vowel count.
const BIGRAM_BONUSES: Array<[string, number]> = [
  ['QU', 0.9], // Q near-always followed by U
  ['CK', 0.5], // K anchors hard
  ['NG', 0.4], // reliable at endings
  ['TH', 0.3],
  ['CH', 0.3],
  ['SH', 0.3],
  ['PH', 0.3],
];

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

// Practical ranges for a 9-letter word with unique letters. Used to
// normalize raw component values into [0, 1].
const VOWEL_MIN = 2;
const VOWEL_MAX = 5.5;
const COMMON_MIN = 30;
const COMMON_MAX = 60;

// Component weights. Slightly more weight on vowels because lived
// solving experience suggests vowel density is the dominant driver.
const W_VOWEL = 0.55;
const W_COMMON = 0.45;

export type DifficultyTier = 'Gentle' | 'Easy' | 'Medium' | 'Hard' | 'Brutal';

export interface DifficultyScore {
  /** 0–100, rounded. */
  score: number;
  tier: DifficultyTier;
  components: {
    /** Vowel count after y-as-vowel adjustment and bigram bonuses. */
    vowelsEffective: number;
    /** Sum of Norvig frequencies for each letter. */
    commonSum: number;
    /** vowel component normalized to [0, 1]. */
    vowelNorm: number;
    /** common component normalized to [0, 1]. */
    commonNorm: number;
  };
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function tierFor(score: number): DifficultyTier {
  if (score < 25) return 'Gentle';
  if (score < 40) return 'Easy';
  if (score < 60) return 'Medium';
  if (score < 75) return 'Hard';
  return 'Brutal';
}

/**
 * Score a single word. Case-insensitive; expects alphabetic input.
 * Non-alpha characters are ignored (not counted toward vowels or
 * commonness). For Griddle this will always be 9 unique letters but
 * the formula works on any length.
 */
export function scoreWord(word: string): DifficultyScore {
  const w = word.toUpperCase().replace(/[^A-Z]/g, '');

  // Base vowel count (a/e/i/o/u only).
  let vowels = 0;
  for (const ch of w) if (VOWELS.has(ch)) vowels += 1;

  // Y counts as a half-vowel when it functions as a vowel — i.e. when
  // neither adjacent letter is a vowel. Covers: between two consonants
  // (labYrinth), at word end after a consonant (discoverY, happY), at
  // word start before a consonant (rare). Y adjacent to a vowel is a
  // glide/consonant (e.g. swordplAY, yes) and doesn't add vowel weight.
  for (let i = 0; i < w.length; i += 1) {
    if (w[i] !== 'Y') continue;
    const prevIsVowel = i > 0 && VOWELS.has(w[i - 1]);
    const nextIsVowel = i < w.length - 1 && VOWELS.has(w[i + 1]);
    if (!prevIsVowel && !nextIsVowel) vowels += 0.5;
  }

  // Bigram anchor bonuses — subtract from effective vowel count.
  let bigramBonus = 0;
  for (const [pair, bonus] of BIGRAM_BONUSES) {
    if (w.includes(pair)) bigramBonus += bonus;
  }
  const vowelsEffective = Math.max(0, vowels - bigramBonus);

  // Commonness: sum Norvig frequencies across all letters.
  let commonSum = 0;
  for (const ch of w) commonSum += LETTER_FREQ[ch] ?? 0;

  const vowelNorm = clamp01((vowelsEffective - VOWEL_MIN) / (VOWEL_MAX - VOWEL_MIN));
  const commonNorm = clamp01((commonSum - COMMON_MIN) / (COMMON_MAX - COMMON_MIN));

  const raw = W_VOWEL * vowelNorm + W_COMMON * commonNorm;
  const score = Math.round(raw * 100);

  return {
    score,
    tier: tierFor(score),
    components: { vowelsEffective, commonSum, vowelNorm, commonNorm },
  };
}
