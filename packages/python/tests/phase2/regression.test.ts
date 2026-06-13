/**
 * Phase-2 fix-round regression guards — the adversarial self-tests mandated by
 * the 6-engine review. Each test FAILS against the pre-fix code and PASSES after
 * the fix, so a future regression that re-opens one of these holes is caught.
 *
 * Coverage (review finding -> guard):
 *   R2/G1 — no-reference + agreeing-wrong routes must be CAPTURE_ERROR, never
 *           BYTE_EQUAL (pre-fix: the `else` byteVerdict path scored a poisoned
 *           reference as BYTE_EQUAL).
 *   R1    — a baseline case missing from current is a regression (pre-fix: only
 *           `current.records` was iterated, so a dropped row went green).
 *   R4/G3 — every current SEMANTIC_BOTH_WRONG is a hard violation regardless of
 *           baseline (pre-fix: a NEW such case bypassed the per-case rank check).
 *   R3    — fallbackCount delta is scoped to baseline-present cases.
 *   E2    — legacy SyntaxError + AST NameError classify to DIFFERENT categories
 *           -> BOTH_BLOCKED_DIFF (pre-fix: the `'runtime' : 'runtime'` no-op
 *           collapsed both to BOTH_BLOCKED_SAME).
 *   E1    — a user expression printing a forged result line with the WRONG nonce
 *           cannot corrupt the real result (pre-fix: the fixed `__PHASE2_RESULT__`
 *           prefix was forgeable).
 *   E3    — List callbacks forward ALL args (element, index, array); an unshimmed
 *           List method fails LOUD instead of silently degrading the TS route.
 *   C1    — the legacy consistency oracle is NON-tautological: a mutated capture
 *           framing is caught via the independent re-derivation.
 *   Route-flip — Gate-INT refuses a --candidate-route flip while the baseline tag
 *           is volatile (INT_FORBIDDEN_ROUTE_FLIP).
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCaptureConvention } from '../../../../scripts/phase2/lib/capture.mjs';
import { executePython, executeTs } from '../../../../scripts/phase2/lib/execute-artifact.mjs';
import { checkRegression, deriveVerdict } from '../../../../scripts/phase2/lib/ratchet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const GATE_INT = join(REPO, 'scripts/phase2-gate-int.mjs');

const pythonAvailable = (() => {
  try {
    return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
})();

const ok = (code: string) => ({ status: 'ok' as const, code });
const run = (canon: string) => ({ status: 'ok' as const, runtimeCanon: canon });
const runErr = (code: string, category = 'runtime') => ({ status: 'error' as const, code, category });

const B = '{"version":1,"status":"ok","value":{"kind":"string","value":"B"},"calls":[]}';

describe('R2/G1 — poisoned reference never scores BYTE_EQUAL', () => {
  test('tsCanon null + two agreeing-wrong routes -> CAPTURE_ERROR (not BYTE_EQUAL)', () => {
    // Both routes ran and agree byte-for-byte, but there is NO reference: TS
    // failed to run AND there is no `expected`. Pre-fix this hit the `else`
    // byteVerdict path and returned BYTE_EQUAL — a poisoned-reference false-green.
    const v = deriveVerdict({
      caseId: 'poisoned',
      route: 'logical',
      legacyCapture: ok('SAME'),
      astCapture: ok('SAME'),
      legacyRun: run(B),
      astRun: run(B),
      tsRun: runErr('ts:typeerror'), // reference is DEAD
      expectedCanon: null,
    } as never);
    expect(v.verdict).toBe('CAPTURE_ERROR');
    expect(v.verdict).not.toBe('BYTE_EQUAL');
    expect(v.triage).toBe('no-reference');
  });

  test('a genuinely-blocked no-reference row still classifies as blocked (not CAPTURE_ERROR)', () => {
    // Guard against over-correction: when a route did NOT run, the blocked path
    // (BOTH_BLOCKED_SAME) must still apply — only EXECUTABLE no-reference rows
    // become CAPTURE_ERROR.
    const v = deriveVerdict({
      caseId: 'blocked',
      route: 'logical',
      legacyCapture: ok('L'),
      astCapture: ok('R'),
      legacyRun: runErr('py:nameerror'),
      astRun: runErr('py:nameerror'),
      tsRun: runErr('ts:referenceerror'),
      expectedCanon: null,
    } as never);
    expect(v.verdict).toBe('BOTH_BLOCKED_SAME');
  });
});

describe('R1 — baseline row disappearance is a regression', () => {
  test('a baseline case absent from current yields a violation', () => {
    const baseline = {
      records: [
        { caseId: 'kept', verdict: 'BYTE_EQUAL' },
        { caseId: 'gone', verdict: 'SEMANTIC_BOTH_WRONG' },
      ],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 0 },
    };
    const current = {
      records: [{ caseId: 'kept', verdict: 'BYTE_EQUAL' }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 0 },
    };
    const v = checkRegression(current, baseline);
    expect(v.some((m) => m.includes('case gone disappeared'))).toBe(true);
  });
});

describe('R4/G3 — SEMANTIC_BOTH_WRONG always fails, even for a new case', () => {
  test('a NEW current SEMANTIC_BOTH_WRONG (absent from baseline) is a violation', () => {
    const baseline = { records: [], summary: { ratchetCount: 0, byteEqualCount: 0, fallbackCount: 0 } };
    const current = {
      records: [{ caseId: 'fresh', verdict: 'SEMANTIC_BOTH_WRONG' }],
      summary: { ratchetCount: 0, byteEqualCount: 0, fallbackCount: 0, semanticBothWrongCount: 1 },
    };
    const v = checkRegression(current, baseline);
    expect(v.some((m) => m.includes('SEMANTIC_BOTH_WRONG'))).toBe(true);
  });
});

describe('R3 — fallbackCount delta is scoped to baseline-present cases', () => {
  test('a new case using a fallback does not trip the aggregate regression', () => {
    const baseline = {
      records: [{ caseId: 'old', verdict: 'BYTE_EQUAL', fallbackUsed: false }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 0 },
    };
    const current = {
      records: [
        { caseId: 'old', verdict: 'BYTE_EQUAL', fallbackUsed: false },
        { caseId: 'new', verdict: 'AST_BLOCKED', fallbackUsed: true },
      ],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 1 },
    };
    const v = checkRegression(current, baseline);
    expect(v.some((m) => m.includes('INT_FALLBACK_COUNT_REGRESSION'))).toBe(false);
  });

  test('a baseline-present case newly using a fallback IS caught', () => {
    const baseline = {
      records: [{ caseId: 'old', verdict: 'BYTE_EQUAL', fallbackUsed: false }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 0 },
    };
    const current = {
      records: [{ caseId: 'old', verdict: 'BYTE_EQUAL', fallbackUsed: true }],
      summary: { ratchetCount: 1, byteEqualCount: 1, fallbackCount: 1 },
    };
    const v = checkRegression(current, baseline);
    expect(v.some((m) => m.includes('INT_FALLBACK_COUNT_REGRESSION'))).toBe(true);
  });
});

if (pythonAvailable) {
  describe('E2 — error categories are distinguishable (no BOTH_BLOCKED_SAME collapse)', () => {
    test('legacy SyntaxError -> emit, AST NameError -> runtime, via real executePython', () => {
      const syntax = executePython({ code: 'a || b', imports: [], helpers: [] }, { locals: { a: 1, b: 2 } });
      const name = executePython({ code: 'undefined_name_xyz', imports: [], helpers: [] }, {});
      expect(syntax.status).toBe('error');
      expect(name.status).toBe('error');
      // Pre-fix BOTH were category 'runtime'; the fix maps SyntaxError -> 'emit'.
      expect((syntax as { category: string }).category).toBe('emit');
      expect((name as { category: string }).category).toBe('runtime');
      expect((syntax as { category: string }).category).not.toBe((name as { category: string }).category);
    });

    test('legacy SyntaxError + AST NameError -> BOTH_BLOCKED_DIFF (not SAME)', () => {
      const legacyRun = executePython({ code: 'a || b', imports: [], helpers: [] }, { locals: { a: 1, b: 2 } });
      const astRun = executePython({ code: 'undefined_name_xyz', imports: [], helpers: [] }, {});
      const v = deriveVerdict({
        caseId: 'collapse',
        route: 'logical',
        legacyCapture: ok('a || b'),
        astCapture: ok('undefined_name_xyz'),
        legacyRun,
        astRun,
        tsRun: runErr('ts:typeerror'),
        expectedCanon: null,
      } as never);
      // Pre-fix: both categories 'runtime' -> BOTH_BLOCKED_SAME.
      expect(v.verdict).toBe('BOTH_BLOCKED_DIFF');
    });
  });

  describe('E1 — result line is not spoofable by user-expression stdout', () => {
    test('a forged line using the OLD fixed prefix does not corrupt the real result', () => {
      // The expression prints the EXACT old fixed marker `__PHASE2_RESULT__...`
      // and then evaluates to 42. PRE-FIX that prefix was the real one, so
      // extractResult saw TWO distinct result lines and threw 'multiple distinct
      // result lines' -> the row degraded to a runner error (corruption).
      // POST-FIX the real prefix carries a random uuid, so the forged old-prefix
      // line is ignored and the real result (42) survives unharmed.
      const emit = {
        code: '(print(\'__PHASE2_RESULT__{"version":1,"status":"ok","value":{"kind":"string","value":"spoofed"},"calls":[]}\') or 42)',
        imports: [] as string[],
        helpers: [] as string[],
      };
      const r = executePython(emit, {});
      expect(r.status).toBe('ok');
      expect((r as { runtimeCanon: string }).runtimeCanon).toContain('"value":"42"');
      expect((r as { runtimeCanon: string }).runtimeCanon).not.toContain('spoofed');
    });
  });

  describe('E3 — List shim forwards all callback args; missing methods fail loud', () => {
    test('(x,i)=>i map: the TS reference includes the index', () => {
      const ts = executeTs('List.map([10,20,30], (x,i) => i)', {});
      expect(ts.status).toBe('ok');
      // Index forwarded -> [0,1,2]; pre-fix the (x)=>fn(x) wrapper dropped i -> [undefined,...].
      const canon = (ts as { runtimeCanon: string }).runtimeCanon;
      expect(canon).toContain('"value":"0"');
      expect(canon).toContain('"value":"1"');
      expect(canon).toContain('"value":"2"');
      expect(canon).not.toContain('undefined');
    });

    test('an unshimmed List method fails LOUD (identifiable error), not silent degradation', () => {
      const ts = executeTs('List.flatMap([1,2],(x)=>[x])', {});
      expect(ts.status).toBe('error');
      // A loud, categorized failure — never a silent null that R2 would byte-score.
      expect((ts as { code: string }).code).toContain('phase2listshimerror');
    });
  });

  describe('C1 — the capture-convention check, scoped honestly', () => {
    // HONESTY: on the empty-framing slice-0 corpus this check is true BY
    // CONSTRUCTION (production legacy bytes ARE rewriteExpr(expr)); it is NOT a
    // fidelity proof there. These tests exercise the framing-consistency
    // mechanism on NON-EMPTY framing — where it actually bites — so it is
    // proven ready to guard the future route-corpus slice (and a hand-translation
    // drift between the two derivations would surface), both directions.

    test('independent re-derivation AGREES with framing() on a realistic multi-param path', async () => {
      // If framingIndependent() were a buggy hand-translation of framing(), a
      // multi-param path is where it would diverge (segment boundaries, ordering).
      const c = {
        id: 'c1-multiparam-agree',
        kind: 'expr',
        source: 'a | z',
        path: '/a/:id/b/:slug',
        authUser: true,
        bindings: { locals: { a: 1, z: 0 }, body: { field1: 1, field2: 2 } },
      };
      const r = await verifyCaptureConvention([c], REPO);
      expect(r.ok).toBe(true);
      expect(r.rows[0].framingMatch).toBe(true);
    });

    test('a CAPTURE-side framing divergence is caught (capture has extra params)', async () => {
      const c = {
        id: 'c1-divergence-capture',
        kind: 'expr',
        source: 'a | z',
        path: '/u/:id',
        bindings: { locals: { a: 1, z: 0 } },
      };
      // The bytes can coincide when the expr ignores path params, which is exactly
      // why the framing-TUPLE comparison — not just bytes — is load-bearing.
      const bad = await verifyCaptureConvention([c], REPO, {
        captureFramingOverride: () => ({ pathParams: ['BOGUS'], bodyFields: new Set(['x']), authUser: true }),
      });
      expect(bad.ok).toBe(false);
      expect(bad.rows[0].framingMatch).toBe(false);
      expect(bad.rows[0].note).toContain('FRAMING DIVERGENCE');
    });

    test('the OTHER direction is caught too (capture is missing a param the path has)', async () => {
      // Production-contracts direction: the path declares :id but the capture
      // framing drops it. The independent derivation still finds :id, so the
      // tuple diverges and the check bites — not just the capture-adds direction.
      const c = {
        id: 'c1-divergence-contract',
        kind: 'expr',
        source: 'a | z',
        path: '/u/:id',
        bindings: { locals: { a: 1, z: 0 } },
      };
      const bad = await verifyCaptureConvention([c], REPO, {
        captureFramingOverride: () => ({ pathParams: [], bodyFields: new Set(), authUser: false }),
      });
      expect(bad.ok).toBe(false);
      expect(bad.rows[0].framingMatch).toBe(false);
      expect(bad.rows[0].note).toContain('FRAMING DIVERGENCE');
    });
  });
}

describe('Route-flip refusal — Gate-INT refuses a candidate flip while volatile', () => {
  test('--candidate-route is refused with INT_FORBIDDEN_ROUTE_FLIP on the volatile baseline', () => {
    const res = spawnSync('node', [GATE_INT, '--candidate-route', 'logical', '--check'], {
      cwd: REPO,
      encoding: 'utf-8',
      env: { ...process.env },
    });
    expect(res.status).not.toBe(0);
    expect(`${res.stderr}${res.stdout}`).toContain('INT_FORBIDDEN_ROUTE_FLIP');
  });
});
