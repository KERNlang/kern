/**
 * THE ZERO-FP ACCEPTANCE WALL — the package's acceptance gate (slice 4 §1b).
 *
 * Walks EVERY `*.kern` file in the repository (excluding node_modules/.git/
 * dist/local agent worktrees, deterministic sorted order) and asserts the
 * whole @kernlang/check checker suite is zero-false-positive against the real
 * corpus:
 *
 *   - Files that fail to parse (a thrown parse OR an ERROR-severity parse
 *     diagnostic — warnings are advisory and do not exclude a file) are
 *     pinned to an EXPLICIT allowlist; a NEW parse failure FAILS the wall.
 *   - Files that parse but are rejected by the live core `validateSemantics`
 *     are EXCLUDED from the zero-assert; their PATHS are pinned so drift shows.
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
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
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
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', '.claude', '.pnpm-store', '.release']);

/** Deterministic (sorted) recursive walk for `*.kern` FILES (not directories —
 *  `.kern` directories exist in the repo and must NOT be collected). */
function collectKernFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      collectKernFiles(full, out);
    } else if (name.endsWith('.kern')) {
      out.push(full);
    }
  }
}

/** Error-level parse failures pinned from reality: NONE — every repo .kern
 *  file parses (warnings are advisory, see header). The deep-equal below
 *  guards M4: a NEW error-level failure must be reviewed, never silent. */
const PARSE_FAILURE_ALLOWLIST: readonly string[] = [];

/** Files that parse but are validator-rejected — EXCLUDED from the zero-assert,
 *  pinned by PATH (same M4 strength as the parse allowlist). 7 = the 5 the
 *  original wall saw + 2 that previously hid behind warning-level "parse
 *  failures" and now flow through to validation. (Of the 28 files the
 *  any-diagnostic wall excluded, 26 are now accepted and 2 land here.) */
const VALIDATOR_REJECTED_ALLOWLIST: readonly string[] = [
  'examples/native-test/conformance-bad-cases.kern',
  'examples/native-test/conformance-classes.test.kern',
  'examples/native-test/conformance-mcp-rag-bad-cases.kern',
  'examples/native-test/conformance-rag-bad-cases.kern',
  'examples/native-test/conformance-rag.test.kern',
  'examples/with-primitive.kern',
  'packages/core/native-test/kernlang-bad-cases.kern',
];
/** Accepted-program floor pinned from reality (currently 116 — up from 90
 *  after the severity fix). */
const ACCEPTED_FLOOR = 100;
/** The severity values core's parser may emit. The wall asserts every observed
 *  severity ∈ this set AND that at least one 'warning' was observed (28 corpus
 *  files carry them) — so a rename/recase of the `severity` field can never
 *  silently turn the error filter into a no-op (agon review, kimi 0.85). */
const KNOWN_SEVERITIES = new Set(['error', 'warning', 'info']);
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
  validatorRejected: string[];
  acceptedPrograms: number;
  severitiesSeen: ReadonlySet<string>;
  returnChecksRun: number;
  offenders: Array<{ file: string; checkProgram: unknown[]; checkCalls: unknown[]; checkReturns: unknown[] }>;
}

/** Run the wall once over the live corpus + synthetic injection. */
function runWall(): WallResult {
  const files: string[] = [];
  collectKernFiles(REPO_ROOT, files);

  const parseFailures: string[] = [];
  const validatorRejected: string[] = [];
  let acceptedPrograms = 0;
  let returnChecksRun = 0;
  const severitiesSeen = new Set<string>();
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
    // Record every observed severity — the severity-sanity assertion below
    // proves the 'error' filter is comparing against a live field, not a
    // renamed/recased one that would silently match nothing.
    for (const d of result.diagnostics ?? []) severitiesSeen.add(String(d.severity));
    // Only ERROR-level diagnostics exclude a file. Warning-level ones
    // (NATIVE_KERN_ELIGIBLE opportunity hints, UNKNOWN_NODE_TYPE advisories)
    // do NOT — the program parsed and must stay inside zero-FP coverage.
    if ((result.diagnostics ?? []).some((d) => d.severity === 'error')) {
      parseFailures.push(rel);
      continue;
    }
    if (validateSemantics(result.root).length > 0) {
      validatorRejected.push(rel); // validator-rejected → excluded from zero-assert.
      continue;
    }
    acceptedPrograms += 1;
    acceptProgram(result.root, rel);
  }

  // Synthetic injection: known-ACCEPT programs that DO run the return rule.
  // Each must meet a STRICTER bar than a real corpus file — ZERO diagnostics
  // of ANY severity (deliberately stricter than the error-only corpus filter:
  // a synthetic is authored here, so even a warning means it drifted) AND
  // validator-clean — before it may contribute to the floors (agon review,
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
  validatorRejected.sort();
  return {
    filesFound: files.length,
    parseFailures,
    validatorRejected,
    acceptedPrograms,
    severitiesSeen,
    returnChecksRun,
    offenders,
  };
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

  test('validator-rejected set exactly matches the pinned allowlist (drift is visible)', () => {
    expect(wall.validatorRejected).toEqual([...VALIDATOR_REJECTED_ALLOWLIST]);
  });

  test('severity sanity: the error filter compares against a live field', () => {
    // Every observed severity must be a known value (a renamed/recased field
    // would surface as 'undefined' here), and the corpus's 28 warning-bearing
    // files must actually be observed as warnings.
    const unknown = [...wall.severitiesSeen].filter((s) => !KNOWN_SEVERITIES.has(s));
    expect(unknown).toEqual([]);
    expect(wall.severitiesSeen.has('warning')).toBe(true);
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
