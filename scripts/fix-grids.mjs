#!/usr/bin/env node
/**
 * One-shot preprocessor: regenerate grids so the target word’s first letter
 * is never placed in cell 0 (top-left). Having word[0] in the top-left is a
 * massive spoiler — players’ eyes land there first, and seeing the first
 * letter of the answer immediately narrows the search space.
 *
 * For every puzzle where word[0] === grid[0], this script finds a fresh
 * Hamiltonian path on the complement of the 3×3 rook graph that starts at
 * some cell ≠ 0, then rebuilds the grid string from that path. Start cell
 * is picked by a hash of the word (FNV-1a) so the output is deterministic
 * and re-running the script produces the same data.
 *
 * Run: `bun scripts/fix-grids.mjs` (or `node`)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PUZZLES_PATH = path.resolve(__dirname, '..', 'data', 'puzzles.json');

// Orthogonal neighbors on the 3×3 grid (the "forbidden" edges).
const ORTH = [
  new Set([1, 3]),       // 0
  new Set([0, 2, 4]),    // 1
  new Set([1, 5]),       // 2
  new Set([0, 4, 6]),    // 3
  new Set([1, 3, 5, 7]), // 4
  new Set([2, 4, 8]),    // 5
  new Set([3, 7]),       // 6
  new Set([4, 6, 8]),    // 7
  new Set([5, 7]),       // 8
];

/** FNV-1a 32-bit hash — deterministic across Node versions. */
function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

/**
 * DFS on the complement of the orthogonal-adjacency graph, starting at the
 * given cell. Returns the first Hamiltonian path found (9 cells, no repeats,
 * no two consecutive cells orthogonally adjacent), or null if none exists
 * from this starting cell.
 */
function findHamiltonianPath(startCell) {
  const pathArr = [startCell];
  const used = new Set([startCell]);
  let found = null;

  function dfs() {
    if (found) return;
    if (pathArr.length === 9) {
      found = [...pathArr];
      return;
    }
    const last = pathArr[pathArr.length - 1];
    for (let next = 0; next < 9; next++) {
      if (used.has(next)) continue;
      if (ORTH[last].has(next)) continue;
      used.add(next);
      pathArr.push(next);
      dfs();
      if (found) return;
      pathArr.pop();
      used.delete(next);
    }
  }
  dfs();
  return found;
}

/**
 * Generate a fresh grid string for the given word. Start cell is picked from
 * {1..8} via a hash of the word so different words get visually distinct
 * layouts rather than all clustering into the same "shape".
 */
function generateGrid(word) {
  const startPreferred = 1 + (hash(word) % 8);
  // Try the preferred start first, then rotate through the rest.
  for (let i = 0; i < 8; i++) {
    const start = 1 + ((startPreferred - 1 + i) % 8);
    const p = findHamiltonianPath(start);
    if (p) {
      const grid = new Array(9);
      for (let i = 0; i < 9; i++) grid[p[i]] = word[i];
      return grid.join('');
    }
  }
  throw new Error(`no valid grid for ${word}`);
}

/** Sanity-check that a (word, grid) pair forms a valid non-adjacent path. */
function validatePuzzle(word, grid) {
  if (word.length !== 9 || grid.length !== 9) {
    throw new Error(`${word}/${grid}: length ≠ 9`);
  }
  if (new Set(word).size !== 9) {
    throw new Error(`${word}: duplicate letters`);
  }
  if ([...word].sort().join('') !== [...grid].sort().join('')) {
    throw new Error(`${word}/${grid}: letters don’t match`);
  }
  if (grid[0] === word[0]) {
    throw new Error(`${word}/${grid}: first letter still in cell 0`);
  }
  const pathArr = [];
  for (const ch of word) pathArr.push(grid.indexOf(ch));
  if (new Set(pathArr).size !== 9) {
    throw new Error(`${word}/${grid}: path not Hamiltonian`);
  }
  for (let i = 0; i < 8; i++) {
    if (ORTH[pathArr[i]].has(pathArr[i + 1])) {
      throw new Error(`${word}/${grid}: adjacency violation at step ${i}`);
    }
  }
}

// ---- main ----
const puzzles = JSON.parse(fs.readFileSync(PUZZLES_PATH, 'utf8'));

let fixed = 0;
let kept = 0;
for (const p of puzzles) {
  if (p.word[0] !== p.grid[0]) {
    validatePuzzle(p.word, p.grid);
    kept++;
    continue;
  }
  const newGrid = generateGrid(p.word);
  validatePuzzle(p.word, newGrid);
  p.grid = newGrid;
  fixed++;
}

fs.writeFileSync(PUZZLES_PATH, JSON.stringify(puzzles));

console.log(`fixed ${fixed} / kept ${kept} (total ${puzzles.length})`);
console.log(`wrote ${PUZZLES_PATH}`);
