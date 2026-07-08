/**
 * 3-leg STDOUT differential for the `print` primitive — KERN's portable output
 * member. For every CERT fixture the REAL reference runner, the REAL emitted
 * TypeScript (run under `node`), and the REAL emitted Python (run under
 * `python3`) must produce byte-identical stdout:
 *
 *     runRefStdout(src) === runTsStdout(src) === runPyStdout(src) === expected
 *
 * This is the production path with NO harness suppression: each leg's stdout is
 * what real `console.log` / `print(...)` actually write, so the test doubles as
 * the council-mandated "spawn-and-capture real-stdout" golden. The reference
 * leg reconstructs the expected bytes from its `{op:'stdout', text}` trace
 * events (+ the trailing newline `console.log`/`print` append by default).
 *
 * The ABSTAIN block locks the fail-close fence: the runner REFUSES to certify a
 * non-portable `print` (non-integer float, UNSAFE integer, object/array). The
 * unsafe-integer case carries a divergence WITNESS — the two emitters genuinely
 * disagree (`9007199254740992` vs `...993`), which is exactly why the runner
 * must use `Number.isSafeInteger`, not `Number.isInteger`.
 *
 * Every expected value was verified on the REAL emitters + node/python3.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IRNode } from '@kernlang/core';
import {
  emitNativeKernBodyTSWithImports,
  makeEnv,
  parse,
  referenceRunSequence,
  registerAllContracts,
} from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports } from '../src/codegen-body-python.js';

registerAllContracts();

function handlerOf(src: string): IRNode {
  const root = parse(src);
  const fn = root.type === 'fn' ? root : (root.children ?? []).find((n: IRNode) => n.type === 'fn');
  if (!fn) throw new Error('handlerOf: no fn');
  const handler = (fn.children ?? []).find((n: IRNode) => n.type === 'handler');
  if (!handler) throw new Error('handlerOf: no handler');
  return handler;
}

/** Build a `fn main` (void) whose kern handler body is the given statement lines. */
function fixture(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((l) => `    ${l}`)].join('\n');
}

const haveExec = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const execDescribe = haveExec ? describe : describe.skip;

let dir: string;

/** REFERENCE leg — run the body through the runner and rebuild stdout from its
 *  `{op:'stdout'}` trace events (one trailing newline per print, matching
 *  `console.log`/`print`). Throws if the runner ABSTAINS (the fail-close suite
 *  asserts on that throw). */
function runRefStdout(src: string): string {
  const trace = referenceRunSequence(handlerOf(src).children ?? [], makeEnv());
  return trace.events
    .filter((e): e is { op: 'stdout'; text: string } => e.op === 'stdout')
    .map((e) => `${e.text}\n`)
    .join('');
}

/** TS leg — emit production code, run it under `node`, capture RAW stdout. */
function runTsStdout(src: string): string {
  const r = emitNativeKernBodyTSWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
  const file = join(dir, 'run.mjs');
  writeFileSync(file, `${imports}\nfunction __h() {\n${r.code}\n}\n__h();\n`);
  return execFileSync('node', [file], { encoding: 'utf8' });
}

/** Python leg — emit production code, run it under `python3`, capture RAW stdout. */
function runPyStdout(src: string): string {
  const r = emitNativeKernBodyPythonWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import ${m} as __k_${m}`).join('\n');
  const helpers = [...(r.helpers ?? [])].join('\n\n');
  const body = r.code
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
  const file = join(dir, 'run.py');
  writeFileSync(file, [imports, helpers, 'def __h():', body, '__h()'].join('\n'));
  return execFileSync('python3', [file], { encoding: 'utf8' });
}

// ── CERTIFIED: ref === ts === py === expected stdout ─────────────────────────
const CERT: Array<[string, string[], string]> = [
  // bool — KILLER for a Python impl that prints `True`/`False` (raw str(bool)).
  ['bool true', ['print value="true"'], 'true\n'],
  ['bool false', ['print value="false"'], 'false\n'],
  // null — KILLER for a Python impl that prints `None`.
  ['null', ['print value="null"'], 'null\n'],
  // integers, base-10, signed.
  ['int', ['print value="42"'], '42\n'],
  ['zero', ['print value="0"'], '0\n'],
  ['negative int', ['print value="0 - 7"'], '-7\n'],
  // NON-integer division (float/int fence, nested-values slice-1): both legs
  // shortest-roundtrip "3.5" and the runner now certifies it. Integer-VALUED
  // division (`6 / 2`) moved to the ABSTAIN suite — Python's `/` is float-
  // typed, and while `_kern_fmt.is_integer()` collapses it in PRINT position,
  // the same value diverges in non-print positions (JSON return: "3" vs
  // "3.0"), so the runner fences it at EVALUATION, conservatively.
  ['non-integer division 7/2', ['print value="7 / 2"'], '3.5\n'],
  ['non-integer float literal 2.5', ['print value="2.5"'], '2.5\n'],
  // strings — exact passthrough.
  ['plain string', ['print value="\\"hello\\""'], 'hello\n'],
  // empty string — KILLER for a truthiness-guarded "skip empty" impl; must be a bare newline.
  ['empty string', ['print value="\\"\\""'], '\n'],
  // unicode — KILLER for a Python impl that escapes non-ASCII (ensure_ascii).
  ['unicode string', ['print value="\\"café→😀\\""'], 'café→😀\n'],
  // embedded newline must NOT be double-processed.
  ['string with embedded newline', ['print value="\\"a\\\\nb\\""'], 'a\nb\n'],
  // embedded quote round-trips byte-exact.
  ['string with embedded quote', ['print value="\\"a\\\\\\"b\\""'], 'a"b\n'],
  // value from a BINDING, not a literal — KILLER for a literal-only evaluator.
  ['binding value', ['let name=x value="5"', 'print value="x"'], '5\n'],
  // two prints — KILLER for a missing/extra newline or coalesced writes.
  ['two prints preserve order + newlines', ['print value="42"', 'print value="7"'], '42\n7\n'],
  // print inside a loop accumulates the right ordered lines.
  ['print inside a for-loop', ['for name=i from="1" to="4"', '  print value="i"'], '1\n2\n3\n'],
];

execDescribe('print primitive — stdout differential (ref === ts === py)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'print-stdout-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const [name, body, expected] of CERT) {
    test(`${name} -> ${JSON.stringify(expected)} on ALL THREE legs`, () => {
      const src = fixture(body);
      expect(runRefStdout(src)).toBe(expected);
      expect(runTsStdout(src)).toBe(expected);
      expect(runPyStdout(src)).toBe(expected);
    });
  }

  // ── DIVERGENCE WITNESS — why the fence must be Number.isSafeInteger ─────────
  // For an unsafe integer the two emitters genuinely DISAGREE: JS rounds
  // 9007199254740993 to ...992, CPython keeps full precision. The runner's
  // safe-integer abstain (the ABSTAIN suite) is what stops this divergence
  // reaching certified code. If this witness ever stops diverging, the fence
  // may be over-broad.
  test('unsafe integer: TS and Python disagree (runner correctly abstains)', () => {
    const src = fixture(['print value="9007199254740993"']);
    const ts = runTsStdout(src);
    const py = runPyStdout(src);
    expect(ts).toBe('9007199254740992\n');
    expect(py).toBe('9007199254740993\n');
    expect(ts).not.toBe(py);
    expect(() => runRefStdout(src)).toThrow();
  });
});

// ── FAIL-CLOSE FENCE (runner-only — GREEN without python3) ───────────────────
// The runner ABSTAINS (precondition fails -> referenceRunSequence throws) on
// every value outside the portable {null, bool, string, safe-integer,
// non-integer finite float} domain.
const ABSTAIN: Array<[string, string[]]> = [
  // Float/int fence (nested-values slice-1) — integer-VALUED float values
  // abstain at evaluation: Python cannot portably prove the int/float TYPE
  // of `4 / 2` (float 2.0) or `4.0` outside _kern_fmt-collapsed positions.
  ['integer-valued division (4/2)', ['print value="4 / 2"']],
  ['integer-valued float literal (4.0)', ['print value="4.0"']],
  ['float-collapsing arithmetic (2.5 + 1.5)', ['print value="2.5 + 1.5"']],
  ['unsafe integer (2^53 + 1)', ['print value="9007199254740993"']],
  ['object literal', ['print value="{ x: 1 }"']],
  ['array literal', ['print value="[1, 2]"']],
  ['undefined-typed bare value', ['print value="undefined"']],
];

describe('print primitive — fail-close fence (runner abstains on non-portable)', () => {
  for (const [name, body] of ABSTAIN) {
    test(`${name} -> runner ABSTAINS`, () => {
      expect(() => runRefStdout(fixture(body))).toThrow();
    });
  }
});

// ── TRAILING-COMMENT ROUND-TRIP (emitter-only — GREEN without python3) ────────
// `print` is in both emitters' TRAILING_COMMENT_TYPES, so a migrated inline
// comment (the migrator captures it as `trailingComment=`) reattaches to the
// emitted line instead of being silently dropped — byte-clean migration
// round-trip, parallel to `return`/`do`.
describe('print primitive — trailing comment reattaches in both targets', () => {
  const handler: IRNode = {
    type: 'handler',
    props: { lang: 'kern' },
    children: [{ type: 'print', props: { value: '42', trailingComment: '// the answer' } }],
  };

  test('TS reattaches the trailing comment', () => {
    expect(emitNativeKernBodyTSWithImports(handler).code).toBe('console.log(`${42}`); // the answer');
  });

  test('Python reattaches the trailing comment', () => {
    expect(emitNativeKernBodyPythonWithImports(handler).code).toBe('print(_kern_fmt(42))  # the answer');
  });
});
