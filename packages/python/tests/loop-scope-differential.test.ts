/**
 * INTERPRETER-GRADE RUNNER — loop/scope differential oracle (ref === ts === py).
 *
 * Locks the lexical-scope-chain semantics that make the ReferenceRunner execute
 * real programs byte-identically to the emitted TS and Python legs:
 *   - a mutable accumulator across a `for` loop persists (was a CONFIRMED
 *     divergence: ref returned 0 while TS/Python returned 15 — the runner forked
 *     a fresh per-iteration env and discarded the `assign`),
 *   - an inner `let` is fresh each iteration (no duplicate-binding abstain),
 *   - nested loops compose,
 *   - the loop variable does NOT leak after the loop (a post-loop read is
 *     non-portable — TS block-scopes it, Python leaks it — so the runner ABSTAINS
 *     and both emitted legs error).
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

/** Build a `fn main` whose kern handler body is the given indented statement lines. */
function fixture(bodyLines: string[], returns = 'number'): string {
  return [`fn name=main returns=${returns}`, '  handler lang="kern"', ...bodyLines.map((l) => `    ${l}`)].join('\n');
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

/** REFERENCE leg — run the FULL handler body sequence through the runner; return
 *  the return-completion value. Throws if the runner ABSTAINS (the fail-close
 *  suite asserts on that throw). */
function runRef(src: string): unknown {
  const handler = handlerOf(src);
  const trace = referenceRunSequence(handler.children ?? [], makeEnv());
  if (trace.completion.kind !== 'return') {
    throw new Error(`runRef: no return completion, got ${JSON.stringify(trace.completion)}`);
  }
  return trace.completion.value;
}

function runTs(src: string): unknown {
  const r = emitNativeKernBodyTSWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
  const file = join(dir, 'run.mjs');
  writeFileSync(file, `${imports}\nfunction __h() {\n${r.code}\n}\nconsole.log(JSON.stringify(__h() ?? null));\n`);
  return JSON.parse(execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
}

function runPy(src: string): unknown {
  const r = emitNativeKernBodyPythonWithImports(handlerOf(src));
  const imports = [...(r.imports ?? [])].map((m) => `import ${m} as __k_${m}`).join('\n');
  const helpers = [...(r.helpers ?? [])].join('\n\n');
  const body = r.code
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
  const file = join(dir, 'run.py');
  writeFileSync(
    file,
    ['import json', imports, helpers, 'def __h():', body, 'print(json.dumps(__h(), ensure_ascii=False))'].join('\n'),
  );
  return JSON.parse(execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim());
}

// ── CERTIFIED: ref === ts === py === expected ────────────────────────────────
const CERT: Array<[string, string[], number]> = [
  // KILLER: a mutable accumulator persists across iterations (the confirmed bug).
  [
    'for accumulator sum 1..5',
    [
      'let kind=let name=sum value="0"',
      'for name=i from="1" to="6"',
      '  assign target=sum value="sum + i"',
      'return value="sum"',
    ],
    15,
  ],
  // inner `let` fresh each iteration (no duplicate-binding abstain on iteration 2).
  [
    'inner let fresh each iteration (sum of squares)',
    [
      'let kind=let name=acc value="0"',
      'for name=i from="1" to="4"',
      '  let name=sq value="i * i"',
      '  assign target=acc value="acc + sq"',
      'return value="acc"',
    ],
    14,
  ],
  // nested loops compose (child scope under child scope).
  [
    'nested loops sum i*j',
    [
      'let kind=let name=t value="0"',
      'for name=i from="1" to="3"',
      '  for name=j from="1" to="3"',
      '    assign target=t value="t + i * j"',
      'return value="t"',
    ],
    9,
  ],
  // `+=` accumulator form.
  [
    'for accumulator via +=',
    [
      'let kind=let name=s value="0"',
      'for name=i from="1" to="5"',
      '  assign target=s op="+=" value="i"',
      'return value="s"',
    ],
    10,
  ],
];

execDescribe('Interpreter-grade runner — loop/scope differential (ref === ts === py)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'loop-scope-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  for (const [name, body, expected] of CERT) {
    test(`${name} -> ${expected} on ALL THREE legs`, () => {
      const src = fixture(body);
      expect(runRef(src)).toBe(expected);
      expect(runTs(src)).toBe(expected);
      expect(runPy(src)).toBe(expected);
    });
  }
});

// ── RUNNER-ONLY value killer (GREEN without python3) ─────────────────────────
describe('Interpreter-grade runner — accumulator value killer', () => {
  test('a for-accumulator returns the SUM, not 0 (the pre-fix divergence)', () => {
    const src = fixture([
      'let kind=let name=sum value="0"',
      'for name=i from="1" to="6"',
      '  assign target=sum value="sum + i"',
      'return value="sum"',
    ]);
    expect(runRef(src)).toBe(15);
  });
});

// ── FAIL-CLOSE FENCE — the runner ABSTAINS (non-portable scope) ──────────────
describe('Interpreter-grade runner — loop scope fail-close fence', () => {
  // Post-loop read of the loop variable: TS block-scopes it (gone), Python leaks
  // it (last value) — divergent, so the runner must abstain.
  test('reading the loop variable AFTER the loop fails closed (no leak)', () => {
    const src = fixture([
      'let kind=let name=s value="0"',
      'for name=i from="1" to="3"',
      '  assign target=s value="s + i"',
      'return value="i"',
    ]);
    expect(() => runRef(src)).toThrow();
  });
  // Post-loop read of an inner-let declared in the body: same non-portable leak.
  test('reading an inner-let declared in the loop body, after the loop, fails closed', () => {
    const src = fixture([
      'let kind=let name=s value="0"',
      'for name=i from="1" to="3"',
      '  let name=tmp value="i * 2"',
      '  assign target=s value="s + tmp"',
      'return value="tmp"',
    ]);
    expect(() => runRef(src)).toThrow();
  });
});
