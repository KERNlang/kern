import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runTest } from '../src/commands/test.js';

describe('kern test command', () => {
  let tmpDir: string;
  let originalExitCode: string | number | null | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-test-command-'));
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = originalExitCode;
  });

  function expectUsageExit(args: string[], expectedError: string): void {
    const errors: string[] = [];
    const originalExit = process.exit;
    const originalError = console.error;
    const originalWrite = process.stdout.write;
    process.exit = ((code?: string | number | null | undefined): never => {
      throw new Error(`exit:${String(code)}`);
    }) as typeof process.exit;
    console.error = (...values: unknown[]) => {
      errors.push(values.map(String).join(' '));
    };
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      expect(() => runTest(args)).toThrow('exit:2');
      expect(errors.join('\n')).toContain(expectedError);
    } finally {
      process.exit = originalExit;
      console.error = originalError;
      process.stdout.write = originalWrite;
      process.exitCode = undefined;
    }
  }

  test('routes native suites through @kernlang/test and emits json', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="reaches paid"',
        '    expect machine=Order reaches=paid',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0].assertion).toBe('machine Order reaches paid');
  });

  test('lists and explains native rule metadata without a test input', () => {
    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', '--list-rules']);
      expect(chunks.join('')).toContain('no:codegenerrors');

      chunks.length = 0;
      runTest(['test', '--explain-rule', 'no:unguardedEffects']);
      expect(chunks.join('')).toContain('Detected effects have guard');

      chunks.length = 0;
      runTest(['test', '--list-rules', '--grep']);
      expect(chunks.join('')).toContain('no:codegenerrors');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('reports unknown native rule metadata without a test input', () => {
    expectUsageExit(['test', '--explain-rule', 'no:doesNotExist'], 'Unknown native test rule: no:doesNotExist');
  });

  test('sets exitCode instead of exiting when native suites fail', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=confirm from=pending to=pending',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="reaches paid"',
        '    expect machine=Order reaches=paid via=confirm',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  test('runs native suites discovered under a directory', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'order.test.kern'),
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="uses machine preset"',
        '    expect preset=machine',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', tmpDir, '--json']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.testFiles).toEqual([join(tmpDir, 'order.test.kern')]);
    expect(summary.passed).toBe(2);
    expect(summary.warnings).toBe(0);
    expect(summary.failed).toBe(0);
  });

  test('allows empty native directory runs with pass-with-no-tests', () => {
    writeFileSync(join(tmpDir, 'plain.kern'), 'const name=value value=1');

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', tmpDir, '--json', '--pass-with-no-tests']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.testFiles).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(0);
    expect(process.exitCode).toBeUndefined();
  });

  test('allows empty single-file grep runs with pass-with-no-tests', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="reaches paid"',
        '    expect machine=Order reaches=paid',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json', '--grep', 'not-present', '--pass-with-no-tests']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(0);
    expect(process.exitCode).toBeUndefined();
  });

  test('keeps warning-only native runs green unless fail-on-warn is set', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json']);
      const summary = JSON.parse(chunks.join(''));
      expect(summary.warnings).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.results[0].ruleId).toBe('no:deadstates');
      expect(process.exitCode).toBeUndefined();

      chunks.length = 0;
      process.exitCode = undefined;
      runTest(['test', testFile, '--json', '--fail-on-warn']);
      const strictSummary = JSON.parse(chunks.join(''));
      expect(strictSummary.warnings).toBe(1);
      expect(strictSummary.failed).toBe(0);
      expect(process.exitCode).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('promotes directory warning summaries to exitCode with fail-on-warn', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'order.test.kern'),
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', tmpDir, '--json', '--fail-on-warn']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.warnings).toBe(1);
    expect(summary.failed).toBe(0);
    expect(process.exitCode).toBe(1);
  });

  test('enforces native warning budgets with max-warnings', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json', '--max-warnings', '1']);
      expect(JSON.parse(chunks.join('')).warnings).toBe(1);
      expect(process.exitCode).toBeUndefined();

      chunks.length = 0;
      process.exitCode = undefined;
      runTest(['test', testFile, '--json', '--max-warnings', '0']);
      expect(JSON.parse(chunks.join('')).warnings).toBe(1);
      expect(process.exitCode).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('prints compact native output with only warning and failure details', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
        '  it name="has no duplicate transitions"',
        '    expect machine=Order no=duplicateTransitions',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--format', 'compact']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join('');
    expect(output).toContain('1 passed, 1 warnings, 0 failed, 2 total');
    expect(output).toContain('WARN Order invariants > tracks dead states as debt');
    expect(output).not.toContain('PASS Order invariants > has no duplicate transitions');
    expect(process.exitCode).toBeUndefined();
  });

  test('prints and gates native coverage', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=confirmed',
        '  state name=paid',
        '  transition name=confirm from=pending to=confirmed',
        '  transition name=capture from=confirmed to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order coverage" target="./order.kern"',
        '  it name="covers confirm"',
        '    expect machine=Order reaches=confirmed via=confirm',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const errors: string[] = [];
    const originalWrite = process.stdout.write;
    const originalError = console.error;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;
    console.error = (...values: unknown[]) => {
      errors.push(values.map(String).join(' '));
    };

    try {
      runTest(['test', testFile, '--coverage', '--min-coverage', '50']);
      expect(chunks.join('')).toContain('coverage 1/2 (50%)');
      expect(chunks.join('')).toContain('Order.capture');
      expect(process.exitCode).toBeUndefined();

      chunks.length = 0;
      errors.length = 0;
      process.exitCode = undefined;
      runTest(['test', testFile, '--coverage', '--min-coverage', '100']);
      expect(chunks.join('')).toContain('coverage 1/2 (50%)');
      expect(errors.join('\n')).toContain('Native coverage 50% is below --min-coverage 100%.');
      expect(process.exitCode).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
      console.error = originalError;
    }
  });

  test('writes and enforces native warning baselines', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    const baselineFile = join(tmpDir, 'kern-test-baseline.json');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const errors: string[] = [];
    const originalWrite = process.stdout.write;
    const originalError = console.error;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };

    try {
      runTest(['test', testFile, '--json', '--write-baseline', baselineFile]);
      expect(JSON.parse(readFileSync(baselineFile, 'utf-8')).warnings).toHaveLength(1);
      expect(process.exitCode).toBeUndefined();

      chunks.length = 0;
      errors.length = 0;
      process.exitCode = undefined;
      runTest(['test', testFile, '--json', '--baseline', baselineFile]);
      expect(JSON.parse(chunks.join('')).warnings).toBe(1);
      expect(errors).toEqual([]);
      expect(process.exitCode).toBeUndefined();

      writeFileSync(
        baselineFile,
        `${JSON.stringify({ version: 1, warnings: [{ suite: 'Old', caseName: 'Old', ruleId: 'no:old', assertion: 'no old' }] }, null, 2)}\n`,
      );
      chunks.length = 0;
      errors.length = 0;
      process.exitCode = undefined;
      runTest(['test', testFile, '--json', '--baseline', baselineFile]);
      expect(JSON.parse(chunks.join('')).warnings).toBe(1);
      expect(errors.join('\n')).toContain('New native warning:');
      expect(errors.join('\n')).toContain('Stale native warning baseline:');
      expect(process.exitCode).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
      console.error = originalError;
    }
  });

  test('writes and reuses empty native warning baselines', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    const baselineFile = join(tmpDir, 'kern-test-baseline.json');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="reaches paid"',
        '    expect machine=Order reaches=paid',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json', '--write-baseline', baselineFile]);
      expect(JSON.parse(readFileSync(baselineFile, 'utf-8')).warnings).toEqual([]);
      expect(process.exitCode).toBeUndefined();

      chunks.length = 0;
      process.exitCode = undefined;
      runTest(['test', testFile, '--json', '--baseline', baselineFile]);
      expect(JSON.parse(chunks.join('')).failed).toBe(0);
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('fails malformed native warning baselines cleanly', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    const baselineFile = join(tmpDir, 'kern-test-baseline.json');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="tracks dead states as debt"',
        '    expect machine=Order no=deadStates severity=warn',
      ].join('\n'),
    );
    writeFileSync(baselineFile, '{');

    expectUsageExit(['test', testFile, '--baseline', baselineFile], 'Failed to read native test baseline');
  });

  test('fails missing native warning baselines cleanly', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="reaches paid"',
        '    expect machine=Order reaches=paid',
      ].join('\n'),
    );

    expectUsageExit(
      ['test', testFile, '--baseline', join(tmpDir, 'missing-baseline.json')],
      'Failed to read native test baseline',
    );
  });

  test('rejects ambiguous native baseline flag usage', () => {
    expectUsageExit(['test', tmpDir, '--baseline', '--json'], '--baseline requires a file path.');
    expectUsageExit(['test', tmpDir, '--baseline='], '--baseline requires a file path.');
    expectUsageExit(['test', tmpDir, '--write-baseline='], '--write-baseline requires a file path.');
    expectUsageExit(
      ['test', tmpDir, '--baseline', join(tmpDir, 'current.json'), '--write-baseline', join(tmpDir, 'next.json')],
      '--baseline and --write-baseline cannot be used together.',
    );
    expectUsageExit(
      ['test', tmpDir, '--watch', '--write-baseline', join(tmpDir, 'baseline.json')],
      '--watch cannot be combined with --write-baseline.',
    );
  });

  test('passes grep through to native test runs', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="has no dead states"',
        '    expect machine=Order no=deadStates',
        '  it name="has no duplicate transitions"',
        '    expect machine=Order no=duplicateTransitions',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json', '--grep', 'duplicateTransitions']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.total).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0].ruleId).toBe('no:duplicatetransitions');
    expect(process.exitCode).toBeUndefined();
  });

  test('passes bail through to native test runs', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      [
        'machine name=Order',
        '  state name=pending initial=true',
        '  state name=paid',
        '  state name=orphaned',
        '  transition name=capture from=pending to=paid',
        '  transition name=capture from=pending to=paid',
      ].join('\n'),
    );
    const testFile = join(tmpDir, 'order.test.kern');
    writeFileSync(
      testFile,
      [
        'test name="Order invariants" target="./order.kern"',
        '  it name="has no dead states"',
        '    expect machine=Order no=deadStates',
        '  it name="has no duplicate transitions"',
        '    expect machine=Order no=duplicateTransitions',
      ].join('\n'),
    );

    const chunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      runTest(['test', testFile, '--json', '--bail']);
    } finally {
      process.stdout.write = originalWrite;
    }

    const summary = JSON.parse(chunks.join(''));
    expect(summary.total).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results[0].ruleId).toBe('no:deadstates');
    expect(process.exitCode).toBe(1);
  });
});
