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

function pathValue(quoted: boolean): IRNode {
  return {
    type: 'path',
    props: { value: 'paid' },
    ...(quoted ? { __quotedProps: ['value'] } : {}),
  };
}

function branchNode(on = '"paid"'): IRNode {
  return {
    type: 'branch',
    props: { name: 'route', on },
    children: [
      { type: 'path', props: { value: 'paid' }, children: [{ type: 'return', props: { value: '1' } }] },
      {
        type: 'path',
        props: { value: 'paid' },
        __quotedProps: ['value'],
        children: [{ type: 'return', props: { value: '7' } }],
      },
      { type: 'path', props: { default: true }, children: [{ type: 'return', props: { value: '9' } }] },
    ],
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

const quotedPaid: CanonicalValue = {
  tag: 'record',
  value: [
    { key: 'form', value: { tag: 'text', value: 'quoted-text' } },
    { key: 'source', value: { tag: 'text', value: 'paid' } },
  ],
};

const unquotedPaid: CanonicalValue = {
  tag: 'record',
  value: [
    { key: 'form', value: { tag: 'text', value: 'unquoted-expression' } },
    { key: 'source', value: { tag: 'text', value: 'paid' } },
  ],
};

describe('branch path structural provenance', () => {
  test('quoted literal and unquoted identifier do not collapse to identical bytes', () => {
    expect(encodeStructuralKir(pathValue(true), limits)).not.toEqual(encodeStructuralKir(pathValue(false), limits));
    expect(decodeStructuralKir(encodeStructuralKir(pathValue(true), limits), limits).root.properties[0]?.value).toEqual(
      quotedPaid,
    );
    expect(
      decodeStructuralKir(encodeStructuralKir(pathValue(false), limits), limits).root.properties[0]?.value,
    ).toEqual(unquotedPaid);
  });

  test('round-trips branch selection inputs and restores only quoted path metadata', () => {
    const bytes = encodeStructuralKir(branchNode(), limits);
    const artifact = decodeStructuralKir(bytes, limits);
    expect(artifact.format).toBe('kern.kir.structural.r1.5g.1-alpha');
    expect(artifact.constitution).toBe('kern.kir.structural.r1.5g.1');
    expect(artifact.root.children[0]?.properties.find((entry) => entry.key === 'value')?.value).toEqual(unquotedPaid);
    expect(artifact.root.children[1]?.properties.find((entry) => entry.key === 'value')?.value).toEqual(quotedPaid);
    const inflated = inflateStructuralKirNode(artifact.root);
    expect(inflated).toEqual(branchNode());
    expect(encodeStructuralKir(inflated, limits)).toEqual(bytes);
  });

  test.each([
    [{ type: 'path', props: { value: '2' } }, false],
    [{ type: 'path', props: { value: '' }, __quotedProps: ['value'] }, true],
  ] as const)('admits the closed path source form %#', (node, quoted) => {
    const artifact = decodeStructuralKir(encodeStructuralKir(node, limits), limits);
    const value = artifact.root.properties[0]?.value;
    expect(value?.tag).toBe('record');
    expect((value as Extract<CanonicalValue, { tag: 'record' }>).value[0]?.value).toEqual({
      tag: 'text',
      value: quoted ? 'quoted-text' : 'unquoted-expression',
    });
  });

  test('writer rejects invalid unquoted sources and hostile quote metadata', () => {
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'path', props: { value: 'paid-tier' } }, limits),
      'invalid-property',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'path', props: { value: '$paid' } }, limits),
      'invalid-property',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'path', props: { value: '-0' } }, limits),
      'invalid-property',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'path', props: { value: '9'.repeat(400) } }, limits),
      'invalid-property',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ ...pathValue(true), __quotedProps: ['value', 'value'] }, limits),
      'invalid-artifact',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ ...pathValue(true), __quotedProps: ['missing'] }, limits),
      'invalid-artifact',
    );
    expectStructuralCode(
      () => encodeStructuralKir({ type: 'path', props: { default: true }, __quotedProps: ['default'] }, limits),
      'invalid-artifact',
    );
  });

  test('reader rejects raw, missing, decorated, and unknown provenance records', () => {
    const encoded = encodeStructuralKir(pathValue(true), limits);
    const mutations: Array<(value: CanonicalValue) => void> = [
      (value) => {
        const root = field(value, 'root');
        const properties = field(root, 'properties');
        if (properties.tag !== 'record') throw new Error('expected properties');
        const path = properties.value.find((entry) => entry.key === 'value');
        if (!path) throw new Error('expected value');
        path.value = { tag: 'text', value: 'paid' };
      },
      (value) => {
        const path = rootProperty(value, 'value');
        if (path.tag !== 'record') throw new Error('expected path provenance');
        path.value.splice(0, 1);
      },
      (value) => {
        const path = rootProperty(value, 'value');
        if (path.tag !== 'record') throw new Error('expected path provenance');
        path.value.push({ key: 'unknown', value: { tag: 'null' } });
      },
      (value) => {
        const form = field(rootProperty(value, 'value'), 'form');
        if (form.tag !== 'text') throw new Error('expected form');
        form.value = 'host-value';
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(decodeCanonicalValue(encoded, limits));
      mutate(value);
      expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), 'invalid-property');
    }
  });

  test('reader rejects the predecessor artifact format without fallback', () => {
    const value = structuredClone(decodeCanonicalValue(encodeStructuralKir(branchNode(), limits), limits));
    const format = field(value, 'format');
    if (format.tag !== 'text') throw new Error('expected format');
    format.value = 'kern.kir.structural.r1.5f.1-alpha';
    expectStructuralCode(() => decodeStructuralKir(encodeCanonicalValue(value, limits), limits), 'unsupported-version');
  });
});
