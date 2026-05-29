import { parseDocument, resolveConfig } from '@kernlang/core';
import { collectFenceDiagnostics } from '../src/core/fence-diagnostics.js';
import { transpilePython } from '../src/targets/python.js';

function diagnose(src: string, severity?: 'error' | 'warning' | 'info') {
  const root = parseDocument(src);
  return collectFenceDiagnostics(root, severity ?? 'warning');
}

describe('python target — fence portability diagnostics', () => {
  test('raw unmarked TS fence → warning, flagged non-portable', () => {
    const diags = diagnose(
      ['fn add(a: number, b: number): number', '  handler <<<', '    return a + b;', '  >>>'].join('\n'),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].outcome).toBe('unsupported');
    expect(diags[0].target).toBe('python');
    expect(diags[0].message).toContain('raw TS fence');
    expect(diags[0].message).toContain('not portable');
    expect(diags[0].message).toContain('fn "add"');
  });

  test('explicit lang="ts" fence → info, foreign', () => {
    const diags = diagnose(['fn two(): number', '  handler lang="ts" <<<', '    return 2;', '  >>>'].join('\n'));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
    expect(diags[0].message).toContain('lang="ts"');
    expect(diags[0].message).toContain('foreign');
  });

  test('lang variants js/javascript/tsx/jsx → info foreign', () => {
    for (const lang of ['js', 'javascript', 'tsx', 'jsx']) {
      const diags = diagnose(['fn f(): number', `  handler lang="${lang}" <<<`, '    return 1;', '  >>>'].join('\n'));
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe('info');
      expect(diags[0].message).toContain(`lang="${lang}"`);
    }
  });

  test('native kern handler → info, not-yet-emitted (kills false-security)', () => {
    const diags = diagnose(['fn native(): number', '  handler', '    let x = 1', '    return x'].join('\n'));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
    expect(diags[0].message).toContain('portable kern');
    expect(diags[0].message).toContain('not yet emitted');
  });

  test('lang="python" fence → info, python-native not-yet-emitted', () => {
    const diags = diagnose(['fn three(): number', '  handler lang="python" <<<', '    return 3', '  >>>'].join('\n'));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
    expect(diags[0].message).toContain('python-native');
  });

  test('empty fence → no diagnostic', () => {
    const diags = diagnose(['fn empty(): number', '  handler <<<', '  >>>'].join('\n'));
    expect(diags).toHaveLength(0);
  });

  test('unknown lang fence → treated as raw, non-portable (warning)', () => {
    const diags = diagnose(['fn r(): number', '  handler lang="ruby" <<<', '    return 1', '  >>>'].join('\n'));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain('lang="ruby"');
    expect(diags[0].message).toContain('not portable');
  });

  test('empty-string lang fence → treated like an unmarked raw TS fence', () => {
    const diags = diagnose(['fn e(): number', '  handler lang="" <<<', '    return 1;', '  >>>'].join('\n'));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain('raw TS fence');
  });

  test('pythonFenceSeverity="error" escalates raw fences (and fails build)', () => {
    const diags = diagnose(
      ['fn add(a: number): number', '  handler <<<', '    return a;', '  >>>'].join('\n'),
      'error',
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  test('pythonFenceSeverity does not escalate info-tier fences', () => {
    const diags = diagnose(
      ['fn two(): number', '  handler lang="ts" <<<', '    return 2;', '  >>>'].join('\n'),
      'error',
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
  });

  test('one diagnostic per handler — no double-reporting across many handlers', () => {
    const src = [
      'fn a(): number',
      '  handler <<<',
      '    return 1;',
      '  >>>',
      'fn b(): number',
      '  handler lang="ts" <<<',
      '    return 2;',
      '  >>>',
      'fn c(): number',
      '  handler',
      '    return 3',
    ].join('\n');
    const diags = diagnose(src);
    expect(diags).toHaveLength(3);
    expect(diags.filter((d) => d.severity === 'warning')).toHaveLength(1);
    expect(diags.filter((d) => d.severity === 'info')).toHaveLength(2);
  });

  test('transpilePython surfaces the diagnostics (default warning)', () => {
    const root = parseDocument(['fn add(a: number): number', '  handler <<<', '    return a;', '  >>>'].join('\n'));
    const result = transpilePython(root);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe('warning');
  });

  test('transpilePython threads config.pythonFenceSeverity through to raw fences', () => {
    const root = parseDocument(['fn add(a: number): number', '  handler <<<', '    return a;', '  >>>'].join('\n'));
    const result = transpilePython(root, resolveConfig({ pythonFenceSeverity: 'error' }));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe('error');
  });
});
