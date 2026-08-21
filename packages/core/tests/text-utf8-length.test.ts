import { readFileSync } from 'node:fs';
import {
  makeEnv,
  KERN_VERSION,
  ReferenceRunnerError,
  referenceRunSequence,
  registerAllContracts,
} from '../src/index.js';
import { assertPortableMachineScalarShape } from '../src/ir/semantics/portable-machine-shape.js';
import { evalPortableValue } from '../src/ir/semantics/portable-machine-evaluator.js';
import { executeKernSource, KernRunnerError } from '../src/runner.js';
import { parseExpression } from '../src/parser-expression.js';
import type { IRNode } from '../src/types.js';

beforeAll(() => {
  registerAllContracts();
});

function evaluate(source: string, bindings: ReadonlyMap<string, unknown> = new Map()): unknown {
  const env = makeEnv();
  for (const [name, value] of bindings) env.bindings.set(name, value);
  return evalPortableValue(parseExpression(source), env);
}

function print(value: string): IRNode {
  return { type: 'print', props: { value } };
}

function runReference(expressions: string[]): string {
  const trace = referenceRunSequence(expressions.map(print), makeEnv());
  return trace.events
    .filter((event): event is { op: 'stdout'; text: string } => event.op === 'stdout')
    .map((event) => `${event.text}\n`)
    .join('');
}

function mainProgram(expression: string): string {
  return [
    'fn name=main returns=void',
    '  handler lang="kern"',
    `    print value="${expression.replaceAll('"', '\\"')}"`,
  ].join('\n');
}

const WIDTH_CASES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 1],
  [0x007f, 1],
  [0x0080, 2],
  [0x07ff, 2],
  [0x0800, 3],
  [0xffff, 3],
  [0x10000, 4],
  [0x1f30d, 4],
];

const MALFORMED_SOURCES = [
  '"\\uD800"',
  '"\\uDC00"',
  '"\\uDC00\\uD800"',
  '"\\uD800\\uD800"',
  '"\\uDC00\\uDC00"',
] as const;

describe('Text.utf8Length — portable machine admission and values', () => {
  test('ships as the additive KERN 4.6.0 language surface', () => {
    const rootPackage = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const corePackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(rootPackage.version).toBe('4.6.0');
    expect(corePackage.version).toBe('4.6.0');
    expect(KERN_VERSION).toBe('4.6.0');
  });

  test('structural admission accepts exactly the unshadowed one-argument call', () => {
    expect(() => assertPortableMachineScalarShape(parseExpression('Text.utf8Length("x")'), makeEnv())).not.toThrow();
    expect(() => assertPortableMachineScalarShape(parseExpression('Text.utf8Length()'), makeEnv())).toThrow(
      /Text call/u,
    );
    expect(() =>
      assertPortableMachineScalarShape(
        parseExpression('Text.utf8Length("x")'),
        Object.assign(makeEnv(), { bindings: new Map([['Text', 1]]) }),
      ),
    ).toThrow(/Text call|namespace call/u);
  });

  test('counts the frozen mixed fixture and every scalar-width boundary', () => {
    expect(evaluate('Text.utf8Length("A¢€🌍")')).toBe(10);
    expect(evaluate('Text.utf8Length("")')).toBe(0);
    for (const [scalar, expected] of WIDTH_CASES) {
      expect(evaluate(`Text.utf8Length(KernInternal.textFromScalar(${scalar}))`)).toBe(expected);
    }
  });

  test('rejects wrong arity, non-string receivers, and a shadowed Text binding', () => {
    expect(() => evaluate('Text.utf8Length()')).toThrow(
      'portable: Text.utf8Length expects exactly 1 argument',
    );
    expect(() => evaluate('Text.utf8Length("x", "y")')).toThrow(
      'portable: Text.utf8Length expects exactly 1 argument',
    );
    expect(() => evaluate('Text.utf8Length(1)')).toThrow(
      'portable: Text.utf8Length requires a string',
    );
    expect(() => evaluate('Text.utf8Length("x")', new Map([['Text', 1]]))).toThrow();
  });

  test.each(MALFORMED_SOURCES)('fails closed on constructible malformed text %s', (source) => {
    expect(() => evaluate(`Text.utf8Length(${source})`)).toThrow(/malformed.*UTF-16/u);
  });
});

describe('Text.utf8Length — ReferenceRunner and public runner', () => {
  test('ReferenceRunner agrees on the mixed fixture and boundary widths', () => {
    const expressions = [
      'Text.utf8Length("A¢€🌍")',
      ...WIDTH_CASES.map(([scalar]) => `Text.utf8Length(KernInternal.textFromScalar(${scalar}))`),
    ];
    expect(runReference(expressions)).toBe('10\n1\n1\n2\n2\n3\n3\n4\n4\n');
  });

  test('ReferenceRunner preserves arity, receiver, and namespace-shadowing fences', () => {
    expect(() => runReference(['Text.utf8Length()'])).toThrow(ReferenceRunnerError);
    expect(() => runReference(['Text.utf8Length("x", "y")'])).toThrow(ReferenceRunnerError);
    expect(() => runReference(['Text.utf8Length(1)'])).toThrow(ReferenceRunnerError);
    expect(() =>
      referenceRunSequence(
        [
          { type: 'let', props: { name: 'Text', value: '1' } },
          print('Text.utf8Length("x")'),
        ],
        makeEnv(),
      ),
    ).toThrow(ReferenceRunnerError);
  });

  test.each(MALFORMED_SOURCES)('ReferenceRunner fails closed on malformed text %s', (source) => {
    expect(() => runReference([`Text.utf8Length(${source})`])).toThrow(ReferenceRunnerError);
  });

  test('CLI-facing execution admits the public operation and retains fail-closed text', () => {
    expect(executeKernSource(mainProgram('Text.utf8Length("A¢€🌍")'))).toBe('10\n');
    expect(() => executeKernSource(mainProgram('Text.utf8Length("\\uD800")'))).toThrow(KernRunnerError);
  });
});
