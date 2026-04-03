import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

describe('Rule Layer Activation', () => {
  it('base rules always run', () => {
    const source = `
export function foo(): void {
  try {
    riskyOp();
  } catch (e) {
  }
}
function riskyOp(): void {}
`;
    // No target — base rules still apply. ignored-error (concept) suppresses empty-catch.
    const report = reviewSource(source, 'test.ts');
    const finding = report.findings.find(f => f.ruleId === 'ignored-error' || f.ruleId === 'empty-catch');
    expect(finding).toBeDefined();
  });

  it('react rules only run for react targets', () => {
    const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(async () => { await fetch('/api'); }, []);
  return null;
}
`;
    // No target → no react rules
    const report1 = reviewSource(source, 'comp.tsx');
    const reactRule1 = report1.findings.find(f => f.ruleId === 'async-effect');
    expect(reactRule1).toBeUndefined();

    // With web target → react rules active
    const report2 = reviewSource(source, 'comp.tsx', { target: 'web' });
    const reactRule2 = report2.findings.find(f => f.ruleId === 'async-effect');
    expect(reactRule2).toBeDefined();
  });
});
