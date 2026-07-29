import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import {
  type CanonicalValue,
  CanonicalValueDecodeError,
  type CanonicalValueLimits,
} from '../src/canonical-value/types.js';
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

function root(children: IRNode[] = []): IRNode {
  return { type: 'screen', props: { name: 'Home', export: 'public' }, children };
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

function expectCanonicalCode(action: () => unknown, code: CanonicalValueDecodeError['code']): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalValueDecodeError);
    expect((error as CanonicalValueDecodeError).code).toBe(code);
  }
}

function expressionKind(source: string): string {
  const artifact = decodeStructuralKir(encodeStructuralKir(letNode(source), limits), limits);
  const value = artifact.root.properties.find((entry) => entry.key === 'value')?.value;
  if (value?.tag !== 'record') throw new Error('missing expression record');
  const kind = value.value.find((entry) => entry.key === 'kind')?.value;
  if (kind?.tag !== 'text') throw new Error('missing expression kind');
  return kind.value;
}

function recordField(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const result = value.value.find((entry) => entry.key === key)?.value;
  if (result === undefined) throw new Error(`missing record field ${key}`);
  return result;
}

describe('internal structural KIR writer and bounded reader', () => {
  test('round-trips canonical bytes while sorting properties and preserving child order', () => {
    const input = root([letNode('a + 1'), { type: 'return', props: { value: 'result' } }]);
    const reordered: IRNode = {
      children: input.children,
      props: { export: 'public', name: 'Home' },
      type: 'screen',
    };
    const bytes = encodeStructuralKir(input, limits);
    expect(encodeStructuralKir(reordered, limits)).toEqual(bytes);
    const artifact = decodeStructuralKir(bytes, limits);
    expect(encodeCanonicalValue(decodeCanonicalValue(bytes, limits), limits)).toEqual(bytes);
    expect(artifact.format).toBe('kern.kir.structural.r1.5e.1-alpha');
    expect(artifact.constitution).toBe('kern.kir.structural.r1.5e.1');
    expect(artifact.proofLabel).toBe('ALPHA-NO-GO');
    expect(artifact.typeCatalog.admittedKinds).toEqual(['boolean', 'integer', 'list', 'text', 'void']);
    expect(artifact.root.properties.map((entry) => entry.key)).toEqual(['export', 'name']);
    expect(artifact.root.children.map((child) => child.kind)).toEqual(['let', 'return']);
  });

  test.each([
    ['x', 'identifier'],
    ['null', 'null'],
    ['true', 'boolean'],
    ['42', 'integer'],
    ['1.25', 'decimal'],
    ['"hi"', 'text'],
    ['[x, 1]', 'list'],
    ['{ x: 1 }', 'record'],
    ['user.name', 'member'],
    ['users[0]', 'index'],
    ['run(1)', 'call'],
    ['x => x + 1', 'lambda'],
    ['a + b', 'binary'],
    ['!ready', 'unary'],
    ['a ? b : c', 'conditional'],
  ])('lowers expression %s to closed kind %s', (source, kind) => {
    expect(expressionKind(source)).toBe(kind);
  });

  test.each([
    ['/a/g', 'unknown-expression-kind'],
    ['`hello`', 'unknown-expression-kind'],
    ['undefined', 'unknown-expression-kind'],
    ['-0', 'invalid-expression'],
    ['(-0)', 'invalid-expression'],
    ['-0.0', 'invalid-expression'],
    ['-(0)', 'invalid-expression'],
    ['- 0', 'invalid-expression'],
    ['[...items]', 'unknown-expression-kind'],
    ['await value', 'unknown-expression-kind'],
    ['new User()', 'invalid-expression'],
    ['x as User', 'unknown-expression-kind'],
  ] as const)('rejects expression outside the closed catalog: %s', (source, code) =>
    expectStructuralCode(() => encodeStructuralKir(letNode(source), limits), code),
  );

  test('lowers exact structured runtime-handler types into semantic KIR', () => {
    const artifact = decodeStructuralKir(
      encodeStructuralKir(
        {
          type: 'fn',
          props: { name: 'answer', returns: 'string[]' },
          children: [{ type: 'param', props: { name: 'question', type: 'string' } }],
        },
        limits,
      ),
      limits,
    );
    const returns = artifact.root.properties.find((entry) => entry.key === 'returns')?.value;
    const parameterType = artifact.root.children[0]?.properties.find((entry) => entry.key === 'type')?.value;
    expect(returns).toEqual({
      tag: 'record',
      value: [
        { key: 'element', value: { tag: 'text', value: 'text' } },
        { key: 'kind', value: { tag: 'text', value: 'list' } },
      ],
    });
    expect(parameterType).toEqual({
      tag: 'record',
      value: [{ key: 'kind', value: { tag: 'text', value: 'text' } }],
    });
  });

  test.each([
    ['string', 'text'],
    ['number', 'integer'],
    ['boolean', 'boolean'],
  ])('lowers scalar handler type %s to %s in parameter and return positions', (annotation, kind) => {
    const artifact = decodeStructuralKir(
      encodeStructuralKir(
        {
          type: 'fn',
          props: { name: 'f', returns: annotation },
          children: [{ type: 'param', props: { name: 'value', type: annotation } }],
        },
        limits,
      ),
      limits,
    );
    const expected = { tag: 'record', value: [{ key: 'kind', value: { tag: 'text', value: kind } }] };
    expect(artifact.root.properties.find((entry) => entry.key === 'returns')?.value).toEqual(expected);
    expect(artifact.root.children[0]?.properties.find((entry) => entry.key === 'type')?.value).toEqual(expected);
  });

  test.each([
    ['string[]', 'text'],
    ['number[]', 'integer'],
    ['boolean[]', 'boolean'],
  ])('lowers list handler type %s with semantic element %s', (annotation, element) => {
    const artifact = decodeStructuralKir(
      encodeStructuralKir({ type: 'fn', props: { name: 'f', returns: annotation } }, limits),
      limits,
    );
    expect(artifact.root.properties.find((entry) => entry.key === 'returns')?.value).toEqual({
      tag: 'record',
      value: [
        { key: 'element', value: { tag: 'text', value: element } },
        { key: 'kind', value: { tag: 'text', value: 'list' } },
      ],
    });
  });

  test('lowers void only in the handler return position', () => {
    const artifact = decodeStructuralKir(
      encodeStructuralKir({ type: 'fn', props: { name: 'f', returns: 'void' } }, limits),
      limits,
    );
    expect(artifact.root.properties.find((entry) => entry.key === 'returns')?.value).toEqual({
      tag: 'record',
      value: [{ key: 'kind', value: { tag: 'text', value: 'void' } }],
    });
  });

  test.each([
    ['param', 'void'],
    ['param', 'string[][]'],
    ['param', 'String'],
    ['param', 'User'],
    ['fn', 'void[]'],
    ['fn', 'string | null'],
    ['fn', '{ value: string }'],
    ['fn', '[string, number]'],
    ['fn', 'Array<string>'],
    ['fn', 'string?'],
    ['fn', 'string=default'],
    ['fn', "User['name']"],
    ['fn', 'value is string'],
    ['fn', 'Record<string, unknown>'],
    ['fn', '(value: string) => string'],
  ])('rejects non-portable %s type %s', (kind, annotation) => {
    const input: IRNode =
      kind === 'param'
        ? {
            type: 'fn',
            props: { name: 'f', returns: 'void' },
            children: [{ type: 'param', props: { name: 'value', type: annotation } }],
          }
        : { type: 'fn', props: { name: 'f', returns: annotation } };
    expectStructuralCode(() => encodeStructuralKir(input, limits), 'invalid-type');
  });

  test('rejects typed params outside direct fn children and legacy raw params text', () => {
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'param', props: { name: 'value', type: 'string' } }, limits),
      'excluded-host-payload',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'fn', props: { name: 'f', params: 'value:string', returns: 'void' } }, limits),
      'excluded-host-payload',
    );
  });

  test.each(['', '   '])('canonicalizes an empty legacy params value to omission', (params) => {
    const artifact = decodeStructuralKir(
      encodeStructuralKir({ type: 'fn', props: { name: 'f', params, returns: 'void' } }, limits),
      limits,
    );
    expect(artifact.root.properties.some((entry) => entry.key === 'params')).toBe(false);

    const mutated = structuredClone(
      decodeCanonicalValue(encodeStructuralKir({ type: 'fn', props: { name: 'f', returns: 'void' } }, limits), limits),
    );
    const rootValue = recordField(mutated, 'root');
    const properties = recordField(rootValue, 'properties');
    if (properties.tag !== 'record') throw new Error('expected properties');
    properties.value.push({ key: 'params', value: { tag: 'text', value: params } });
    properties.value.sort((left, right) => left.key.localeCompare(right.key));
    expectStructuralCode(
      () => decodeStructuralKir(encodeCanonicalValue(mutated, limits), limits),
      'excluded-host-payload',
    );
  });

  test('hard-rejects excluded host payloads and required excluded types', () => {
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'let', props: { name: 'x', type: 'User' } }, limits),
      'excluded-host-payload',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'let', props: { name: 'x', expr: 'host()' } }, limits),
      'excluded-host-payload',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'screen', props: { memo: 'hostValue' } }, limits),
      'excluded-host-payload',
    );
    expectStructuralCode(() => encodeStructuralKir({ type: 'indexer' }, limits), 'excluded-host-payload');
  });

  test('rejects unknown nodes, properties, fields, and invalid child contracts', () => {
    expectStructuralCode(() => encodeStructuralKir({ type: 'invented' }, limits), 'unknown-node-kind');
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'screen', props: { invented: 'x' } }, limits),
      'unknown-property',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'fn', props: { name: 'f' }, children: [{ type: 'screen' }] }, limits),
      'invalid-child',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'screen', invented: true } as unknown as IRNode, limits),
      'invalid-artifact',
    );
  });

  test('normalizes only admitted portable import-path syntax', () => {
    const artifact = decodeStructuralKir(
      encodeStructuralKir({ type: 'use', props: { path: './lib.kern' } }, limits),
      limits,
    );
    expect(artifact.root.properties[0]).toEqual({ key: 'path', value: { tag: 'text', value: './lib.kern' } });
    for (const path of [
      '',
      '/root',
      'C:/root',
      './/x',
      './x/',
      '.\\x',
      'a/../b',
      'http:evil',
      'file:tmp',
      'pkg:name',
    ]) {
      expectStructuralCode(() => encodeStructuralKir({ type: 'use', props: { path } }, limits), 'invalid-import-path');
    }
    expect(
      decodeStructuralKir(encodeStructuralKir({ type: 'use', props: { path: '../../lib' } }, limits), limits),
    ).toBeDefined();
  });

  test('numeric properties reject host negative zero instead of collapsing identity', () => {
    expectStructuralCode(() => encodeStructuralKir({ type: 'grid', props: { cols: -0 } }, limits), 'invalid-property');
  });

  test('reader rejects structurally wrong but canonical values before return', () => {
    const bytes = encodeStructuralKir(root(), limits);
    const value = structuredClone(decodeCanonicalValue(bytes, limits));
    if (value.tag !== 'record') throw new Error('expected artifact record');
    value.value.push({ key: 'unknown', value: { tag: 'null' } });
    value.value.sort((left, right) => left.key.localeCompare(right.key));
    const mutated = encodeCanonicalValue(value, limits);
    expectStructuralCode(() => decodeStructuralKir(mutated, limits), 'invalid-artifact');

    const typeValue = structuredClone(decodeCanonicalValue(bytes, limits));
    if (typeValue.tag !== 'record') throw new Error('expected artifact record');
    const typeCatalog = typeValue.value.find((entry) => entry.key === 'typeCatalog')?.value;
    if (typeCatalog?.tag !== 'record') throw new Error('expected type catalog');
    const admitted = typeCatalog.value.find((entry) => entry.key === 'admittedKinds')?.value;
    if (admitted?.tag !== 'list') throw new Error('expected admitted kinds');
    admitted.value.push({ tag: 'text', value: 'host-type' });
    expectStructuralCode(
      () => decodeStructuralKir(encodeCanonicalValue(typeValue, limits), limits),
      'invalid-artifact',
    );

    const rawTypeValue = structuredClone(
      decodeCanonicalValue(
        encodeStructuralKir({ type: 'fn', props: { name: 'f', returns: 'string' } }, limits),
        limits,
      ),
    );
    const rawTypeRoot = recordField(rawTypeValue, 'root');
    const rawTypeProperties = recordField(rawTypeRoot, 'properties');
    if (rawTypeProperties.tag !== 'record') throw new Error('expected properties');
    const rawReturn = rawTypeProperties.value.find((entry) => entry.key === 'returns');
    if (!rawReturn) throw new Error('expected return type');
    rawReturn.value = { tag: 'text', value: 'string' };
    expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(rawTypeValue, limits), limits), 'invalid-type');
  });

  test('reader rejects semantic type shape, catalog, and predecessor-version mutations', () => {
    const typed = () =>
      structuredClone(
        decodeCanonicalValue(
          encodeStructuralKir({ type: 'fn', props: { name: 'f', returns: 'string[]' } }, limits),
          limits,
        ),
      );
    const returnType = (value: CanonicalValue): CanonicalValue => {
      const rootValue = recordField(value, 'root');
      const properties = recordField(rootValue, 'properties');
      if (properties.tag !== 'record') throw new Error('expected properties');
      const result = properties.value.find((entry) => entry.key === 'returns')?.value;
      if (!result) throw new Error('expected return type');
      return result;
    };
    const mutations: Array<(value: CanonicalValue) => void> = [
      (value) => {
        const type = returnType(value);
        if (type.tag !== 'record' || type.value[0]?.value.tag !== 'text') throw new Error('expected list element');
        type.value[0].value.value = 'void';
      },
      (value) => {
        const type = returnType(value);
        if (type.tag !== 'record' || type.value[1]?.value.tag !== 'text') throw new Error('expected list kind');
        type.value[1].value.value = 'array';
      },
      (value) => {
        const type = returnType(value);
        if (type.tag !== 'record') throw new Error('expected type record');
        type.value.push({ key: 'unknown', value: { tag: 'null' } });
      },
      (value) => {
        const type = returnType(value);
        if (type.tag !== 'record') throw new Error('expected type record');
        type.value.splice(0, 1);
      },
    ];
    for (const mutate of mutations) {
      const value = typed();
      mutate(value);
      expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), 'invalid-type');
    }

    const scalarMutation = structuredClone(
      decodeCanonicalValue(
        encodeStructuralKir({ type: 'fn', props: { name: 'f', returns: 'string' } }, limits),
        limits,
      ),
    );
    const scalarType = returnType(scalarMutation);
    if (scalarType.tag !== 'record' || scalarType.value[0]?.value.tag !== 'text') {
      throw new Error('expected scalar type');
    }
    scalarType.value[0].value.value = 'number';
    expectStructuralCode(
      () => decodeStructuralKir(encodeCanonicalValue(scalarMutation, limits), limits),
      'invalid-type',
    );

    const catalogMutation = typed();
    const catalog = recordField(catalogMutation, 'typeCatalog');
    if (catalog.tag !== 'record') throw new Error('expected type catalog');
    catalog.value.splice(1, 1);
    expectStructuralCode(
      () => decodeStructuralKir(encodeCanonicalValue(catalogMutation, limits), limits),
      'invalid-artifact',
    );

    const predecessor = typed();
    const format = recordField(predecessor, 'format');
    if (format.tag !== 'text') throw new Error('expected format');
    format.value = 'kern.kir.structural.r1.5c.2-alpha';
    expectStructuralCode(
      () => decodeStructuralKir(encodeCanonicalValue(predecessor, limits), limits),
      'unsupported-version',
    );
  });

  test('reader rejects canonical unary negative zero that the writer cannot emit', () => {
    const value = structuredClone(decodeCanonicalValue(encodeStructuralKir(letNode('!0'), limits), limits));
    const rootValue = recordField(value, 'root');
    const properties = recordField(rootValue, 'properties');
    const expression = recordField(properties, 'value');
    const fields = recordField(expression, 'fields');
    const operator = recordField(fields, 'op');
    if (operator.tag !== 'text') throw new Error('expected unary operator');
    (operator as { tag: 'text'; value: string }).value = '-';
    expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), 'invalid-expression');
  });

  test('inherits byte, depth, node, collection, and string limits symmetrically', () => {
    const bytes = encodeStructuralKir(root([letNode('a + 1')]), limits);
    expect(decodeStructuralKir(bytes, { ...limits, maxBytes: bytes.byteLength })).toBeDefined();
    expectCanonicalCode(() => decodeStructuralKir(bytes, { ...limits, maxBytes: bytes.byteLength - 1 }), 'limit-bytes');
    expectCanonicalCode(() => encodeStructuralKir(root(), { ...limits, maxDepth: 2 }), 'limit-depth');
    expectCanonicalCode(() => encodeStructuralKir(root(), { ...limits, maxNodes: 1 }), 'limit-nodes');
    expectCanonicalCode(
      () => encodeStructuralKir(root([{ type: 'return' }, { type: 'return' }]), { ...limits, maxCollectionLength: 1 }),
      'limit-collection',
    );
    expectCanonicalCode(() => encodeStructuralKir(root(), { ...limits, maxStringBytes: 4 }), 'limit-string');
  });

  test('writer accepts only inspectable plain nodes, properties, and arrays', () => {
    const getter = Object.defineProperty({}, 'type', { enumerable: true, get: () => 'screen' });
    expectStructuralCode(() => encodeStructuralKir(getter as IRNode, limits), 'invalid-artifact');
    const props = Object.defineProperty({}, 'name', { enumerable: true, get: () => 'Home' });
    expectStructuralCode(() => encodeStructuralKir({ type: 'screen', props }, limits), 'invalid-artifact');
    const children = Array<IRNode>(1);
    expectStructuralCode(() => encodeStructuralKir({ type: 'screen', children }, limits), 'invalid-artifact');
    const hostile = new Proxy(
      { type: 'screen' },
      {
        ownKeys: () => {
          throw new Error('trap');
        },
      },
    );
    expectStructuralCode(() => encodeStructuralKir(hostile, limits), 'invalid-artifact');
  });

  test('duplicate object keys and noncanonical bytes remain rejected by the underlying reader', () => {
    const text = new TextDecoder().decode(encodeStructuralKir(root(), limits));
    expectCanonicalCode(
      () => decodeStructuralKir(new TextEncoder().encode(text.replace('{"format"', '{ "format"')), limits),
      'noncanonical',
    );
    const value = decodeCanonicalValue(encodeStructuralKir(root(), limits), limits) as CanonicalValue;
    expect(encodeCanonicalValue(value, limits)).toEqual(encodeStructuralKir(root(), limits));
  });
});
