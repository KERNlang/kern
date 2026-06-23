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
  // INLINE `if` conditions — full expressions, no pre-computed boolean needed.
  [
    'if inline comparison (x > 3)',
    [
      'let kind=let name=r value="0"',
      'let name=x value="5"',
      'if cond="x > 3"',
      '  assign target=r value="10"',
      'return value="r"',
    ],
    10,
  ],
  [
    'if boolean composition (a && b)',
    [
      'let kind=let name=r value="0"',
      'let name=a value="true"',
      'let name=b value="true"',
      'if cond="a && b"',
      '  assign target=r value="7"',
      'return value="r"',
    ],
    7,
  ],
  [
    'if negation (!done)',
    [
      'let kind=let name=r value="0"',
      'let name=done value="false"',
      'if cond="!done"',
      '  assign target=r value="3"',
      'return value="r"',
    ],
    3,
  ],
  // a `for` driving an inline-condition `if` in its body — composition of both slices.
  // (`i % 2 < 1` rather than `== 0` to avoid the loose-eq stdlib helper, which this
  // minimal 3-leg harness does not inline; the runner/emitters all support `==`.)
  [
    'for + inline-if: count evens 1..6',
    [
      'let kind=let name=c value="0"',
      'for name=i from="1" to="7"',
      '  if cond="i % 2 < 1"',
      '    assign target=c value="c + 1"',
      'return value="c"',
    ],
    3,
  ],
  // `while` body runs in a child scope: an inner `let` is fresh each iteration
  // (no cross-iteration redeclaration abstain) while the `assign n += 1` writes
  // through so the condition still terminates.
  [
    'while + inner let accumulates',
    [
      'let kind=let name=n value="0"',
      'let kind=let name=s value="0"',
      'while cond="n < 4"',
      '  assign target=n value="n + 1"',
      '  let name=tmp value="n * 1"',
      '  assign target=s value="s + tmp"',
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

  test('an `each` over a bound collection accumulates into an outer mutable binding (not 0)', () => {
    // `each` cannot yet be driven through the 3-leg harness — the runner has no
    // array-literal evaluator, so the collection must be SEEDED in the env (a
    // separate, larger "array values in the runner" feature is deferred). Assert
    // the runner value directly: per-element child scopes + write-through `assign`
    // must accumulate (this returned 0 before the each child-scope fix).
    const handler = handlerOf(
      fixture([
        'let kind=let name=s value="0"',
        'each name=v in="xs"',
        '  assign target=s value="s + v"',
        'return value="s"',
      ]),
    );
    const env = makeEnv({ bindings: new Map<string, unknown>([['xs', [10, 20, 30]]]) });
    const trace = referenceRunSequence(handler.children ?? [], env);
    expect(trace.completion.kind).toBe('return');
    expect((trace.completion as { value: unknown }).value).toBe(60);
  });

  test('a `branch` path body `assign` writes through to an outer binding (not the old fork)', () => {
    // Hand-built IR avoids surface-parse subtleties (branch uses strict no-coercion
    // value matching). The selected path's `assign` to outer `r` must PERSIST — the
    // old `new Map(env.bindings)` fork discarded it (returning 0). And a branch
    // NESTED IN A LOOP must see + accumulate the outer binding through the parent
    // chain (agon review blocker: codex/kimi 1.00).
    const writeThrough = [
      { type: 'let', props: { kind: 'let', name: 'r', value: '0' } },
      { type: 'let', props: { name: 'x', value: '"b"' } },
      {
        type: 'branch',
        props: { on: 'x' },
        children: [
          {
            type: 'path',
            props: { value: '"b"' },
            children: [{ type: 'assign', props: { target: 'r', value: '100' } }],
          },
          {
            type: 'path',
            props: { default: true },
            children: [{ type: 'assign', props: { target: 'r', value: '1' } }],
          },
        ],
      },
      { type: 'return', props: { value: 'r' } },
    ] as unknown as IRNode[];
    const t1 = referenceRunSequence(writeThrough, makeEnv());
    expect(t1.completion.kind).toBe('return');
    expect((t1.completion as { value: unknown }).value).toBe(100);

    const branchInLoop = [
      { type: 'let', props: { kind: 'let', name: 'sum', value: '0' } },
      {
        type: 'for',
        props: { name: 'i', from: '1', to: '4' },
        children: [
          {
            type: 'branch',
            props: { on: 'i' },
            children: [
              {
                type: 'path',
                props: { value: '2' },
                children: [{ type: 'assign', props: { target: 'sum', value: 'sum + 100' } }],
              },
              {
                type: 'path',
                props: { default: true },
                children: [{ type: 'assign', props: { target: 'sum', value: 'sum + 1' } }],
              },
            ],
          },
        ],
      },
      { type: 'return', props: { value: 'sum' } },
    ] as unknown as IRNode[];
    const t2 = referenceRunSequence(branchInLoop, makeEnv());
    expect(t2.completion.kind).toBe('return');
    expect((t2.completion as { value: unknown }).value).toBe(102); // i=1->+1, i=2->+100, i=3->+1
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
  // A non-boolean container condition is non-portable (JS `[]` truthy, Python `[]`
  // falsy) — `portableTruthy` rejects it, so an `if` over an array fails closed.
  test('an `if` condition over an array literal fails closed (divergent truthiness)', () => {
    const src = fixture(['if cond="[1, 2, 3]"', '  return value="1"', 'return value="0"']);
    expect(() => runRef(src)).toThrow();
  });
});
