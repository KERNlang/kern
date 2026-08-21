import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-declarations-main.kern', import.meta.url), 'utf8');
const SEMANTIC_SOURCE = readFileSync(
  new URL('../../examples/kern-frontend/f4-declarations-semantic.kern', import.meta.url), 'utf8');
const REPLAY_CALLS = [
  'f4pathmoduleid', 'f4authoritydrift', 'f4f1drift', 'f4f2bdrift',
  'structuref3document', 'f4f3sidecartapes',
];

function escaped(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function functionBlock(source, name) {
  const header = new RegExp(`^fn name=${escaped(name)}(?=\\s|$)[^\\n]*(?:\\n|$)`, 'gmu');
  const matches = [...source.matchAll(header)];
  assert.equal(matches.length, 1, `exactly one exact ${name} header`);
  const start = matches[0].index;
  const next = source.indexOf('\nfn name=', start + matches[0][0].length);
  return source.slice(start, next === -1 ? source.length : next);
}

function countCalls(block, name) {
  return [...block.matchAll(new RegExp(`\\b${escaped(name)}\\s*\\(`, 'gu'))].length;
}

function replayCounts(source, name) {
  const block = functionBlock(source, name);
  return Object.fromEntries(REPLAY_CALLS.map((call) => [call, countCalls(block, call)]));
}

test('single-replay scanner is exact-name anchored and sees calls nested in loops', () => {
  const source = [
    'fn name=classifyf4documentextra returns="string[]"',
    '  handler lang="kern"',
    '    let name=shadow value="f4pathmoduleid(moduleId, a, b)"',
    'fn name=classifyf4document returns="string[]"',
    '  handler lang="kern"',
    '    let name=first value="f4pathmoduleid(moduleId, a, b)"',
    '    for name=index from=0 to=items.length',
    '      let name=second value="f4pathmoduleid(moduleId, a, b)"',
    '',
  ].join('\n');
  const block = functionBlock(source, 'classifyf4document');
  assert.equal(countCalls(block, 'f4pathmoduleid'), 2);
  assert.equal(countCalls(functionBlock(source, 'classifyf4documentextra'), 'f4pathmoduleid'), 1);
});

test('F4 root authenticates each replay dependency exactly once', () => {
  assert.deepEqual(replayCounts(ROOT_SOURCE, 'classifyf4document'), Object.fromEntries(
    REPLAY_CALLS.map((call) => [call, 1])));
});

test('F4 semantic helper does not repeat root replay dependencies', () => {
  assert.deepEqual(replayCounts(SEMANTIC_SOURCE, 'classifyf4available'), Object.fromEntries(
    REPLAY_CALLS.map((call) => [call, 0])));
});
