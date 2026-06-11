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
 * Parse failures pinned from reality (28 files, all parse-diagnostic — none
 * throw). A NEW parse failure (or a fixed one) changes this set and FAILS the
 * wall via the exact deep-equal below — guarding mutation M4 (a file silently
 * dropping out of the accepted set). Relative POSIX paths, sorted.
 */
const PARSE_FAILURE_ALLOWLIST: readonly string[] = [
  'examples/agon-plan.kern',
  'examples/agon.kern',
  'examples/audiofacets-toast.kern',
  'examples/mcp-api-gateway.kern',
  'examples/mcp-server.kern',
  'examples/native-test/conformance-bad-cases.kern',
  'examples/native-test/conformance-classes.test.kern',
  'examples/native-test/conformance-mocks.test.kern',
  'examples/native-test/conformance-routes.test.kern',
  'examples/native-test/conformance-tools.test.kern',
  'examples/native-test/language-surface.test.kern',
  'examples/native-test/runtime-functions.test.kern',
  'examples/template-usage.kern',
  'packages/core/native-test/kernlang-contracts.test.kern',
  'packages/core/src/kern/utils/external-boundary-utils.kern',
  'packages/core/src/kern/utils/import-metadata.kern',
  'packages/review-mcp/rules/mcp01-command-injection.kern',
  'packages/review-mcp/rules/mcp02-path-traversal.kern',
  'packages/review-mcp/rules/mcp03-tool-poisoning.kern',
  'packages/review-mcp/rules/mcp04-secrets-exposure.kern',
  'packages/review-mcp/rules/mcp05-unsanitized-response.kern',
  'packages/review-mcp/rules/mcp06-missing-validation.kern',
  'packages/review-mcp/rules/mcp07-missing-auth.kern',
  'packages/review-mcp/rules/mcp09-data-injection.kern',
  'packages/review-mcp/rules/mcp10-ssrf.kern',
  'packages/review-mcp/rules/mcp11-secret-leakage.kern',
  'packages/review-mcp/rules/mcp12-rug-pull.kern',
  'packages/review-mcp/rules/mcp13-insufficient-logging.kern',
];

/** Files that parse but are validator-rejected — EXCLUDED from the zero-assert.
 *  Pin the COUNT so drift is visible (spec §1b). */
const VALIDATOR_REJECTED_COUNT = 5;
/** Accepted-program floor pinned from reality (currently 90). */
const ACCEPTED_FLOOR = 80;
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
    if ((result.diagnostics ?? []).length > 0) {
      parseFailures.push(rel); // parse diagnostics → failure.
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
  for (let i = 0; i < SYNTHETIC_ACCEPT_PROGRAMS.length; i += 1) {
    const result = parseDocumentWithDiagnostics(SYNTHETIC_ACCEPT_PROGRAMS[i]);
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
