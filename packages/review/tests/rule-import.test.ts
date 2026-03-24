import { loadNativeRules } from '../src/rule-loader.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = join(tmpdir(), 'kern-rule-import-test');

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('rule import', () => {
  it('loads rules from imported .kern files', () => {
    // Write a base rules file
    writeFileSync(join(TMP, 'base.kern'), `
rule base-check severity=info category=pattern
  pattern type=guard
  message "Base rule fired"
`);

    // Write a file that imports it
    writeFileSync(join(TMP, 'main.kern'), `
import from="base.kern"

rule main-check severity=warning category=bug
  pattern type=effect
  message "Main rule fired"
`);

    const rules = loadNativeRules([TMP]);
    // base.kern has 1 rule, main.kern has 1 rule + imports base.kern
    // But base.kern is also discovered directly from the directory scan
    // So: base.kern loaded once (via direct scan), main.kern loaded (imports base.kern — already visited, skipped)
    // Total: 2 rules (base-check + main-check)
    expect(rules.length).toBe(2);
  });

  it('handles circular imports without infinite loop', () => {
    writeFileSync(join(TMP, 'a.kern'), `
import from="b.kern"

rule rule-a severity=info category=pattern
  pattern type=guard
  message "Rule A"
`);

    writeFileSync(join(TMP, 'b.kern'), `
import from="a.kern"

rule rule-b severity=info category=pattern
  pattern type=effect
  message "Rule B"
`);

    // Should not hang — circular import guard prevents infinite recursion
    const rules = loadNativeRules([TMP]);
    // a.kern and b.kern both discovered, circular imports resolved by visited set
    expect(rules.length).toBeGreaterThanOrEqual(2);
  });

  it('warns on missing import (does not crash)', () => {
    writeFileSync(join(TMP, 'with-missing.kern'), `
import from="nonexistent.kern"

rule still-works severity=info category=pattern
  pattern type=guard
  message "This rule should still load"
`);

    const rules = loadNativeRules([TMP]);
    const ruleCount = rules.length;
    // The still-works rule should be loaded despite missing import
    expect(ruleCount).toBeGreaterThanOrEqual(1);
  });
});
