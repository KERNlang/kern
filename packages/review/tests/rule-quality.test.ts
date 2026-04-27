import {
  applyRoleAwareConfidence,
  applyRuleQualityCalibration,
  applyRuleSupersession,
  getRuleQualityProfile,
  isRulePromotedForCi,
  roleMultiplierFor,
  validateRuleQualityRegistry,
} from '../src/rule-quality.js';
import type { ReviewFinding } from '../src/types.js';

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    source: 'kern',
    ruleId: 'test-rule',
    severity: 'warning',
    category: 'pattern',
    message: 'test finding',
    primarySpan: { file: 'input.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    fingerprint: 'test-rule:1:1',
    confidence: 0.85,
    ...overrides,
  };
}

describe('rule quality profiles', () => {
  it('infers stable metadata for legacy rules without explicit precision', () => {
    expect(getRuleQualityProfile('floating-promise')).toMatchObject({
      id: 'floating-promise',
      precision: 'medium',
      lifecycle: 'stable',
      ciDefault: 'guarded',
    });
  });

  it('keeps rollout rules guarded until promoted', () => {
    expect(getRuleQualityProfile('xss-href-javascript')).toMatchObject({
      id: 'xss-href-javascript',
      precision: 'high',
      lifecycle: 'candidate',
      ciDefault: 'guarded',
    });
  });

  it('keeps experimental rules out of default CI posture', () => {
    expect(getRuleQualityProfile('large-list-no-virtualization')).toMatchObject({
      id: 'large-list-no-virtualization',
      precision: 'experimental',
      lifecycle: 'experimental',
      ciDefault: 'off',
    });
  });

  it('exposes root-cause ownership metadata for overlapping concept rules', () => {
    expect(getRuleQualityProfile('auth-drift')?.supersedes).toEqual(
      expect.arrayContaining(['auth-propagation-drift', 'unhandled-api-error-shape']),
    );
  });

  it('has a self-consistent registry', () => {
    expect(validateRuleQualityRegistry()).toEqual([]);
  });

  it('promotes only stable CI-on rules to hard production gates', () => {
    expect(isRulePromotedForCi('async-effect')).toBe(true);
    expect(isRulePromotedForCi('xss-href-javascript')).toBe(false);
    expect(isRulePromotedForCi('large-list-no-virtualization')).toBe(false);
  });
});

describe('rule quality calibration', () => {
  it('demotes advisory rules to info in guard mode', () => {
    const findings = [finding({ ruleId: 'dead-export', severity: 'warning' })];

    applyRuleQualityCalibration(findings);

    expect(findings[0].severity).toBe('info');
  });

  it('preserves advisory severity in audit mode', () => {
    const findings = [finding({ ruleId: 'dead-export', severity: 'warning' })];

    applyRuleQualityCalibration(findings, { crossStackMode: 'audit' });

    expect(findings[0].severity).toBe('warning');
  });

  it('softens experimental findings and caps confidence in guard mode', () => {
    const findings = [
      finding({
        ruleId: 'large-list-no-virtualization',
        severity: 'warning',
        confidence: 0.85,
      }),
    ];

    applyRuleQualityCalibration(findings);

    expect(findings[0].severity).toBe('info');
    expect(findings[0].confidence).toBe(0.6);
  });

  it('never demotes errors during guard calibration', () => {
    const findings = [
      finding({
        ruleId: 'xss-href-javascript',
        severity: 'error',
      }),
    ];

    applyRuleQualityCalibration(findings);

    expect(findings[0].severity).toBe('error');
  });

  it('is idempotent — second call does not re-demote or re-cap', () => {
    const findings = [
      finding({
        ruleId: 'large-list-no-virtualization',
        severity: 'warning',
        confidence: 0.85,
      }),
    ];

    applyRuleQualityCalibration(findings);
    const afterFirst = { ...findings[0] };

    applyRuleQualityCalibration(findings);

    expect(findings[0].severity).toBe(afterFirst.severity);
    expect(findings[0].confidence).toBe(afterFirst.confidence);
    expect(findings[0].calibrationTrail?.length).toBe(afterFirst.calibrationTrail?.length);
    expect(findings[0].calibrated).toBe(true);
  });

  it('records calibration trail when severity is demoted', () => {
    const findings = [finding({ ruleId: 'dead-export', severity: 'warning' })];

    applyRuleQualityCalibration(findings);

    expect(findings[0].calibrationTrail).toEqual([
      expect.objectContaining({
        stage: 'rule-quality:demote-advisory',
        beforeSeverity: 'warning',
        afterSeverity: 'info',
      }),
    ]);
  });

  it('records calibration trail when experimental confidence is capped', () => {
    const findings = [
      finding({
        ruleId: 'large-list-no-virtualization',
        severity: 'warning',
        confidence: 0.85,
      }),
    ];

    applyRuleQualityCalibration(findings);

    const stages = findings[0].calibrationTrail ?? [];
    expect(stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'rule-quality:experimental-cap',
          beforeConfidence: 0.85,
          afterConfidence: 0.6,
        }),
      ]),
    );
  });

  it('does not record trail or set calibrated flag in audit mode', () => {
    const findings = [finding({ ruleId: 'dead-export', severity: 'warning' })];

    applyRuleQualityCalibration(findings, { crossStackMode: 'audit' });

    expect(findings[0].calibrationTrail).toBeUndefined();
    expect(findings[0].calibrated).toBeUndefined();
  });

  it('protects graph-mode union: pre-calibrated finding is left alone when re-run', () => {
    // Simulates the index.ts site D path: per-file calibration runs, then graph
    // mode unions findings + suppressedFindings and runs calibration again. The
    // pre-calibrated entry must not be touched a second time.
    const findings = [finding({ ruleId: 'dead-export', severity: 'warning', confidence: 0.85 })];
    applyRuleQualityCalibration(findings);
    const preCalibrated = findings[0];

    const newCrossFileFinding = finding({
      ruleId: 'dead-export',
      severity: 'warning',
      confidence: 0.85,
      primarySpan: { file: 'other.ts', startLine: 5, startCol: 1, endLine: 5, endCol: 1 },
      fingerprint: 'dead-export:other:5:1',
    });

    const union = [preCalibrated, newCrossFileFinding];
    applyRuleQualityCalibration(union);

    expect(preCalibrated.calibrationTrail?.length).toBe(1);
    expect(newCrossFileFinding.calibrationTrail?.length).toBe(1);
    expect(newCrossFileFinding.calibrated).toBe(true);
  });
});

describe('role-aware confidence multipliers', () => {
  it('zeros confidence on dead-export inside a barrel file', () => {
    const findings = [finding({ ruleId: 'dead-export', confidence: 0.85 })];

    applyRoleAwareConfidence(findings, 'barrel');

    expect(findings[0].confidence).toBe(0);
    expect(findings[0].calibrationTrail?.[0]).toMatchObject({
      stage: 'role-aware:confidence-multiplier',
      factor: 0,
      beforeConfidence: 0.85,
      afterConfidence: 0,
    });
  });

  it('halves cognitive-complexity inside a test file (factor 0.5)', () => {
    const findings = [finding({ ruleId: 'cognitive-complexity', confidence: 0.8 })];

    applyRoleAwareConfidence(findings, 'test');

    expect(findings[0].confidence).toBeCloseTo(0.4, 5);
  });

  it('does not touch findings on runtime files (default factor=1)', () => {
    const findings = [finding({ ruleId: 'dead-export', confidence: 0.85 })];

    applyRoleAwareConfidence(findings, 'runtime');

    expect(findings[0].confidence).toBe(0.85);
    expect(findings[0].calibrationTrail).toBeUndefined();
  });

  it('SECURITY: never reduces confidence on a security-layer rule, regardless of role', () => {
    // hardcoded-secret is layer='security' in rules/index.ts. Even if a future edit
    // lists it in ROLE_MULTIPLIER, isProtectedRule() must short-circuit.
    const findings = [finding({ ruleId: 'hardcoded-secret', confidence: 0.9 })];

    applyRoleAwareConfidence(findings, 'codegen');

    expect(findings[0].confidence).toBe(0.9);
    expect(findings[0].calibrationTrail).toBeUndefined();
  });

  it('SECURITY: roleMultiplierFor returns 1 for any security-layer rule', () => {
    expect(roleMultiplierFor('codegen', 'hardcoded-secret')).toBe(1);
    expect(roleMultiplierFor('barrel', 'command-injection')).toBe(1);
    expect(roleMultiplierFor('test', 'xss-unsafe-html')).toBe(1);
  });

  it('NaN-safe: unmapped role+rule pair returns factor 1', () => {
    expect(roleMultiplierFor('runtime', 'this-rule-does-not-exist')).toBe(1);
    expect(roleMultiplierFor('barrel', 'unknown-rule')).toBe(1);
  });

  it('preserves findings in audit mode', () => {
    const findings = [finding({ ruleId: 'dead-export', confidence: 0.85 })];

    applyRoleAwareConfidence(findings, 'barrel', { crossStackMode: 'audit' });

    expect(findings[0].confidence).toBe(0.85);
    expect(findings[0].calibrationTrail).toBeUndefined();
  });

  it('skips findings already calibrated (graph-mode union safety)', () => {
    const findings = [finding({ ruleId: 'dead-export', confidence: 0.85, calibrated: true })];

    applyRoleAwareConfidence(findings, 'barrel');

    expect(findings[0].confidence).toBe(0.85);
    expect(findings[0].calibrationTrail).toBeUndefined();
  });

  it('composes with rule-quality calibration: role first, then quality', () => {
    // Order at the call sites: role-aware → rule-quality. Both record their own
    // trail entries. rule-quality flips `calibrated=true` last.
    const findings = [finding({ ruleId: 'dead-export', confidence: 0.85, severity: 'warning' })];

    applyRoleAwareConfidence(findings, 'codegen');
    applyRuleQualityCalibration(findings);

    expect(findings[0].confidence).toBe(0); // role multiplier zeroed
    expect(findings[0].severity).toBe('info'); // rule-quality demoted advisory
    expect(findings[0].calibrationTrail?.length).toBe(2);
    expect(findings[0].calibrated).toBe(true);
  });
});

describe('rule supersession', () => {
  it('suppresses lower-level overlapping findings at the same root span in guard mode', () => {
    const findings = [
      finding({ ruleId: 'auth-drift', message: 'raw fetch lacks auth' }),
      finding({ ruleId: 'auth-propagation-drift', message: 'wrapper lacks auth' }),
      finding({ ruleId: 'unhandled-api-error-shape', message: 'error shape not handled' }),
    ];

    const filtered = applyRuleSupersession(findings);

    expect(filtered.map((f) => f.ruleId)).toEqual(['auth-drift']);
  });

  it('uses semantic root causes before source spans', () => {
    const findings = [
      finding({
        ruleId: 'auth-drift',
        primarySpan: { file: 'input.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        rootCause: { kind: 'api-call', key: 'api-call client=c1 method=GET path=/api/me' },
      }),
      finding({
        ruleId: 'auth-propagation-drift',
        primarySpan: { file: 'input.ts', startLine: 30, startCol: 5, endLine: 30, endCol: 5 },
        rootCause: { kind: 'api-call', key: 'api-call client=c1 method=GET path=/api/me' },
      }),
    ];

    const filtered = applyRuleSupersession(findings);

    expect(filtered.map((f) => f.ruleId)).toEqual(['auth-drift']);
  });

  it('does not suppress the same rule ids at different root spans', () => {
    const findings = [
      finding({
        ruleId: 'auth-drift',
        primarySpan: { file: 'input.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      }),
      finding({
        ruleId: 'auth-propagation-drift',
        primarySpan: { file: 'input.ts', startLine: 2, startCol: 1, endLine: 2, endCol: 1 },
      }),
    ];

    const filtered = applyRuleSupersession(findings);

    expect(filtered.map((f) => f.ruleId)).toEqual(['auth-drift', 'auth-propagation-drift']);
  });

  it('preserves overlapping findings in audit mode', () => {
    const findings = [
      finding({ ruleId: 'auth-drift', message: 'raw fetch lacks auth' }),
      finding({ ruleId: 'auth-propagation-drift', message: 'wrapper lacks auth' }),
    ];

    const filtered = applyRuleSupersession(findings, { crossStackMode: 'audit' });

    expect(filtered.map((f) => f.ruleId)).toEqual(['auth-drift', 'auth-propagation-drift']);
  });
});
