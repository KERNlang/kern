import {
  applyRuleQualityCalibration,
  applyRuleSupersession,
  getRuleQualityProfile,
  isRulePromotedForCi,
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
