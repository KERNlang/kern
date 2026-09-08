import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ADDED_DIST_PATHS,
  BASE_COMPILED_CORE_DIGEST,
  BASE_OMITTED_PATHS,
  C_PY_1_TRANSITION_SHA256,
  M4145_CHAIN_INPUT_COUNT,
  M4145_HISTORICAL_PATH_COUNT,
  PREDECESSOR_INVENTORY,
  SUCCESSOR_INVENTORY_COUNT,
  TRANSITION_CLAIM,
} from './pins.mjs';
import {
  TRANSITION_PATH,
  TRANSITION_TEST_PATH,
  compiledCorePaths,
  exists,
  hashPathInventory,
  readRepositoryText,
  repositoryPath,
} from './support.mjs';

const C_PY_1_PATH = 'scripts/kern-canonicalizer/c-py-1-lowering-historical-transition.mjs';
const COVERAGE_DEPENDENCIES = 'scripts/kern-canonicalizer/coverage-dependencies.mjs';
const COVERAGE_INTEGRITY = 'scripts/kern-canonicalizer/coverage-integrity.test.mjs';
const COVERAGE_PREREQUISITE = 'scripts/kern-canonicalizer/coverage-prerequisite.test.mjs';
const COVERAGE_SUMMARY = 'scripts/kern-canonicalizer/coverage-summary.json';
const RECONSTRUCTOR = 'reconstructD0ContractsSplitCompiledCoreJavaScriptPaths';
const VALIDATOR = 'validateD0ContractsSplitHistoricalTransition';
const RECORD = 'D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION';

async function transition() {
  assert.ok(exists(TRANSITION_PATH), `D0_TRANSITION_MISSING: ${TRANSITION_PATH} does not exist`);
  return import(new URL(`../../${TRANSITION_PATH}`, import.meta.url).href);
}

function omittedPathsInIntegrityTest() {
  const source = readRepositoryText(COVERAGE_INTEGRITY);
  const anchor = source.indexOf('const omitted = new Set(currentPaths.filter');
  assert.ok(anchor >= 0, 'D0_INTEGRITY_ANCHOR: the omitted-list assertion moved');
  const open = source.indexOf('assert.deepEqual([...omitted].sort(), [', anchor);
  assert.ok(open > anchor, 'D0_INTEGRITY_ANCHOR: the omitted deepEqual moved');
  const close = source.indexOf(']);', open);
  assert.ok(close > open, 'D0_INTEGRITY_ANCHOR: the omitted literal is unterminated');
  return [...source.slice(open, close).matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

function prerequisiteDigest() {
  const source = readRepositoryText(COVERAGE_PREREQUISITE);
  const match = /compiledCoreDigest: '([0-9a-f]{64})'/u.exec(source);
  assert.ok(match !== null, 'D0_PREREQUISITE_PIN: the compiledCoreDigest literal is gone');
  return match[1];
}

test('the live compiled-core inventory is 357 paths and holds the three new modules', () => {
  const paths = compiledCorePaths();
  assert.equal(
    paths.length,
    SUCCESSOR_INVENTORY_COUNT,
    'D0_INVENTORY_COUNT: the live compiled-core JavaScript inventory is not 357 paths',
  );
  for (const added of ADDED_DIST_PATHS) {
    assert.ok(paths.includes(added), `D0_INVENTORY_MEMBER: ${added} is not in the live inventory`);
  }
});

test('the new head-stage transition module carries the pinned frozen record', async () => {
  const module = await transition();
  const record = module[RECORD];
  assert.ok(Object.isFrozen(record), `D0_TRANSITION_SHAPE: ${RECORD} must be frozen`);
  assert.equal(record.claim, TRANSITION_CLAIM, 'D0_TRANSITION_SHAPE: the claim string drifted');
  assert.deepEqual(
    [...record.addedPaths],
    [...ADDED_DIST_PATHS],
    'D0_TRANSITION_SHAPE: addedPaths is not exactly the three new dist paths',
  );
  assert.equal(record.currentInventory.count, SUCCESSOR_INVENTORY_COUNT);
  assert.equal(
    record.predecessorInventory.count,
    PREDECESSOR_INVENTORY.count,
    'D0_TRANSITION_SHAPE: the predecessor count must stay 354',
  );
  assert.equal(
    record.predecessorInventory.digest,
    PREDECESSOR_INVENTORY.digest,
    'D0_TRANSITION_SHAPE: the predecessor digest must stay the c-py-1 head',
  );
  assert.match(record.predecessorCommit, /^[0-9a-f]{40}$/u);
  assert.match(record.successorCommit, /^[0-9a-f]{40}$/u);
});

test('the head reconstructor rebuilds the authenticated c-py-1 inventory', async () => {
  const module = await transition();
  const predecessor = module[RECONSTRUCTOR](compiledCorePaths());
  assert.equal(
    predecessor.length,
    PREDECESSOR_INVENTORY.count,
    'D0_RECONSTRUCTION: the head stage must hand back 354 paths',
  );
  assert.equal(
    hashPathInventory(predecessor),
    PREDECESSOR_INVENTORY.digest,
    'D0_RECONSTRUCTION: the reconstructed inventory does not hash to the c-py-1 head digest',
  );
  for (const added of ADDED_DIST_PATHS) {
    assert.equal(
      predecessor.includes(added),
      false,
      `D0_RECONSTRUCTION: ${added} leaked into the predecessor inventory`,
    );
  }
});

test('the validator refuses a mutated record and a malformed inventory', async () => {
  const module = await transition();
  const record = module[RECORD];
  assert.equal(module[VALIDATOR](), true);
  for (const mutation of [
    { ...record, claim: `${record.claim}-tampered` },
    { ...record, currentInventory: { ...record.currentInventory, count: 358 } },
    { ...record, addedPaths: [...record.addedPaths, 'kir-runtime/linked-kir-program/extra.js'] },
  ]) {
    assert.throws(
      () => module[VALIDATOR](mutation),
      /immutable identity changed/u,
      'D0_TRANSITION_MUTABLE: the validator accepted a mutated record',
    );
  }
  const live = compiledCorePaths();
  for (const malformed of [
    [...live, 'kir-runtime/linked-kir-program/extra.js'],
    live.slice(1),
    [...live, live[0]],
    [...live.slice(1), '../escaping.js'],
    [...live.slice(1), 'kir-runtime\\backslashed.js'],
    'not-an-array',
  ]) {
    assert.throws(
      () => module[RECONSTRUCTOR](malformed),
      /coverage dependency rejection/u,
      'D0_TRANSITION_LAX: the reconstructor accepted a malformed inventory',
    );
  }
});

test('the transition module has its own immutability oracle', () => {
  assert.ok(exists(TRANSITION_TEST_PATH), `D0_TRANSITION_UNTESTED: ${TRANSITION_TEST_PATH} is missing`);
  const source = readRepositoryText(TRANSITION_TEST_PATH);
  for (const symbol of [RECORD, RECONSTRUCTOR, VALIDATOR]) {
    assert.ok(source.includes(symbol), `D0_TRANSITION_UNTESTED: its oracle does not exercise ${symbol}`);
  }
});

test('coverage-dependencies wires the new head before the c-py-1 stage', () => {
  const source = readRepositoryText(COVERAGE_DEPENDENCIES);
  assert.ok(
    source.includes(RECONSTRUCTOR),
    'D0_WIRING_MISSING: coverage-dependencies does not import the new head reconstructor',
  );
  const composite = source.indexOf('export function reconstructRunnerCallCacheCompiledCoreJavaScriptPaths');
  assert.ok(composite >= 0, 'D0_WIRING_ANCHOR: the composite chain entry point moved');
  const head = source.indexOf(`${RECONSTRUCTOR}(paths)`, composite);
  const cPy1 = source.indexOf('reconstructCPy1LoweringCompiledCoreJavaScriptPaths(', composite);
  assert.ok(head > composite, 'D0_WIRING_MISSING: the new head is not called with the live paths');
  assert.ok(
    head < cPy1,
    'D0_WIRING_ORDER: the new head must run before the c-py-1 stage, not after it',
  );
  assert.equal(
    source.includes('reconstructCPy1LoweringCompiledCoreJavaScriptPaths(paths)'),
    false,
    'D0_WIRING_ORDER: the c-py-1 stage must no longer receive the live paths directly',
  );
});

test('the coverage-integrity omitted list gains exactly the three new dist paths', () => {
  const omitted = omittedPathsInIntegrityTest();
  assert.deepEqual(
    omitted,
    [...BASE_OMITTED_PATHS, ...ADDED_DIST_PATHS].sort(),
    'D0_OMITTED_LIST: the omitted deepEqual literal is not the base list plus the three new paths',
  );
  assert.deepEqual(omitted, [...omitted].sort(), 'D0_OMITTED_LIST: the literal must stay sorted');
});

// pnpm write:kern-canonicalizer-coverage regenerates coverage-summary.json; the prerequisite
// literal is the one value that must then be re-pinned by hand.
test('the compiled-core digest moves off its base value', () => {
  assert.notEqual(
    prerequisiteDigest(),
    BASE_COMPILED_CORE_DIGEST,
    'D0_DIGEST_NOT_REPINNED: three new dist files must move compiledCoreDigest off its base value',
  );
});

test('the prerequisite literal, the coverage summary and the live digest agree', async () => {
  const { digestCompiledCoreJavaScript } = await import(
    new URL(`../../${COVERAGE_DEPENDENCIES}`, import.meta.url).href
  );
  const live = digestCompiledCoreJavaScript();
  assert.equal(
    prerequisiteDigest(),
    live,
    'D0_DIGEST_SKEW: the coverage-prerequisite literal does not match the live compiled core',
  );
  assert.equal(
    JSON.parse(readRepositoryText(COVERAGE_SUMMARY)).compiledCoreDigest,
    live,
    'D0_DIGEST_SKEW: coverage-summary.json does not match the live compiled core',
  );
});

test('the c-py-1 stage is untouched and becomes a predecessor pin', () => {
  const bytes = readRepositoryText(C_PY_1_PATH);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    C_PY_1_TRANSITION_SHA256,
    'D0_CHAIN_REWRITTEN: the c-py-1 transition module must be byte-identical to base',
  );
  assert.ok(bytes.includes(`count: ${PREDECESSOR_INVENTORY.count},`));
  assert.ok(bytes.includes(PREDECESSOR_INVENTORY.digest));
});

test('the composite chain still delivers 317 paths into the M4.145 stage', async () => {
  const module = await import(new URL(`../../${COVERAGE_DEPENDENCIES}`, import.meta.url).href);
  const runnerCallCache = module.reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(compiledCorePaths());
  const retention = module.reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths(runnerCallCache);
  const compaction = module.reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths(retention);
  assert.equal(
    compaction.length,
    M4145_CHAIN_INPUT_COUNT,
    'D0_CHAIN_DRIFT: the M4.145 stage must still receive exactly 317 paths',
  );
  assert.equal(
    module.reconstructM4145CompiledCoreJavaScriptPaths(compaction).length,
    M4145_HISTORICAL_PATH_COUNT,
    'D0_CHAIN_DRIFT: the M4.145 historical inventory must stay at 305 paths',
  );
});

test('no fourth path leaks into the compiled core', () => {
  const live = compiledCorePaths();
  const added = live.filter(
    (path) => path.startsWith('kir-runtime/linked-kir-program/') && !path.endsWith('index.js'),
  );
  assert.deepEqual(
    added.sort(),
    [
      'kir-runtime/linked-kir-program/contracts.js',
      'kir-runtime/linked-kir-program/expression.js',
      ...ADDED_DIST_PATHS,
      'kir-runtime/linked-kir-program/link.js',
    ].sort(),
    'D0_INVENTORY_LEAK: the linked-kir-program dist membership is not the pinned six modules',
  );
});
