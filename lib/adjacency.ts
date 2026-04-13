/**
 * 3×3 grid adjacency (orthogonal only, no diagonals).
 *
 * Position indices:
 *   0 | 1 | 2
 *   ---------
 *   3 | 4 | 5
 *   ---------
 *   6 | 7 | 8
 *
 * A valid Griddle path is a Hamiltonian path on the COMPLEMENT of this graph —
 * i.e. consecutive letters in the target word must occupy cells that are NOT
 * orthogonally adjacent. The number of such Hamiltonian paths is exactly
 * 12,072 for any 9-letter word with 9 unique letters, which is why the
 * puzzle bank can reuse words with fresh arrangements.
 */

export const ADJACENCY: Readonly<Record<number, readonly number[]>> = Object.freeze({
  0: [1, 3],
  1: [0, 2, 4],
  2: [1, 5],
  3: [0, 4, 6],
  4: [1, 3, 5, 7],
  5: [2, 4, 8],
  6: [3, 7],
  7: [4, 6, 8],
  8: [5, 7],
});

const ADJ_SETS: ReadonlyArray<ReadonlySet<number>> = Array.from({ length: 9 }, (_, i) =>
  new Set(ADJACENCY[i]),
);

export function areAdjacent(a: number, b: number): boolean {
  return ADJ_SETS[a]?.has(b) ?? false;
}

export function getBlockedCells(currentCell: number | null): ReadonlySet<number> {
  if (currentCell === null) return EMPTY_SET;
  return ADJ_SETS[currentCell] ?? EMPTY_SET;
}

const EMPTY_SET: ReadonlySet<number> = new Set();

/**
 * Given a sequence of cell indices, return true iff no two consecutive cells
 * are orthogonally adjacent and no cell is reused.
 */
export function isValidPath(cells: readonly number[]): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c < 0 || c > 8 || seen.has(c)) return false;
    seen.add(c);
    if (i > 0 && areAdjacent(cells[i - 1], c)) return false;
  }
  return true;
}

/**
 * Resolve each letter of `word` to its unique position in `grid`.
 * Assumes both have 9 unique letters (true for the curated puzzle bank).
 * Returns null if any letter in word is not present in grid.
 */
export function pathForWord(word: string, grid: string): number[] | null {
  const path: number[] = [];
  for (const ch of word) {
    const idx = grid.indexOf(ch);
    if (idx === -1) return null;
    path.push(idx);
  }
  return path;
}

/**
 * Full validation: does `word` fit on `grid` as a valid non-adjacent
 * Hamiltonian path? This is a PURE consistency check, not answer validation
 * — answer validation happens server-side against the stored target word.
 */
export function isWordValidOnGrid(word: string, grid: string): boolean {
  const path = pathForWord(word, grid);
  if (!path) return false;
  return isValidPath(path);
}
