import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import type { CanonicalValue, CanonicalValueLimits } from '../src/canonical-value/types.js';
import { decodeStructuralKir, encodeStructuralKir } from '../src/kir-structural/canonical.js';
import { inflateStructuralKirNode } from '../src/kir-structural/runtime-inflate.js';
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

function expressionNode(expr: unknown = '1 + 6'): IRNode {
  return { type: 'expression-v1', props: { expr, name: 'answer' } };
}

function field(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const result = value.value.find((entry) => entry.key === key)?.value;
  if (!result) throw new Error(`missing ${key}`);
  return result;
}

function expressionProperty(value: CanonicalValue): CanonicalValue {
  return field(field(field(value, 'root'), 'properties'), 'expr');
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

function integer(value: string): CanonicalValue {
  return {
    tag: 'record',
    value: [
      {
        key: 'fields',
        value: { tag: 'record', value: [{ key: 'value', value: { tag: 'int', value } }] },
      },
      { key: 'kind', value: { tag: 'text', value: 'integer' } },
    ],
  };
}

const exactBinary: CanonicalValue = {
  tag: 'record',
  value: [
    {
      key: 'fields',
      value: {
        tag: 'record',
        value: [
          { key: 'left', value: integer('1') },
          { key: 'op', value: { tag: 'text', value: '+' } },
          { key: 'right', value: integer('6') },
        ],
      },
    },
    { key: 'kind', value: { tag: 'text', value: 'binary' } },
  ],
};

describe('expression-v1 structural constitution admission', () => {
  test('round-trips an exact binary expression and inflates it without precedence drift', () => {
    const bytes = encodeStructuralKir(expressionNode(), limits);
    const artifact = decodeStructuralKir(bytes, limits);
    expect(artifact.format).toBe('kern.kir.structural.r1.5h.1-alpha');
    expect(artifact.constitution).toBe('kern.kir.structural.r1.5h.1');
    expect(artifact.root.properties.find((entry) => entry.key === 'expr')?.value).toEqual(exactBinary);
    expect(inflateStructuralKirNode(artifact.root)).toEqual({
      type: 'expression-v1',
      props: { expr: '(1 + 6)', name: 'answer' },
    });
    expect(encodeStructuralKir(inflateStructuralKirNode(artifact.root), limits)).toEqual(bytes);
  });

  test('keeps optional type and a remaining required raw expression excluded', () => {
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'expression-v1', props: { name: 'answer' } }, limits),
      'missing-property',
    );
    expectStructuralCode(
      () =>
        encodeStructuralKir({ type: 'expression-v1', props: { expr: '1', name: 'answer', type: 'number' } }, limits),
      'excluded-host-payload',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'metric', props: { label: 'answer', value: '1' } }, limits),
      'excluded-host-payload',
    );
  });

  test.each([
    ['', 'invalid-expression'],
    ['/a/g', 'unknown-expression-kind'],
    ['await answer', 'unknown-expression-kind'],
  ] as const)('rejects expression source outside the closed codec: %s', (source, code) => {
    expectStructuralCode(() => encodeStructuralKir(expressionNode(source), limits), code);
  });

  test('reader rejects raw, missing, decorated, and unknown expression records', () => {
    const encoded = encodeStructuralKir(expressionNode(), limits);
    const mutations: Array<[StructuralKirError['code'], (value: CanonicalValue) => void]> = [
      [
        'invalid-expression',
        (value) => {
          const root = field(value, 'root');
          const properties = field(root, 'properties');
          if (properties.tag !== 'record') throw new Error('expected properties');
          const expr = properties.value.find((entry) => entry.key === 'expr');
          if (!expr) throw new Error('expected expr');
          expr.value = { tag: 'text', value: '1 + 6' };
        },
      ],
      [
        'invalid-expression',
        (value) => {
          const expr = expressionProperty(value);
          if (expr.tag !== 'record') throw new Error('expected expression');
          expr.value.splice(0, 1);
        },
      ],
      [
        'invalid-expression',
        (value) => {
          const expr = expressionProperty(value);
          if (expr.tag !== 'record') throw new Error('expected expression');
          expr.value.push({ key: 'unknown', value: { tag: 'null' } });
        },
      ],
      [
        'unknown-expression-kind',
        (value) => {
          const kind = field(expressionProperty(value), 'kind');
          if (kind.tag !== 'text') throw new Error('expected kind');
          kind.value = 'host-expression';
        },
      ],
    ];
    for (const [code, mutate] of mutations) {
      const value = structuredClone(decodeCanonicalValue(encoded, limits));
      mutate(value);
      expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), code);
    }
  });

  test('reader rejects the predecessor artifact format without fallback', () => {
    const value = structuredClone(decodeCanonicalValue(encodeStructuralKir(expressionNode(), limits), limits));
    const format = field(value, 'format');
    if (format.tag !== 'text') throw new Error('expected format');
    format.value = 'kern.kir.structural.r1.5g.1-alpha';
    expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), 'unsupported-version');
  });
});
