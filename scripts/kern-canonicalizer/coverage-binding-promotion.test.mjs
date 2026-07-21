import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCoveragePolicy } from './coverage.mjs';
import { profileBlockersForFunction } from './coverage-profile.mjs';

test('the promoted binding profile admits only exact direct let and assign statements', () => {
  const base = loadCoveragePolicy().base;
  const returned = (value) => ({ children: [], props: { value }, type: 'return' });
  const declaration = { children: [], props: { name: '$local', value: 'input' }, type: 'let' };
  const assignment = { children: [], props: { target: 'state.value', value: '$local' }, type: 'assign' };
  const functionRoot = {
    children: [{
      children: [declaration, assignment, returned('$local')],
      props: { lang: 'kern' },
      type: 'handler',
    }],
    props: { name: 'bind', returns: 'string' },
    type: 'fn',
  };
  assert.deepEqual(profileBlockersForFunction(functionRoot, base), []);

  const mutations = [
    ['let-missing-name', (copy) => { delete copy.children[0].children[0].props.name; }],
    ['let-kind', (copy) => { copy.children[0].children[0].props.kind = 'let'; }],
    ['let-malformed-name', (copy) => { copy.children[0].children[0].props.name = '1local'; }],
    ['let-child', (copy) => { copy.children[0].children[0].children.push(returned('input')); }],
    ['assign-missing-target', (copy) => { delete copy.children[0].children[1].props.target; }],
    ['assign-op', (copy) => { copy.children[0].children[1].props.op = '='; }],
    ['assign-call-target', (copy) => { copy.children[0].children[1].props.target = 'write()'; }],
    ['assign-binary-target', (copy) => { copy.children[0].children[1].props.target = 'a + b'; }],
    ['assign-child', (copy) => { copy.children[0].children[1].children.push(returned('input')); }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(functionRoot);
    mutate(copy);
    assert.notDeepEqual(profileBlockersForFunction(copy, base), [], label);
  }
});
