/**
 * THE ZERO-FP ACCEPTANCE WALL — the package's acceptance gate (slice 4 §1b).
 *
 * Walks EVERY `*.kern` file in the repository (excluding node_modules/.git/
 * dist, deterministic sorted order) and asserts the whole @kernlang/check
 * checker suite is zero-false-positive against the real corpus:
 *
 *   - Files that fail to parse (a thrown parse OR any parse diagnostic) are
 *     pinned to an EXPLICIT allowlist; a NEW parse failure FAILS the wall.
 *   - Files that parse but are rejected by the live core `validateSemantics`
 *     are EXCLUDED from the zero-assert; their COUNT is pinned so drift shows.
 *   - For every ACCEPTED program (parses + validator-clean) all THREE checkers
 *     — `checkProgram` (slice 2), `checkCalls` (slice 3), `checkReturns`
 *     (slice 4) — must produce ZERO diagnostics. ANY diagnostic FAILS the wall
 *     verbatim (it is a checker FP or a real corpus bug; both need a human —
 *     do NOT allowlist it away).
 *
 * NON-VACUITY floors (all hard assertions; spec §1b.3):
 *   1. `filesFound >= 100` and `acceptedPrograms >= ACCEPTED_FLOOR`.
 *   2. `returnChecksRun >= 3` — every (fn/method, return) pair that REACHED the
 *      assignable() comparison. The real corpus exercises this 0 times (class-
 *      name `returns=` are not used in committed .kern files), so the floor is
 *      guaranteed by SYNTHETIC INJECTION: ~3 in-test known-ACCEPT programs
 *      (returns=<KnownClass> + return new <Subclass>()) appended to the wall
 *      run. They prove the checker RAN inside the wall without turning it red.
 *   3. Parse-failure allowlist exact-match (above).
 *
 * Structural mutation mapping (spec §2 M3/M4):
 *   M3 (the return rule could silently never run) → guarded by the
 *      `returnChecksRun >= 3` floor below.
 *   M4 (a corpus file silently drops out of the wall) → guarded by the exact
 *      `PARSE_FAILURE_ALLOWLIST` deep-equal below.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';
import { parseDocumentWithDiagnostics } from '../../core/dist/parser.js';
import { validateSemantics } from '../../core/dist/semantic-validator.js';
import { checkCalls } from '../dist/calls.js';
import { checkReturns } from '../dist/returns.js';
import { checkProgram } from '../dist/walk.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root: packages/check/tests → ../../.. */
const REPO_ROOT = join(HERE, '..', '..', '..');
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist']);

/** Deterministic (sorted) recursive walk for `*.kern` FILES (not directories —
 *  `.kern` directories exist in the repo and must NOT be collected). */
function collectKernFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      collectKernFiles(full, out);
    } else if (name.endsWith('.kern')) {
      out.push(full);
    }
  }
}

/**
 * Parse failures pinned from reality: NONE — with the severity fix (only
 * `severity: 'error'` diagnostics are parse failures) every repo .kern file
 * parses. The original wall counted ANY diagnostic as a failure, which
 * silently excluded 28 files that merely carried advisory warnings
 * (NATIVE_KERN_ELIGIBLE hints, UNKNOWN_NODE_TYPE) from zero-FP coverage —
 * found by dogfooding the wall against the AGON corpus. The allowlist
 * mechanism stays: a NEW error-level failure (or a fixed one) changes this
 * set and FAILS the wall via the exact deep-equal below — guarding mutation
 * M4 (a file silently dropping out of the accepted set). Relative POSIX
 * paths, sorted.
 */
const PARSE_FAILURE_ALLOWLIST: readonly string[] = [];

/** Files that parse but are validator-rejected — EXCLUDED from the zero-assert.
 *  Pin the COUNT so drift is visible (spec §1b). 7 = the 5 originally pinned
 *  plus 2 that previously hid behind warning-level "parse failures" and now
 *  flow through to validation. */
const VALIDATOR_REJECTED_COUNT = 7;
/** Accepted-program floor pinned from reality (currently 116 — up from 90
 *  after the severity fix widened coverage by 26 programs). */
const ACCEPTED_FLOOR = 100;
/** Synthetic injection floor for the return rule (spec §1b.3.2). */
const RETURN_CHECKS_FLOOR = 3;

/**
 * Synthetic in-test KERN programs that DO exercise `checkReturns` to the
 * assignable() comparison (the real corpus never does). All are known-ACCEPT
 * (return type IS / extends the declared type) so they contribute to the
 * `returnChecksRun` floor WITHOUT producing any diagnostic. One uses a method
 * so the method path is also proven to run inside the wall.
 */
const SYNTHETIC_ACCEPT_PROGRAMS: readonly string[] = [
  [
    'class name=Animal',
    'class name=Dog extends=Animal',
    'fn name=make returns=Animal',
    '  handler lang=kern',
    '    return value="new Dog()"',
  ].join('\n'),
  [
    'class name=Animal',
    'class name=Dog extends=Animal',
    'class name=Puppy extends=Dog',
    'fn name=make returns=Dog',
    '  handler lang=kern',
    '    return value="new Puppy()"',
  ].join('\n'),
  [
    'class name=Animal',
    'class name=Dog extends=Animal',
    'class name=Holder',
    '  method name=make returns=Animal',
    '    handler lang=kern',
    '      return value="new Dog()"',
  ].join('\n'),
];

interface WallResult {
  filesFound: number;
  parseFailures: string[];
  acceptedPrograms: number;
  excludedCount: number;
  returnChecksRun: number;
  offenders: Array<{ file: string; checkProgram: unknown[]; checkCalls: unknown[]; checkReturns: unknown[] }>;
}

/** Run the wall once over the live corpus + synthetic injection. */
function runWall(): WallResult {
  const files: string[] = [];
  collectKernFiles(REPO_ROOT, files);

  const parseFailures: string[] = [];
  let acceptedPrograms = 0;
  let excludedCount = 0;
  let returnChecksRun = 0;
  const offenders: WallResult['offenders'] = [];

  const acceptProgram = (root: unknown, file: string): void => {
    const d2 = checkProgram(root as never);
    const d3 = checkCalls(root as never);
    const r4 = checkReturns(root as never);
    returnChecksRun += r4.returnChecksRun;
    if (d2.length > 0 || d3.length > 0 || r4.diagnostics.length > 0) {
      offenders.push({ file, checkProgram: d2, checkCalls: d3, checkReturns: r4.diagnostics });
    }
  };

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).split('\\').join('/');
    const source = readFileSync(file, 'utf8');
    let result: ReturnType<typeof parseDocumentWithDiagnostics>;
    try {
      result = parseDocumentWithDiagnostics(source);
    } catch {
      parseFailures.push(rel); // thrown parse → failure.
      continue;
    }
    if ((result.diagnostics ?? []).some((d) => d.severity === 'error')) {
      parseFailures.push(rel); // ERROR-level parse diagnostics → failure.
      // Warning-level diagnostics (NATIVE_KERN_ELIGIBLE opportunity hints,
      // UNKNOWN_NODE_TYPE advisories) do NOT exclude a file — the program
      // parsed and must stay inside zero-FP coverage.
      continue;
    }
    if (validateSemantics(result.root).length > 0) {
      excludedCount += 1; // validator-rejected → excluded from zero-assert.
      continue;
    }
    acceptedPrograms += 1;
    acceptProgram(result.root, rel);
  }

  // Synthetic injection: known-ACCEPT programs that DO run the return rule.
  // Each must meet the SAME bar as a real accepted corpus file — parse-clean
  // AND validator-clean — before it may contribute to the floors (agon review,
  // codex: an accidentally-broken synthetic would otherwise count via a
  // malformed root and fail only indirectly through the M3 floor).
  for (let i = 0; i < SYNTHETIC_ACCEPT_PROGRAMS.length; i += 1) {
    const result = parseDocumentWithDiagnostics(SYNTHETIC_ACCEPT_PROGRAMS[i]);
    if ((result.diagnostics ?? []).length > 0) {
      throw new Error(`<synthetic-accept-${i}> failed to parse — fix the synthetic program`);
    }
    if (validateSemantics(result.root).length > 0) {
      throw new Error(`<synthetic-accept-${i}> is validator-rejected — fix the synthetic program`);
    }
    acceptProgram(result.root, `<synthetic-accept-${i}>`);
  }

  parseFailures.sort();
  return { filesFound: files.length, parseFailures, acceptedPrograms, excludedCount, returnChecksRun, offenders };
}

describe('THE ZERO-FP ACCEPTANCE WALL', () => {
  const wall = runWall();

  test('ZERO diagnostics from ALL THREE checkers on every accepted corpus program', () => {
    // If this fails, the offender is printed verbatim — STOP and report it; do
    // NOT allowlist it away (spec §1b). It is a checker FP or a real corpus bug.
    expect(wall.offenders).toEqual([]);
  });

  test('M4: parse-failure set exactly matches the pinned allowlist', () => {
    expect(wall.parseFailures).toEqual([...PARSE_FAILURE_ALLOWLIST]);
  });

  test('validator-rejected count is pinned (drift is visible)', () => {
    expect(wall.excludedCount).toBe(VALIDATOR_REJECTED_COUNT);
  });

  test('NON-VACUITY: filesFound >= 100', () => {
    expect(wall.filesFound).toBeGreaterThanOrEqual(100);
  });

  test('NON-VACUITY: acceptedPrograms >= floor', () => {
    expect(wall.acceptedPrograms).toBeGreaterThanOrEqual(ACCEPTED_FLOOR);
  });

  test('M3: returnChecksRun >= 3 (the return rule provably RAN inside the wall)', () => {
    expect(wall.returnChecksRun).toBeGreaterThanOrEqual(RETURN_CHECKS_FLOOR);
  });
});
