import { groupFindingsByRootCause } from '../src/group-by-root-cause.js';
import type { ReviewFinding } from '../src/types.js';

function f(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'jwt-weak-verification',
    severity: 'warning',
    category: 'bug',
    message: 'msg',
    primarySpan: { file: 'a.ts', startLine: 10, startCol: 1, endLine: 10, endCol: 10 },
    fingerprint: `${overrides.ruleId ?? 'jwt-weak-verification'}:10:1`,
    confidence: 80,
    ...overrides,
  };
}

describe('groupFindingsByRootCause', () => {
  it('keeps single findings untouched', () => {
    const out = groupFindingsByRootCause([f()]);
    expect(out).toHaveLength(1);
    expect(out[0].rootCause).toBeUndefined();
  });

  it('does not group findings without explicit rootCause — even when same file/line/family', () => {
    // Conservative scope: synthetic grouping was rejected because it
    // collapsed unrelated same-line rules. Only rule authors who set
    // rootCause opt in.
    const input = [
      f({ ruleId: 'jwt-weak-verification', confidence: 80 }),
      f({ ruleId: 'jwt-decode-no-verify', confidence: 70, fingerprint: 'jwt-decode-no-verify:10:1' }),
    ];
    const out = groupFindingsByRootCause(input);
    expect(out).toHaveLength(2);
  });

  it('does NOT collapse different security families on the same line', () => {
    const input = [
      f({ ruleId: 'jwt-weak-verification' }),
      f({ ruleId: 'csrf-detection', fingerprint: 'csrf-detection:10:1' }),
    ];
    const out = groupFindingsByRootCause(input);
    expect(out).toHaveLength(2);
  });

  it('collapses across rule-families when an explicit rootCause is shared', () => {
    const shared = { key: 'api-call client=c1 method=GET path=/api/me', kind: 'api-call' as const };
    const input = [
      f({ ruleId: 'auth-drift', rootCause: shared }),
      f({ ruleId: 'contract-method-drift', rootCause: shared, fingerprint: 'contract-method-drift:10:1' }),
    ];
    const out = groupFindingsByRootCause(input);
    expect(out).toHaveLength(1);
    expect(out[0].rootCause?.facets?.coveredRules).toContain('auth-drift');
    expect(out[0].rootCause?.facets?.coveredRules).toContain('contract-method-drift');
  });

  it('ties by confidence resolved by severity (error > warning > info)', () => {
    const shared = { key: 'shared-cause-1', kind: 'symbol' as const };
    const input = [
      f({ ruleId: 'jwt-weak-verification', confidence: 80, severity: 'warning', rootCause: shared }),
      f({
        ruleId: 'jwt-decode-no-verify',
        confidence: 80,
        severity: 'error',
        rootCause: shared,
        fingerprint: 'jwt-decode-no-verify:10:1',
      }),
    ];
    const out = groupFindingsByRootCause(input);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('error');
    expect(out[0].ruleId).toBe('jwt-decode-no-verify');
  });

  it('folds duplicates spans into relatedSpans, deduping by location signature', () => {
    const shared = { key: 'shared-cause-2', kind: 'symbol' as const };
    const sameSpan = { file: 'a.ts', startLine: 10, startCol: 1, endLine: 10, endCol: 10 };
    const input = [
      f({ ruleId: 'jwt-weak-verification', primarySpan: sameSpan, rootCause: shared }),
      f({
        ruleId: 'jwt-decode-no-verify',
        primarySpan: sameSpan,
        rootCause: shared,
        fingerprint: 'jwt-decode-no-verify:10:1',
      }),
    ];
    const out = groupFindingsByRootCause(input);
    expect(out).toHaveLength(1);
    // Both share the same span signature, so relatedSpans should be empty.
    expect(out[0].relatedSpans).toBeUndefined();
  });

  it('picks the deterministic tsc finding (95) over a capped LLM finding (89) as primary', () => {
    // The LLM confidence cap (<=89) guarantees a deterministic-source finding
    // in the same group always out-ranks an LLM one on confidence — so
    // group-by-root-cause primary selection stays deterministic-first.
    const shared = { key: 'shared-cause-3', kind: 'symbol' as const };
    const input = [
      f({
        source: 'llm',
        ruleId: 'llm-bug',
        confidence: 89,
        severity: 'error',
        rootCause: shared,
        fingerprint: 'llm-bug:10:1',
      }),
      f({
        source: 'tsc',
        ruleId: 'ts2345',
        confidence: 95,
        severity: 'error',
        rootCause: shared,
        fingerprint: 'ts2345:10:1',
      }),
    ];
    const out = groupFindingsByRootCause(input);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('tsc');
    expect(out[0].ruleId).toBe('ts2345');
    expect(out[0].confidence).toBe(95);
  });
});
