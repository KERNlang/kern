import assert from 'node:assert/strict';
import test from 'node:test';

import { flattenKernSource } from '../capstone-checker-subset/flatten-kern.mjs';
import { FIXTURES } from '../capstone-checker-subset/fixtures.mjs';
import { checkFlatModule } from '../capstone-checker-subset/reference.mjs';
import { checkerFactsFromFlatModule } from './contract.mjs';
import { runKernCheckerFacts } from './production.mjs';

function factsFor(fixture) {
  return checkerFactsFromFlatModule(flattenKernSource(fixture.path, fixture.source()));
}

test('production KERN checker owns all admitted checker-v2 verdicts', () => {
  for (const fixture of FIXTURES) {
    const facts = factsFor(fixture);
    const result = runKernCheckerFacts(facts);
    assert.equal(result.outcome, fixture.expected, fixture.id);
    assert.deepEqual(result.diagnostics, checkFlatModule(flattenKernSource(fixture.path, fixture.source())));
  }
});

test('unknown facts format fails before semantic output', () => {
  const fixture = FIXTURES[0];
  const facts = factsFor(fixture);
  const result = runKernCheckerFacts({ ...facts, format: 'kern.checker.facts.future' });
  assert.equal(result.outcome, 'failure');
  assert.match(result.diagnostics[0].message, /format is unsupported/);
});

test('diagnostic control text in a path cannot change accept polarity', () => {
  const fixture = FIXTURES.find((item) => item.expected === 'accept');
  const flat = flattenKernSource('evil|reject|path.kern', fixture.source());
  const result = runKernCheckerFacts(checkerFactsFromFlatModule(flat));
  assert.equal(result.outcome, 'accept');
  assert.deepEqual(result.diagnostics, checkFlatModule(flat));
});

test('duplicate same-name functions keep parameter ownership without verdict drift', () => {
  const source = `fn name=f returns=number
  param name=a type=number
  handler lang="kern"
    return value="a"

fn name=f returns=number
  param name=b type=number
  handler lang="kern"
    return value="b"
`;
  const flat = flattenKernSource('duplicate.kern', source);
  const result = runKernCheckerFacts(checkerFactsFromFlatModule(flat));
  assert.equal(result.outcome, 'accept');
  assert.deepEqual(result.diagnostics, checkFlatModule(flat));
});
