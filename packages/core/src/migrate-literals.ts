/**
 * Shared classifiers for handler-body migrations.
 *
 * Used by:
 *   - `kern migrate literal-const` / `fn-expr` (to detect & rewrite)
 *   - `collectCoverageGaps` (to tag detected gaps as `migratable`)
 *
 * Keeping the rules in one place ensures the gap emitter's classification
 * matches what `kern migrate` will actually rewrite — otherwise users would
 * see `category: migratable` but get no hits when they run the migration.
 */

/**
 * True if `text` is a bare-safe primitive literal that can be inlined as
 * `value=<literal>` without quoting:
 *   - numeric (int, float, hex, binary, octal, scientific, underscore)
 *   - boolean / null / undefined
 *
 * The KERN prop parser tokenises on whitespace, so anything with spaces
 * (`60 * 1000`) or special tokens (`"..."`, `{`, `[`) must use the
 * `value={{ ... }}` form — see `isInlineSafeExpression`.
 */
export function isInlineSafeLiteral(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t === 'true' || t === 'false' || t === 'null' || t === 'undefined') return true;

  if (
    /^-?(?:0x[0-9a-fA-F][0-9a-fA-F_]*|0b[01][01_]*|0o[0-7][0-7_]*|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)$/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * True if `text` is a single-line body safe to wrap as `value={{ ... }}` /
 * `expr={{ ... }}`. The expression block preserves raw content verbatim, so
 * anything works as long as:
 *   - body is non-empty (after trim),
 *   - body contains no `}}` substring (would close the wrapper early),
 *   - body has no embedded newline (caller must guarantee this).
 */
export function isInlineSafeExpression(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.includes('}}')) return false;
  return true;
}

/** Categories the compiler uses to tag coverage gaps for actionable triage. */
export type GapCategory =
  | 'detected' /* feature observed, no migration or schema change yet */
  | 'migratable' /* `kern migrate` has a rewrite for this */
  | 'blocked-by-parser' /* parser fails before codegen can see it */
  | 'blocked-by-codegen' /* parses but codegen has no emit path */
  | 'needs-new-node'; /* requires a new IR node type to express */

export interface GapClassification {
  category: GapCategory;
  /** Name of the `kern migrate` migration that would fix this, if any. */
  migration?: string;
}

/**
 * Classify a handler-escape gap based on its parent node and body. Returns
 * `migratable` with a migration name when `kern migrate` would rewrite it;
 * otherwise `detected`. Other categories are reserved for future emitters.
 */
export function classifyHandlerGap(parentType: string | undefined, body: string): GapClassification {
  const trimmed = body.trim();
  // Multi-line handlers are never migratable by the current rewriters — they
  // all require a single-line body sandwiched in `<<<` / `>>>`.
  if (trimmed.length === 0 || trimmed.includes('\n')) {
    return { category: 'detected' };
  }

  if (parentType === 'const' && (isInlineSafeLiteral(trimmed) || isInlineSafeExpression(trimmed))) {
    return { category: 'migratable', migration: 'literal-const' };
  }
  if (parentType === 'fn' && isInlineSafeExpression(trimmed)) {
    return { category: 'migratable', migration: 'fn-expr' };
  }

  return { category: 'detected' };
}
