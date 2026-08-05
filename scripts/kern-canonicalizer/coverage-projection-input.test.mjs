import assert from 'node:assert/strict';
import test from 'node:test';

import { withoutExcludedProperties } from './coverage-projection-input.mjs';

test('projection input removes quote metadata only with its excluded property', () => {
  const input = {
    type: 'fn',
    props: { name: 'answer', params: 'value: number' },
    __quotedProps: ['name', 'params'],
    children: [{ type: 'return', props: { value: '7' }, __quotedProps: ['value'] }],
  };
  assert.deepEqual(withoutExcludedProperties(input), {
    type: 'fn',
    props: { name: 'answer' },
    __quotedProps: ['name'],
    children: [{ type: 'return', props: { value: '7' }, __quotedProps: ['value'], children: [] }],
  });
  assert.deepEqual(input.__quotedProps, ['name', 'params']);
});
