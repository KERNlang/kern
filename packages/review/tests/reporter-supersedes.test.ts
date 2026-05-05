import { applySupersedes, sortAndDedup } from '../src/reporter.js';
import type { ReviewFinding } from '../src/types.js';

// `applySupersedes` enforces the `supersedes` graph declared on RuleInfo.
// When ruleA supersedes ruleB and BOTH fire at the same `(file, line, col)`,
// the ruleB finding is dropped — the registry author already declared it
// redundant. Pure subtraction (no rewriting). Outside the same-span case,
// nothing is suppressed.

function makeFinding(ruleId: string, line: number, col = 1, file = '/x.ts'): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity: 'warning',
    category: 'bug',
    message: `${ruleId} message`,
    primarySpan: { file, startLine: line, startCol: col, endLine: line, endCol: col + 1 },
    fingerprint: `${ruleId}:${line}:${col}`,
  };
}

describe('applySupersedes — registry-driven dedup of redundant findings', () => {
  // ── Same-span suppression ───────────────────────────────────────────────

  it('drops a superseded finding when the superseding rule fires at the same span', () => {
    // body-shape-drift supersedes request-validation-drift in the registry.
    // When both fire on the same client call, only body-shape-drift survives.
    const findings = [makeFinding('request-validation-drift', 10), makeFinding('body-shape-drift', 10)];
    const result = applySupersedes(findings);
    const ids = result.map((f) => f.ruleId).sort();
    expect(ids).toEqual(['body-shape-drift']);
  });

  it('drops every superseded id at the same span when one rule supersedes multiple', () => {
    // contract-drift supersedes [unhandled-api-error-shape, unbounded-collection-query, request-validation-drift]
    const findings = [
      makeFinding('contract-drift', 20),
      makeFinding('unhandled-api-error-shape', 20),
      makeFinding('unbounded-collection-query', 20),
      makeFinding('request-validation-drift', 20),
    ];
    const result = applySupersedes(findings);
    expect(result.map((f) => f.ruleId)).toEqual(['contract-drift']);
  });

  it('keeps both findings when the superseding rule does NOT fire at the same span', () => {
    // body-shape-drift fires on a different line — no suppression.
    const findings = [makeFinding('request-validation-drift', 10), makeFinding('body-shape-drift', 50)];
    const result = applySupersedes(findings);
    const ids = result.map((f) => f.ruleId).sort();
    expect(ids).toEqual(['body-shape-drift', 'request-validation-drift']);
  });

  it('keeps both findings when the superseding rule does NOT fire at the same column on the same line', () => {
    const findings = [makeFinding('request-validation-drift', 10, 4), makeFinding('body-shape-drift', 10, 30)];
    const result = applySupersedes(findings);
    expect(result).toHaveLength(2);
  });

  it('keeps both findings when the superseding rule fires in a different FILE', () => {
    const findings = [
      makeFinding('request-validation-drift', 10, 1, '/a.ts'),
      makeFinding('body-shape-drift', 10, 1, '/b.ts'),
    ];
    const result = applySupersedes(findings);
    expect(result).toHaveLength(2);
  });

  // ── Behavior when no supersedes relation exists ─────────────────────────

  it('is a no-op when no supersedes relation exists between the rule pair', () => {
    // floating-promise and empty-catch have no declared relation.
    const findings = [makeFinding('floating-promise', 10), makeFinding('empty-catch', 10)];
    const result = applySupersedes(findings);
    expect(result).toHaveLength(2);
  });

  it('is a no-op for a single finding', () => {
    const findings = [makeFinding('floating-promise', 10)];
    expect(applySupersedes(findings)).toHaveLength(1);
  });

  it('is a no-op for an empty list', () => {
    expect(applySupersedes([])).toEqual([]);
  });

  // ── Composition with the existing dedup pipeline ────────────────────────

  it('integrates into sortAndDedup so the existing emit pipeline applies it everywhere', () => {
    const findings = [
      makeFinding('contract-drift', 20),
      makeFinding('request-validation-drift', 20),
      makeFinding('floating-promise', 10),
    ];
    const result = sortAndDedup(findings);
    const ids = result.map((f) => f.ruleId).sort();
    expect(ids).toEqual(['contract-drift', 'floating-promise']);
  });

  it('does not drop a superseding rule even if a superseded rule fires at the same span', () => {
    // Defensive: contract-drift supersedes request-validation-drift.
    // Make sure we never drop the WINNER, only the LOSER.
    const findings = [makeFinding('contract-drift', 30), makeFinding('request-validation-drift', 30)];
    const result = applySupersedes(findings);
    expect(result.map((f) => f.ruleId)).toContain('contract-drift');
    expect(result.map((f) => f.ruleId)).not.toContain('request-validation-drift');
  });
});
