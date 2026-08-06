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

function eachNode(source = 'items'): IRNode {
  return {
    type: 'each',
    props: { in: source, name: 'item' },
    children: [{ type: 'return', props: { value: 'item' } }],
  };
}

function field(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const result = value.value.find((entry) => entry.key === key)?.value;
  if (!result) throw new Error(`missing ${key}`);
  return result;
}

function rootProperty(value: CanonicalValue, key: string): CanonicalValue {
  return field(field(field(value, 'root'), 'properties'), key);
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

const bindingItems: CanonicalValue = {
  tag: 'record',
  value: [
    { key: 'form', value: { tag: 'text', value: 'binding' } },
    { key: 'source', value: { tag: 'text', value: 'items' } },
  ],
};

const recordItems: CanonicalValue = {
  tag: 'record',
  value: [
    { key: 'form', value: { tag: 'text', value: 'record-array-field' } },
    { key: 'source', value: { tag: 'text', value: 'record.items' } },
  ],
};

describe('each collection-reference structural admission', () => {
  test('round-trips the exact binding record through the h artifact format', () => {
    const bytes = encodeStructuralKir(eachNode(), limits);
    const artifact = decodeStructuralKir(bytes, limits);
    expect(artifact.format).toBe('kern.kir.structural.r1.5h.1-alpha');
    expect(artifact.constitution).toBe('kern.kir.structural.r1.5h.1');
    expect(artifact.root.properties.find((entry) => entry.key === 'in')?.value).toEqual(bindingItems);
    expect(inflateStructuralKirNode(artifact.root)).toEqual(eachNode());
    expect(encodeStructuralKir(inflateStructuralKirNode(artifact.root), limits)).toEqual(bytes);
  });

  test('normalizes only runtime-equivalent member whitespace', () => {
    const canonicalBytes = encodeStructuralKir(eachNode('record.items'), limits);
    const spacedBytes = encodeStructuralKir(eachNode(' record . items '), limits);
    expect(spacedBytes).toEqual(canonicalBytes);
    const artifact = decodeStructuralKir(spacedBytes, limits);
    expect(artifact.root.properties.find((entry) => entry.key === 'in')?.value).toEqual(recordItems);
    expect(inflateStructuralKirNode(artifact.root)).toEqual(eachNode('record.items'));
  });

  test.each([
    ' items',
    'items ',
    '(items)',
    '(record).items',
    'record?.items',
    'record.items.more',
    'record["items"]',
    'items.',
    'items()',
    '[1,2]',
    'items + other',
  ])('writer rejects unsupported collection source %s', (source) => {
    expectStructuralCode(() => encodeStructuralKir(eachNode(source), limits), 'invalid-property');
  });

  test('optional each key and type remain excluded', () => {
    expectStructuralCode(
      () => encodeStructuralKir({ ...eachNode(), props: { in: 'items', key: 'item.id', name: 'item' } }, limits),
      'excluded-host-payload',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ ...eachNode(), props: { in: 'items', name: 'item', type: 'number' } }, limits),
      'excluded-host-payload',
    );
  });

  test('reader rejects raw, decorated, mismatched, and non-canonical reference records', () => {
    const encoded = encodeStructuralKir(eachNode(), limits);
    const mutations: Array<(value: CanonicalValue) => void> = [
      (value) => {
        const root = field(value, 'root');
        const properties = field(root, 'properties');
        if (properties.tag !== 'record') throw new Error('expected properties');
        const input = properties.value.find((entry) => entry.key === 'in');
        if (!input) throw new Error('expected in');
        input.value = { tag: 'text', value: 'items' };
      },
      (value) => {
        const input = rootProperty(value, 'in');
        if (input.tag !== 'record') throw new Error('expected collection reference');
        input.value.push({ key: 'unknown', value: { tag: 'null' } });
      },
      (value) => {
        const form = field(rootProperty(value, 'in'), 'form');
        if (form.tag !== 'text') throw new Error('expected form');
        form.value = 'record-array-field';
      },
      (value) => {
        const source = field(rootProperty(value, 'in'), 'source');
        if (source.tag !== 'text') throw new Error('expected source');
        source.value = ' record.items ';
      },
      (value) => {
        const source = field(rootProperty(value, 'in'), 'source');
        if (source.tag !== 'text') throw new Error('expected source');
        source.value = '(items)';
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(decodeCanonicalValue(encoded, limits));
      mutate(value);
      expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), 'invalid-property');
    }
  });

  test('reader rejects the predecessor artifact format without fallback', () => {
    const value = structuredClone(decodeCanonicalValue(encodeStructuralKir(eachNode(), limits), limits));
    const format = field(value, 'format');
    if (format.tag !== 'text') throw new Error('expected format');
    format.value = 'kern.kir.structural.r1.5g.1-alpha';
    expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), 'unsupported-version');
  });
});
