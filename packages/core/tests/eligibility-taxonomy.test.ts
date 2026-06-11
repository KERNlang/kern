/** Declarative eligibility taxonomy — SHADOW fidelity (grammar-sovereignty
 *  phase 1, step 2).
 *
 *  A minimal, TEST-LOCAL interpreter evaluates the taxonomy against the SAME
 *  golden-snapshot corpus the drift wall pins, and asserts the declared verdict
 *  (and reason, for ineligible rows) equals the classifier's actual verdict for
 *  every snapshot row the taxonomy claims to cover. This proves the declarative
 *  description is FAITHFUL to the imperative classifier — the precondition for
 *  the later consumption-inversion slice (which will make the taxonomy the
 *  source of truth instead of a shadow).
 *
 *  Rows whose verdict is `contextual` (`when: ['imperative']`) describe surface
 *  constructs whose verdict is not a single value; they are EXCLUDED from shadow
 *  eval and COUNTED — that count is the phase-2 backlog and the abort metric
 *  (the slice aborts if it exceeds 40% of rows).
 *
 *  SHADOW-ONLY: this test imports the loader + JSON only. No production path
 *  consumes the taxonomy yet. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contextualRows,
  deterministicRows,
  type EligibilityTaxonomy,
  type EligibilityTaxonomyRow,
  loadEligibilityTaxonomy,
} from '../src/eligibility-taxonomy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.resolve(__dirname, '__snapshots__/eligibility-golden.json');

interface SnapshotRow {
  snippet: string;
  classifier: string;
  eligible: boolean;
  reason: string;
}

const DYNAMIC_FAMILY_PREFIXES = ['unsupported-stmt-', 'closure-unsupported-stmt-'];

function loadGolden(): SnapshotRow[] {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SnapshotRow[];
}

/** Map a snapshot reason code to the taxonomy construct key that covers it: a
 *  dynamic-family reason collapses to its prefix; otherwise the reason IS the
 *  construct key (reason-keyed rows). */
function reasonToConstruct(reason: string): string {
  for (const prefix of DYNAMIC_FAMILY_PREFIXES) {
    if (reason.startsWith(prefix)) return prefix;
  }
  return reason;
}

/** The minimal shadow interpreter. Given a deterministic-row lookup and a
 *  snapshot row, it predicts the taxonomy's verdict+reason for that row's
 *  construct and returns whether it agrees with the snapshot (the ground
 *  truth). Returns `null` when no deterministic row covers the construct (a
 *  coverage hole the completeness test reports). */
function shadowEvaluate(
  byConstruct: Map<string, EligibilityTaxonomyRow>,
  row: SnapshotRow,
): { covered: boolean; agrees: boolean } {
  const construct = reasonToConstruct(row.reason);
  const taxonomyRow = byConstruct.get(construct);
  if (!taxonomyRow) return { covered: false, agrees: false };
  const predictedEligible = taxonomyRow.verdict === 'eligible';
  if (predictedEligible !== row.eligible) return { covered: true, agrees: false };
  // For ineligible rows, the declared reason must equal the construct key the
  // snapshot reason maps to (exact for reason-keyed rows, prefix for families).
  if (!row.eligible) {
    const reasonAgrees = taxonomyRow.reason === construct;
    return { covered: true, agrees: reasonAgrees };
  }
  return { covered: true, agrees: true };
}

let taxonomy: EligibilityTaxonomy;
let byConstruct: Map<string, EligibilityTaxonomyRow>;

describe('eligibility taxonomy — shadow fidelity', () => {
  taxonomy = loadEligibilityTaxonomy();
  byConstruct = new Map(deterministicRows(taxonomy).map((row) => [row.construct, row]));

  test('every deterministic row has a well-formed schema', () => {
    for (const row of taxonomy.rows) {
      expect(typeof row.construct).toBe('string');
      expect(['eligible', 'ineligible', 'contextual']).toContain(row.verdict);
      expect(typeof row.rationale).toBe('string');
      expect(row.rationale.length).toBeGreaterThan(0);
      if (row.verdict === 'ineligible') {
        expect(typeof row.reason).toBe('string');
      }
      if (row.verdict === 'contextual') {
        expect(Array.isArray(row.when)).toBe(true);
        expect(row.when).toContain('imperative');
      }
    }
  });

  test('taxonomy verdict+reason agrees with the golden snapshot for every covered row', () => {
    const golden = loadGolden();
    const disagreements: string[] = [];
    for (const row of golden) {
      const result = shadowEvaluate(byConstruct, row);
      if (result.covered && !result.agrees) {
        disagreements.push(`${row.reason} (eligible=${row.eligible}) <<< ${JSON.stringify(row.snippet)}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  test('the taxonomy covers every reason code in the snapshot (completeness)', () => {
    const golden = loadGolden();
    const uncovered = new Set<string>();
    for (const row of golden) {
      const result = shadowEvaluate(byConstruct, row);
      if (!result.covered) uncovered.add(reasonToConstruct(row.reason));
    }
    expect([...uncovered]).toEqual([]);
  });

  test('shadow-verified coverage is 100% of snapshot rows (every row is covered AND agrees)', () => {
    const golden = loadGolden();
    const covered = golden.filter((row) => shadowEvaluate(byConstruct, row).covered).length;
    const agreeing = golden.filter((row) => shadowEvaluate(byConstruct, row).agrees).length;
    expect(covered).toBe(golden.length);
    expect(agreeing).toBe(golden.length);
  });
});

describe('eligibility taxonomy — imperative-only backlog (abort metric)', () => {
  test('imperative-only rows stay under the 40% abort threshold', () => {
    const tax = loadEligibilityTaxonomy();
    const imperativeOnly = contextualRows(tax);
    const fraction = imperativeOnly.length / tax.rows.length;
    expect(fraction).toBeLessThanOrEqual(0.4);
  });

  test('every imperative-only row carries a when:[imperative] predicate', () => {
    const tax = loadEligibilityTaxonomy();
    for (const row of contextualRows(tax)) {
      expect(row.when).toContain('imperative');
    }
  });
});
