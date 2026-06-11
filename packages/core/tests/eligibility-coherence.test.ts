/** Taxonomy AUTHORITY coherence gates (grammar-sovereignty phase 2).
 *
 *  Phase 1 PROVED the declarative taxonomy is a faithful SHADOW of the
 *  imperative classifier (eligibility-taxonomy.test.ts + the golden drift
 *  wall). Phase 2 INVERTS the authority: the classifier now routes every
 *  ineligible reason through `reject()`, which validates the reason against the
 *  taxonomy and records a coherence violation (fail-safe, never throws) for any
 *  reason with no deterministic taxonomy row. These gates pin that inversion:
 *
 *   1. RUNTIME MEMBERSHIP — after the classifier runs over the whole golden
 *      corpus, the violation collector is EMPTY (every reason the live
 *      classifier emits is taxonomy-backed, exact or family). Covers the
 *      DYNAMIC reasons (instanceof RHS, the `unsupported-stmt-` families) that
 *      a static scan cannot see.
 *   2. STATIC MEMBERSHIP — every STRING LITERAL passed to `reject(...)` in the
 *      classifier source is in the taxonomy (exact or family). Dynamic
 *      (variable / template) reject arguments are intentionally not statically
 *      checkable and are covered by gate 1.
 *   3. JSON↔MODULE SYNC — the compiled-in generated const deep-equals the
 *      human-edited JSON, so the production authority source can never drift
 *      from its editable source of truth.
 *
 *  Tests may read the filesystem; the PRODUCTION path may not (it imports the
 *  generated const, see eligibility-taxonomy.ts). */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../../../scripts/eligibility-corpus.mjs';
import { classifyClosureBlock } from '../src/closure-eligibility.js';
import { deterministicRows, type EligibilityTaxonomy, loadEligibilityTaxonomy } from '../src/eligibility-taxonomy.js';
import {
  classifyHandlerBodyAst,
  coherenceViolations,
  resetCoherenceViolations,
} from '../src/native-eligibility-ast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../src');
const JSON_PATH = path.resolve(SRC_DIR, 'eligibility-taxonomy.json');

/** Membership predicate mirroring `reject()`'s index: exact deterministic
 *  reason codes plus the dynamic-family prefixes (taxonomy rows whose construct
 *  ends with `-`). */
function buildMembership(taxonomy: EligibilityTaxonomy): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const row of deterministicRows(taxonomy)) {
    if (row.verdict !== 'ineligible' || row.reason === undefined) continue;
    if (row.construct.endsWith('-')) prefixes.push(row.reason);
    else exact.add(row.reason);
  }
  return { exact, prefixes };
}

function isTaxonomyBacked(reason: string, membership: { exact: Set<string>; prefixes: string[] }): boolean {
  if (membership.exact.has(reason)) return true;
  return membership.prefixes.some((prefix) => reason.startsWith(prefix));
}

/** Extract every STRING-LITERAL argument to a `reject(...)` call in the
 *  classifier source. Strips comments first (so doc-example slugs never count),
 *  mirroring `extractReasonCodesFromSource` in eligibility-golden.test.ts.
 *  Template / variable arguments (`reject(gateReason)`,
 *  `` reject(`unsupported-stmt-${…}`) ``) are intentionally skipped — those are
 *  dynamic reasons covered by the runtime gate. */
function extractRejectLiterals(): string[] {
  const raw = readFileSync(path.join(SRC_DIR, 'native-eligibility-ast.ts'), 'utf-8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const literals: string[] = [];
  for (const m of code.matchAll(/\breject\(\s*'([^']+)'\s*\)/g)) {
    literals.push(m[1]);
  }
  return literals;
}

describe('taxonomy authority — coherence gates', () => {
  test('gate 1 — runtime membership: classifier emits no un-taxonomied reason over the golden corpus', () => {
    resetCoherenceViolations();
    // Drive the REAL classifier over the whole corpus the drift wall pins. The
    // closure-block rows funnel through their own gate; the handler-body rows
    // exercise classifyHandlerBodyAst (which is what wraps reasons in reject()).
    buildSnapshot({ classifyHandlerBodyAst, classifyClosureBlock });
    expect(coherenceViolations()).toEqual([]);
  });

  test('gate 2 — static membership: every reject() string literal is in the taxonomy', () => {
    const membership = buildMembership(loadEligibilityTaxonomy());
    const literals = extractRejectLiterals();
    // Sanity: the routing is actually present (guards against the regex silently
    // matching nothing if reject() is renamed).
    expect(literals.length).toBeGreaterThan(0);
    const orphans = literals.filter((reason) => !isTaxonomyBacked(reason, membership));
    expect(orphans).toEqual([]);
  });

  test('gate 3 — JSON↔module sync: the compiled-in const deep-equals the human-edited JSON', () => {
    const fromJson = JSON.parse(readFileSync(JSON_PATH, 'utf-8')) as EligibilityTaxonomy;
    const fromModule = loadEligibilityTaxonomy();
    expect(fromModule).toEqual(fromJson);
  });
});
