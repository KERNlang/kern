import assert from 'node:assert/strict';
import test from 'node:test';

import { between, occurrencesOf, repositoryText, specCriteria } from './k0-support.mjs';
import {
  E0_ADDED_DIST_PATHS,
  E0_INVENTORY_COUNT,
  JAVASCRIPT_KERNEL_SHA256,
  PYTHON_KERNEL_SHA256,
  SPEC_PATH,
  STATEMENT_KINDS_AFTER_E,
} from './pins.mjs';

const STILL_OUTSIDE_FILES = Object.freeze([
  'scripts/kern-5-rt10-for/compatibility.test.mjs',
  'scripts/kern-5-rt11-linked-while/compatibility.test.mjs',
  'scripts/kern-5-rt12-linked-jumps/compatibility.test.mjs',
]);

test('both kernel digests are the frozen pins, recomputed at module load', async () => {
  const javascript = await import('../../packages/core/dist/compiler/kir-js-esm/emitter.js');
  const python = await import('../../packages/core/dist/compiler/kir-python/emitter.js');
  assert.equal(javascript.TARGET_KERNEL_SHA256, JAVASCRIPT_KERNEL_SHA256, 'E_KERNEL_TOUCH: the JavaScript kernel moved');
  assert.equal(python.TARGET_KERNEL_SHA256, PYTHON_KERNEL_SHA256, 'E_KERNEL_TOUCH: the Python kernel moved');
});

// STILL_OUTSIDE loses `each` and keeps `set`. A slice that emptied the list would pass a
// "does not contain each" check while destroying the invariant the list exists for.
test('the prior-slice STILL_OUTSIDE lists drop each and keep set', () => {
  for (const path of STILL_OUTSIDE_FILES) {
    const source = repositoryText(path);
    const region = between(source, 'STILL_OUTSIDE', ']', `${path} STILL_OUTSIDE`);
    const kinds = [...region.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]);
    assert.equal(kinds.includes('each'), false, `E_STILL_OUTSIDE: ${path} must drop each once it is admitted`);
    assert.ok(kinds.includes('set'), `E_STILL_OUTSIDE: ${path} must keep set outside`);
    assert.ok(kinds.length >= 1, `E_STILL_OUTSIDE: ${path} must not be emptied`);
  }
});

test('the parity-ledger exhaustiveness table names all fourteen statement kinds', () => {
  const source = repositoryText('scripts/kern-5-parity-ledger/exhaustiveness.test.mjs');
  const region = between(source, 'const STATEMENT_KINDS = Object.freeze([', ']', 'the exhaustiveness table');
  const kinds = [...region.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]).sort();
  assert.deepEqual(kinds, [...STATEMENT_KINDS_AFTER_E], 'E_EXHAUSTIVENESS: the pinned statement kind set is not fourteen');
});

// rt10's neg-each was a refusal row precisely because `each` was outside. Slice E turns it into a
// positive, and must APPEND a new refusal row rather than silently reusing the old name: a
// substitution would leave rt10 with one fewer refusal than it had.
test('rt10 amends neg-each to a positive and appends a new refusal row', () => {
  const support = repositoryText('scripts/kern-5-rt10-for/k0-support.mjs');
  const typeGate = repositoryText('scripts/kern-5-rt10-for/type-gate.test.mjs');
  const leafRegion = between(typeGate, 'const LEAF_REFUSALS', ']', 'rt10 LEAF_REFUSALS');
  assert.equal(
    leafRegion.includes("'neg-each'"),
    false,
    'E_RT10_NEG_EACH: neg-each is admitted now and must leave the leaf-refusal list',
  );
  assert.ok(occurrencesOf(support, "'neg-each'") >= 1, 'E_RT10_NEG_EACH: the fixture itself must survive as a positive');
  const appended = ['neg-each-pair', 'neg-each-await', 'neg-each-entries', 'neg-each-record-field'].some((name) =>
    support.includes(`'${name}'`),
  );
  assert.ok(appended, 'E_RT10_NEG_EACH: rt10 must gain a NEW each refusal row, not just lose one');
});

test('the E.0 chain stage exists, strips exactly three paths, and heads the chain', () => {
  const transition = repositoryText('scripts/kern-canonicalizer/e0-loop-extraction-historical-transition.mjs');
  for (const path of E0_ADDED_DIST_PATHS) {
    assert.ok(transition.includes(`'${path}'`), `E0_CHAIN_STAGE: the stage must name ${path}`);
  }
  assert.ok(transition.includes(`count: ${E0_INVENTORY_COUNT},`), 'E0_CHAIN_STAGE: the current inventory count moved');
  const dependencies = repositoryText('scripts/kern-canonicalizer/coverage-dependencies.mjs');
  const composite = dependencies.indexOf('export function reconstructRunnerCallCacheCompiledCoreJavaScriptPaths');
  const head = dependencies.indexOf('reconstructE0LoopExtractionCompiledCoreJavaScriptPaths(paths)', composite);
  const next = dependencies.indexOf('reconstructD0ContractsSplitCompiledCoreJavaScriptPaths(', composite);
  assert.ok(head > composite, 'E0_CHAIN_STAGE: the E.0 stage is not called with the live paths');
  assert.ok(head < next, 'E0_CHAIN_ORDER: the E.0 stage must run before the D.0 stage');
});

test('F5 is untouched: no schema, catalog or structural edit is required by this slice', () => {
  for (const path of [
    'packages/core/src/schema.ts',
    'packages/core/src/kir-structural/catalog.generated.ts',
    'packages/core/src/kir-structural/each-collection-reference.ts',
  ]) {
    const text = repositoryText(path);
    for (const label of ['KIR_EACH_SOURCE_NOT_PARAMETER', 'KIR_DO_EXPRESSION_NOT_USER_CALL']) {
      assert.equal(text.includes(label), false, `E_F5_TOUCH: ${path} must not carry the link-time label ${label}`);
    }
  }
});

test('the spec exists, carries every acceptance group, and is loadable in one session', () => {
  const spec = repositoryText(SPEC_PATH);
  const lines = spec.split('\n').length - 1;
  assert.ok(lines < 900, `E_SPEC_SIZE: the spec is ${lines} lines and must load in one session`);
  const { criteria, groups } = specCriteria();
  assert.ok(criteria.length >= 30, `E_SPEC_THIN: ${criteria.length} acceptance criteria is thinner than the row set`);
  for (const group of ['E.0 — extraction (GREEN guards)', 'E1 — `do`', 'E2 — `each`', 'E3 — pins and ledger']) {
    assert.ok(groups.includes(group), `E_SPEC_SHAPE: the acceptance criteria must carry the ${group} group`);
  }
  for (const section of ['## Corrections Log', '## Deploy Order', '## Blast Radius', '## Confidence']) {
    assert.ok(spec.includes(section), `E_SPEC_SHAPE: the spec must carry ${section}`);
  }
});
