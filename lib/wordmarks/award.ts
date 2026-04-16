import { insertWordmarksIfNew } from '../db/queries';
import type { WordmarkId } from './catalog';

/**
 * Context bundle passed to `awardWordmarks`. All the state the award
 * rules need, pre-computed by the caller so this helper stays pure
 * (aside from the final insert).
 */
export interface AwardContext {
  wallet: string;
  puzzleId: number;
  /** Lowercase solution word — for Labyrinth's prefix check. */
  puzzleWord: string;
  /**
   * Server-computed solve duration in ms. Null when the session
   * submitted without a puzzle_loads row (direct POST, pre-M4b
   * archive replays, etc.); in that case speed wordmarks are
   * suppressed because we have no trusted timing.
   */
  solveTimeMs: number | null;
  unassisted: boolean;
  /**
   * Times the player hit Backspace / Reset during the attempt. Null
   * when the client bundle didn't report the field (old client
   * mid-deploy) — this suppresses Blameless rather than defaulting to
   * 0 and awarding it trivially to every solve.
   */
  backspaceCount: number | null;
  resetCount: number | null;
  /** De-duped list of 4–8 letter Crumbs found during the attempt. */
  foundWords: readonly string[];
  /**
   * Lifetime count of eligible solves for this wallet, INCLUDING the
   * just-inserted row. Caller fetches this via getLifetimeSolveCount
   * after the solves insert.
   */
  lifetimeSolves: number;
  /** Current streak post-update. */
  currentStreak: number;
  /**
   * True when the solve flag is `'ineligible'` or `'suspicious'`. Speed
   * wordmarks are suppressed for flagged solves so bots can't harvest
   * Lightning with sub-30s mechanical solves.
   */
  botFlagged: boolean;
}

/**
 * Evaluate the award rules for a single solve and insert any newly-
 * earned wordmarks. Returns the list of wordmark ids that were
 * actually inserted (i.e. NOT already held) — callers surface these
 * in the SolveModal earn toast.
 *
 * Deferred wordmarks (NOT awarded by this function):
 *   - **Throwback** — requires archive solves to be accepted, which
 *     `/api/solve` currently rejects for non-today puzzles.
 *   - **Frontline** + **Unrivaled** — require leaderboard finalization,
 *     which is its own eventual cron. A later PR will fire these
 *     when the daily leaderboard closes.
 *   - **Megaphone** — awarded client-side after a confirmed share,
 *     via POST /api/wordmarks/megaphone.
 *
 * The spec's pseudocode is the source of truth; this implementation
 * follows it literally aside from the deferred entries above.
 */
export async function awardWordmarks(ctx: AwardContext): Promise<string[]> {
  const toAward: WordmarkId[] = [];

  // Milestone — both use >= so they self-heal if a prior award
  // pipeline attempt failed (insertWordmarksIfNew is idempotent).
  if (ctx.lifetimeSolves >= 1) toAward.push('fledgling');
  if (ctx.lifetimeSolves >= 100) toAward.push('goldfinch');

  // Skill — Blameless requires BOTH counts to be explicitly reported
  // as 0. If either is null (old client didn't send the field), we
  // can't attest the player didn't hit Backspace/Reset, so the award
  // is conservatively skipped. Prevents mid-deploy old-bundle users
  // from getting Blameless on every solve.
  if (
    ctx.backspaceCount !== null &&
    ctx.resetCount !== null &&
    ctx.backspaceCount === 0 &&
    ctx.resetCount === 0
  ) {
    toAward.push('blameless');
  }
  if (ctx.unassisted) toAward.push('nightclub');
  if (ctx.foundWords.length >= 9) toAward.push('wordsmith');

  // Labyrinth: any 8-letter Crumb NOT a prefix of the solution word.
  // Case-insensitive compare. "Prefix" = `solution.startsWith(crumb)`,
  // per the spec — the 8-letter word is what the player found, and we
  // ask whether that word is sitting at the start of the 9-letter
  // solution (trivial finding) or something more elsewhere (clever).
  const solutionLc = ctx.puzzleWord.toLowerCase();
  const hasLabyrinth = ctx.foundWords.some(
    (w) => w.length === 8 && !solutionLc.startsWith(w.toLowerCase()),
  );
  if (hasLabyrinth) toAward.push('labyrinth');

  // Dauntless combo — MUST come after the individual skill checks
  // (Blameless + Nightclub on the same solve).
  if (toAward.includes('blameless') && toAward.includes('nightclub')) {
    toAward.push('dauntless');
  }

  // Speed — only for legit, timed solves. `botFlagged` catches the
  // `ineligible` + `suspicious` cases, and `solveTimeMs != null`
  // catches the no-puzzle-load edge.
  if (!ctx.botFlagged && ctx.solveTimeMs != null) {
    if (ctx.solveTimeMs < 30_000) toAward.push('lightning');
    else if (ctx.solveTimeMs < 60_000) toAward.push('quicksand');
    else if (ctx.solveTimeMs < 180_000) toAward.push('clockwork');
  }

  // Streak — highest applicable tier only. The player's current
  // streak determines which single streak wordmark is in scope for
  // this solve. Leaderboard-row display suppression (Lightning hides
  // Quicksand hides Clockwork; Centurion hides Steadfast hides
  // Fireproof) will ship in the follow-up PR that wires wordmark
  // emojis into leaderboard rows — it's out of scope here since
  // there's no caller yet.
  if (ctx.currentStreak >= 100) toAward.push('centurion');
  else if (ctx.currentStreak >= 30) toAward.push('steadfast');
  else if (ctx.currentStreak >= 7) toAward.push('fireproof');

  const newlyEarned = await insertWordmarksIfNew(
    ctx.wallet,
    toAward,
    ctx.puzzleId,
  );
  return newlyEarned;
}
