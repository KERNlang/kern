import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import type { CanonicalValue, CanonicalValueLimits } from '../src/canonical-value/types.js';
import { decodeStructuralKir, encodeStructuralKir } from '../src/kir-structural/canonical.js';
import { StructuralKirError } from '../src/kir-structural/types.js';
import type { IRNode } from '../src/types.js';

const limits: CanonicalValueLimits = {
  maxBytes: 262_144,
  maxDepth: 64,
  maxNodes: 2_048,
  maxStringBytes: 8_192,
  maxCollectionLength: 512,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};

function letNode(value: string): IRNode {
  return { type: 'let', props: { name: 'result', value: { __expr: true, code: value } } };
}

function expectStructuralCode(action: () => unknown, code: StructuralKirError['code']): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StructuralKirError);
    expect((error as StructuralKirError).code).toBe(code);
  }
}

function recordField(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const result = value.value.find((entry) => entry.key === key)?.value;
  if (result === undefined) throw new Error(`missing record field ${key}`);
  return result;
}

function expressionValue(source: string): CanonicalValue {
  const artifact = decodeStructuralKir(encodeStructuralKir(letNode(source), limits), limits);
  const value = artifact.root.properties.find((entry) => entry.key === 'value')?.value;
  if (value === undefined) throw new Error('missing expression value');
  return value;
}

function mutateEncodedExpression(source: string, mutate: (expression: CanonicalValue) => void): Uint8Array {
  const value = structuredClone(decodeCanonicalValue(encodeStructuralKir(letNode(source), limits), limits));
  const root = recordField(value, 'root');
  const properties = recordField(root, 'properties');
  const expression = recordField(properties, 'value');
  mutate(expression);
  return encodeCanonicalValue(value, limits);
}

describe('bounded structural new-expression contract', () => {
  test('projects exact Map and Error constructors to canonical new records', () => {
    expect(expressionValue('new Map()')).toEqual({
      tag: 'record',
      value: [
        {
          key: 'fields',
          value: {
            tag: 'record',
            value: [
              { key: 'args', value: { tag: 'list', value: [] } },
              { key: 'constructor', value: { tag: 'text', value: 'Map' } },
            ],
          },
        },
        { key: 'kind', value: { tag: 'text', value: 'new' } },
      ],
    });
    expect(expressionValue('new Error(message)')).toEqual({
      tag: 'record',
      value: [
        {
          key: 'fields',
          value: {
            tag: 'record',
            value: [
              {
                key: 'args',
                value: {
                  tag: 'list',
                  value: [
                    {
                      tag: 'record',
                      value: [
                        {
                          key: 'fields',
                          value: {
                            tag: 'record',
                            value: [{ key: 'name', value: { tag: 'text', value: 'message' } }],
                          },
                        },
                        { key: 'kind', value: { tag: 'text', value: 'identifier' } },
                      ],
                    },
                  ],
                },
              },
              { key: 'constructor', value: { tag: 'text', value: 'Error' } },
            ],
          },
        },
        { key: 'kind', value: { tag: 'text', value: 'new' } },
      ],
    });
  });

  test.each([
    'new User()',
    'new Namespace.Error("x")',
    'new Errors[0]("x")',
    'new Error<string>("x")',
    'new Error?.("x")',
    'new Map("x")',
    'new Error()',
    'new Error("x", "y")',
    'new Error(...messages)',
  ])('writer rejects unsupported constructor shape: %s', (source) => {
    expectStructuralCode(() => encodeStructuralKir(letNode(source), limits), 'invalid-expression');
  });

  test('reader rejects constructor, arity, tag, and field mutations', () => {
    const mutations: Array<(expression: CanonicalValue) => void> = [
      (expression) => {
        const fields = recordField(expression, 'fields');
        const constructorField = recordField(fields, 'constructor');
        if (constructorField.tag !== 'text') throw new Error('expected constructor text');
        constructorField.value = 'User';
      },
      (expression) => {
        const fields = recordField(expression, 'fields');
        const args = recordField(fields, 'args');
        if (args.tag !== 'list') throw new Error('expected args list');
        args.value.push(expressionValue('"x"'));
      },
      (expression) => {
        const fields = recordField(expression, 'fields');
        const args = recordField(fields, 'args');
        if (args.tag !== 'list') throw new Error('expected args list');
        const entry = fields.value.find((field) => field.key === 'args');
        if (entry === undefined) throw new Error('missing args');
        entry.value = { tag: 'text', value: 'not-a-list' };
      },
      (expression) => {
        const fields = recordField(expression, 'fields');
        if (fields.tag !== 'record') throw new Error('expected fields record');
        fields.value.push({ key: 'future', value: { tag: 'null' } });
        fields.value.sort((left, right) => left.key.localeCompare(right.key));
      },
      (expression) => {
        const fields = recordField(expression, 'fields');
        if (fields.tag !== 'record') throw new Error('expected fields record');
        fields.value = fields.value.filter(({ key }) => key !== 'constructor');
      },
      (expression) => {
        const fields = recordField(expression, 'fields');
        if (fields.tag !== 'record') throw new Error('expected fields record');
        const entry = fields.value.find(({ key }) => key === 'constructor');
        if (entry === undefined) throw new Error('missing constructor');
        entry.value = { tag: 'bool', value: false };
      },
    ];
    for (const mutate of mutations) {
      expectStructuralCode(
        () => decodeStructuralKir(mutateEncodedExpression('new Map()', mutate), limits),
        'invalid-expression',
      );
    }
    expectStructuralCode(
      () =>
        decodeStructuralKir(
          mutateEncodedExpression('new Error("x")', (expression) => {
            const fields = recordField(expression, 'fields');
            const args = recordField(fields, 'args');
            if (args.tag !== 'list' || args.value.length !== 1) {
              throw new Error('expected one Error argument');
            }
            const kind = recordField(args.value[0], 'kind');
            if (kind.tag !== 'text') throw new Error('expected expression kind');
            kind.value = 'future';
          }),
          limits,
        ),
      'unknown-expression-kind',
    );
  });

  test('writer and reader preserve canonical bytes across both constructors', () => {
    for (const source of ['new Map()', 'new Error("KERN_CANONICALIZER_PROFILE")']) {
      const bytes = encodeStructuralKir(letNode(source), limits);
      expect(decodeStructuralKir(bytes, limits)).toBeDefined();
      expect(encodeCanonicalValue(decodeCanonicalValue(bytes, limits), limits)).toEqual(bytes);
    }
  });
});
