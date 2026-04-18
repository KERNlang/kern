/**
 * ReviewHealth builder — collects subsystem-status notes across a review run
 * and emits them deduped.
 *
 * Design: subsystems can fail or fall back many times during a review (once per file,
 * once per rule, etc.). We want one entry per (subsystem, kind) pair — not N identical
 * entries flooding the report header. The builder is the single dedupe point.
 *
 * Kept in its own module so external-tools.ts, index.ts, and rule-loader.ts all share
 * the same collector rather than each growing its own set.
 */

import type { ReviewHealth, ReviewHealthEntry, ReviewHealthKind, ReviewHealthSubsystem } from './types.js';

export class ReviewHealthBuilder {
  private entries = new Map<string, ReviewHealthEntry>();

  /**
   * Note that a subsystem degraded analysis. The first note per (subsystem, kind) wins —
   * subsequent calls with the same key are ignored so a malformed repo doesn't produce
   * one entry per file. Pass `detail` only when it's genuinely different between calls
   * (it isn't recorded after the first).
   */
  note(entry: ReviewHealthEntry): void {
    const key = `${entry.subsystem}:${entry.kind}`;
    if (!this.entries.has(key)) {
      this.entries.set(key, entry);
    }
  }

  /** Convenience shorthand — same as calling note({ ... }). */
  noteKind(subsystem: ReviewHealthSubsystem, kind: ReviewHealthKind, message: string, detail?: string): void {
    this.note({ subsystem, kind, message, detail });
  }

  /**
   * Produce the final ReviewHealth, or undefined if nothing was noted. Callers should
   * assign `undefined` directly to `ReviewReport.health` when this returns undefined
   * so "no health field" means "clean run" (see ReviewHealth jsdoc in types.ts).
   */
  build(): ReviewHealth | undefined {
    if (this.entries.size === 0) return undefined;
    const entries = [...this.entries.values()];
    const hasError = entries.some((e) => e.kind === 'error');
    const status: ReviewHealth['status'] = hasError ? 'partial' : 'degraded';
    return { status, entries };
  }

  /** Number of distinct (subsystem, kind) entries recorded so far. */
  get size(): number {
    return this.entries.size;
  }
}

/**
 * Attach a detail string when KERN_DEBUG is set. Keeps stack traces and internal
 * error messages out of user-facing reports by default while making them available
 * for debugging. Call from catch blocks that want to surface the underlying error.
 */
export function debugDetail(err: unknown): string | undefined {
  if (!process.env.KERN_DEBUG) return undefined;
  if (err instanceof Error) return err.message;
  return String(err);
}
