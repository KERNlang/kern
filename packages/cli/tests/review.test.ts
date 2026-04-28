import { reviewFile } from '@kernlang/review';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runReview } from '../src/commands/review.js';
import { createReviewBaseline } from '../src/review-baseline.js';
import { collectTsFilesFlat } from '../src/shared.js';
import { git } from './git-test-env.js';

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

  it('lists rule quality metadata with --list-rules', async () => {
    process.chdir(tmpDir);

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', '--list-rules', '--target=nextjs'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('Columns: SEV PRECISION LIFECYCLE CI RULE');
    expect(output).toContain('xss-href-javascript');
    expect(output).toContain('HIGH');
    expect(output).toContain('CANDIDATE');
    expect(output).toContain('GUARDED');
  });

  it('writes telemetry snapshots and records explicit CI policy', async () => {
    process.chdir(tmpDir);
    const file = join(tmpDir, 'screen.kern');
    const telemetryPath = join(tmpDir, 'review-telemetry.jsonl');
    writeFileSync(file, `screen name=Home\n  text value="hello"\n`);

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(
      runReview(['review', file, '--policy=ci', `--telemetry-out=${telemetryPath}`, '--json']),
    ).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const snapshot = JSON.parse(readFileSync(telemetryPath, 'utf-8').trim());
    expect(snapshot.policy).toBe('ci');
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.files).toBe(1);
  });

  it('renders a telemetry dashboard from JSONL snapshots', async () => {
    process.chdir(tmpDir);
    const telemetryPath = join(tmpDir, 'review-telemetry.jsonl');
    writeFileSync(
      telemetryPath,
      `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-04-27T00:00:00.000Z',
        policy: 'guard',
        files: 1,
        findings: { total: 1, errors: 0, warnings: 1, notes: 0 },
        suppressed: { total: 0 },
        rootCauses: 0,
        health: { status: 'ok', errors: 0, fallbacks: 0, skipped: 0 },
        rules: [
          {
            ruleId: 'floating-promise',
            findings: 1,
            suppressed: 0,
            errors: 0,
            warnings: 1,
            notes: 0,
            rootCauses: 0,
          },
        ],
      })}\n`,
    );

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', `--telemetry-report=${telemetryPath}`, '--json'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const summary = JSON.parse(logs.join('\n'));
    expect(summary.runs).toBe(1);
    expect(summary.rules[0].ruleId).toBe('floating-promise');
  });

  it('runs a review eval manifest without a positional input', async () => {
    process.chdir(tmpDir);
    const file = join(tmpDir, 'floating.ts');
    writeFileSync(
      file,
      `
export async function fetchData(): Promise<string[]> {
  return ['a', 'b'];
}

export async function main() {
  fetchData();
}
`,
    );
    const manifestPath = join(tmpDir, 'kern-review-eval.json');
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          cases: [
            {
              name: 'floating promise',
              files: ['floating.ts'],
              expect: {
                present: ['floating-promise'],
                absent: ['hardcoded-secret'],
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', `--eval-manifest=${manifestPath}`, '--json', '--no-cache'])).rejects.toThrow(
      'EXIT:0',
    );
    expect(exitCode).toBe(0);

    const summary = JSON.parse(logs.join('\n'));
    expect(summary.passed).toBe(true);
    expect(summary.results[0].name).toBe('floating promise');
  });

  it('includes changed .kern files in --diff review', async () => {
    process.chdir(tmpDir);

    git(['init'], tmpDir);
    git(['config', 'user.email', 'kern@example.com'], tmpDir);
    git(['config', 'user.name', 'KERN Test'], tmpDir);

    const file = join(tmpDir, 'screen.kern');
    writeFileSync(file, `screen name=Home\n  text value="hello"\n`);
    git(['add', 'screen.kern'], tmpDir);
    git(['commit', '-m', 'init'], tmpDir);

    writeFileSync(file, `screen name=Home\n  text value="hi"\n`);

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', '--diff=HEAD', '--json'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"filePath"');
    expect(output).toContain('screen.kern');
  });

  it('includes changed Python files in --diff review', async () => {
    process.chdir(tmpDir);

    git(['init'], tmpDir);
    git(['config', 'user.email', 'kern@example.com'], tmpDir);
    git(['config', 'user.name', 'KERN Test'], tmpDir);

    const file = join(tmpDir, 'main.py');
    writeFileSync(file, 'from fastapi import FastAPI\n\napp = FastAPI()\n');
    git(['add', 'main.py'], tmpDir);
    git(['commit', '-m', 'init'], tmpDir);

    writeFileSync(
      file,
      `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True)
`,
    );

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', '--diff=HEAD', '--target=fastapi', '--json', '--no-cache'])).rejects.toThrow(
      'EXIT:0',
    );
    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"filePath"');
    expect(output).toContain('main.py');
    expect(output).toContain('fastapi-broad-cors');
  });

  it('does not collect .kern directories as reviewable files', () => {
    mkdirSync(join(tmpDir, 'packages', 'app', '.kern'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages', 'app', 'index.ts'), 'export const ok = true;\n');

    const files = collectTsFilesFlat(join(tmpDir, 'packages'), true);

    expect(files).toContain(join(tmpDir, 'packages', 'app', 'index.ts'));
    expect(files).not.toContain(join(tmpDir, 'packages', 'app', '.kern'));
  });

  it('honors --target for actual review scans', async () => {
    process.chdir(tmpDir);
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '15.0.0' }, devDependencies: {} }, null, 2),
    );

    const file = join(tmpDir, 'server.ts');
    writeFileSync(
      file,
      `
import express from 'express';

const app = express();
app.post('/users', (req, res) => {
  res.json({ name: req.body.name });
});
`,
    );

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', file, '--target=express', '--json', '--no-cache'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const report = JSON.parse(logs.join('\n'));
    expect(report.findings.some((f: { ruleId: string }) => f.ruleId === 'unvalidated-input')).toBe(true);
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
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

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
    const baseline = createReviewBaseline([reviewFile(file, { requireConfidenceAnnotations: true })]);
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(
      runReview(['review', file, `--baseline=${baselinePath}`, '--sarif', '--require-confidence']),
    ).rejects.toThrow('EXIT:0');
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
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

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
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', file, `--baseline=${baselinePath}`])).rejects.toThrow('EXIT:1');
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('Failed to parse baseline');
  });

  it('reviews a remote repo via --git without a pre-existing local checkout', async () => {
    process.chdir(tmpDir);

    const repoDir = join(tmpDir, 'remote-review');
    git(['init', repoDir]);
    git(['config', 'user.email', 'kern@example.com'], repoDir);
    git(['config', 'user.name', 'KERN Test'], repoDir);

    const file = join(repoDir, 'confidence.kern');
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
    git(['add', 'confidence.kern'], repoDir);
    git(['commit', '-m', 'init'], repoDir);

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', `--git=${repoDir}`, 'confidence.kern', '--json'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"filePath"');
    expect(output).toContain('confidence.kern');
  });

  it('supports remote diff review with full clone history', async () => {
    process.chdir(tmpDir);

    const repoDir = join(tmpDir, 'remote-diff-review');
    git(['init', repoDir]);
    git(['config', 'user.email', 'kern@example.com'], repoDir);
    git(['config', 'user.name', 'KERN Test'], repoDir);

    const file = join(repoDir, 'screen.kern');
    writeFileSync(file, 'screen name=Home\n  text value="hello"\n');
    git(['add', 'screen.kern'], repoDir);
    git(['commit', '-m', 'init'], repoDir);

    writeFileSync(file, 'screen name=Home\n  text value="hi"\n');
    git(['add', 'screen.kern'], repoDir);
    git(['commit', '-m', 'update'], repoDir);

    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;

    await expect(runReview(['review', `--git=${repoDir}`, '--diff=HEAD~1', '--json'])).rejects.toThrow('EXIT:0');
    expect(exitCode).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"filePath"');
    expect(output).toContain('screen.kern');
  });
});
