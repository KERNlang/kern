import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  type CheckReport,
  type CheckSummary,
  collectCheck,
  exitCodeFor,
  readCheckerVersion,
  runCheck,
} from '../src/commands/check.js';

// All .kern fixtures are generated into a tmpdir at runtime rather than
// committed. @kernlang/check's repo-wide ZERO-FP acceptance wall
// (packages/check/tests/acceptance-wall.test.ts) walks EVERY committed .kern in
// the repo and asserts (a) zero checker diagnostics on every accepted program,
// (b) an exact pinned set of parse-failing files, and (c) an exact pinned set
// of validator-rejected files. ANY committed fixture that trips a checker,
// fails to parse, or is validator-rejected would break that wall — which lives
// in a read-only package. Generating fixtures at runtime keeps them out of the
// scanned corpus entirely (mirrors the existing self-coverage.test.ts pattern).

const CLEAN_KERN = [
  'class name=Animal',
  'class name=Dog extends=Animal',
  'fn name=makeDog returns=Dog',
  '  handler lang=kern',
  '    return value="new Dog()"',
].join('\n');

const RETURN_VIOLATION_KERN = [
  'class name=Animal',
  'class name=Dog extends=Animal',
  'class name=Cat extends=Animal',
  'fn name=makeDog returns=Dog',
  '  handler lang=kern',
  '    return value="new Cat()"',
].join('\n');

const ENUM_REVERSE_INDEX_KERN = [
  'enum name=Status values="A|B"',
  'fn name=first returns=Status',
  '  handler lang=kern',
  '    return value="Status[0]"',
].join('\n');

const UNPARSABLE_KERN = ')broken syntax that cannot parse\n';

/** Make a fresh tmpdir and write the given { relativePath: contents } files. */
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kern-check-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

/** Strip non-deterministic fields so the JSON contract is snapshot-stable. */
function normalize(report: CheckReport): Omit<CheckReport, 'root'> & { root: '<root>'; summary: CheckSummary } {
  return {
    ...report,
    root: '<root>',
    summary: { ...report.summary, durationMs: 0 },
  };
}

function summary(overrides: Partial<CheckSummary> = {}): CheckSummary {
  return {
    filesScanned: 0,
    filesWithParseErrors: 0,
    diagnosticCount: 0,
    errorCount: 0,
    warningCount: 0,
    returnChecksRun: 0,
    durationMs: 0,
    ...overrides,
  };
}

describe('kern check — JSON contract snapshot (schema lock)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fixtureDir({ 'animals.kern': `${RETURN_VIOLATION_KERN}\n` });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('return-violation matches the stable schema with durationMs/root normalized', () => {
    const report = collectCheck(dir, { withSemantics: false });
    expect(normalize(report)).toEqual({
      schemaVersion: '1.0',
      tool: 'kern-check',
      checkerVersion: report.checkerVersion,
      root: '<root>',
      diagnostics: [
        {
          file: 'animals.kern',
          line: null,
          column: null,
          severity: 'error',
          category: 'return',
          rule: 'check-return-type',
          message:
            "Return value of type 'Cat' is not assignable to the declared return type 'Dog'. " +
            "A returned value's type must be a subtype of the declared return type.",
        },
      ],
      summary: summary({
        filesScanned: 1,
        diagnosticCount: 1,
        errorCount: 1,
        returnChecksRun: 1,
      }),
    });
  });

  test('checkerVersion is the resolved @kernlang/check package version (semver-shaped)', () => {
    expect(readCheckerVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('kern check — exit codes', () => {
  test('clean fixture → no failing diagnostics', () => {
    const dir = fixtureDir({ 'animals.kern': `${CLEAN_KERN}\n` });
    try {
      const report = collectCheck(dir, { withSemantics: false });
      expect(report.diagnostics).toHaveLength(0);
      expect(exitCodeFor(report.summary, false)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('return-violation fixture → category "return", library rule id, exit 1', () => {
    const dir = fixtureDir({ 'animals.kern': `${RETURN_VIOLATION_KERN}\n` });
    try {
      const report = collectCheck(dir, { withSemantics: false });
      expect(report.diagnostics).toHaveLength(1);
      expect(report.diagnostics[0]?.category).toBe('return');
      expect(report.diagnostics[0]?.rule).toBe('check-return-type');
      expect(exitCodeFor(report.summary, false)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('kern check — parse-failure continuation', () => {
  let dir: string;
  beforeEach(() => {
    dir = fixtureDir({ 'broken.kern': UNPARSABLE_KERN, 'animals.kern': `${RETURN_VIOLATION_KERN}\n` });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('both the parse error and the return violation surface; exit 1', () => {
    const report = collectCheck(dir, { withSemantics: false });
    const categories = report.diagnostics.map((d) => d.category).sort();
    expect(categories).toEqual(['parse', 'return']);
    expect(report.summary.filesScanned).toBe(2);
    expect(report.summary.filesWithParseErrors).toBe(1);

    const parse = report.diagnostics.find((d) => d.category === 'parse');
    expect(parse?.rule).toBe('parse-error');
    expect(parse?.line).not.toBeNull();

    const ret = report.diagnostics.find((d) => d.category === 'return');
    expect(ret?.rule).toBe('check-return-type');

    expect(exitCodeFor(report.summary, false)).toBe(1);
  });
});

describe('exitCodeFor — pure decision function', () => {
  test('errors → 1', () => {
    expect(exitCodeFor(summary({ errorCount: 3 }), false)).toBe(1);
  });
  test('warnings only, non-strict → 0', () => {
    expect(exitCodeFor(summary({ warningCount: 2 }), false)).toBe(0);
  });
  test('warnings only, strict → 1', () => {
    expect(exitCodeFor(summary({ warningCount: 2 }), true)).toBe(1);
  });
  test('empty → 0', () => {
    expect(exitCodeFor(summary(), false)).toBe(0);
    expect(exitCodeFor(summary(), true)).toBe(0);
  });
  test('errors dominate regardless of strict', () => {
    expect(exitCodeFor(summary({ errorCount: 1, warningCount: 1 }), true)).toBe(1);
  });
});

describe('kern check — discovery filtering', () => {
  test('a file inside build/ is not scanned (filesScanned proves it)', () => {
    // kept.kern (clean) at root + build/skipped.kern (a Cat-not-Dog violation).
    // If build/ were scanned, filesScanned would be 2 and a return diagnostic
    // would surface.
    const dir = fixtureDir({
      'kept.kern': `${CLEAN_KERN}\n`,
      'build/skipped.kern': `${RETURN_VIOLATION_KERN}\n`,
    });
    try {
      const report = collectCheck(dir, { withSemantics: false });
      expect(report.summary.filesScanned).toBe(1);
      expect(report.diagnostics).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('kern check — semantic validation is opt-in', () => {
  let dir: string;
  beforeEach(() => {
    dir = fixtureDir({ 'enum-reverse.kern': `${ENUM_REVERSE_INDEX_KERN}\n` });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('enum reverse-index appears ONLY with --with-semantics, category "semantic"', () => {
    const off = collectCheck(dir, { withSemantics: false });
    expect(off.diagnostics).toHaveLength(0);

    const on = collectCheck(dir, { withSemantics: true });
    expect(on.diagnostics).toHaveLength(1);
    expect(on.diagnostics[0]?.category).toBe('semantic');
    expect(on.diagnostics[0]?.rule).toBe('enum-reverse-index');
    expect(on.diagnostics[0]?.line).not.toBeNull();
  });
});

describe('kern check — returnChecksRun telemetry', () => {
  test('a correct literal return runs the check with zero diagnostics', () => {
    const dir = fixtureDir({ 'animals.kern': `${CLEAN_KERN}\n` });
    try {
      const report = collectCheck(dir, { withSemantics: false });
      expect(report.summary.returnChecksRun).toBeGreaterThanOrEqual(1);
      expect(report.diagnostics).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('kern check — single-file target', () => {
  test('checks just the named file with no SKIP_DIRS filtering', () => {
    const dir = fixtureDir({ 'animals.kern': `${RETURN_VIOLATION_KERN}\n` });
    try {
      const report = collectCheck(join(dir, 'animals.kern'), { withSemantics: false });
      expect(report.summary.filesScanned).toBe(1);
      expect(report.diagnostics).toHaveLength(1);
      expect(report.diagnostics[0]?.file).toBe('animals.kern');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('kern check — operational failures (exit 2)', () => {
  let tmpDir: string;
  let originalExit: typeof process.exit;
  let originalStderr: typeof process.stderr.write;
  let originalStdout: typeof process.stdout.write;
  let stderr: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-check-op-'));
    stderr = [];
    originalExit = process.exit;
    originalStderr = process.stderr.write;
    originalStdout = process.stdout.write;
    process.exit = ((code?: string | number | null | undefined): never => {
      throw new Error(`exit:${String(code)}`);
    }) as typeof process.exit;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.exit = originalExit;
    process.stderr.write = originalStderr;
    process.stdout.write = originalStdout;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('nonexistent path → exit 2', async () => {
    await expect(runCheck(['check', join(tmpDir, 'does-not-exist')])).rejects.toThrow('exit:2');
    expect(stderr.join('')).toContain('path does not exist');
  });

  test('unknown flag → exit 2', async () => {
    await expect(runCheck(['check', '--bogus'])).rejects.toThrow('exit:2');
    expect(stderr.join('')).toContain("unknown flag '--bogus'");
  });

  test('more than one positional path → exit 2', async () => {
    await expect(runCheck(['check', tmpDir, tmpDir])).rejects.toThrow('exit:2');
    expect(stderr.join('')).toContain('expected at most one path');
  });
});

describe('kern check — runCheck integration (--json + exit plumbing)', () => {
  let dir: string;
  let originalExit: typeof process.exit;
  let originalStdout: typeof process.stdout.write;
  let stdout: string[];

  beforeEach(() => {
    dir = fixtureDir({ 'clean.kern': `${CLEAN_KERN}\n`, 'bad/animals.kern': `${RETURN_VIOLATION_KERN}\n` });
    stdout = [];
    originalExit = process.exit;
    originalStdout = process.stdout.write;
    process.exit = ((code?: string | number | null | undefined): never => {
      throw new Error(`exit:${String(code)}`);
    }) as typeof process.exit;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.exit = originalExit;
    process.stdout.write = originalStdout;
    rmSync(dir, { recursive: true, force: true });
  });

  test('clean single-file → JSON on stdout, no exit call (exit 0 path)', async () => {
    await runCheck(['check', join(dir, 'clean.kern'), '--json']);
    const parsed = JSON.parse(stdout.join('')) as CheckReport;
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.tool).toBe('kern-check');
    expect(parsed.diagnostics).toHaveLength(0);
  });

  test('return-violation single-file → JSON emitted AND process.exit(1)', async () => {
    await expect(runCheck(['check', join(dir, 'bad', 'animals.kern'), '--json'])).rejects.toThrow('exit:1');
    const parsed = JSON.parse(stdout.join('')) as CheckReport;
    expect(parsed.diagnostics[0]?.category).toBe('return');
  });

  test('--help prints usage without exit', async () => {
    await runCheck(['check', '--help']);
    expect(stdout.join('')).toContain('Usage: kern check');
  });
});

describe('kern check — human output', () => {
  let dir: string;
  let originalExit: typeof process.exit;
  let originalStdout: typeof process.stdout.write;
  let stdout: string[];

  beforeEach(() => {
    dir = fixtureDir({ 'clean.kern': `${CLEAN_KERN}\n`, 'bad/animals.kern': `${RETURN_VIOLATION_KERN}\n` });
    stdout = [];
    originalExit = process.exit;
    originalStdout = process.stdout.write;
    process.exit = ((code?: string | number | null | undefined): never => {
      throw new Error(`exit:${String(code)}`);
    }) as typeof process.exit;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.exit = originalExit;
    process.stdout.write = originalStdout;
    rmSync(dir, { recursive: true, force: true });
  });

  test('clean run prints the ✓ summary line with returnChecksRun', async () => {
    await runCheck(['check', join(dir, 'clean.kern')]);
    const out = stdout.join('');
    expect(out).toContain('✓');
    expect(out).toContain('files checked, no issues');
    expect(out).toContain('returnChecksRun:');
  });

  test('default human mode groups per-diagnostic lines under the file header', async () => {
    await expect(runCheck(['check', join(dir, 'bad', 'animals.kern')])).rejects.toThrow('exit:1');
    const out = stdout.join('');
    expect(out).toContain('animals.kern');
    expect(out).toContain('not assignable');
    expect(out).toContain('(return)');
    expect(out).toContain('✗');
  });

  test('--quiet suppresses per-diagnostic lines but keeps the summary', async () => {
    await expect(runCheck(['check', join(dir, 'bad', 'animals.kern'), '--quiet'])).rejects.toThrow('exit:1');
    const out = stdout.join('');
    expect(out).not.toContain('not assignable');
    expect(out).toContain('✗');
  });
});
