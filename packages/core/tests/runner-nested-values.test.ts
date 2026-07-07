import { makeEnv, referenceRunSequence, registerAllContracts } from '../src/index.js';
import { evalPortableValueAsync } from '../src/ir/semantics/async-portable-scalar.js';
import { asyncReferenceRunSequence } from '../src/ir/semantics/async-reference-runner.js';
import { assignBinding, defineRecordBinding, recordArrayFieldsForBinding } from '../src/ir/semantics/index.js';
import { evalPortableValue } from '../src/ir/semantics/portable-scalar.js';
import { parseExpression } from '../src/parser-expression.js';
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

async function runStdoutAsync(nodes: IRNode[]): Promise<string> {
  const trace = await asyncReferenceRunSequence(nodes, makeEnv(), {});
  return trace.events
    .filter((e): e is { op: 'stdout'; text: string } => e.op === 'stdout')
    .map((e) => `${e.text}\n`)
    .join('');
}

function letBind(name: string, value: string, kind?: string): IRNode {
  return { type: 'let', props: { name, value, ...(kind ? { kind } : {}) } };
}

function print(value: string): IRNode {
  return { type: 'print', props: { value } };
}

function forLoop(name: string, from: string, to: string, child: IRNode | IRNode[]): IRNode {
  return { type: 'for', props: { name, from, to }, children: Array.isArray(child) ? child : [child] };
}

function eachLoop(name: string, inExpr: string, child: IRNode | IRNode[]): IRNode {
  return { type: 'each', props: { name, in: inExpr }, children: Array.isArray(child) ? child : [child] };
}

function exprBind(name: string, expr: string): IRNode {
  return { type: 'expression-v1', props: { name, expr } };
}

function assign(target: string, value: string): IRNode {
  return { type: 'assign', props: { target, value } };
}

function doValue(value: string): IRNode {
  return { type: 'do', props: { value } };
}

function expectFailClosedError(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(Error);
  expect(String((thrown as Error).message)).toMatch(
    /Preconditions failed|array|assign|binding|each|field|fresh|index|length|literal|nested|portable|record|scalar|stale|unsupported/u,
  );
}

function expectThrows(action: () => unknown): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expectFailClosedError(thrown);
}

async function expectAsyncThrows(action: () => Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  expectFailClosedError(thrown);
}

function abstains(nodes: IRNode[]): void {
  expectThrows(() => referenceRunSequence(nodes, makeEnv()));
}

describe('runner nested values — admitted record array-literal fields', () => {
  it('NV-1 reads a scalar field from a record that also holds an array literal', () => {
    expect(runStdout([letBind('r', '{a: 1, b: [10,20,30]}'), print('r.a')])).toBe('1\n');
  });

  it('NV-2 reads .length on an array-literal record field', () => {
    expect(runStdout([letBind('r', '{a: 1, b: [10,20,30]}'), print('r.b.length')])).toBe('3\n');
  });

  it('NV-3 reads distinct literal indices on an array-literal record field', () => {
    expect(runStdout([letBind('r', '{a: 1, b: [10,20,30]}'), print('r.b[0]'), print('r.b[2]')])).toBe('10\n30\n');
  });

  it('NV-4 admits a nested-array-literal field for .length but not composite element reads', () => {
    expect(runStdout([letBind('r', '{b: [[1,2],[3,4]]}'), print('r.b.length')])).toBe('2\n');
    abstains([letBind('r', '{b: [[1,2],[3,4]]}'), print('r.b[1]')]);
  });

  it('NV-5 out-of-range nested index abstains', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), print('r.b[9]')]);
  });

  it('NV-6 reads a float element from an array-literal record field', () => {
    expect(runStdout([letBind('r', '{b: [1.5, 2.5]}'), print('r.b[1]')])).toBe('2.5\n');
  });

  // Float/int fence (rule 1) — a floaty-lexeme literal with an INTEGER value
  // inside an array-field element must abstain at `let`, the same as it
  // would as a bare scalar literal: JS collapses `4.0` to `4` while the
  // Python leg keeps it a float and would print `"4.0"`.
  it('rejects an integer-valued float literal as an array-field element', () => {
    abstains([letBind('r', '{b: [4.0]}')]);
  });

  it('NV-7 reads a string element from an array-literal record field', () => {
    expect(runStdout([letBind('r', '{tags: ["x","y"]}'), print('r.tags[1]')])).toBe('y\n');
  });

  it('NV-8 preserves record rebinding for array-field records', () => {
    expect(runStdout([letBind('r', '{a: 1, b: [10,20,30]}'), letBind('s', 'r'), print('s.b[1]')])).toBe('20\n');
  });

  it('NV-9 resolves the receiver record, not any array field in scope', () => {
    expect(
      runStdout([
        letBind('r', '{a: 1, b: [10,20,30]}'),
        letBind('s', '{a: 1, b: [77,88,99]}'),
        print('s.b[2]'),
        print('r.b[2]'),
      ]),
    ).toBe('99\n30\n');
  });

  it('NV-10 keeps array .length distinct from a scalar field named length', () => {
    expect(runStdout([letBind('r', '{b: [10,20,30], length: 999}'), print('r.b.length'), print('r.length')])).toBe(
      '3\n999\n',
    );
  });

  it('NV-12 fresh values and fractional index abstain pin held-out behavior', () => {
    expect(
      runStdout([letBind('r', '{c: 42, b: ["left","right","tail"], z: true}'), print('r.b[2]'), print('r.c')]),
    ).toBe('tail\n42\n');
    abstains([letBind('r', '{b: [11,22,33]}'), print('r.b[1.5]')]);
  });

  it('NV-P1 and NV-P2 pin existing scalar field behavior', () => {
    expect(runStdout([letBind('r', '{a: 7}'), print('r.a')])).toBe('7\n');
    expect(runStdout([letBind('r', '{a: 3 + 4}'), print('r.a')])).toBe('7\n');
  });
});

describe('runner nested values — admitted single-use fresh array fields', () => {
  it('FV-1 captures a fresh array binding and reads .length', () => {
    expect(runStdout([letBind('xs', '[10,20,30]'), letBind('r', '{items: xs}'), print('r.items.length')])).toBe('3\n');
  });

  it('FV-2 captures a fresh array binding and reads literal indices', () => {
    expect(
      runStdout([letBind('xs', '[10,20,30]'), letBind('r', '{items: xs}'), print('r.items[0]'), print('r.items[2]')]),
    ).toBe('10\n30\n');
  });

  it('FV-3 captures two independent fresh arrays in one record', () => {
    expect(
      runStdout([
        letBind('xs', '[1,2]'),
        letBind('ys', '[3,4,5]'),
        letBind('r', '{left: xs, right: ys}'),
        print('r.left.length'),
        print('r.right[2]'),
      ]),
    ).toBe('2\n5\n');
  });

  it('FV-4 keeps scalar fields beside fresh array fields readable', () => {
    expect(
      runStdout([
        letBind('xs', '["a","b"]'),
        letBind('r', '{count: 2, tags: xs}'),
        print('r.count'),
        print('r.tags[1]'),
      ]),
    ).toBe('2\nb\n');
  });

  it('FV-5 admits nested fresh arrays for .length but not composite element reads', () => {
    expect(runStdout([letBind('xs', '[[1,2],[3,4]]'), letBind('r', '{items: xs}'), print('r.items.length')])).toBe(
      '2\n',
    );
    abstains([letBind('xs', '[[1,2],[3,4]]'), letBind('r', '{items: xs}'), print('r.items[1]')]);
  });

  it('FV-6 captures arrays created by expression-v1', () => {
    expect(runStdout([exprBind('xs', '[7,8,9]'), letBind('r', '{items: xs}'), print('r.items[1]')])).toBe('8\n');
  });

  it('FV-7 permits fresh arrays declared inside a repeatable loop body', () => {
    expect(
      runStdout([
        forLoop('i', '0', '2', [letBind('xs', '[1,2]'), letBind('r', '{items: xs}'), print('r.items.length')]),
      ]),
    ).toBe('2\n2\n');
  });

  it('FV-8 aliases a captured record-array field for reads', () => {
    expect(
      runStdout([
        letBind('xs', '[10,20,30]'),
        letBind('r', '{items: xs}'),
        letBind('ys', 'r.items'),
        print('ys.length'),
        print('ys[1]'),
      ]),
    ).toBe('3\n20\n');
  });

  it('FV-9 expression-v1 aliases a captured record-array field for reads', () => {
    expect(
      runStdout([letBind('xs', '[7,8,9]'), letBind('r', '{items: xs}'), exprBind('ys', 'r.items'), print('ys[2]')]),
    ).toBe('9\n');
  });

  it('FV-10 returns a record that captures a fresh array without precondition side effects', () => {
    const trace = referenceRunSequence(
      [letBind('xs', '[1,2]'), { type: 'return', props: { value: '{items: xs}' } }],
      makeEnv(),
    );
    expect(trace.completion.kind).toBe('return');
    expect((trace.completion as { value: { items: readonly unknown[] } }).value.items).toEqual([1, 2]);
  });

  it('FV-PUSH-1 preserves freshness across scalar pushes before capture', () => {
    expect(
      runStdout([
        letBind('xs', '[]'),
        doValue('xs.push(1)'),
        doValue('xs.push(2)'),
        letBind('r', '{children: xs}'),
        print('r.children.length'),
      ]),
    ).toBe('2\n');
  });
});

describe('runner nested values — first-class iteration over record array fields', () => {
  it('NI-1 iterates scalar elements from a captured fresh array field in order', () => {
    expect(
      runStdout([
        letBind('xs', '[1,2,3]'),
        letBind('r', '{children: xs}'),
        eachLoop('child', 'r.children', print('child')),
      ]),
    ).toBe('1\n2\n3\n');
  });

  it('NI-2 resolves the exact receiver record when iterating two record array fields', () => {
    expect(
      runStdout([
        letBind('xs', '[1,2]'),
        letBind('ys', '[7,8]'),
        letBind('r', '{children: xs}'),
        letBind('s', '{children: ys}'),
        eachLoop('child', 's.children', print('child')),
        eachLoop('child', 'r.children', print('child')),
      ]),
    ).toBe('7\n8\n1\n2\n');
  });

  it('NI-3 keeps expression-v1 record literals iterable in sync and async runners', async () => {
    const nodes = [exprBind('r', '{children: [4,5]}'), eachLoop('child', 'r.children', print('child'))];

    expect(runStdout(nodes)).toBe('4\n5\n');
    await expect(runStdoutAsync(nodes)).resolves.toBe('4\n5\n');
  });

  it('NI-R1 rejects missing, non-array, and unproven nested iteration receivers', () => {
    abstains([letBind('r', '{a: 1}'), eachLoop('child', 'r.children', print('child'))]);
    abstains([letBind('r', '{children: 1}'), eachLoop('child', 'r.children', print('child'))]);
    abstains([
      letBind('xs', '[1,2]'),
      letBind('r', '{children: xs}'),
      letBind('s', 'r'),
      eachLoop('child', 's.children', print('child')),
    ]);
    expectThrows(() =>
      referenceRunSequence(
        [eachLoop('child', 'r.children', print('child'))],
        makeEnv({ bindings: new Map<string, unknown>([['r', { children: [1, 2, 3] }]]) }),
      ),
    );
  });

  it('NI-R1b clears nested iteration proof when assignBinding overwrites a record binding', () => {
    const env = makeEnv();
    defineRecordBinding(env, 'r', { children: [1, 2, 3] }, new Set(['children']));
    expect(recordArrayFieldsForBinding(env, 'r')?.has('children')).toBe(true);

    assignBinding(env, 'r', 1);

    expect(recordArrayFieldsForBinding(env, 'r')).toBeUndefined();
    expectThrows(() => referenceRunSequence([eachLoop('child', 'r.children', print('child'))], env));
  });

  it('NI-R2 rejects composite elements and mutation during nested iteration', () => {
    abstains([letBind('r', '{children: [[1],[2]]}'), eachLoop('child', 'r.children', print('child'))]);
    abstains([
      letBind('xs', '[1,2]'),
      letBind('r', '{children: xs}'),
      eachLoop('child', 'r.children', doValue('r.children.push(3)')),
    ]);
  });

  it('NI-A1 keeps async runner nested iteration in lockstep with sync runner', async () => {
    const admitted = [
      letBind('xs', '[1,2,3]'),
      letBind('r', '{children: xs}'),
      eachLoop('child', 'r.children', print('child')),
    ];
    expect(await runStdoutAsync(admitted)).toBe(runStdout(admitted));

    const directRead = [letBind('xs', '[4,5]'), letBind('r', '{children: xs}'), print('r.children.length')];
    expect(await runStdoutAsync(directRead)).toBe(runStdout(directRead));

    const unproven = [
      letBind('xs', '[1,2]'),
      letBind('r', '{children: xs}'),
      letBind('s', 'r'),
      eachLoop('child', 's.children', print('child')),
    ];
    abstains(unproven);
    await expectAsyncThrows(() => asyncReferenceRunSequence(unproven, makeEnv(), {}));
  });
});

describe('runner nested values — rejected surface stays abstaining', () => {
  it('FV-R1 rejects stale variable-sourced array fields', () => {
    abstains([letBind('xs', '[1,2]'), doValue('xs.push(3)'), letBind('r', '{a: xs}')]);
  });

  it('FV-R2 rejects aliases created before capture because freshness is single-owner', () => {
    abstains([letBind('xs', '[1,2]'), letBind('ys', 'xs'), letBind('r', '{a: ys}')]);
  });

  it('FV-R3 rejects expression-v1 aliases created before capture because freshness is single-owner', () => {
    abstains([letBind('xs', '[1,2]'), exprBind('ys', 'xs'), letBind('r', '{a: ys}')]);
  });

  it('FV-R4 rejects mutation through the original binding after capture', () => {
    abstains([letBind('xs', '[1,2]'), letBind('r', '{a: xs}'), doValue('xs.push(3)')]);
  });

  it('FV-R5 rejects mutation through an alias of a captured record-array field', () => {
    abstains([letBind('xs', '[1,2]'), letBind('r', '{a: xs}'), letBind('ys', 'r.a'), doValue('ys.push(3)')]);
  });

  it('FV-R6 rejects mutation through a direct alias of a captured array binding', () => {
    abstains([letBind('xs', '[1,2]'), letBind('r', '{a: xs}'), letBind('ys', 'xs'), doValue('ys.push(3)')]);
  });

  it('FV-R7 rejects capturing the same fresh array twice', () => {
    abstains([letBind('xs', '[1,2]'), letBind('r', '{a: xs}'), letBind('s', '{b: xs}')]);
  });

  it('FV-R8 rejects duplicate fresh-array fields inside one record literal', () => {
    abstains([letBind('xs', '[1,2]'), letBind('r', '{a: xs, b: xs}')]);
  });

  it('FV-R9 rejects recapturing an existing record array field', () => {
    abstains([letBind('xs', '[1,2]'), letBind('r', '{a: xs}'), letBind('s', '{b: r.a}')]);
  });

  it('FV-R10 rejects capturing an outer fresh array inside a repeatable loop body', () => {
    abstains([letBind('xs', '[1,2]'), forLoop('i', '0', '2', letBind('r', '{a: xs}'))]);
  });

  it('FV-PUSH-R1 rejects capture after pushing a composite element', () => {
    abstains([letBind('xs', '[]'), doValue('xs.push([1])'), letBind('r', '{children: xs}')]);
  });

  it('FV-PUSH-R2 rejects capture after pushing through an alias', () => {
    abstains([letBind('xs', '[]'), letBind('ys', 'xs'), doValue('ys.push(1)'), letBind('r', '{children: xs}')]);
  });

  it('FV-PUSH-R3 rejects integer-valued float elements like array literals do', () => {
    abstains([letBind('xs', '[]'), doValue('xs.push(4.0)'), letBind('r', '{children: xs}')]);
  });

  describe('FV-PUSH-A1 async runner lockstep', () => {
    it('admits push-built capture identically in sync and async sequence runners', async () => {
      const nodes = [
        letBind('xs', '[]'),
        doValue('xs.push(1)'),
        doValue('xs.push(2)'),
        letBind('r', '{children: xs}'),
        print('r.children.length'),
      ];
      expect(runStdout(nodes)).toBe('2\n');
      await expect(runStdoutAsync(nodes)).resolves.toBe('2\n');
    });

    it('rejects composite push before capture in both sync and async sequence runners', async () => {
      const nodes = [letBind('xs', '[]'), doValue('xs.push([1])'), letBind('r', '{children: xs}')];
      abstains(nodes);
      await expectAsyncThrows(() => asyncReferenceRunSequence(nodes, makeEnv(), {}));
    });
  });

  it('NV-R2 rejects record-in-record fields', () => {
    abstains([letBind('r', '{a: {b: 1}}')]);
  });

  it('NV-R3 and NV-R17 reject composite equality', () => {
    abstains([letBind('r', '{a: 1, b: [10]}'), letBind('s', '{a: 1, b: [10]}'), print('r == s')]);
    abstains([letBind('r', '{b: [10,20,30]}'), print('r.b == [10,20,30]')]);
  });

  it('NV-R4 rejects provenanced counter indices on the nested path', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), forLoop('i', '0', '2', print('r.b[i]'))]);
  });

  it('NV-R5 rejects nested mutation', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), doValue('r.b.push(4)')]);
  });

  it('NV-R6 rejects record values in Map.set', () => {
    abstains([letBind('m', 'Map.new()'), letBind('r', '{b: [10]}'), doValue('Map.set(m, "k", r)')]);
  });

  it('NV-R7 rejects composite print', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), print('r.b')]);
  });

  it('NV-R8 leaves for-loop bounds on nested length outside this slice', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), forLoop('k', '0', 'r.b.length', print('k'))]);
  });

  it('NV-R9 rejects plain let indices on the nested path', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), letBind('idx', '0'), print('r.b[idx]')]);
  });

  it('NV-R10 rejects every non-safe-literal nested index form', () => {
    for (const index of ['-1', '1.5', '"0"', '1 + 1']) {
      abstains([letBind('r', '{b: [10,20,30]}'), print(`r.b[${index}]`)]);
    }
  });

  it('NV-R11 rejects index equal to length', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), print('r.b[3]')]);
  });

  it('NV-R12 rejects chained depth beyond ident.field', () => {
    abstains([letBind('r', '{b: [[1,2,3],[4,5]]}'), print('r.b[0][0]')]);
    abstains([letBind('r', '{b: [[1,2,3],[4,5]]}'), print('r.b[0].length')]);
  });

  it('NV-R13 rejects record elements inside array fields', () => {
    abstains([letBind('r', '{b: [{x:1},{x:2}]}')]);
  });

  it('NV-R14 rejects .length on scalar record fields', () => {
    abstains([letBind('r', '{name: "abcde"}'), print('r.name.length')]);
  });

  it('NV-R15 rejects nested assign targets', () => {
    abstains([letBind('r', '{b: [10,20,30]}', 'let'), assign('r.b[0]', '99')]);
  });

  // Delta review (record reassignment): `assign` requires a SCALAR current
  // binding, so reassigning a record binding to a new record literal abstains
  // in the runner — the codegen legs stay lockstep for it (stmt NV-A1).
  it('rejects whole-record reassignment', () => {
    abstains([letBind('r', '{a: 1}', 'let'), assign('r', '{a: 2}')]);
  });

  it('NV-R16 rejects non-bare receiver shapes and computed field access', () => {
    abstains([letBind('r', '{b: [10,20,30]}'), print('(r).b[0]')]);
    abstains([letBind('r', '{b: [10,20,30]}'), print('(r).b.length')]);
    abstains([letBind('r', '{b: [10,20,30]}'), print('r?.b.length')]);
    abstains([letBind('r', '{b: [10,20,30]}'), print('r["b"][0]')]);
  });

  it('NV-R18 rejects missing nested and scalar fields without host crashes', () => {
    abstains([letBind('r', '{a: 1}'), print('r.b.length')]);
    abstains([letBind('r', '{a: 1}'), print('r.zzz')]);
  });
});

describe('runner nested values — async portable scalar delegates the same member/index fence', () => {
  it('reads nested length and literal index through evalPortableValueAsync', async () => {
    const env = makeEnv({ bindings: new Map<string, unknown>([['r', { b: [10, 20, 30] }]]) });
    const options = { runFunctionBody: async () => ({ events: [] }) };
    await expect(evalPortableValueAsync(parseExpression('r.b.length'), env, options)).resolves.toBe(3);
    await expect(evalPortableValueAsync(parseExpression('r.b[2]'), env, options)).resolves.toBe(30);
  });

  it('rejects plain-let nested indices through the sync delegate path', async () => {
    const env = makeEnv({
      bindings: new Map<string, unknown>([
        ['r', { b: [10, 20, 30] }],
        ['idx', 0],
      ]),
    });
    await expect(
      evalPortableValueAsync(parseExpression('r.b[idx]'), env, { runFunctionBody: async () => ({ events: [] }) }),
    ).rejects.toThrow(/literal/);
  });

  it('direct eval keeps two-level receiver exact', () => {
    const env = makeEnv({
      bindings: new Map<string, unknown>([
        [
          'r',
          {
            b: [
              [1, 2],
              [3, 4],
            ],
          },
        ],
      ]),
    });
    expect(evalPortableValue(parseExpression('r.b.length'), env)).toBe(2);
    expect(() => evalPortableValue(parseExpression('r.b[0].length'), env)).toThrow(/portable/);
  });
});
