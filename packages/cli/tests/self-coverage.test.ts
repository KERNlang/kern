import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectSelfCoverage, runSelfCoverage } from '../src/commands/self-coverage.js';

describe('kern self-coverage command', () => {
  let tmpDir: string;
  let stdoutChunks: string[];
  let origWrite: typeof process.stdout.write;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-self-coverage-test-'));
    stdoutChunks = [];
    origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function out(): string {
    return stdoutChunks.join('');
  }

  test('classifies native, migratable, explicit foreign, heuristic foreign, template, and blocked handlers', () => {
    writeFileSync(
      join(tmpDir, 'app.kern'),
      [
        'fn name=native',
        '  handler lang=kern',
        '    return value=ok',
        'fn name=migratable',
        '  handler <<<',
        '    return 1 + 2;',
        '  >>>',
        'fn name=foreign',
        '  handler lang=ts reason="express response adapter" <<<',
        '    return res.json({ ok: true });',
        '  >>>',
        'fn name=heuristic',
        '  handler <<<',
        "    const mod = import('pg');",
        '    return mod;',
        '  >>>',
        'fn name=template',
        '  handler <<<',
        '    export const {{name}} = ({{params}}) => {',
        '      {{CHILDREN}}',
        '    };',
        '  >>>',
        'fn name=blocked',
        '  handler <<<',
        '    function inner() { return 1; }',
        '    return inner();',
        '  >>>',
      ].join('\n'),
    );

    const report = collectSelfCoverage(tmpDir);
    expect(report.scannedFiles).toBe(1);
    expect(report.totalHandlers).toBe(6);
    expect(report.nativeHandlers).toBe(1);
    expect(report.migratableRawHandlers).toBe(1);
    expect(report.explicitForeignHandlers).toBe(1);
    expect(report.heuristicForeignHandlers).toBe(1);
    expect(report.templatePlaceholderHandlers).toBe(1);
    expect(report.blockedHandlers).toBe(1);
    expect(report.blockers[0]).toMatchObject({ reason: 'unsupported-stmt-FunctionDeclaration', count: 1 });
  });

  test('--canonicalize-braces counts a non-block `if` body as migratable', () => {
    writeFileSync(
      join(tmpDir, 'clamp.kern'),
      ['fn name=clamp', '  handler <<<', '    if (x > 10) return 10;', '    return x;', '  >>>'].join('\n'),
    );

    // Default metric: the non-block `if` is blocked (if-non-block-then).
    const strict = collectSelfCoverage(tmpDir);
    expect(strict.migratableRawHandlers).toBe(0);
    expect(strict.blockers.some((b) => b.reason === 'if-non-block-then')).toBe(true);

    // Opt-in: mirrors the migrate `--canonicalize-braces` lift — now migratable.
    const canon = collectSelfCoverage(tmpDir, { canonicalizeBraces: true });
    expect(canon.migratableRawHandlers).toBe(1);
    expect(canon.blockers.some((b) => b.reason === 'if-non-block-then')).toBe(false);
  });

  test('--json emits structured output', async () => {
    writeFileSync(join(tmpDir, 'app.kern'), ['fn name=x', '  handler <<<', '    return 1;', '  >>>'].join('\n'));

    await runSelfCoverage(['self-coverage', `--root=${tmpDir}`, '--json']);
    const parsed = JSON.parse(out());
    expect(parsed.scannedFiles).toBe(1);
    expect(parsed.totalHandlers).toBe(1);
    expect(parsed.migratableRawHandlers).toBe(1);
    expect(parsed.classifiedOrMigratablePct).toBe(100);
  });

  test('supports positional root and -v without treating the flag as a path', async () => {
    writeFileSync(join(tmpDir, 'app.kern'), ['fn name=x', '  handler <<<', '    return 1;', '  >>>'].join('\n'));

    await runSelfCoverage(['self-coverage', tmpDir, '-v']);
    expect(out()).toContain('Handler detail:');
    expect(out()).toContain('migratable');
    expect(out()).not.toContain('root does not exist: -v');
  });

  test('supports roots named self-coverage', async () => {
    const namedRoot = join(tmpDir, 'self-coverage');
    mkdirSync(namedRoot);
    writeFileSync(join(namedRoot, 'app.kern'), ['fn name=x', '  handler <<<', '    return 1;', '  >>>'].join('\n'));

    await runSelfCoverage(['self-coverage', namedRoot, '--json']);
    const parsed = JSON.parse(out());
    expect(parsed.scannedFiles).toBe(1);
    expect(parsed.totalHandlers).toBe(1);
    expect(parsed.migratableRawHandlers).toBe(1);
  });

  test('supports space-separated --root form', async () => {
    writeFileSync(join(tmpDir, 'app.kern'), ['fn name=x', '  handler <<<', '    return 1;', '  >>>'].join('\n'));

    await runSelfCoverage(['self-coverage', '--root', tmpDir, '--json']);
    const parsed = JSON.parse(out());
    expect(parsed.scannedFiles).toBe(1);
    expect(parsed.totalHandlers).toBe(1);
  });

  test('tracks parse errors without dropping parseable handlers from the same file', () => {
    writeFileSync(
      join(tmpDir, 'app.kern'),
      [')broken', 'fn name=y', '  handler <<<', '    return 2;', '  >>>'].join('\n'),
    );

    const report = collectSelfCoverage(tmpDir);
    expect(report.filesWithParseErrors).toBe(1);
    expect(report.parseErrors.length).toBeGreaterThan(0);
    expect(report.totalHandlers).toBeGreaterThanOrEqual(1);
  });

  test('counts bare non-native handlers as empty instead of dropping them', () => {
    writeFileSync(join(tmpDir, 'app.kern'), ['fn name=x', '  handler'].join('\n'));

    const report = collectSelfCoverage(tmpDir);
    expect(report.totalHandlers).toBe(0);
    expect(report.emptyRawHandlers).toBe(1);
    expect(report.handlers[0]).toMatchObject({ status: 'empty', reason: 'no-code' });
  });

  test('counts empty lang=kern handlers as empty instead of native', () => {
    writeFileSync(join(tmpDir, 'app.kern'), ['fn name=x', '  handler lang=kern'].join('\n'));

    const report = collectSelfCoverage(tmpDir);
    expect(report.totalHandlers).toBe(0);
    expect(report.nativeHandlers).toBe(0);
    expect(report.emptyRawHandlers).toBe(1);
    expect(report.handlers[0]).toMatchObject({ status: 'empty', reason: 'no-code' });
  });

  test('normalizes lang=KERN for native structured handlers', () => {
    writeFileSync(join(tmpDir, 'app.kern'), ['fn name=x', '  handler lang=KERN', '    return value=ok'].join('\n'));

    const report = collectSelfCoverage(tmpDir);
    expect(report.totalHandlers).toBe(1);
    expect(report.nativeHandlers).toBe(1);
    expect(report.handlers[0]).toMatchObject({ status: 'native', reason: 'lang-kern' });
  });

  test('does not count raw lang=kern bodies as native structured KERN', () => {
    writeFileSync(
      join(tmpDir, 'app.kern'),
      ['fn name=x', '  handler lang=kern <<<', '    return 1;', '  >>>'].join('\n'),
    );

    const report = collectSelfCoverage(tmpDir);
    expect(report.totalHandlers).toBe(1);
    expect(report.nativeHandlers).toBe(0);
    expect(report.handlers[0]).toMatchObject({ status: 'blocked', reason: 'lang-kern-raw-body' });
  });

  test('counts foreign handlers without a reason as blocked for annotation', () => {
    writeFileSync(
      join(tmpDir, 'app.kern'),
      ['fn name=x', '  handler lang=ts <<<', '    return 1;', '  >>>'].join('\n'),
    );

    const report = collectSelfCoverage(tmpDir);
    expect(report.totalHandlers).toBe(1);
    expect(report.blockedHandlers).toBe(1);
    expect(report.handlers[0]).toMatchObject({ status: 'blocked', reason: 'foreign-missing-reason' });
  });

  test('counts unsupported foreign handler languages as blocked even with a reason', () => {
    writeFileSync(
      join(tmpDir, 'app.kern'),
      ['fn name=x', '  handler lang=rust reason="native addon" <<<', '    return 1;', '  >>>'].join('\n'),
    );

    const report = collectSelfCoverage(tmpDir);
    expect(report.totalHandlers).toBe(1);
    expect(report.blockedHandlers).toBe(1);
    expect(report.handlers[0]).toMatchObject({ status: 'blocked', reason: 'foreign-unsupported-lang' });
  });

  test('empty project reports null percentages', async () => {
    await runSelfCoverage(['self-coverage', tmpDir, '--json']);
    const parsed = JSON.parse(out());
    expect(parsed.scannedFiles).toBe(0);
    expect(parsed.nativeAuthoredPct).toBeNull();
    expect(parsed.classifiedOrMigratablePct).toBeNull();
  });

  test('human output surfaces top blockers', async () => {
    writeFileSync(
      join(tmpDir, 'app.kern'),
      ['fn name=blocked', '  handler <<<', '    function inner() { return 1; }', '    return inner();', '  >>>'].join(
        '\n',
      ),
    );

    await runSelfCoverage(['self-coverage', `--root=${tmpDir}`]);
    expect(out()).toContain('kern self-coverage');
    expect(out()).toContain('Blocked handlers: 1');
    expect(out()).toContain('unsupported-stmt-FunctionDeclaration');
  });

  test('prints command-specific help', async () => {
    await runSelfCoverage(['self-coverage', '--help']);
    expect(out()).toContain('Usage: kern self-coverage');
  });

  test('honors .kernignore and skips generated directories', () => {
    mkdirSync(join(tmpDir, 'node_modules'));
    mkdirSync(join(tmpDir, 'generated'));
    writeFileSync(join(tmpDir, '.kernignore'), 'ignored.kern\n');
    writeFileSync(join(tmpDir, 'ignored.kern'), 'fn name=w\n  handler <<< return 1; >>>');
    writeFileSync(join(tmpDir, 'node_modules', 'ignored.kern'), 'fn name=x\n  handler <<< return 1; >>>');
    writeFileSync(join(tmpDir, 'generated', 'ignored.kern'), 'fn name=y\n  handler <<< return 1; >>>');
    writeFileSync(join(tmpDir, 'kept.kern'), 'fn name=z\n  handler <<< return 1; >>>');

    const report = collectSelfCoverage(tmpDir);
    expect(report.scannedFiles).toBe(1);
    expect(report.handlers[0]?.file).toBe('kept.kern');
  });

  test('rejects a file path as the root', async () => {
    const file = join(tmpDir, 'app.kern');
    writeFileSync(file, ['fn name=x', '  handler <<<', '    return 1;', '  >>>'].join('\n'));

    await expect(runSelfCoverage(['self-coverage', file])).rejects.toThrow('self-coverage root must be a directory');
  });

  test('rejects --root without a path before another flag', async () => {
    await expect(runSelfCoverage(['self-coverage', '--root', '--json'])).rejects.toThrow(
      'self-coverage --root requires a directory path',
    );
  });
});
