/**
 * `kern run <file.kern>` — slice-1 oracle (CLI behavior + fail-close contract).
 *
 * `kern run` is KERN's native entry point: it parses a `.kern` file, locates the
 * single `fn name=main returns=void` whose `handler lang="kern"` body holds the
 * program, executes that body through the ReferenceRunner (`referenceRunSequence`,
 * the SAME executor the 3-leg parity suite certifies), and replays the resulting
 * `{op:'stdout'}` trace events to REAL stdout. This is "KERN runs on its own".
 *
 * Contract under test (slice-1):
 *   - Entry resolution is STRICT: exactly one top-level `fn name=main`, it must
 *     declare `returns=void`, carry no params and not be async, and contain
 *     exactly one `handler lang="kern"`. Anything else is a deterministic
 *     stderr diagnostic + exit 2 — never a stack trace, never partial stdout.
 *   - Program stdout (the replayed trace events, each `text + "\n"`) goes to
 *     stdout ONLY; diagnostics go to stderr ONLY.
 *   - FAIL-CLOSE atomicity: when the runner ABSTAINS on a non-portable op
 *     (precondition fails -> referenceRunSequence throws), `kern run` emits NO
 *     stdout at all (not even output produced before the abstaining statement)
 *     and exits 2. Silent partial output is the one unforgivable bug.
 *   - Exit codes: 0 = normal/return completion; 2 = setup failure (parse / entry
 *     resolution / unreadable file) OR runner abstention. (Exit 1 is reserved for
 *     a future uncaught KERN `throw`; `throw` ABSTAINS in the runner today, so it
 *     fail-closes to 2 in slice-1.)
 *
 * Executable surface is exactly what the runner certifies today: print / let /
 * assign / for / if / while / each / return / portable arithmetic / portable
 * array-literal binding / literal in-bounds array index reads / array `.length`
 * (value AND as a for-range bound) / for-counter dynamic index reads (`xs[i]`).
 * Constructs the runner does not yet execute over PRODUCTION IR (branch/try/throw,
 * fmt interpolation, whole-array rendering, objects, NON-counter dynamic index
 * reads, arithmetic-on-counter index, string `.length`) ABSTAIN -> exit 2.
 *
 * Every expected stdout byte below was verified empirically against the built
 * runner before this oracle was authored (the `(1/3)*3 != 1` lesson).
 *
 * NOTE: assertions on diagnostic text are intentionally LOOSE (non-empty stderr,
 * plus a required keyword where the contract demands one). The exact wording of a
 * diagnostic is the implementation's choice; coupling the oracle to verbatim
 * message strings would let the implementation define its own contract.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = resolve(ROOT, 'packages/cli/dist/cli.js');

let dir: string;

beforeAll(() => {
  // The CLI is spawned, so the built entry must exist (the package `test` script
  // runs `build` first). Fail with a clear message instead of confusing ENOENT.
  if (!existsSync(CLI)) {
    throw new Error(`kern run tests require a built CLI at ${CLI} — run \`pnpm --filter @kernlang/cli build\` first.`);
  }
  dir = mkdtempSync(join(tmpdir(), 'kern-run-'));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function writeFile(source: string): string {
  const file = join(dir, `prog-${counter++}.kern`);
  writeFileSync(file, source);
  return file;
}

/** Wrap body statement lines in a void `fn main` + kern handler (the entry convention). */
function mainProgram(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((l) => `    ${l}`)].join('\n');
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runFile(file: string): RunResult {
  // `timeout` guards against a hung runner; surface a spawn error or a
  // signal-kill (e.g. the timeout) rather than a confusing null status.
  const r = spawnSync(process.execPath, [CLI, 'run', file], { encoding: 'utf-8', timeout: 20000 });
  if (r.error) throw r.error;
  if (r.signal) throw new Error(`kern run was killed by signal ${r.signal}`);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function runProgram(bodyLines: string[]): RunResult {
  return runFile(writeFile(mainProgram(bodyLines)));
}

// ── HAPPY PATH: exact stdout, exit 0, clean stderr ───────────────────────────
describe('kern run — executes a void main and replays stdout (exit 0)', () => {
  // Portable scalars (values + expected bytes proven by print-stdout-differential).
  const PORTABLE_PRINTS: Array<[string, string[], string]> = [
    ['bool true -> lowercase', ['print value="true"'], 'true\n'],
    ['bool false -> lowercase', ['print value="false"'], 'false\n'],
    ['null -> lowercase', ['print value="null"'], 'null\n'],
    ['positive integer base-10', ['print value="42"'], '42\n'],
    ['zero', ['print value="0"'], '0\n'],
    ['negative integer keeps sign', ['print value="0 - 7"'], '-7\n'],
    ['integer-valued arithmetic collapses to integer', ['print value="6 / 2"'], '3\n'],
    ['string passthrough', ['print value="\\"hello\\""'], 'hello\n'],
    ['empty string still emits its newline', ['print value="\\"\\""'], '\n'],
    ['unicode preserved', ['print value="\\"café→😀\\""'], 'café→😀\n'],
    ['embedded newline replayed exactly', ['print value="\\"a\\\\nb\\""'], 'a\nb\n'],
    ['embedded quote round-trips', ['print value="\\"a\\\\\\"b\\""'], 'a"b\n'],
  ];

  for (const [name, body, expected] of PORTABLE_PRINTS) {
    test(`prints ${name}`, () => {
      const r = runProgram(body);
      expect(r.stdout).toBe(expected);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    });
  }

  test('two prints preserve order + per-line newline', () => {
    const r = runProgram(['print value="42"', 'print value="7"']);
    expect(r.stdout).toBe('42\n7\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('prints a value read from a binding (not literal-only)', () => {
    const r = runProgram(['let name=x value="5"', 'print value="x"']);
    expect(r.stdout).toBe('5\n');
    expect(r.status).toBe(0);
  });

  test('for-loop body accumulates ordered lines (fresh iteration binding)', () => {
    const r = runProgram(['for name=i from="1" to="4"', '  print value="i"']);
    expect(r.stdout).toBe('1\n2\n3\n');
    expect(r.status).toBe(0);
  });

  test('FLAGSHIP: let + for + assign accumulation through real lexical scope', () => {
    // sum 1..3 via a write-through `assign` to an OUTER binding from inside the
    // loop body — kills a per-iteration env reset and a per-statement re-eval bug.
    // `kind=let` = MUTABLE (a plain `let` is immutable and the emitters reject the
    // reassign), so this program is genuinely 3-leg portable (ref === ts === py).
    const r = runProgram([
      'let kind=let name=total value="0"',
      'for name=i from="1" to="4"',
      '  assign target=total value="total + i"',
      'print value="total"',
    ]);
    expect(r.stdout).toBe('6\n');
    expect(r.status).toBe(0);
  });

  test('empty main succeeds with no output (NOT a nonzero exit)', () => {
    const r = runProgram([]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(0);
  });

  test('a `return` in a void main ends the program after prior stdout', () => {
    const r = runProgram(['print value="1"', 'return']);
    expect(r.stdout).toBe('1\n');
    expect(r.status).toBe(0);
  });

  test('a helper fn beside main is ignored; only main runs', () => {
    const source = [
      'fn name=helper returns=number',
      '  handler lang="kern"',
      '    return value="99"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="7"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.stdout).toBe('7\n');
    expect(r.status).toBe(0);
  });

  test('if/else takes the branch its (comparison) condition selects', () => {
    const r = runProgram([
      'let name=x value="5"',
      'if cond="x > 3"',
      '  print value="\\"big\\""',
      'else',
      '  print value="\\"small\\""',
    ]);
    expect(r.stdout).toBe('big\n');
    expect(r.status).toBe(0);
  });

  test('while loops until its condition goes false', () => {
    const r = runProgram([
      'let kind=let name=n value="0"',
      'while cond="n < 3"',
      '  print value="n"',
      '  assign target=n value="n + 1"',
    ]);
    expect(r.stdout).toBe('0\n1\n2\n');
    expect(r.status).toBe(0);
  });

  test('ARRAYS: each over an array literal prints each element in order', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'each name=x in=xs', '  print value="x"']);
    expect(r.stdout).toBe('1\n2\n3\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAYS: nested array literals iterate as real values (double-nested each)', () => {
    const r = runProgram([
      'let name=rows value="[[1,2],[3]]"',
      'each name=row in=rows',
      '  each name=v in=row',
      '    print value="v"',
    ]);
    expect(r.stdout).toBe('1\n2\n3\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
  test('ARRAY INDEX: an in-bounds read prints the element', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[0]"']);
    expect(r.stdout).toBe('10\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY INDEX: the last in-bounds literal index reads the last element', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[2]"']);
    expect(r.stdout).toBe('30\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: reads the element count', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs.length"']);
    expect(r.stdout).toBe('3\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: an empty array reads 0', () => {
    const r = runProgram(['let name=xs value="[]"', 'print value="xs.length"']);
    expect(r.stdout).toBe('0\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: a nested array counts TOP-LEVEL elements (not leaves)', () => {
    const r = runProgram(['let name=xs value="[[1,2],[3,4,5]]"', 'print value="xs.length"']);
    expect(r.stdout).toBe('2\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('ARRAY LENGTH: the length value flows into arithmetic', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs.length - 1"']);
    expect(r.stdout).toBe('2\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('DYNAMIC INDEX: iterate an array by for-counter over its length (headline)', () => {
    const r = runProgram([
      'let name=xs value="[10,20,30]"',
      'for name=i from="0" to="xs.length"',
      '  print value="xs[i]"',
    ]);
    expect(r.stdout).toBe('10\n20\n30\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  test('DYNAMIC INDEX: a reverse for-counter reads back-to-front', () => {
    const r = runProgram([
      'let name=xs value="[10,20,30]"',
      'for name=i from="2" to="-1" step="-1"',
      '  print value="xs[i]"',
    ]);
    expect(r.stdout).toBe('30\n20\n10\n');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});

// ── FAIL-CLOSE ATOMICITY: abstain produces NO stdout, exit 2 ──────────────────
describe('kern run — abstains atomically on non-portable ops (exit 2, no stdout)', () => {
  test('a non-integer float print abstains with no output', () => {
    const r = runProgram(['print value="3 / 2"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toBe('');
  });

  test('ATOMICITY: a later abstaining print suppresses ALL prior stdout', () => {
    // The "1" must NOT leak: render only happens after the whole body succeeds.
    const r = runProgram(['print value="1"', 'print value="3 / 2"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('an unsafe integer (>2^53) abstains (JS/Python disagree)', () => {
    const r = runProgram(['print value="9007199254740993"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('whole-array print abstains (the array now BINDS; printing it is deferred)', () => {
    // Slice-2a binds the array literal, but printing a WHOLE array is deferred
    // (the `print` contract fail-closes arrays — and a lossy comma-join is a
    // later rendering decision). So `print xs` abstains -> exit 2, no stdout.
    const r = runProgram(['let name=xs value="[1, 2, 3]"', 'print value="xs"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('OUT-OF-BOUNDS index abstains (TS undefined vs Py IndexError)', () => {
    // In-bounds index now runs (see the happy-path ARRAY INDEX tests above); an
    // OOB read stays fenced because the emitter legs diverge.
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs[5]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('NEGATIVE index abstains (TS undefined vs Py wraps to last element)', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs[-1]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('FLOAT-literal index abstains (Python list indices must be int)', () => {
    // ref + TS would read xs[1] (1.0 === 1) but Python `xs[1.0]` raises TypeError,
    // so the runner fences float-source indices. Verified on real node + python3.
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[1.0]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a dynamic (variable) index abstains (deferred — needs integer provenance)', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'let name=j value="1"', 'print value="xs[j]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('an arithmetic index abstains (only bare safe-integer literals certify)', () => {
    // `1 + 1` is in-bounds but computed indices abstain: integer `%` diverges by
    // sign and `+/-/*` can overflow 2^53 (JS rounds, Python is exact).
    const r = runProgram(['let name=xs value="[10,20,30]"', 'print value="xs[1 + 1]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a float ELEMENT abstains when iterated/printed (print float fails closed)', () => {
    const r = runProgram(['let name=xs value="[1.5]"', 'each name=x in=xs', '  print value="x"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('STRING `.length` abstains (JS UTF-16 units vs Python code points)', () => {
    // ASCII happens to agree, but the runner rule is arrays-only: a string
    // receiver fails closed so an astral case can never silently diverge.
    const r = runProgram(['let name=s value="\\"hello\\""', 'print value="s.length"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('ASTRAL string `.length` abstains (the real divergence: JS 2 vs Python 1)', () => {
    const r = runProgram(['let name=s value="\\"😀\\""', 'print value="s.length"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('OPTIONAL `xs?.length` abstains (outside the portable domain)', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs?.length"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test("COMPUTED `xs['length']` abstains (a string-literal index is not certified)", () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs[\'length\']"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a NON-`length` member on an array (`xs.foo`) abstains', () => {
    const r = runProgram(['let name=xs value="[1,2,3]"', 'print value="xs.foo"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('ATOMICITY: an OUT-OF-BOUNDS for-counter iteration suppresses ALL prior stdout', () => {
    // for i in 0..5 over a length-3 array: at i=3 TS reads undefined, Python raises.
    // The 10/20/30 from i=0..2 must NOT leak — the whole program abstains.
    const r = runProgram(['let name=xs value="[10,20,30]"', 'for name=i from="0" to="5"', '  print value="xs[i]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a NEGATIVE for-counter (reverse past 0) abstains', () => {
    const r = runProgram([
      'let name=xs value="[10,20,30]"',
      'for name=i from="2" to="-2" step="-1"',
      '  print value="xs[i]"',
    ]);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('ARITHMETIC on a for-counter index (`xs[i + 1]`) abstains (out of slice)', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'for name=i from="0" to="2"', '  print value="xs[i + 1]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });

  test('a NON-counter (plain let) index abstains even when in-bounds', () => {
    const r = runProgram(['let name=xs value="[10,20,30]"', 'let name=j value="4 / 2"', 'print value="xs[j]"']);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(2);
  });
});

// ── ENTRY RESOLUTION: deterministic diagnostics, exit 2, no stdout ────────────
describe('kern run — strict entry resolution (exit 2, diagnostic on stderr)', () => {
  test('no fn main -> diagnostic, not a crash', () => {
    const source = ['fn name=other returns=void', '  handler lang="kern"', '    print value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
    expect(r.stderr.toLowerCase()).toContain('main');
  });

  test('duplicate fn main -> rejected (no first-wins)', () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="1"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="2"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  test('main with params -> rejected in slice-1', () => {
    const source = ['fn name=main params="x:number" returns=void', '  handler lang="kern"', '    print value="1"'].join(
      '\n',
    );
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  test('main returns a non-void type -> rejected in slice-1', () => {
    const source = ['fn name=main returns=number', '  handler lang="kern"', '    return value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  test('main whose handler is foreign (lang=ts) -> rejected', () => {
    const source = ['fn name=main returns=void', '  handler lang="ts"', '    print value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  test('async main -> rejected in slice-1', () => {
    const source = ['fn name=main async=true returns=void', '  handler lang="kern"', '    print value="1"'].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  // (zero kern handlers is exercised by the foreign-handler case above — main with
  // only a `lang=ts` handler resolves to zero kern handlers and is rejected.)
  test('main with two kern handlers -> rejected (no first-handler-wins)', () => {
    const source = [
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="1"',
      '  handler lang="kern"',
      '    print value="2"',
    ].join('\n');
    const r = runFile(writeFile(source));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });
});

// ── FILE / PARSE FAILURES ────────────────────────────────────────────────────
describe('kern run — file + parse failures (exit 2, no stdout)', () => {
  test('a parse error fails closed', () => {
    const r = runFile(writeFile('fn name=main returns=void\n  handler lang="kern"\n    print value='));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  test('a nonexistent file is a clean diagnostic, not a stack trace', () => {
    const r = runFile(join(dir, 'does-not-exist.kern'));
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });
});
