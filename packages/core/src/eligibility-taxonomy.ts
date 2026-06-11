/** Declarative eligibility taxonomy — typed loader (PRODUCTION authority).
 *
 *  Grammar-sovereignty phase 2 (taxonomy AUTHORITY inversion). Types the
 *  declarative description of the native-eligibility classifier behavior
 *  (statement kinds, the closure gate constructs, the instanceof RHS table),
 *  transcribed from native-eligibility-ast.ts / closure-eligibility.ts /
 *  instanceof-rhs.ts.
 *
 *  Two kinds of row:
 *   - `eligible` / `ineligible`: a deterministic, reason-keyed verdict. These
 *     are shadow-verified against the golden snapshot — for every snapshot row
 *     whose reason maps to this construct, the declared verdict (and reason,
 *     when ineligible) must agree.
 *   - `contextual` (`when: ['imperative']`): a surface construct whose verdict
 *     is NOT a single value but is decided by shape predicates a flat row cannot
 *     evaluate. These are the phase-2 (consumption-inversion) backlog; they are
 *     excluded from shadow eval and counted.
 *
 *  AUTHORITY SOURCE: the classifier (`native-eligibility-ast.ts`) now validates
 *  every emitted reason string against this taxonomy via `reject()`. The data
 *  is compiled in from `eligibility-taxonomy.generated.ts` (no runtime
 *  `node:fs` read) — `eligibility-taxonomy.json` stays the human-edited source
 *  of truth, regenerated into the module by
 *  `scripts/generate-eligibility-taxonomy-module.mjs`. */

import { ELIGIBILITY_TAXONOMY } from './eligibility-taxonomy.generated.js';

export type EligibilityVerdict = 'eligible' | 'ineligible' | 'contextual';

/** Predicate keys a `contextual` row's verdict depends on. `'imperative'` is
 *  the phase-1 catch-all meaning "decided by imperative shape checks the flat
 *  taxonomy cannot express yet". */
export type EligibilityPredicateKey = 'imperative';

export interface EligibilityTaxonomyRow {
  /** The construct this row describes — a classifier reason code (e.g.
   *  `'var-non-const'`), a dynamic-family prefix (`'unsupported-stmt-'`), an
   *  eligible verdict slug (`'ok'` / `'empty'`), or a surface-construct name
   *  for a `contextual` row (`'if-statement'`). */
  construct: string;
  verdict: EligibilityVerdict;
  /** Present on `ineligible` rows: the reason code the classifier emits. Equals
   *  `construct` for reason-keyed rows. Absent on `eligible`/`contextual` rows. */
  reason?: string;
  rationale: string;
  /** Present on `contextual` rows: the predicate keys the verdict depends on. */
  when?: EligibilityPredicateKey[];
}

export interface EligibilityTaxonomy {
  $schema: string;
  description: string;
  rows: EligibilityTaxonomyRow[];
}

/** The taxonomy singleton, deep-frozen once at module init: this is the
 *  production AUTHORITY for emitted reasons, so no in-process caller may
 *  mutate it (agon review, codex 0.91). 92 rows — freeze cost is negligible. */
const FROZEN_TAXONOMY: EligibilityTaxonomy = deepFreeze(ELIGIBILITY_TAXONOMY as EligibilityTaxonomy);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Return the committed taxonomy (deep-frozen singleton). The data is compiled
 *  in from the generated module (no runtime filesystem read), so the
 *  production path carries it as code. */
export function loadEligibilityTaxonomy(): EligibilityTaxonomy {
  return FROZEN_TAXONOMY;
}

/** The reason-keyed (deterministic) rows — verdict is `eligible` or
 *  `ineligible`. These are the shadow-verifiable subset. */
export function deterministicRows(taxonomy: EligibilityTaxonomy): EligibilityTaxonomyRow[] {
  return taxonomy.rows.filter((row) => row.verdict !== 'contextual');
}

/** The `contextual` rows — the imperative-only phase-2 backlog, excluded from
 *  shadow eval. */
export function contextualRows(taxonomy: EligibilityTaxonomy): EligibilityTaxonomyRow[] {
  return taxonomy.rows.filter((row) => row.verdict === 'contextual');
}
