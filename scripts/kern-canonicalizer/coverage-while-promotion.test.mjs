import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCoveragePolicy } from './coverage.mjs';
import { profileBlockersForFunction } from './coverage-profile.mjs';

function returned(value) {
  return {
    children: [],
    props: value === undefined ? {} : { value },
    type: 'return',
  };
}

function validRoot() {
  return {
    children: [{
      children: [{
        children: [{
          children: [{ children: [], props: { value: 'tick()' }, type: 'do' }],
          props: { cond: 'innerReady' },
          type: 'while',
        }],
        props: { cond: 'ready' },
        type: 'while',
      }],
      props: { lang: 'kern' },
      type: 'handler',
    }],
    props: { name: 'drain', returns: 'void' },
    type: 'fn',
  };
}

test('the promoted while profile admits exact recursive condition loops', () => {
  const base = loadCoveragePolicy().base;
  assert.equal(base.id, 'kern.kir-canonicalizer.profile.m4.137');
  assert.equal(base.nodeKinds.includes('while'), true);
  assert.equal(base.propertyKeys.includes('while.cond'), true);
  assert.deepEqual(profileBlockersForFunction(validRoot(), base), []);

  const emptyBody = validRoot();
  emptyBody.children[0].children[0].children = [];
  assert.deepEqual(profileBlockersForFunction(emptyBody, base), []);
});

test('the promoted while profile requires only cond and rejects malformed recursive conditions', () => {
  const base = loadCoveragePolicy().base;
  const mutations = [
    ['missing-cond', 'while.properties.cond', (copy) => { delete copy.children[0].children[0].props.cond; }],
    ['unknown-property', 'while.properties.future', (copy) => { copy.children[0].children[0].props.future = true; }],
    ['unknown-kind-property', 'while.properties.kind', (copy) => { copy.children[0].children[0].props.kind = 'loop'; }],
    ['unknown-trailing-comment', 'while.properties.trailingComment', (copy) => {
      copy.children[0].children[0].props.trailingComment = 'x';
    }],
    ['recursive-condition', 'while.properties.cond.expression.text.character-u007f', (copy) => {
      copy.children[0].children[0].props.cond = '"\u007f"';
    }],
  ];
  for (const [label, expected, mutate] of mutations) {
    const copy = validRoot();
    mutate(copy);
    assert.ok(profileBlockersForFunction(copy, base).includes(expected), label);
  }
});

test('the promoted while profile preserves recursive statement sequencing', () => {
  const base = loadCoveragePolicy().base;
  const mutations = [
    ['unsupported-child', (loop) => {
      loop.children = [{ children: [], props: { name: 'x', type: 'number' }, type: 'param' }];
    }],
    ['orphan-else', (loop) => {
      loop.children = [{ children: [], props: {}, type: 'else' }];
    }],
    ['non-terminal-return', (loop) => {
      loop.children = [returned(), { children: [], props: { value: 'tick()' }, type: 'do' }];
    }],
    ['duplicate-return', (loop) => {
      loop.children = [returned(), returned()];
    }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = validRoot();
    mutate(copy.children[0].children[0]);
    assert.ok(profileBlockersForFunction(copy, base).includes('while.children'), label);
  }
});
