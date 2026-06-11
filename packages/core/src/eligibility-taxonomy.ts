/** Declarative eligibility taxonomy — typed loader (SHADOW mode).
 *
 *  Grammar-sovereignty phase 1, step 2. Loads and types
 *  `eligibility-taxonomy.json`, the declarative description of the CURRENT
 *  native-eligibility classifier behavior (statement kinds, the closure gate
 *  constructs, the instanceof RHS table), transcribed from
 *  native-eligibility-ast.ts / closure-eligibility.ts / instanceof-rhs.ts.
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
 *  SHADOW-ONLY: this loader and the JSON it reads are imported only by the
 *  taxonomy test. Nothing on the production codegen / migrator / review path
 *  imports them — wiring the taxonomy into a consumer is a later slice. */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Resolve `eligibility-taxonomy.json`. tsc does not copy JSON assets into
 *  `dist`, so at runtime the compiled loader (in `dist/`) reads the source JSON
 *  by rewriting `/dist/` → `/src/` in its own URL. A dist-local copy (if a
 *  future build step adds one) is preferred when present. */
function resolveTaxonomyPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const distLocal = join(here, 'eligibility-taxonomy.json');
  if (existsSync(distLocal)) return distLocal;
  const srcSibling = join(here.replace(/([/\\])dist([/\\]|$)/, '$1src$2'), 'eligibility-taxonomy.json');
  return srcSibling;
}

/** Load the committed taxonomy. */
export function loadEligibilityTaxonomy(): EligibilityTaxonomy {
  return JSON.parse(readFileSync(resolveTaxonomyPath(), 'utf-8')) as EligibilityTaxonomy;
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
