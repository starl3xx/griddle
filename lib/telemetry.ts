/**
 * Client-side solve telemetry. Captures keystroke timing data so that in M4
 * the server can flag bot solves as ineligible for rewards/streaks and surface
 * anomalies in the admin dashboard.
 *
 * All data lives in memory — nothing is persisted client-side. On solve, the
 * full payload is sent with /api/solve (server wiring is M4).
 */

export interface SolvePayload {
  claimedWord: string;
  clientSolveMs: number;
  keystrokeIntervalsMs: number[];
  firstKeystrokeAt: number | null;
  keystrokeCount: number;
  /**
   * Wordmark-driving counters added in M5j. Populated by useGriddle
   * from its own action counters (telemetry doesn't track these — it
   * only knows about keystrokes). The server uses them to evaluate
   * Blameless (both zero), Wordsmith (foundWords.length >= 9), and
   * Labyrinth (an 8-letter Crumb not prefixing the solution).
   */
  backspaceCount: number;
  resetCount: number;
  foundWords: string[];
}

export class SolveTelemetry {
  private puzzleLoadedAt: number;
  private firstKeystrokeAt: number | null = null;
  private lastKeystrokeAt: number | null = null;
  private intervals: number[] = [];

  constructor() {
    this.puzzleLoadedAt = performance.now();
  }

  reset(): void {
    this.puzzleLoadedAt = performance.now();
    this.firstKeystrokeAt = null;
    this.lastKeystrokeAt = null;
    this.intervals = [];
  }

  recordKeystroke(): void {
    const now = performance.now();
    if (this.firstKeystrokeAt === null) {
      this.firstKeystrokeAt = now;
    } else if (this.lastKeystrokeAt !== null) {
      this.intervals.push(Math.round(now - this.lastKeystrokeAt));
    }
    this.lastKeystrokeAt = now;
  }

  build(claimedWord: string): SolvePayload {
    return {
      claimedWord,
      clientSolveMs: Math.round(performance.now() - this.puzzleLoadedAt),
      keystrokeIntervalsMs: [...this.intervals],
      firstKeystrokeAt: this.firstKeystrokeAt,
      keystrokeCount: this.firstKeystrokeAt === null ? 0 : this.intervals.length + 1,
      // Wordmark counters are tracked in useGriddle (not this class)
      // because they correspond to player actions, not keystroke
      // telemetry. We return zeros here as defaults; useGriddle
      // always overrides them with its own counters before sending
      // to /api/solve. If you're writing a test that stubs telemetry
      // directly and skips useGriddle, override these fields too.
      backspaceCount: 0,
      resetCount: 0,
      foundWords: [],
    };
  }
}
