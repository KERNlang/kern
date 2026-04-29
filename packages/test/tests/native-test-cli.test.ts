import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runNativeKernTestCli } from '../src/cli.js';

describe('standalone kern-test CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-test-cli-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function captureIO(): { io: Parameters<typeof runNativeKernTestCli>[1]; stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      stdout,
      stderr,
      io: {
        stdout: {
          write: (chunk: string | Uint8Array) => {
            stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
            return true;
          },
        } as any,
        stderr: {
          write: (chunk: string | Uint8Array) => {
            stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
            return true;
          },
        } as any,
      },
    };
  }

  test('runs native suites directly from @kernlang/test', () => {
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
    const { io, stdout } = captureIO();

    const code = runNativeKernTestCli([testFile, '--json'], io);

    expect(code).toBe(0);
    const summary = JSON.parse(stdout.join(''));
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  test('returns a nonzero code when native assertions fail', () => {
    writeFileSync(
      join(tmpDir, 'order.kern'),
      ['machine name=Order', '  state name=pending initial=true', '  state name=paid'].join('\n'),
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
    const { io, stdout } = captureIO();

    const code = runNativeKernTestCli([testFile, '--json'], io);

    expect(code).toBe(1);
    const summary = JSON.parse(stdout.join(''));
    expect(summary.failed).toBe(1);
  });

  test('lists native rules without requiring an input file', () => {
    const { io, stdout } = captureIO();

    const code = runNativeKernTestCli(['--list-rules'], io);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('no:unguardedeffects');
  });

  test('does not treat option values as the input path', () => {
    writeFileSync(join(tmpDir, 'plain.kern'), 'const name=value value=1');
    const testFile = join(tmpDir, 'plain.test.kern');
    writeFileSync(
      testFile,
      ['test name="Plain" target="./plain.kern"', '  it name="stays valid"', '    expect no=schemaViolations'].join(
        '\n',
      ),
    );
    const { io, stdout } = captureIO();

    const code = runNativeKernTestCli(['--grep', 'Plain', testFile, '--json'], io);

    expect(code).toBe(0);
    const summary = JSON.parse(stdout.join(''));
    expect(summary.passed).toBe(1);
  });
});
