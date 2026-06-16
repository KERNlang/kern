/**
 * Phase-2 ratchet verdict-derivation self-test.
 *
 * `deriveVerdict` is pure given captures + runtime canons, so it can be exercised
 * with synthetic envelopes. Proves: the SEMANTIC-before-byte ordering (a byte-
 * equal but both-wrong row is SEMANTIC_BOTH_WRONG, NOT BYTE_EQUAL), the legacy/
 * AST-blocked classifications, BYTE_EQUAL vs RUNTIME_EQUAL_BYTE_DIFF, and the
 * monotonic regression guard.
 */

import { checkRegression, deriveVerdict, summarize } from '../../../../scripts/phase2/lib/ratchet.mjs';

const ok = (code: string) => ({ status: 'ok' as const, code });
const capErr = (code: string, category = 'parse') => ({ status: 'error' as const, code, category });
const run = (canon: string) => ({ status: 'ok' as const, runtimeCanon: canon });
const runErr = (code: string, category = 'runtime') => ({ status: 'error' as const, code, category });

const A = '{"version":1,"status":"ok","value":{"kind":"string","value":"A"},"calls":[]}';
const B = '{"version":1,"status":"ok","value":{"kind":"string","value":"B"},"calls":[]}';

function base(over: Record<string, unknown> = {}) {
  return {
    caseId: 't',
    route: 'logical',
    legacyCapture: ok('L'),
    astCapture: ok('R'),
    legacyRun: run(A),
    astRun: run(A),
    tsRun: run(A),
    expectedCanon: A,
    ...over,
  };
}

describe('phase2 ratchet verdict derivation', () => {
  test('both routes correct, bytes differ -> RUNTIME_EQUAL_BYTE_DIFF', () => {
    expect(deriveVerdict(base() as never).verdict).toBe('RUNTIME_EQUAL_BYTE_DIFF');
  });

  test('both routes correct, bytes equal -> BYTE_EQUAL', () => {
    const v = deriveVerdict(base({ legacyCapture: ok('SAME'), astCapture: ok('SAME') }) as never);
    expect(v.verdict).toBe('BYTE_EQUAL');
  });

  test('SEMANTIC_BOTH_WRONG beats BYTE_EQUAL: both agree with each other, disagree with TS', () => {
    // Both routes return B, byte-identical, but TS/expected say A.
    const v = deriveVerdict(
      base({
        legacyCapture: ok('SAME'),
        astCapture: ok('SAME'),
        legacyRun: run(B),
        astRun: run(B),
        tsRun: run(A),
        expectedCanon: A,
      }) as never,
    );
    expect(v.verdict).toBe('SEMANTIC_BOTH_WRONG');
  });

  test('legacy wrong, AST right -> LEGACY_BLOCKED (legacy-bug)', () => {
    const v = deriveVerdict(base({ legacyRun: run(B), astRun: run(A) }) as never);
    expect(v.verdict).toBe('LEGACY_BLOCKED');
    expect(v.triage).toBe('legacy-bug');
  });

  test('legacy syntax-error (raw JS), AST right -> LEGACY_BLOCKED', () => {
    // The real slice-0 logical situation: legacy bytes are unrunnable Python.
    const v = deriveVerdict(base({ legacyRun: runErr('py:syntax-error') }) as never);
    expect(v.verdict).toBe('LEGACY_BLOCKED');
  });

  test('AST wrong (ran), legacy right -> RUNTIME_DIVERGE (ast-bug)', () => {
    const v = deriveVerdict(base({ astRun: run(B), legacyRun: run(A) }) as never);
    expect(v.verdict).toBe('RUNTIME_DIVERGE');
    expect(v.triage).toBe('ast-bug');
  });

  test('AST failed to capture, legacy right -> AST_BLOCKED', () => {
    const v = deriveVerdict(
      base({ astCapture: capErr('ast-parse:boom'), astRun: runErr('no-capture', 'parse') }) as never,
    );
    expect(v.verdict).toBe('AST_BLOCKED');
  });

  test('both blocked at runtime with same category -> BOTH_BLOCKED_SAME', () => {
    // Parse-boundary row: both emit, both NameError at runtime, no reference.
    const v = deriveVerdict(
      base({
        legacyRun: runErr('py:nameerror'),
        astRun: runErr('py:nameerror'),
        tsRun: runErr('ts:referenceerror'),
        expectedCanon: null,
      }) as never,
    );
    expect(v.verdict).toBe('BOTH_BLOCKED_SAME');
  });

  test('both blocked with different categories -> BOTH_BLOCKED_DIFF', () => {
    const v = deriveVerdict(
      base({
        legacyCapture: capErr('legacy:boom', 'emit'),
        astCapture: capErr('ast:boom', 'parse'),
        legacyRun: runErr('legacy:boom', 'emit'),
        astRun: runErr('ast:boom', 'parse'),
        tsRun: runErr('ts:boom'),
        expectedCanon: null,
      }) as never,
    );
    expect(v.verdict).toBe('BOTH_BLOCKED_DIFF');
  });
});

describe('phase2 ratchet summary + regression guard', () => {
  test('ratchetCount excludes SEMANTIC_BOTH_WRONG', () => {
    const s = summarize([
      { verdict: 'BYTE_EQUAL' },
      { verdict: 'RUNTIME_EQUAL_BYTE_DIFF' },
      { verdict: 'SEMANTIC_BOTH_WRONG' },
      { verdict: 'LEGACY_BLOCKED' },
    ]);
    expect(s.ratchetCount).toBe(2);
    expect(s.byteEqualCount).toBe(1);
    expect(s.semanticBothWrongCount).toBe(1);
  });

  test('a per-case verdict regression is caught', () => {
    const baseline = {
      records: [{ caseId: 'x', verdict: 'BYTE_EQUAL' }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 0 },
    };
    const current = {
      records: [{ caseId: 'x', verdict: 'RUNTIME_DIVERGE' }],
      summary: { ratchetCount: 0, byteEqualCount: 0, fallbackCount: 0 },
    };
    const v = checkRegression(current, baseline);
    expect(v.length > 0).toBe(true);
    expect(v.some((m) => m.includes('INT_RATCHET_REGRESSION'))).toBe(true);
  });

  test('an improvement (AST_BLOCKED -> BYTE_EQUAL) is allowed', () => {
    const baseline = {
      records: [{ caseId: 'x', verdict: 'AST_BLOCKED' }],
      summary: { ratchetCount: 0, byteEqualCount: 0, fallbackCount: 0 },
    };
    const current = {
      records: [{ caseId: 'x', verdict: 'BYTE_EQUAL' }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 0 },
    };
    expect(checkRegression(current, baseline).length).toBe(0);
  });

  test('a fallbackCount rise is caught', () => {
    const baseline = {
      records: [{ caseId: 'x', verdict: 'BYTE_EQUAL' }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 0 },
    };
    const current = {
      records: [{ caseId: 'x', verdict: 'BYTE_EQUAL' }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 2 },
    };
    const v = checkRegression(current, baseline);
    expect(v.some((m) => m.includes('INT_FALLBACK_COUNT_REGRESSION'))).toBe(true);
  });

  test('a new case (absent from baseline) does not trigger regression', () => {
    const baseline = { records: [], summary: { ratchetCount: 0, byteEqualCount: 0, fallbackCount: 0 } };
    const current = {
      records: [{ caseId: 'new', verdict: 'AST_BLOCKED' }],
      summary: { ratchetCount: 0, byteEqualCount: 0, fallbackCount: 0 },
    };
    expect(checkRegression(current, baseline).length).toBe(0);
  });
});
