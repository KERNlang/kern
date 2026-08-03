import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { firstDiscardedCommentLine } from '../src/commands/canonicalizer-source-boundary.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');
const COMPOSITION = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../dist/kern-canonicalizer/composition.json'), 'utf8'),
) as { readonly composite: { readonly bytes: number; readonly sha256: string } };
const POLICY = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../dist/kern-canonicalizer/policy.json'), 'utf8'),
) as { readonly runtimeLimits: { readonly maxStringBytes: number } };
const CANONICALIZER = {
  bytes: COMPOSITION.composite.bytes,
  sha256: COMPOSITION.composite.sha256,
};

const SHUFFLED = [
  'fn export=true returns=string name=greet',
  '  param type=string name=name',
  '  handler lang="kern"',
  '    return value="name"',
  '',
].join('\n');

const CANONICAL = [
  'fn name=greet returns=string export=true',
  '  param name=name type=string',
  '  handler lang="kern"',
  '    return value="name"',
  '',
].join('\n');

function run(...args: string[]) {
  return spawnSync(process.execPath, [CLI, 'canonicalize', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('kern canonicalize command', () => {
  let root = '';
  let sourcePath = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kern-canonicalize-command-'));
    sourcePath = join(root, 'input.kern');
    writeFileSync(sourcePath, SHUFFLED);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('emits the KERN-authored canonical source from the built CLI', () => {
    const result = run(sourcePath);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(CANONICAL);
    expect(result.stderr).toBe('');
  });

  test('--check distinguishes changed and canonical input without emitting source', () => {
    const changed = run(sourcePath, '--check');
    expect(changed.status).toBe(1);
    expect(changed.stdout).toBe('');
    expect(changed.stderr).toContain('would change');

    writeFileSync(sourcePath, CANONICAL);
    const canonical = run(sourcePath, '--check');
    expect(canonical.status).toBe(0);
    expect(canonical.stdout).toBe('');
    expect(canonical.stderr).toBe('');
  });

  test('--json emits the versioned deterministic envelope', () => {
    const result = run(sourcePath, '--json');

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toEqual({
      canonicalSource: CANONICAL,
      canonicalizer: CANONICALIZER,
      changed: true,
      diagnostics: [],
      format: 'kern.cli.canonicalize.1',
      outcome: 'success',
    });
    expect(result.stderr).toBe('');
  });

  test('--check --json reports change state without embedding canonical source', () => {
    const result = run(sourcePath, '--check', '--json');

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.outcome).toBe('success');
    expect(report.changed).toBe(true);
    expect(report.canonicalSource).toBeNull();
    expect(result.stderr).toBe('');
  });

  test('rejects a non-.kern input before exposing structural KIR diagnostics', () => {
    const textPath = join(root, 'input.txt');
    writeFileSync(textPath, SHUFFLED);
    const result = run(textPath, '--json');

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics[0]?.code).toBe('cli-error');
    expect(report.diagnostics[0]?.message).toContain('.kern extension');
  });

  test('admits valid POSIX filenames without using them as structural module ids', () => {
    const unusualPath = join(root, 'colon:and\\backslash.kern');
    writeFileSync(unusualPath, SHUFFLED);
    const result = run(unusualPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(CANONICAL);
    expect(result.stderr).toBe('');
  });

  test('rejects oversized source before parsing using the policy-owned byte ceiling', () => {
    writeFileSync(sourcePath, Buffer.alloc(POLICY.runtimeLimits.maxStringBytes + 1, 0x20));
    const result = run(sourcePath, '--json');

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics[0]?.message).toContain('exceeds configured');
    expect(report.canonicalSource).toBeNull();
  });

  test('rejects malformed UTF-8 instead of decoding replacement characters', () => {
    writeFileSync(sourcePath, Buffer.from([0x66, 0x6e, 0x20, 0xff, 0x0a]));
    const result = run(sourcePath, '--json');

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics[0]?.message).toContain('valid UTF-8');
    expect(report.canonicalSource).toBeNull();
  });

  test('rejects symbolic-link inputs instead of following them', () => {
    const linkPath = join(root, 'linked.kern');
    symlinkSync(sourcePath, linkPath);
    const result = run(linkPath, '--json');

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics[0]?.message).toContain('regular file');
    expect(report.canonicalSource).toBeNull();
  });

  test('parse failures return exit 2 without partial canonical source', () => {
    writeFileSync(sourcePath, 'fn name=\n');
    const result = run(sourcePath, '--json');

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.format).toBe('kern.cli.canonicalize.1');
    expect(report.outcome).toBe('failure');
    expect(report.canonicalSource).toBeNull();
    expect(report.changed).toBeNull();
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(result.stderr).toBe('');
  });

  test('bounds parser diagnostics using the policy-owned runtime limit', () => {
    writeFileSync(sourcePath, '@\n'.repeat(10_000));
    const result = run(sourcePath, '--json');

    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.diagnostics).toHaveLength(POLICY.runtimeLimits.maxDiagnostics);
    expect(report.diagnostics.at(-1)?.code).toBe('diagnostics-truncated');
    expect(report.canonicalSource).toBeNull();
  });

  test('rejects comment syntax instead of silently deleting trivia', () => {
    writeFileSync(sourcePath, `# keep this comment\n${SHUFFLED}`);
    const leading = run(sourcePath, '--json');
    expect(leading.status).toBe(2);
    expect(JSON.parse(leading.stdout).diagnostics[0]?.code).toBe('comments-not-preserved');

    writeFileSync(sourcePath, SHUFFLED.replace('name=greet', 'name=greet # keep this comment'));
    const inline = run(sourcePath, '--json');
    expect(inline.status).toBe(2);
    expect(JSON.parse(inline.stdout).diagnostics[0]?.code).toBe('comments-not-preserved');

    expect(firstDiscardedCommentLine('return value="name # data"\n')).toBeNull();
  });
});
