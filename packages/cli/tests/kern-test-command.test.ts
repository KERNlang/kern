import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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
