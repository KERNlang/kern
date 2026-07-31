import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import {
  assertM4150QuotesourceImplementation,
} from './coverage-m4-150-central.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { formatM4150QuotesourceRewriteStatus } from './coverage-status-m4-150.mjs';
import { assertM4150QuotesourceRewrite } from './quotesource-rewrite-m4-150.mjs';

const STATUS =
  'M4.150 applies the exact M4.149 quotesource neighbor-sentinel rewrite and clears ' +
  'all six canonical-surface blockers; the base remains 111/112 with only fn.params and ' +
  'exposes the exact 1-function/2-row parameter queue; M4.151 consumes it.';

function current() {
  return {
    coverage: measureCanonicalizerCoverage(loadCoveragePolicy()),
    prerequisite: measureCanonicalizerPrerequisite(),
    rewrite: assertM4150QuotesourceRewrite(),
  };
}

test('M4.150 status freezes the exact source rewrite and terminal parameter queue', () => {
  const { coverage, prerequisite, rewrite } = current();
  assert.equal(
    formatM4150QuotesourceRewriteStatus(rewrite, coverage, prerequisite),
    STATUS,
  );
  assert.match(
    assertM4150QuotesourceImplementation(coverage, prerequisite),
    new RegExp(` ${STATUS.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'),
  );
});

test('M4.150 status rejects source, coverage, and terminal-frontier drift', () => {
  const { coverage, prerequisite, rewrite } = current();
  for (const [label, mutate] of [
    ['format', (copy) => { copy.rewrite.format = 'future'; }],
    ['rewrite extra field', (copy) => { copy.rewrite.future = true; }],
    ['input extra field', (copy) => { copy.rewrite.input.future = true; }],
    ['source extra field', (copy) => { copy.rewrite.source.future = true; }],
    ['next-action extra field', (copy) => { copy.rewrite.selectedNextAction.future = true; }],
    ['source prototype', (copy) => {
      Object.setPrototypeOf(copy.rewrite.source, { future: true });
    }],
    ['M4.149 digest', (copy) => { copy.rewrite.input.m4149Digest = '0'.repeat(64); }],
    ['M4.149 input commit', (copy) => { copy.rewrite.input.m4149InputCommit = '0'.repeat(40); }],
    ['M4.150 input commit', (copy) => { copy.rewrite.input.m4150InputCommit = '0'.repeat(40); }],
    ['source digest', (copy) => { copy.rewrite.source.afterDigest = '0'.repeat(64); }],
    ['source path', (copy) => { copy.rewrite.source.path = 'future.kern'; }],
    ['source predicate', (copy) => { copy.rewrite.source.predicate = 'true'; }],
    ['next milestone', (copy) => { copy.rewrite.selectedNextAction.milestone = 'M4.152'; }],
    ['coverage count', (copy) => { copy.coverage.baseCompleteFunctions = 112; }],
    ['coverage policy', (copy) => { copy.coverage.coveragePolicyDigest = '0'.repeat(64); }],
    ['fact blockers', (copy) => {
      copy.coverage.functions.find(({ id }) => id.endsWith('#5:quotesource'))
        .profileBlockers.push('future');
    }],
    ['outcome', (copy) => { copy.prerequisite.outcome = 'bounded-exhaustion'; }],
    ['exhaustion', (copy) => { copy.prerequisite.exhaustion = {}; }],
    ['queue', (copy) => { copy.prerequisite.parameterMigration.migratedParameterRows = 1; }],
  ]) {
    const copy = {
      coverage: structuredClone(coverage),
      prerequisite: structuredClone(prerequisite),
      rewrite: structuredClone(rewrite),
    };
    mutate(copy);
    assert.throws(
      () => formatM4150QuotesourceRewriteStatus(
        copy.rewrite,
        copy.coverage,
        copy.prerequisite,
      ),
      /M4\.150 must publish/u,
      label,
    );
  }
});
