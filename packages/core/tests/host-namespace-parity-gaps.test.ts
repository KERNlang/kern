/** Host-namespace parity gaps (PR #432 — tribunal-hardened).
 *
 *  Regression coverage for the four host-namespace fixes that keep the
 *  TS-emit path, the Python-emit path, and the IR-validation pass in lockstep:
 *   - GAP 1: the IR validator rejects an unknown stdlib member (`Number.foo`)
 *     exactly as the emitter does, against the ONE KERN_STDLIB registry.
 *   - GAP 2: a closure callee wrapped in paren/as/satisfies/non-null/legacy
 *     type-assert/comma-sequence forms still surfaces its host-namespace root.
 *   - GAP 3: an unparseable const value ships raw verbatim (no raw-scanner
 *     rejection on the parse-failure branch).
 *   - GAP 4: legacy `params="..."` defaults are parsed with the real TS parser,
 *     so `===`/`>=`/regex/template/generic defaults shadow correctly. */

import { collectClosureBlockMemberAccesses } from '../src/closure-eligibility.js';
import { beginIRHostNamespacesValidatedTS } from '../src/codegen/host-namespace-ir.js';
import { emitConstValue } from '../src/codegen/type-system.js';
import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';
import { typescriptClosureClassifier } from '../src/typescript-closure-classifier.js';

const parseExpr = (input: string): ReturnType<typeof parseExpression> =>
  parseExpression(input, { closureClassifier: typescriptClosureClassifier });

const TOP_LEVEL_CTX = { isUserBinding: () => false };

function emitTopLevel(src: string): { ok: boolean; message: string } {
  try {
    return { ok: true, message: emitExpression(parseExpr(src), TOP_LEVEL_CTX) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function validateConstIR(src: string, userBindings: string[] = []): { ok: boolean; message: string } {
  const mod: IRNode = {
    type: 'module',
    props: { name: 'M' },
    children: [{ type: 'const', props: { name: 'c', value: src }, children: [] }],
  };
  try {
    beginIRHostNamespacesValidatedTS(mod, { userBindings: new Set(userBindings) });
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

describe('GAP 1 — IR-validate ↔ emit parity against the single KERN_STDLIB registry', () => {
  // Portable members emit and validate cleanly on both paths.
  test.each([
    'Number.isFinite(x)',
    'Math.max(1, 2)',
    'JSON.parse(s)',
    'Object.keys(x)',
    'Array.isArray(x)',
  ])('portable %s passes both emit and IR-validate', (src) => {
    expect(emitTopLevel(src).ok).toBe(true);
    expect(validateConstIR(src, ['x', 's']).ok).toBe(true);
  });

  // Unknown members on stdlib roots must FAIL on BOTH paths (the drift the gap
  // closed: the validator previously PASSED these for the emitter to throw on).
  test.each([
    'Number.foo()',
    'Math.bogus(1)',
    'JSON.weird(s)',
    'Object.nope(x)',
    'Number.MAX_SAFE_INTEGER',
  ])('unknown stdlib member %s fails-closed on both emit and IR-validate', (src) => {
    expect(emitTopLevel(src).ok).toBe(false);
    expect(validateConstIR(src, ['x', 's']).ok).toBe(false);
  });

  // Non-stdlib host roots fail-closed identically on both paths.
  test.each([
    'process.exit()',
    'console.log(x)',
    'String.fromCharCode(65)',
  ])('host root %s fails-closed on both emit and IR-validate', (src) => {
    expect(emitTopLevel(src).ok).toBe(false);
    expect(validateConstIR(src, ['x']).ok).toBe(false);
  });

  // The IR-validate unknown-member diagnostic mirrors the emit diagnostic.
  test('unknown stdlib member surfaces the same "Unknown KERN-stdlib" diagnostic from validation', () => {
    const r = validateConstIR('Number.foo()');
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Unknown KERN-stdlib method/member 'Number.foo'");
  });
});

describe('GAP 2 — closure callee unwrap surfaces the host root through wrapper layers', () => {
  const callRoots = (block: string): string[] =>
    collectClosureBlockMemberAccesses(block)
      .filter((a) => a.member === 'call')
      .map((a) => a.root);

  test.each([
    ['{ (process as any)(); }', 'process'],
    ['{ (process)!(); }', 'process'],
    ['{ (process satisfies unknown)(); }', 'process'],
    ['{ (0, process)(); }', 'process'],
    ['{ (<any>process)(); }', 'process'],
    ['{ process(); }', 'process'],
  ])('wrapped callee %s surfaces %s as a call root', (block, root) => {
    expect(callRoots(block)).toContain(root);
  });

  test('comma-sequence callee resolves to the right (value) operand, not the left', () => {
    expect(callRoots('{ (Math, foo)(); }')).toEqual(['foo']);
  });
});

describe('GAP 3 — unparseable const value ships raw verbatim (no parse-failure rejection)', () => {
  const constNode: IRNode = { type: 'const', props: { name: 'c' }, children: [] };

  test('an unparseable raw value containing a host-namespace token is emitted verbatim', () => {
    // `process.env.FOO ??` is a syntactically incomplete expression; the
    // previous parse-failure branch ran the raw scanner and threw on `process`.
    const raw = 'process.env.FOO ??';
    expect(emitConstValue(constNode, raw)).toBe(raw);
  });
});

describe('GAP 4 — legacy param defaults parsed with the real TS parser', () => {
  // A fn whose body references host `process.exit()`; a param named `process`
  // shadows it. The default expressions exercise cases the old char-scanner
  // mis-split (===, >=, regex-with-comma, template-with-comma, generics).
  function validateFnWithParams(params: string): { ok: boolean; message: string } {
    const mod: IRNode = {
      type: 'module',
      props: { name: 'M' },
      children: [
        {
          type: 'fn',
          props: { name: 'f', params },
          children: [{ type: 'const', props: { name: 'r', value: 'process.exit()' }, children: [] }],
        },
      ],
    };
    try {
      beginIRHostNamespacesValidatedTS(mod);
      return { ok: true, message: '' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  test.each([
    'process = (a === b)',
    'x = /,/g, process = 1',
    'process: Array<number> = []',
    'process = `a,b`',
    'process = a >= b',
  ])('param `process` from a tricky default (%s) shadows the host root', (params) => {
    expect(validateFnWithParams(params).ok).toBe(true);
  });

  test('no `process` param leaves host `process.exit()` fail-closed', () => {
    expect(validateFnWithParams('x = 1').ok).toBe(false);
  });

  test('a host-namespace reference inside a param default is rejected', () => {
    expect(validateFnWithParams('x = process.exit()').ok).toBe(false);
  });

  test('left-to-right scoping: an earlier param shadows the host in a later default', () => {
    expect(validateFnWithParams('process = 1, y = process.foo').ok).toBe(true);
  });
});
