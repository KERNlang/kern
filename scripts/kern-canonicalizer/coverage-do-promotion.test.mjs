import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCoveragePolicy } from './coverage.mjs';
import { profileBlockersForFunction } from './coverage-profile.mjs';

function promotedDoFunction() {
  return {
    children: [{
      children: [
        {
          children: [],
          props: { value: 'service.run(items[0])' },
          type: 'do',
        },
        { children: [], props: {}, type: 'return' },
      ],
      props: { lang: 'kern' },
      type: 'handler',
    }],
    props: { name: 'runFirst', returns: 'void' },
    type: 'fn',
  };
}

test('the promoted do profile admits only an exact leaf with one recursive value', () => {
  const base = loadCoveragePolicy().base;
  const valid = promotedDoFunction();
  assert.deepEqual(profileBlockersForFunction(valid, base), []);

  const mutations = [
    ['missing-value', (copy) => { delete copy.children[0].children[0].props.value; }],
    ['future-property', (copy) => { copy.children[0].children[0].props.future = 'x'; }],
    ['child-statement', (copy) => {
      copy.children[0].children[0].children.push({
        children: [],
        props: { name: 'nested', value: '1' },
        type: 'let',
      });
    }],
    ['optional-member', (copy) => { copy.children[0].children[0].props.value = 'service?.run(items[0])'; }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(valid);
    mutate(copy);
    assert.notDeepEqual(profileBlockersForFunction(copy, base), [], label);
  }
});

