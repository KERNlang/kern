import {
  canonicalEachCollectionReferenceSource,
  classifyEachCollectionReference,
} from '../src/each-collection-reference.js';
import { eachRuntimeSteps } from '../src/ir/semantics/each-runtime.js';
import { defineBinding, defineRecordBinding, makeEnv } from '../src/ir/semantics/index.js';

describe('shared each collection-reference classification', () => {
  test.each([
    ['items', { status: 'reference', reference: { form: 'binding', name: 'items' } }],
    ['$items', { status: 'reference', reference: { form: 'binding', name: '$items' } }],
    [' items', { status: 'missing-binding', name: 'items' }],
    ['items ', { status: 'missing-binding', name: 'items' }],
    ['(items)', { status: 'missing-binding', name: 'items' }],
    [
      'record.items',
      { status: 'reference', reference: { form: 'record-array-field', receiver: 'record', property: 'items' } },
    ],
    [
      ' record . items ',
      { status: 'reference', reference: { form: 'record-array-field', receiver: 'record', property: 'items' } },
    ],
    [
      '(record.items)',
      { status: 'reference', reference: { form: 'record-array-field', receiver: 'record', property: 'items' } },
    ],
    ['(record).items', { status: 'unsupported' }],
    ['record?.items', { status: 'unsupported' }],
    ['record.items.more', { status: 'unsupported' }],
    ['record["items"]', { status: 'unsupported' }],
    ['items()', { status: 'unsupported' }],
    ['[1,2]', { status: 'unsupported' }],
    ['items + other', { status: 'unsupported' }],
  ] as const)('classifies %s without erasing runtime-significant syntax', (source, expected) => {
    expect(classifyEachCollectionReference(source)).toEqual(expected);
  });

  test('renders only the two exact canonical reference forms', () => {
    expect(canonicalEachCollectionReferenceSource({ form: 'binding', name: 'items' })).toBe('items');
    expect(
      canonicalEachCollectionReferenceSource({ form: 'record-array-field', receiver: 'record', property: 'items' }),
    ).toBe('record.items');
  });

  test('runtime preserves direct binding and member-whitespace behavior through the shared classifier', () => {
    const env = makeEnv();
    defineBinding(env, 'items', [3, 4]);
    defineRecordBinding(env, 'record', { items: [3, 4] }, new Set(['items']));
    const steps = (source: string) =>
      eachRuntimeSteps({ type: 'each', props: { in: source, name: 'item' }, children: [{ type: 'return' }] }, env);

    expect(steps('items')).toHaveLength(2);
    expect(steps('record.items')).toHaveLength(2);
    expect(steps(' record . items ')).toHaveLength(2);
    expect(() => steps(' items')).toThrow(/binding "items" not found/u);
    expect(() => steps('(items)')).toThrow(/binding "items" not found/u);
    expect(() => steps('(record).items')).toThrow(/proven record array field/u);
    expect(() => steps('record?.items')).toThrow(/proven record array field/u);
    expect(() => steps('items.')).toThrow(/Expected ident, got eof/u);
  });
});
