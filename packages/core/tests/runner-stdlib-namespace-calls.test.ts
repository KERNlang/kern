/**
 * ReferenceRunner — KERN-stdlib namespace calls executable natively.
 * Milestone 5.1b: `List.length(xs)`, `new Map()`, `Map.get`/`Map.has`
 * (general expressions), and `Map.set` (a `do`-statement mutation — see
 * ir-semantics-do.test.ts for the contract-level fixtures).
 *
 * `List.length(xs)` is namespace-call sugar for the SAME operation
 * `xs.length` already certifies (runner-array-length.test.ts) — see
 * kern-stdlib.ts's `List.length` lowering (`ts: '$0.length'`, `py: 'len($0)'`).
 *
 * Map values are a genuine native JS `Map<string, PortableScalar>` at
 * runtime (see portable-map.ts). Scope is deliberately narrow: construction
 * is `new Map()` (empty) only, keys are strings only, values are portable
 * scalars only, and `Map.get` on a MISSING key abstains (the TS-`undefined`-
 * vs-Python-`None` gap documented in portable-map.ts and kern-stdlib.ts).
 */

import { makeEnv, ReferenceRunnerError, referenceRunSequence, registerAllContracts } from '../src/index.js';
import { executeKernSource, executeKernSourceAsync, KernRunnerError } from '../src/runner.js';
import type { IRNode } from '../src/types.js';

beforeAll(() => {
  registerAllContracts();
});

function runStdout(nodes: IRNode[]): string {
  const trace = referenceRunSequence(nodes, makeEnv());
  return trace.events
    .filter((e): e is { op: 'stdout'; text: string } => e.op === 'stdout')
    .map((e) => `${e.text}\n`)
    .join('');
}

function letBind(name: string, value: string): IRNode {
  return { type: 'let', props: { name, value } };
}
function print(expr: string): IRNode {
  return { type: 'print', props: { value: expr } };
}
function doStmt(value: string): IRNode {
  return { type: 'do', props: { value } };
}

function mainProgram(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((line) => `    ${line}`)].join('\n');
}

describe('runner stdlib namespace calls — List.length', () => {
  it('reads the element count via the namespace-call form', () => {
    expect(runStdout([letBind('xs', '[10,20,30]'), print('List.length(xs)')])).toBe('3\n');
  });

  it('matches the member-access form on the same array', () => {
    expect(runStdout([letBind('xs', '[1,2]'), print('List.length(xs)'), print('xs.length')])).toBe('2\n2\n');
  });

  it('reads zero for an empty array', () => {
    expect(runStdout([letBind('xs', '[]'), print('List.length(xs)')])).toBe('0\n');
  });

  it('abstains on a non-array receiver', () => {
    expect(() => runStdout([letBind('n', '1'), print('List.length(n)')])).toThrow(ReferenceRunnerError);
  });

  it('abstains on wrong arity', () => {
    expect(() => runStdout([letBind('xs', '[1]'), print('List.length(xs, xs)')])).toThrow(ReferenceRunnerError);
  });

  it('respects user shadowing of the `List` name', () => {
    // A user binding named `List` shadows the builtin namespace entirely —
    // `List.length(...)` is then a member/call on the SHADOWING value, which
    // is outside the portable domain here, so the program still abstains
    // (never silently falls back to the builtin against the user's intent).
    expect(() => runStdout([letBind('List', '1'), letBind('xs', '[1]'), print('List.length(xs)')])).toThrow(
      ReferenceRunnerError,
    );
  });
});

describe('runner stdlib namespace calls — List.index', () => {
  it('reads a zero-based element and coalesces every miss class', () => {
    expect(
      executeKernSource(
        mainProgram([
          'let name=xs value="[10,20,30]"',
          'print value="List.index(xs, 1)"',
          'print value="List.index(xs, -1) ?? -1"',
          'print value="List.index(xs, 1.5) ?? -1"',
          'print value="List.index(xs, 3) ?? -1"',
        ]),
      ),
    ).toBe('20\n-1\n-1\n-1\n');
  });

  it('accepts helper-parameter arithmetic without granting raw index provenance', () => {
    const source = [
      'fn name=lookup params="id:number,values:number[]" returns=number export=true',
      '  handler lang="kern"',
      '    return value="List.index(values, id - 1) ?? -1"',
      '',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="lookup(2, [10,20,30])"',
    ].join('\n');
    expect(executeKernSource(source)).toBe('20\n');
  });

  it('matches sync and async source execution', async () => {
    const source = mainProgram(['let name=xs value="[10,20,30]"', 'print value="List.index(xs, 2)"']);
    expect(await executeKernSourceAsync(source)).toBe(executeKernSource(source));
  });

  it('fails closed on wrong arity, receiver, index type, and namespace shadowing', () => {
    expect(() => executeKernSource(mainProgram(['let name=xs value="[1]"', 'print value="List.index(xs)"']))).toThrow(
      KernRunnerError,
    );
    expect(() => executeKernSource(mainProgram(['let name=n value="1"', 'print value="List.index(n, 0)"']))).toThrow(
      KernRunnerError,
    );
    expect(() =>
      executeKernSource(mainProgram(['let name=xs value="[1]"', 'print value="List.index(xs, "0")"'])),
    ).toThrow(KernRunnerError);
    expect(() =>
      executeKernSource(
        mainProgram(['let name=List value="1"', 'let name=xs value="[1]"', 'print value="List.index(xs, 0)"']),
      ),
    ).toThrow(KernRunnerError);
  });
});

describe('runner stdlib namespace calls — Map construction + get/has (executeKernSource)', () => {
  it('constructs an empty Map, sets a key via `do`, and reads it back', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=m value="new Map()"',
        'do value="Map.set(m, \\"a\\", 1)"',
        'print value="Map.get(m, \\"a\\")"',
        'print value="Map.has(m, \\"a\\")"',
        'print value="Map.has(m, \\"b\\")"',
      ]),
    );
    expect(stdout).toBe('1\ntrue\nfalse\n');
  });

  it('Map.set overwrites an existing key and leaves others untouched', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=m value="new Map()"',
        'do value="Map.set(m, \\"a\\", 1)"',
        'do value="Map.set(m, \\"b\\", 2)"',
        'do value="Map.set(m, \\"a\\", 99)"',
        'print value="Map.get(m, \\"a\\")"',
        'print value="Map.get(m, \\"b\\")"',
      ]),
    );
    expect(stdout).toBe('99\n2\n');
  });

  it('fails closed reading a missing key via Map.get (Map.has probes safely)', () => {
    expect(() =>
      executeKernSource(mainProgram(['let name=m value="new Map()"', 'print value="Map.get(m, \\"missing\\")"'])),
    ).toThrow(KernRunnerError);
  });

  it('fails closed on `new Map(...)` with any argument (only the empty form is supported)', () => {
    expect(() =>
      executeKernSource(mainProgram(['let name=m value="new Map([[\\"a\\",1]])"', 'print value="1"'])),
    ).toThrow(KernRunnerError);
  });

  it('fails closed on a non-string Map key', () => {
    expect(() =>
      executeKernSource(
        mainProgram(['let name=m value="new Map()"', 'do value="Map.set(m, 1, 1)"', 'print value="1"']),
      ),
    ).toThrow(KernRunnerError);
  });

  it('fails closed on Map.set outside a `do` statement', () => {
    expect(() =>
      executeKernSource(
        mainProgram([
          'let name=m value="new Map()"',
          'let name=ignored value="Map.set(m, \\"a\\", 1)"',
          'print value="1"',
        ]),
      ),
    ).toThrow(KernRunnerError);
  });

  it('fails closed on `Map.get`/`Map.has` on a non-Map binding', () => {
    expect(() => executeKernSource(mainProgram(['let name=n value="1"', 'print value="Map.has(n, \\"a\\")"']))).toThrow(
      KernRunnerError,
    );
  });
});

describe('runner stdlib namespace calls — direct IR unit checks', () => {
  it('Map.set via `do` is invisible to the differential trace (no synthetic assign event)', () => {
    const trace = referenceRunSequence(
      [doStmt('Map.set(m, "a", 1)')],
      makeEnv({ bindings: new Map<string, unknown>([['m', new Map<string, unknown>()]]) }),
    );
    expect(trace.events).toEqual([]);
    expect(trace.completion).toEqual({ kind: 'normal' });
  });
});
