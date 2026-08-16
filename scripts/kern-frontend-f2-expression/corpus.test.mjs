import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCorpus,
  buildRuleCoverage,
  corpusSha256,
  stableCorpusBytes,
  stableCoverageBytes,
} from './generator.mjs';
import { loadPolicy } from './decoder.mjs';
import { runExpression } from './worker.mjs';

test('frozen deterministic corpus and rule coverage regenerate byte-identically', () => {
  const policy = loadPolicy();
  const corpusBytes = readFileSync(new URL('./conformance-corpus.json', import.meta.url), 'utf8');
  const coverageBytes = readFileSync(new URL('./rule-coverage.json', import.meta.url), 'utf8');
  assert.equal(stableCorpusBytes(), stableCorpusBytes());
  assert.equal(stableCoverageBytes(), stableCoverageBytes());
  assert.equal(corpusBytes, stableCorpusBytes());
  assert.equal(coverageBytes, stableCoverageBytes());
  assert.equal(corpusSha256(corpusBytes), policy.conformanceCorpusSha256);
  assert.equal(createHash('sha256').update(coverageBytes).digest('hex'), policy.ruleCoverageSha256);
  assert.equal(readFileSync(new URL('./conformance-corpus.sha256', import.meta.url), 'utf8'), `${corpusSha256(corpusBytes)}\n`);
});

test('frozen corpus binds every catalog family and operator to witnesses', () => {
  const policy = loadPolicy();
  const coverage = buildRuleCoverage(buildCorpus()).rules;
  const required = [
    ...policy.ledger.primaryForms.map((form) => `primary:${form}`),
    ...policy.ledger.postfixForms.map((form) => `postfix:${form.form}:${form.optional}`),
    ...policy.ledger.constructors.map((constructor) => `constructor:${constructor.name}`),
    ...policy.ledger.binaryOperators.map((operator) => `operator:${operator}`),
    ...policy.ledger.unaryOperators.map((operator) => `unary:${operator}`),
    ...policy.ledger.resultKinds.map((kind) => `kind:${kind}`),
    ...policy.ledger.explicitlyRejectedFamilies.map((family) => `reject:${family}`),
  ];
  for (const rule of required) assert.ok(coverage[rule]?.length > 0, `uncovered source rule ${rule}`);
});

test('frozen corpus has deterministic production dispositions and receipts', () => {
  for (const fixture of buildCorpus().cases) {
    const first = runExpression(fixture.source);
    const second = runExpression(fixture.source);
    assert.equal(first.decoded.status, fixture.status, fixture.id);
    assert.deepEqual(second.fields, first.fields, fixture.id);
    assert.deepEqual(second.decoded, first.decoded, fixture.id);
    if (fixture.status === 'failure') assert.deepEqual(first.decoded.nodes, [], fixture.id);
  }
});
