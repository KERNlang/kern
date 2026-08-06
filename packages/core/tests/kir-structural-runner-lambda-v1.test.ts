import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import type { CanonicalValue, CanonicalValueLimits } from '../src/canonical-value/types.js';
import { decodeStructuralKir, encodeStructuralKir } from '../src/kir-structural/canonical.js';
import { inflateStructuralKirNode } from '../src/kir-structural/runtime-inflate.js';
import { StructuralKirError } from '../src/kir-structural/types.js';
import { parseWithDiagnostics } from '../src/parser.js';
import { KERN_RESERVED, NODE_TYPES } from '../src/spec.js';
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

function lambdaNode(expr = 'List.map([1,2,3], x => x * 2)'): IRNode {
  return { type: 'lambda', props: { expr } };
}

function handlerWithLambda(lambda = lambdaNode()): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children: [lambda] };
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

function field(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const result = value.value.find((entry) => entry.key === key)?.value;
  if (!result) throw new Error(`missing ${key}`);
  return result;
}

function lambdaArtifactNode(value: CanonicalValue): CanonicalValue {
  const children = field(field(value, 'root'), 'children');
  if (children.tag !== 'list' || !children.value[0]) throw new Error('expected synthetic lambda child');
  return children.value[0];
}

describe('runner-synthetic lambda structural admission', () => {
  test('round-trips the direct runner wrapper without widening source syntax', () => {
    const input = handlerWithLambda();
    const bytes = encodeStructuralKir(input, limits);
    const artifact = decodeStructuralKir(bytes, limits);
    expect(artifact.format).toBe('kern.kir.structural.r1.5i.1-alpha');
    expect(artifact.constitution).toBe('kern.kir.structural.r1.5i.1');
    const lambda = artifact.root.children[0];
    expect(lambda?.kind).toBe('lambda');
    expect(lambda?.children).toEqual([]);
    expect(lambda?.properties.map(({ key }) => key)).toEqual(['expr']);
    expect(lambda?.properties[0]?.value).toMatchObject({ tag: 'record' });

    const inflated = inflateStructuralKirNode(artifact.root);
    const inflatedLambda = inflated.children?.[0];
    expect(inflatedLambda?.type).toBe('lambda');
    expect(inflatedLambda?.children).toBeUndefined();
    expect(typeof inflatedLambda?.props?.expr).toBe('string');
    expect(encodeStructuralKir(inflated, limits)).toEqual(bytes);

    expect(NODE_TYPES).not.toContain('lambda');
    expect(KERN_RESERVED.has('lambda')).toBe(false);
    expect(parseWithDiagnostics('lambda expr="List.map([1,2,3], x => x * 2)"').diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNKNOWN_NODE_TYPE' })]),
    );
  });

  test('rejects missing expressions, setup children, and non-portable lambdas', () => {
    expectStructuralCode(() => encodeStructuralKir(lambdaNode(), limits), 'invalid-child');
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'fn', props: { name: 'answer' }, children: [lambdaNode()] }, limits),
      'invalid-child',
    );
    expectStructuralCode(() => encodeStructuralKir(handlerWithLambda({ type: 'lambda' }), limits), 'missing-property');
    expectStructuralCode(
      () =>
        encodeStructuralKir(
          handlerWithLambda({
            ...lambdaNode(),
            children: [{ type: 'let', props: { name: 'value', value: '1' } }],
          }),
          limits,
        ),
      'invalid-child',
    );
    expectStructuralCode(
      () => encodeStructuralKir(handlerWithLambda(lambdaNode('(x: number) => x')), limits),
      'invalid-expression',
    );
    expectStructuralCode(
      () => encodeStructuralKir(handlerWithLambda(lambdaNode('x => { return x }')), limits),
      'invalid-expression',
    );
  });

  test('reader rejects predecessor bytes and hostile synthetic records', () => {
    const encoded = encodeStructuralKir(handlerWithLambda(), limits);
    const mutations: Array<[StructuralKirError['code'], (value: CanonicalValue) => void]> = [
      [
        'unsupported-version',
        (value) => {
          const format = field(value, 'format');
          if (format.tag !== 'text') throw new Error('expected format');
          format.value = 'kern.kir.structural.r1.5h.1-alpha';
        },
      ],
      [
        'missing-property',
        (value) => {
          const properties = field(lambdaArtifactNode(value), 'properties');
          if (properties.tag !== 'record') throw new Error('expected lambda properties');
          properties.value.splice(0, 1);
        },
      ],
      [
        'unknown-property',
        (value) => {
          const properties = field(lambdaArtifactNode(value), 'properties');
          if (properties.tag !== 'record') throw new Error('expected lambda properties');
          properties.value.push({ key: 'unknown', value: { tag: 'null' } });
        },
      ],
      [
        'invalid-expression',
        (value) => {
          const properties = field(lambdaArtifactNode(value), 'properties');
          if (properties.tag !== 'record' || !properties.value[0]) throw new Error('expected lambda expression');
          properties.value[0].value = { tag: 'text', value: 'List.map([1,2,3], x => x * 2)' };
        },
      ],
    ];
    for (const [code, mutate] of mutations) {
      const value = structuredClone(decodeCanonicalValue(encoded, limits));
      mutate(value);
      expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), code);
    }
  });
});
