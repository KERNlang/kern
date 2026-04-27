import { applyReviewPolicyDefaults, getReviewPolicyProfile, inferReviewPolicy } from '../src/policy.js';

describe('review policy defaults', () => {
  it('infers audit from crossStackMode', () => {
    expect(inferReviewPolicy({ crossStackMode: 'audit' })).toBe('audit');
  });

  it('applies CI defaults without overriding explicit thresholds', () => {
    const config = applyReviewPolicyDefaults(
      { policy: 'ci', minConfidence: 0.9, maxWarnings: 2 },
      { minConfidence: true, maxWarnings: true },
    );

    expect(config.crossStackMode).toBe('guard');
    expect(config.minConfidence).toBe(0.9);
    expect(config.maxWarnings).toBe(2);
    expect(config.maxErrors).toBe(0);
    expect(config.strict).toBe('inline');
    expect(config.strictParse).toBe(true);
  });

  it('exposes human-readable policy metadata', () => {
    expect(getReviewPolicyProfile('ci').description).toContain('Strict CI');
  });
});
