import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewFile } from '@kernlang/review';
import { runReview } from '../src/commands/review.js';
import { createReviewBaseline } from '../src/review-baseline.js';

describe('kern review command', () => {
  let cwd: string;
  let tmpDir: string;
  let logs: string[];
  let errors: string[];
  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origExit: typeof process.exit;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-review-cli-'));
    logs = [];
    errors = [];
    origLog = console.log;
    origError = console.error;
    origExit = process.exit;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(' '));
    };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
    process.chdir(cwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes changed .kern files in --diff review', async () => {
    process.chdir(tmpDir);

    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'kern@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'KERN Test'], { cwd: tmpDir });

    const file = join(tmpDir, 'screen.kern');
    writeFileSync(file, `screen name=Home\n  text value="hello"\n`);
    execFileSync('git', ['add', 'screen.kern'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });

    writeFileSync(file, `screen name=Home\n  text value="hi"\n`);

    let exitCode: number | undefined;
    process.exit = (((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never);

    await expect(runReview(['review', '--diff=HEAD', '--json'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"filePath"');
    expect(output).toContain('screen.kern');
  });

  it('filters known findings with --baseline and --new-only', async () => {
    process.chdir(tmpDir);

    const file = join(tmpDir, 'confidence.kern');
    writeFileSync(
      file,
      `
fn name=loadUser params="id:string" returns=unknown
  handler <<<
    const response = await fetch("/api/users/" + id);
    return response.json();
  >>>
`,
    );

    const baselinePath = join(tmpDir, 'baseline.json');
    const baseline = createReviewBaseline([reviewFile(file)]);
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

    let exitCode: number | undefined;
    process.exit = (((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never);

    await expect(runReview(['review', file, `--baseline=${baselinePath}`, '--new-only', '--json'])).rejects.toThrow(
      'EXIT:0',
    );
    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.filePath).toContain('confidence.kern');
    expect(parsed.findings).toEqual([]);
  });

  it('marks baseline findings as existing in SARIF output', async () => {
    process.chdir(tmpDir);

    const file = join(tmpDir, 'confidence.kern');
    writeFileSync(
      file,
      `
fn name=loadUser params="id:string" returns=unknown
  handler <<<
    const response = await fetch("/api/users/" + id);
    return response.json();
  >>>
`,
    );

    const baselinePath = join(tmpDir, 'baseline.json');
    const baseline = createReviewBaseline([reviewFile(file)]);
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

    let exitCode: number | undefined;
    process.exit = (((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never);

    await expect(runReview(['review', file, `--baseline=${baselinePath}`, '--sarif'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const sarif = JSON.parse(logs.join('\n'));
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    expect(sarif.runs[0].results[0].properties['kern/baselineStatus']).toBe('existing');
    expect(sarif.runs[0].results[0].suppressions).toEqual([
      { kind: 'external', justification: 'Present in review baseline' },
    ]);
  });

  it('includes in-source suppressed findings in SARIF output', async () => {
    process.chdir(tmpDir);

    const file = join(tmpDir, 'suppressed.ts');
    writeFileSync(
      file,
      `// kern-ignore floating-promise
fetch('/api/data');
`,
    );

    let exitCode: number | undefined;
    process.exit = (((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never);

    await expect(runReview(['review', file, '--sarif'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const sarif = JSON.parse(logs.join('\n'));
    const suppressed = sarif.runs[0].results.find((result: any) => result.ruleId === 'floating-promise');
    expect(suppressed).toBeDefined();
    expect(suppressed.suppressions).toEqual([{ kind: 'inSource', justification: 'kern-ignore directive' }]);
  });

  it('reports invalid baseline files as parse failures', async () => {
    process.chdir(tmpDir);

    const file = join(tmpDir, 'confidence.kern');
    writeFileSync(file, `fn name=loadUser confidence="0.7"\n`);

    const baselinePath = join(tmpDir, 'baseline.json');
    writeFileSync(baselinePath, '{not valid json}\n');

    let exitCode: number | undefined;
    process.exit = (((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never);

    await expect(runReview(['review', file, `--baseline=${baselinePath}`])).rejects.toThrow('EXIT:1');
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Failed to parse baseline');
  });
});
