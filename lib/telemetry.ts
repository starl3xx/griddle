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
    };
  }
}
